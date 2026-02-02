from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel
import torch
from pyannote.audio import Pipeline
import os
import logging
import json
import librosa
import numpy as np
import threading
from typing import List, Optional, Dict
from huggingface_hub import login

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="Diarization Worker")

HF_TOKEN = os.environ.get("HF_TOKEN")
pipeline = None

# Voice IDs (ElevenLabs) - Fallback defaults
DEFAULT_VOICES = {
    'male': [
        'nPczCjzI2devNBz1zQrb', # Brian
        'pNInz6obpgDQGcFmaJgB', # Adam
        'ErXwobaYiN019PkySvjV', # Antoni
        'JBFqnCBsd6RMkjVDRZzb', # George
        'IKne3meq5aSn9XLyUdCD', # Charlie
        'onwK4e9ZLuTAKqWW03F9'  # Daniel
    ],
    'female': [
        'Xb7hH8MSUJpSbSDYk0k2', # Alice
        '21m00Tcm4TlvDq8ikWAM', # Rachel
        'MF3mGyEYCl7XYWbV9V6O', # Elli
        'EXAVITQu4vr4xnSDxMaL', # Sarah
        'XrExE9yKIg1WjnnlVkGX', # Matilda
        'FGY2WhTYpPnrIDTdsKH5'  # Laura
    ]
}

VOICES = DEFAULT_VOICES.copy()

def load_dynamic_voices():
    global VOICES
    json_path = "/app/voices_list.json"
    if not os.path.exists(json_path):
        logger.warning(f"Voice list NOT found at {json_path}. Using fallback defaults.")
        return

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        voice_items = data.get('voices', [])
        if not voice_items:
            logger.warning("Empty voice list in JSON. Using fallbacks.")
            return

        new_male = []
        new_female = []
        
        for item in voice_items:
            vid = item.get('voice_id')
            labels = item.get('labels', {})
            gender = labels.get('gender', '').lower()
            
            if vid:
                if gender == 'male':
                    new_male.append(vid)
                elif gender == 'female':
                    new_female.append(vid)
        
        if new_male: VOICES['male'] = new_male
        if new_female: VOICES['female'] = new_female
        
        logger.info(f"Dynamically loaded {len(new_male)} male and {len(new_female)} female voices from JSON.")
    except Exception as e:
        logger.error(f"Failed to load dynamic voices: {e}. Keeping fallbacks.")

# Initial load
load_dynamic_voices()

class WhisperSegment(BaseModel):
    start: float
    end: float
    text: str

class DiarizeRequest(BaseModel):
    audioPath: str
    whisperSegments: List[WhisperSegment]

class EnhancedSegment(BaseModel):
    start: float
    end: float
    text: str
    speaker_id: str
    voice_id: str
    gender: str

def get_pitch(y, sr):
    if len(y) == 0: return 0
    try:
        # Use a simpler and faster pitch estimator if librosa fails or is too slow
        # fmin/fmax adjusted for human speech
        f0, voiced_flag, voiced_probs = librosa.pyin(y, fmin=65, fmax=400, sr=sr)
        voiced_f0 = f0[~np.isnan(f0)]
        if len(voiced_f0) == 0: 
            return 0
        return float(np.median(voiced_f0))
    except Exception as e:
        logger.warning(f"Pitch detection error: {e}")
        return 0

def load_pipeline():
    global pipeline
    if not HF_TOKEN:
        logger.error("!!! HF_TOKEN is missing !!! Diarization will not work.")
        return

    logger.info("Background Startup: Downloading/Loading pyannote pipeline. This stays in 503 status until finished.")
    try:
        login(token=HF_TOKEN)
        # Using the explicit 3.1 model for consistency
        new_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=HF_TOKEN
        )
        if new_pipeline is None:
            raise Exception("Pipeline from_pretrained returned None. Check HF permissions.")
        
        new_pipeline.to(torch.device("cpu"))
        pipeline = new_pipeline
        logger.info("!!! Pipeline is READY and loaded on CPU !!!")
    except Exception as e:
        logger.error(f"FATAL: Failed to load pipeline: {e}")
        logger.error("Please ensure you have accepted conditions for 'pyannote/speaker-diarization-3.1' and 'pyannote/segmentation-3.0' on HuggingFace.")

@app.on_event("startup")
def startup_event():
    # Start loading in background thread so server can start immediately
    # and pass healthchecks (returning 503) instead of "Connection Refused"
    thread = threading.Thread(target=load_pipeline, daemon=True)
    thread.start()

@app.post("/diarize", response_model=List[EnhancedSegment])
async def diarize(request: DiarizeRequest):
    if pipeline is None:
        raise HTTPException(status_code=500, detail="Pipeline not loaded. Check HF_TOKEN and logs.")

    if not os.path.exists(request.audioPath):
        logger.error(f"File not found: {request.audioPath}")
        raise HTTPException(status_code=404, detail=f"File not found: {request.audioPath}. Ensure shared volumes are correct.")

    try:
        logger.info(f"--- Diarization Request Starting ---")
        logger.info(f"Target Audio: {request.audioPath}")
        
        # 1. Run Diarization
        torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", 1)))
        diarization = pipeline(request.audioPath)
        
        diar_segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            # Ignore ultra-short noises
            if (turn.end - turn.start) < 0.2: 
                continue
            diar_segments.append({"start": turn.start, "end": turn.end, "speaker": speaker})

        unique_speakers = sorted(list(set(d['speaker'] for d in diar_segments)))
        logger.info(f"Diarization found {len(unique_speakers)} speakers: {unique_speakers}")
        
        # 1.5 Prepare Speaker Samples for Cloning (New)
        user_dir = os.path.dirname(request.audioPath)
        samples_dir = os.path.join(user_dir, 'speaker_samples')
        os.makedirs(samples_dir, exist_ok=True)
        
        if not unique_speakers:
            logger.warning("No speakers detected by pyannote. Defaulting to one speaker.")
            unique_speakers = ["SPEAKER_00"]

        # 2. Extract unique speakers and assign voices via pitch detection
        speaker_info = {} # speaker_id -> {voice_id, gender}
        
        # Load audio for analysis
        logger.info("Loading audio for pitch analysis...")
        y_full, sr = librosa.load(request.audioPath, sr=16000)
        
        male_cursor = 0
        female_cursor = 0
        
        for spk in unique_speakers:
            # Aggregate up to 20s of speech for this speaker to get a good pitch sample
            spk_audio = []
            dur = 0
            for d in diar_segments:
                if d['speaker'] == spk:
                    start_s = int(d['start'] * sr)
                    end_s = int(d['end'] * sr)
                    # Bounds check
                    if start_s < len(y_full):
                        spk_audio.extend(y_full[start_s:min(end_s, len(y_full))])
                    dur += (d['end'] - d['start'])
                    if dur > 20: break
            
            # Save a 10-second sample for the cloning API (New)
            if spk_audio:
                import soundfile as sf
                sample_path = os.path.join(samples_dir, f"{spk}_sample.wav")
                # Use only the first 10s for the sample
                sample_audio = np.array(spk_audio)[:int(10 * sr)]
                sf.write(sample_path, sample_audio, sr)
                logger.info(f"Saved speaker sample to {sample_path}")
            
            # Detect pitch
            pitch = get_pitch(np.array(spk_audio), sr) if len(spk_audio) > 1024 else 0
            
            # Determine gender (Threshold: 180Hz is a good midpoint for male/female)
            if pitch == 0:
                # Fallback to alternation if pitch detection fails
                gender = 'male' if (male_cursor + female_cursor) % 2 == 0 else 'female'
                logger.info(f"Speaker {spk}: Pitch detection failed, assigned {gender} by fallback.")
            else:
                gender = 'male' if pitch < 185 else 'female'
                logger.info(f"Speaker {spk}: Detected pitch {pitch:.1f}Hz -> {gender}")
            
            pool = VOICES[gender]
            if gender == 'male':
                voice_id = pool[male_cursor % len(pool)]
                male_cursor += 1
            else:
                voice_id = pool[female_cursor % len(pool)]
                female_cursor += 1
                
            speaker_info[spk] = {"voice_id": voice_id, "gender": gender}
            logger.info(f"Speaker {spk} final assignment: Voice={voice_id} ({gender})")

        # 3. Align Whisper segments to speakers
        logger.info(f"Aligning {len(request.whisperSegments)} Whisper segments...")
        results = []
        for w in request.whisperSegments:
            max_overlap = 0
            best_speaker = unique_speakers[0]
            
            w_start = w.start
            w_end = w.end
            
            for d in diar_segments:
                overlap = max(0, min(w_end, d['end']) - max(w_start, d['start']))
                if overlap > 0:
                    logger.debug(f"  Overlap found: {overlap:.2f}s with {d['speaker']}")
                if overlap > max_overlap:
                    max_overlap = overlap
                    best_speaker = d['speaker']
            
            # If no overlap, use closest diarization segment to avoid everyone being SPEAKER_00
            if max_overlap == 0 and diar_segments:
                min_dist = float('inf')
                for d in diar_segments:
                    dist = min(abs(w_start - d['end']), abs(w_end - d['start']))
                    if dist < min_dist:
                        min_dist = dist
                        best_speaker = d['speaker']
                logger.info(f"  No overlap for Whisper segment {w_start:.1f}-{w_end:.1f}. Closest speaker: {best_speaker}")
            else:
                logger.debug(f"  Assigned speaker {best_speaker} (Overlap: {max_overlap:.2f}s)")

            info = speaker_info.get(best_speaker, speaker_info[unique_speakers[0]])
            
            results.append({
                "start": w.start,
                "end": w.end,
                "text": w.text,
                "speaker_id": best_speaker,
                "voice_id": info["voice_id"],
                "gender": info["gender"]
            })
            
        logger.info(f"--- Diarization Request Complete. Returning {len(results)} segments. ---")
        return results

    except Exception as e:
        logger.error(f"Diarization critical failure: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@app.get("/health")
def health():
    if pipeline is None:
        # Return 503 so Docker healthcheck (curl -f) fails while loading
        raise HTTPException(status_code=503, detail="Pipeline still loading or failed to load. Check container logs.")
    return {"status": "ok", "pipeline_loaded": True}

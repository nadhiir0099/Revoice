import sys
import json
import asyncio
import subprocess
import os
import logging
import aiohttp
from pydub import AudioSegment
from dotenv import load_dotenv
import edge_tts

# Voice mapping for Edge TTS (Fallback)
EDGE_VOICES = {
    'en': 'en-US-GuyNeural',
    'fr': 'fr-FR-HenriNeural',
    'ar': 'ar-SA-HamedNeural',
    'tn': 'ar-TN-HediNeural',
    'default': 'en-US-GuyNeural'
}

# Force reload .env to catch key updates without container restart
load_dotenv(override=True)

# Configure logging to shared volume
logging.basicConfig(
    filename='uploads/dub_debug.log',
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    filemode='a' # Append to see history
)

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

async def generate_tts(text, voice_id, output_file):
    if not ELEVENLABS_API_KEY:
        error_msg = "CRITICAL: ELEVENLABS_API_KEY is missing from environment/env file!"
        print(error_msg, file=sys.stderr)
        logging.critical(error_msg)
        raise Exception(error_msg)

    logging.info(f"Generating ElevenLabs TTS for: {text[:50]}...")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY
    }
    
    data = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.5
        }
    }

    max_retries = 3
    for attempt in range(max_retries):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=data, headers=headers) as response:
                    if response.status != 200:
                        err_text = await response.text()
                        logging.error(f"ElevenLabs error ({response.status}) on attempt {attempt+1}: {err_text}")
                        
                        if response.status == 429:
                            msg = "!!! QUOTA EXCEEDED: Your ElevenLabs account has 0 characters left !!!"
                            print(msg, file=sys.stderr)
                            logging.error(msg)
                        elif response.status == 401:
                            msg = f"!!! AUTH FAILED: Is your API Key correct? (Status 401: {err_text})"
                            print(msg, file=sys.stderr)
                            logging.error(msg)
                        elif response.status == 404:
                            msg = f"!!! VOICE NOT FOUND: ID {voice_id} is missing from your account. Fallback will be used."
                            print(msg, file=sys.stderr)
                            logging.error(msg)
                            # Special case: don't retry a 404, it won't change
                            raise ValueError("VOICE_NOT_FOUND")
                        
                        if attempt == max_retries - 1:
                            raise Exception(f"ElevenLabs error {response.status}: {err_text}")
                        await asyncio.sleep(1) # Wait before retry
                        continue
                    
                    with open(output_file, 'wb') as f:
                        while True:
                            chunk = await response.content.read(4096)
                            if not chunk:
                                break
                            f.write(chunk)
                    
                    if os.path.getsize(output_file) < 100:
                        logging.warning(f"Generated file {output_file} is suspiciously small ({os.path.getsize(output_file)} bytes)")
                    
                    return # Success
        except Exception as e:
            if attempt == max_retries - 1:
                raise e
            logging.warning(f"TTS Attempt {attempt+1} failed: {e}. Retrying...")
            await asyncio.sleep(1)

async def generate_edge_tts(text, lang_code, output_file):
    logging.info(f"Generating Edge-TTS fallback for: {text[:50]}...")
    voice = EDGE_VOICES.get(lang_code, EDGE_VOICES['default'])
    
    # Simple check for Arabic script to use Arabic voice if lang is default/en
    if any('\u0600' <= c <= '\u06FF' for c in text):
        voice = EDGE_VOICES.get('tn') if lang_code == 'tn' else EDGE_VOICES.get('ar')

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_file)
    logging.info(f"Edge-TTS success with voice {voice}")

def stretch_audio(input_file, output_file, ratio):
    if ratio < 0.5: ratio = 0.5
    if ratio > 2.0: ratio = 2.0
    logging.info(f"Stretching {input_file} by {ratio}")
    cmd = [
        "ffmpeg", "-y", "-i", input_file,
        "-filter:a", f"atempo={ratio}",
        "-vn", output_file
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        logging.error(f"FFmpeg stretch failed: {res.stderr}")
        raise Exception("FFmpeg stretch failed")

def get_best_voice(lang_code, voice_type):
    # Mapping for ElevenLabs voices (using labels from voices_list.txt)
    # Male: Brian - Deep, Resonant and Comforting
    # Female: Alice - Clear, Engaging Educator
    voices_map = {
        'male': 'nPczCjzI2devNBz1zQrb',
        'female': 'Xb7hH8MSUJpSbSDYk0k2',
        'unknown': 'nPczCjzI2devNBz1zQrb'
    }
    return voices_map.get(voice_type, voices_map['unknown'])

async def main():
    try:
        if len(sys.argv) < 5:
            logging.error("Missing arguments")
            sys.exit(1)

        segments_path = sys.argv[1]
        original_file = sys.argv[2]
        output_path = sys.argv[3]
        lang_code = sys.argv[4]

        logging.info(f"Starting dubbing: {original_file} -> {lang_code}")
        
        # CRITICAL: We no longer perform global voice detection.
        # Each segment must have its own voice_id assigned during diarization.
        # Fallback voice only if mandatory.
        default_voice = 'nPczCjzI2devNBz1zQrb' # Brian (Male)
        logging.info(f"Segments path: {segments_path}")

        job_dir = os.path.dirname(os.path.abspath(original_file))
        temp_dir = os.path.join(job_dir, 'temp_dub')
        if not os.path.exists(temp_dir):
            os.makedirs(temp_dir, exist_ok=True)

        if not os.path.exists(segments_path):
            logging.error(f"Segments file not found: {segments_path}")
            sys.exit(1)

        with open(segments_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        segments = data.get('segments', data) if isinstance(data, dict) else data
        if not isinstance(segments, list):
            logging.error("Segments is not a list")
            sys.exit(1)

        logging.info(f"Processing {len(segments)} segments")
        combined_audio = AudioSegment.silent(duration=0)

        for i, seg in enumerate(segments):
            start_ms = int(seg.get('start', 0) * 1000)
            end_ms = int(seg.get('end', 0) * 1000)
            text = seg.get('text', '').strip()
            
            if not text: continue
            
            target_duration = end_ms - start_ms
            if target_duration <= 0: continue

            temp_tts = os.path.join(temp_dir, f"seg_{i}.mp3")
            temp_stretched = os.path.join(temp_dir, f"seg_{i}_final.mp3")

            # Determine voice to use: use specific 'voice_id' if present, otherwise default
            segment_voice = seg.get('voice_id') or seg.get('voiceId') or default_voice
            
            # Sanity check: if voice_id looks like an error message or is empty, use default
            if not segment_voice or len(segment_voice) < 10 or ' ' in segment_voice:
                logging.warning(f"Seg {i}: Invalid Voice ID '{segment_voice}'. Falling back to default.")
                segment_voice = default_voice

            logging.info(f"Seg {i}: VoiceID={segment_voice} (Text: {text[:30]}...)")

            try:
                try:
                    await generate_tts(text, segment_voice, temp_tts)
                except ValueError as ve:
                    if str(ve) == "VOICE_NOT_FOUND" and segment_voice != default_voice:
                        logging.warning(f"Voice {segment_voice} not found. Trying fallback {default_voice}...")
                        print(f"DEBUG: Voice {segment_voice} not found. Falling back to default.", file=sys.stderr)
                        await generate_tts(text, default_voice, temp_tts)
                    else:
                        raise ve

                audio_seg = AudioSegment.from_file(temp_tts)
                current_duration = len(audio_seg)
                ratio = current_duration / target_duration
                
                final_clip = audio_seg
                if ratio > 1.05 or ratio < 0.95:
                    stretch_audio(temp_tts, temp_stretched, ratio)
                    final_clip = AudioSegment.from_file(temp_stretched)
                
                if len(combined_audio) < start_ms:
                    combined_audio += AudioSegment.silent(duration=start_ms - len(combined_audio))
                
                combined_audio += final_clip
                logging.info(f"Seg {i} added. Current total: {len(combined_audio)}ms")

            except Exception as e:
                logging.warning(f"ElevenLabs failed for segment {i}: {e}. Trying Edge-TTS fallback...")
                print(f"DEBUG: ElevenLabs failed for segment {i}. Using Edge-TTS fallback.", file=sys.stderr)
                try:
                    await generate_edge_tts(text, lang_code, temp_tts)
                    audio_seg = AudioSegment.from_file(temp_tts)
                    current_duration = len(audio_seg)
                    ratio = current_duration / target_duration
                    
                    final_clip = audio_seg
                    if ratio > 1.05 or ratio < 0.95:
                        stretch_audio(temp_tts, temp_stretched, ratio)
                        final_clip = AudioSegment.from_file(temp_stretched)
                    
                    if len(combined_audio) < start_ms:
                        combined_audio += AudioSegment.silent(duration=start_ms - len(combined_audio))
                    
                    combined_audio += final_clip
                    logging.info(f"Seg {i} added via Edge-TTS.")
                except Exception as edge_e:
                    logging.error(f"FATAL: All TTS providers failed for segment {i}: {edge_e}")
                    print(f"DEBUG: All TTS providers failed for segment {i}: {edge_e}", file=sys.stderr)
                    combined_audio += AudioSegment.silent(duration=target_duration)

        logging.info(f"Exporting to {output_path}...")
        combined_audio.export(output_path, format="mp3")
        logging.info("Dubbing complete!")

        # Cleanup temp files
        try:
            for f in os.listdir(temp_dir):
                if f.endswith(".mp3"):
                    os.remove(os.path.join(temp_dir, f))
            logging.info("Cleaned up temp mp3 files.")
        except Exception as cleanup_error:
            logging.warning(f"Cleanup warning: {cleanup_error}")

    except Exception as e:
        logging.critical(f"Main loop failed: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())

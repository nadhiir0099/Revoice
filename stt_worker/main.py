import logging
import os
import subprocess
import tempfile
import time
from typing import List, Optional, Literal

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, HttpUrl

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("stt_worker")

app = FastAPI(title="STT Worker", version="1.0.0")


class STTRequest(BaseModel):
    creationId: str = Field(..., min_length=1)
    video_url: HttpUrl
    source_mode: Literal["original", "tunisian"]


class Segment(BaseModel):
    start: float
    end: float
    text: str


class STTResponse(BaseModel):
    creationId: str
    detected_language: Optional[str]
    segments: List[Segment]


class GroqError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": "Invalid input", "details": exc.errors()},
    )


def _round_ts(value: float) -> float:
    return round(float(value), 3)


def _download_to_path(url: str, dest_path: str) -> None:
    with httpx.stream("GET", url, follow_redirects=True, timeout=60.0) as response:
        if response.status_code != 200:
            raise RuntimeError(f"Download failed with status {response.status_code}")
        with open(dest_path, "wb") as handle:
            for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)


def _extract_audio(input_path: str, output_path: str) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-vn",
        output_path,
    ]
    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffmpeg failed")


def _call_groq(audio_path: str, source_mode: str) -> dict:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise GroqError("GROQ_API_KEY is not set", status_code=500)

    headers = {"Authorization": f"Bearer {api_key}"}
    data = [
        ("model", "whisper-large-v3"),
        ("temperature", "0"),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "segment"),
    ]
    if source_mode == "tunisian":
        data.append(("language", "ar"))

    with open(audio_path, "rb") as audio_file:
        files = {"file": (os.path.basename(audio_path), audio_file, "audio/wav")}
        with httpx.Client(timeout=300.0) as client:
            response = client.post(
                GROQ_TRANSCRIBE_URL, headers=headers, data=data, files=files
            )
    if response.status_code != 200:
        raise GroqError(
            f"Groq API error {response.status_code}: {response.text}",
            status_code=502,
        )
    return response.json()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/stt", response_model=STTResponse)
def stt(request: STTRequest) -> STTResponse:
    start_total = time.time()
    creation_id = request.creationId
    download_s = 0.0
    ffmpeg_s = 0.0
    groq_s = 0.0

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.bin")
            audio_path = os.path.join(temp_dir, "audio.wav")

            download_start = time.time()
            _download_to_path(str(request.video_url), input_path)
            download_s = time.time() - download_start

            ffmpeg_start = time.time()
            _extract_audio(input_path, audio_path)
            ffmpeg_s = time.time() - ffmpeg_start

            groq_start = time.time()
            groq_response = _call_groq(audio_path, request.source_mode)
            groq_s = time.time() - groq_start

        raw_segments = groq_response.get("segments") or []
        if not raw_segments and groq_response.get("text"):
            raw_segments = [
                {
                    "start": 0.0,
                    "end": groq_response.get("duration") or 0.0,
                    "text": groq_response.get("text") or "",
                }
            ]

        segments: List[Segment] = []
        for segment in raw_segments:
            text = (segment.get("text") or "").strip()
            start = _round_ts(segment.get("start", 0.0))
            end = _round_ts(segment.get("end", 0.0))
            segments.append(Segment(start=start, end=end, text=text))

        response_payload = STTResponse(
            creationId=creation_id,
            detected_language=groq_response.get("language"),
            segments=segments,
        )

        total_s = time.time() - start_total
        logger.info(
            "stt_job creationId=%s download_s=%.3f ffmpeg_s=%.3f groq_s=%.3f total_s=%.3f",
            creation_id,
            download_s,
            ffmpeg_s,
            groq_s,
            total_s,
        )

        return response_payload
    except GroqError as exc:
        logger.error(
            "groq_error creationId=%s error=%s",
            creation_id,
            str(exc),
        )
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except RuntimeError as exc:
        logger.error(
            "stt_runtime_error creationId=%s error=%s",
            creation_id,
            str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.exception(
            "stt_unexpected_error creationId=%s error=%s",
            creation_id,
            str(exc),
        )
        raise HTTPException(status_code=500, detail="Internal server error")

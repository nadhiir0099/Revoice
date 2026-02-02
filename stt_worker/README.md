# STT Worker

FastAPI worker that downloads a video file, extracts audio with ffmpeg, and sends it to Groq Whisper STT.

## Requirements

- Python 3.10+
- ffmpeg on PATH
- `GROQ_API_KEY` environment variable

## Install

```bash
pip install -r requirements.txt
```

## Run locally

```bash
uvicorn main:app --port 8000
```

## Example request

```bash
curl -X POST "http://localhost:8000/stt" \
  -H "Content-Type: application/json" \
  -d '{
    "creationId": "abc123",
    "video_url": "https://example.com/video.mp4",
    "source_mode": "tunisian"
  }'
```

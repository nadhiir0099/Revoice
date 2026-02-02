# Video Compression Guide

## Quick Start

### Option 1: Using the Python Script (Recommended)
```bash
python compress_video.py "path/to/your/video.mp4"
```

This will create a compressed version with `_compressed` suffix.

### Option 2: Using FFmpeg Directly
```bash
ffmpeg -i input.mp4 -c:v libx264 -crf 28 -preset medium -c:a aac -b:a 64k output.mp4
```

## Expected Results

For a **300MB video**, you should get:
- **Compressed size**: ~60-90MB (70-80% reduction)
- **Quality**: Minimal visual loss, perfect for transcription
- **Upload time**: ~8-12 minutes (vs 40 minutes for original)

## Settings Explained

| Setting | Value | Why |
|---------|-------|-----|
| `-crf 28` | Quality level | Good balance (lower = better quality, higher file size) |
| `-preset medium` | Encoding speed | Balances compression time and file size |
| `-b:a 64k` | Audio bitrate | Sufficient for clear speech transcription |

## Adjusting Quality

If you need **smaller files** (more compression):
```bash
python compress_video.py input.mp4 -crf 32
```

If you need **better quality** (less compression):
```bash
python compress_video.py input.mp4 -crf 23
```

## Alternative: Online Tools

If you don't have FFmpeg installed:
1. **HandBrake** (Free, Windows/Mac): https://handbrake.fr/
   - Use "Fast 1080p30" preset
   - Set audio to 64kbps AAC
   
2. **Online Converter**: https://www.freeconvert.com/video-compressor
   - Upload your video
   - Choose "Medium" quality
   - Download compressed version

## Troubleshooting

**"ffmpeg not found"**
- Install FFmpeg: `winget install ffmpeg` (Windows)
- Or download from: https://ffmpeg.org/download.html

**Video too large after compression**
- Increase CRF value: `-crf 32` or `-crf 35`
- Reduce resolution: add `-vf scale=1280:720` for 720p

**Audio quality poor**
- Increase audio bitrate: `-b:a 96k` or `-b:a 128k`

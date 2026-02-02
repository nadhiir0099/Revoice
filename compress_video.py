#!/usr/bin/env python3
"""
Video Compression Script
Compresses video files while maintaining good quality for transcription.
Target: Reduce file size by 70-80% with minimal quality loss.
"""

import sys
import subprocess
import os

def compress_video(input_path, output_path=None):
    """
    Compress video using H.264 with optimized settings.
    
    Settings:
    - CRF 28: Good balance between quality and size (18=high quality, 28=medium, 32=lower)
    - Preset medium: Good compression/speed balance
    - Audio: 64k AAC (sufficient for speech)
    """
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        return False
    
    if output_path is None:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_compressed{ext}"
    
    print(f"Compressing: {input_path}")
    print(f"Output: {output_path}")
    print("This may take a few minutes...\n")
    
    command = [
        'ffmpeg',
        '-i', input_path,
        '-c:v', 'libx264',           # H.264 video codec
        '-crf', '28',                # Quality (lower = better, 18-28 recommended)
        '-preset', 'medium',         # Encoding speed/compression balance
        '-c:a', 'aac',               # AAC audio codec
        '-b:a', '64k',               # Audio bitrate (sufficient for speech)
        '-movflags', '+faststart',   # Enable streaming
        '-y',                        # Overwrite output
        output_path
    ]
    
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        
        # Show file size comparison
        original_size = os.path.getsize(input_path) / (1024 * 1024)  # MB
        compressed_size = os.path.getsize(output_path) / (1024 * 1024)  # MB
        reduction = ((original_size - compressed_size) / original_size) * 100
        
        print(f"\n✓ Compression complete!")
        print(f"Original size: {original_size:.2f} MB")
        print(f"Compressed size: {compressed_size:.2f} MB")
        print(f"Reduction: {reduction:.1f}%")
        print(f"\nSaved to: {output_path}")
        
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error during compression: {e.stderr}")
        return False
    except Exception as e:
        print(f"Unexpected error: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python compress_video.py <input_video> [output_video]")
        print("\nExample:")
        print("  python compress_video.py my_video.mp4")
        print("  python compress_video.py my_video.mp4 compressed.mp4")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    success = compress_video(input_file, output_file)
    sys.exit(0 if success else 1)

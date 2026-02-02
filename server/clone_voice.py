import sys
import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

def add_voice(name, file_path):
    url = "https://api.elevenlabs.io/v1/voices/add"
    
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY
    }
    
    data = {
        'name': name,
        'description': f"Cloned voice for {name}",
        'labels': json.dumps({'vocal_fuse': 'true'})
    }
    
    files = [
        ('files', (os.path.basename(file_path), open(file_path, 'rb'), 'audio/wav'))
    ]
    
    response = requests.post(url, headers=headers, data=data, files=files)
    
    if response.status_code != 200:
        print(f"Error: {response.text}", file=sys.stderr)
        return None
    
    return response.json().get("voice_id")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python clone_voice.py <speaker_name> <sample_file_path>", file=sys.stderr)
        sys.exit(1)
        
    speaker_name = sys.argv[1]
    sample_path = sys.argv[2]
    
    if not os.path.exists(sample_path):
        print(f"Error: Sample file not found: {sample_path}", file=sys.stderr)
        sys.exit(1)
        
    voice_id = add_voice(speaker_name, sample_path)
    if voice_id:
        print(voice_id)
    else:
        sys.exit(1)

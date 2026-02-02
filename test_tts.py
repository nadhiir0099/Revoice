import requests
import os

API_KEY = "sk_805f139db85f2119498e83938d564efe70690379a4fc2a52"
VOICE_ID = "nPczCjzI2devNBz1zQrb" # Brian
URL = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"

headers = {
    "Accept": "audio/mpeg",
    "Content-Type": "application/json",
    "xi-api-key": API_KEY
}

data = {
    "text": "Hello",
    "model_id": "eleven_multilingual_v2"
}

print(f"Testing TTS for {API_KEY[:10]}...")
response = requests.post(URL, json=data, headers=headers)

print(f"Status: {response.status_code}")
print(f"Response: {response.text[:200]}")

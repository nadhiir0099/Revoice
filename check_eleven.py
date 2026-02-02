import requests
import os

API_KEY = "sk_805f139db85f2119498e83938d564efe70690379a4fc2a52"
URL = "https://api.elevenlabs.io/v1/user"

headers = {
    "xi-api-key": API_KEY
}

print(f"Checking account for {API_KEY[:10]}...")
response = requests.get(URL, headers=headers)

print(f"Status: {response.status_code}")
print(f"Response: {response.text}")

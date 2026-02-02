import requests
import json
import os

API_KEY = "sk_9d96424ef94351bc2913105783f62fec48b7001df66c3451"
URL = "https://api.elevenlabs.io/v1/voices"
OUTPUT_FILE = r"c:\Users\nadhi\OneDrive\Desktop\fuse\server\voices_list_utf8.json"

headers = {
    "xi-api-key": API_KEY,
    "Content-Type": "application/json"
}

print(f"Syncing voices for new key...")
response = requests.get(URL, headers=headers)

if response.status_code == 200:
    voices_data = response.json()
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(voices_data, f, indent=2)
    print(f"Successfully updated {OUTPUT_FILE} with {len(voices_data.get('voices', []))} voices.")
else:
    print(f"Error: {response.status_code}")
    print(response.text)

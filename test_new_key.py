import requests
import os

API_KEY = "sk_9d96424ef94351bc2913105783f62fec48b7001df66c3451"
URL = "https://api.elevenlabs.io/v1/user"

headers = {
    "xi-api-key": API_KEY
}

print(f"Testing new key: {API_KEY[:10]}...")
response = requests.get(URL, headers=headers)

print(f"Status: {response.status_code}")
if response.status_code == 200:
    print("Success! Key is active and not flagged.")
    user_data = response.json()
    print(f"Subscription: {user_data.get('subscription', {}).get('tier', 'unknown')}")
    print(f"Character Count: {user_data.get('subscription', {}).get('character_count', 0)} / {user_data.get('subscription', {}).get('character_limit', 0)}")
else:
    print(f"Failed: {response.text}")

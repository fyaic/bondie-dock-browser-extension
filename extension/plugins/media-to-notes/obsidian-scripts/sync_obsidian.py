import urllib.request
import urllib.error
import os
import sys
import argparse
from dotenv import load_dotenv

# Load environment variables from parent directory
current_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(current_dir, '..', '.env')
load_dotenv(env_path)

# Configuration
API_KEY = os.getenv("OBSIDIAN_API_KEY")
HOST = os.getenv("OBSIDIAN_HOST", "127.0.0.1")
PORT = int(os.getenv("OBSIDIAN_PORT", "27123"))

if not API_KEY:
    raise ValueError("OBSIDIAN_API_KEY not found in environment variables")

def sync_to_obsidian(file_path):
    if not os.path.exists(file_path):
        print(f"Error: File not found at {file_path}")
        return

    filename = os.path.basename(file_path)

    print(f"Reading {file_path}...")
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    # Obsidian Local REST API endpoint for creating/updating a file
    url = f"http://{HOST}:{PORT}/vault/{filename}"

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "text/markdown",
        "Accept": "*/*"
    }

    print(f"Syncing to Obsidian at {url}...")
    req = urllib.request.Request(url, data=content.encode('utf-8'), headers=headers, method='PUT')

    try:
        with urllib.request.urlopen(req) as response:
            print(f"Success! Status Code: {response.getcode()}")
            if response.getcode() != 204:
                print(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} {e.reason}")
        print(e.read().decode('utf-8'))
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Sync a markdown file to Obsidian Vault.')
    parser.add_argument('file_path', help='The absolute path to the markdown file to sync')

    args = parser.parse_args()
    sync_to_obsidian(args.file_path)

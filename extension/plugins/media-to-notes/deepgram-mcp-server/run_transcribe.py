
import asyncio
import base64
import os
import sys
import json
import traceback
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from dotenv import load_dotenv

# Load environment variables
# Check if .env exists in current dir, otherwise check parent
current_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(current_dir, ".env")
if not os.path.exists(env_path):
    env_path = os.path.join(current_dir, "..", ".env")

load_dotenv(env_path)

async def run(input_file="temp_audio_best.m4a"):
    # Get absolute path to the server script
    # Assumes we are running from within reddheeraj-deepgram-mcp or referencing it relatively
    # Ideally, server_script should be robust.
    # If this script is in reddheeraj-deepgram-mcp, then dist is in current_dir

    script_dir = os.path.dirname(os.path.abspath(__file__))
    server_script = os.path.join(script_dir, "dist", "index.js")

    # Check for .env file and API Key (or env var)
    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        print("❌ Error: Valid Deepgram API Key not found in environment.")
        return

    print(f"Connecting to MCP server at: {server_script}")

    server_params = StdioServerParameters(
        command="node",
        args=[server_script, "--stdio"],
        env=os.environ.copy()
    )

    try:
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                print("Initializing session...")
                await session.initialize()

                audio_file = input_file
                if not os.path.exists(audio_file):
                    # Fallback check
                    if input_file == "temp_audio_best.m4a" and os.path.exists("temp_audio.m4a"):
                         audio_file = "temp_audio.m4a"
                         print(f"Default file not found, using: {audio_file}")
                    else:
                        print(f"Error: Audio file not found: {audio_file}")
                        return

                print(f"Reading audio file: {audio_file}...")
                with open(audio_file, "rb") as f:
                    audio_bytes = f.read()
                    audio_data = base64.b64encode(audio_bytes).decode("utf-8")

                print(f"Audio file read. Size: {len(audio_bytes)} bytes")

                print("Calling transcribe_audio tool...")
                # Deepgram MCP typically returns a text result with JSON content
                result = await session.call_tool(
                    "transcribe_audio",
                    arguments={
                        "audioData": audio_data,
                        "model": "nova-2",
                        # "detect_language": True,  # Let Deepgram detect language
                        "language": "zh", # Force Chinese
                        "punctuate": True,
                        "diarize": True,
                        "paragraphs": True,
                        "smart_format": True
                    }
                )

                if result.content and result.content[0].type == 'text':
                    try:
                        # Try to parse as JSON first
                        transcript_text = result.content[0].text
                        print("\n=== RAW RESPONSE START ===\n")
                        print(transcript_text[:2000])
                        print("\n=== RAW RESPONSE END ===\n")

                        try:
                            transcript_json = json.loads(transcript_text)
                            final_transcript = ""

                            if 'results' in transcript_json and 'channels' in transcript_json['results']:
                                channel = transcript_json['results']['channels'][0]
                                if 'alternatives' in channel and len(channel['alternatives']) > 0:
                                    final_transcript = channel['alternatives'][0]['transcript']
                            elif 'transcript' in transcript_json:
                                final_transcript = transcript_json['transcript']
                            else:
                                # Fallback: just use the raw text if it looks like a transcript
                                final_transcript = transcript_text
                        except json.JSONDecodeError:
                            # If not JSON, use the text directly
                            final_transcript = transcript_text

                        print("\n=== TRANSCRIPTION RESULT ===\n")
                        print(final_transcript[:500] + "..." if len(final_transcript) > 500 else final_transcript)

                        # Save to file
                        output_filename = f"transcript_{os.path.basename(audio_file)}.txt"
                        with open(output_filename, "w", encoding="utf-8") as f:
                            f.write(final_transcript)
                        print(f"\n(Transcript saved to {output_filename})")
                        print("\n============================\n")

                    except Exception as e:
                        print(f"Error processing result: {e}")
                        print(result.content[0].text)
                else:
                    print("Unexpected result format:")
                    print(result)

    except Exception as e:
        print(f"An error occurred: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    file_path = sys.argv[1] if len(sys.argv) > 1 else "temp_audio_best.m4a"
    asyncio.run(run(file_path))

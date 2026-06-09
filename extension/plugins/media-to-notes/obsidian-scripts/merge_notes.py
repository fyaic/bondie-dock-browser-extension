import os

# Paths
source_file = r"c:\Users\ryshi\.trae\research-test\音视频MCP\Video_Notes_AI_Museum_Guide.md"
target_file = r"c:\Users\ryshi\Documents\AIC-000\连贯性的例子：讲解机 - AI大模型=聊天式讲解.md"

def merge_notes():
    print(f"Source: {source_file}")
    print(f"Target: {target_file}")

    if not os.path.exists(source_file):
        print("❌ Error: Source file not found.")
        return

    if not os.path.exists(target_file):
        print("❌ Error: Target file not found.")
        return

    try:
        # Read source content
        with open(source_file, "r", encoding="utf-8") as f:
            source_content = f.read()

        # Read target content (to check encoding and existing content)
        with open(target_file, "r", encoding="utf-8") as f:
            target_content = f.read()

        # Prepare content to append
        # Add a newline and separator if the file is not empty
        separator = "\n\n---\n\n## Video Notes: AI Museum Guide\n\n"

        # Append
        new_content = target_content + separator + source_content

        # Write back
        with open(target_file, "w", encoding="utf-8") as f:
            f.write(new_content)

        print("✅ Success! Content merged into target note.")
        print(f"New file size: {len(new_content)} bytes")

    except Exception as e:
        print(f"❌ Error during merge: {str(e)}")

if __name__ == "__main__":
    merge_notes()

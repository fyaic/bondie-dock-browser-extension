import os

vault_path = r"c:\Users\ryshi\Documents\AIC-000"
search_terms = ["讲解员", "Museum", "导游"]

print(f"Searching in {vault_path}...")

found_files = []

for root, dirs, files in os.walk(vault_path):
    for file in files:
        if file.endswith(".md"):
            for term in search_terms:
                if term in file:
                    full_path = os.path.join(root, file)
                    found_files.append(full_path)
                    print(f"Found candidate: {full_path}")
                    break

if not found_files:
    print("No matching files found.")

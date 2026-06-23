#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/extension"
DIST_DIR="$ROOT_DIR/dist"
VERSION_NAME="$(python3 - <<'PY' "$EXT_DIR/manifest.json"
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    manifest = json.load(f)

print(manifest.get("version_name") or manifest["version"])
PY
)"
PACKAGE_NAME="bondie-dock-browser-extension-$VERSION_NAME.zip"

mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR/$PACKAGE_NAME"

(
  cd "$EXT_DIR"
  zip -qr "$DIST_DIR/$PACKAGE_NAME" .
)

echo "$DIST_DIR/$PACKAGE_NAME"

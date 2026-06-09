#!/usr/bin/env bash
# Browser Host wrapper for the bundled Media to Notes pipeline.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${OPENCLAW_MEDIA_NOTES_ENV_FILE:-$PLUGIN_DIR/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: run.sh <url-or-file> [pipeline flags]" >&2
  exit 1
fi

INPUT="$1"
shift || true

OUTPUT_DIR="${OPENCLAW_MEDIA_NOTES_OUTPUT_DIR:-${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}/browser-notes}"
mkdir -p "$OUTPUT_DIR"

exec "$PLUGIN_DIR/scripts/run-pipeline.sh" "$INPUT" --output-dir "$OUTPUT_DIR" "$@"

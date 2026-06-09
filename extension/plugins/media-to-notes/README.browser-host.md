# Media to Notes Browser Host Plugin

This directory is bundled with OpenClaw Browser Host. It is intentionally copied into the extension package so the browser extension owns the ability it exposes.

## Runtime Contract

- Chrome does not execute this shell pipeline directly.
- The Browser Host sends the configured local plugin path and page context to OpenClaw.
- OpenClaw executes `run.sh` on the local machine and writes Markdown notes to the OpenClaw workspace.
- The default output directory is `${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}/browser-notes`.

## Configuration

Create a `.env` next to `run.sh` or set `OPENCLAW_MEDIA_NOTES_ENV_FILE` to another env file path.

Required for full media understanding:

- `MEDIA_API_KEY`

Optional:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `DEEPGRAM_API_KEY`
- `GITHUB_TOKEN`
- `WEB_FETCH_YT_DLP`
- `WEB_FETCH_FFMPEG`
- `DOUYIN_COOKIE_FILE`

## Invocation

```bash
OPENCLAW_WORKSPACE="$HOME/.openclaw/workspace" ./run.sh "https://example.com" --skip-polish
```

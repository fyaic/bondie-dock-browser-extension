## Liev Workspace Contract

Materialize these files before editing code:

```text
.liev/brief.md
.liev/plan.md
.liev/validation.md
.liev/progress.md
.liev/status.sh
```

Use the contents from `/Users/fuyo-aic/Projects/openclaw-browser-host-extension/.liev/protocol-v4/`.

### Goal

Make `OpenClaw Browser Host` Chrome extension compatible with OpenClaw gateway protocol 4 and verify no new `protocol mismatch` log lines for extension origin.

### Repo

`https://github.com/veil-chow-fyaic/openclaw-browser-host-extension`

### Validation

Run:

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/content.js"
node --check "extension/src/options.js"
node --check "extension/src/popup.js"
node --check "extension/src/confirm.js"
test ! -f "extension/src/history.js" || node --check "extension/src/history.js"
test ! -f "extension/src/pattern-memory.js" || node --check "extension/src/pattern-memory.js"
./scripts/package-extension.sh
```

### Forbidden

Do not touch ACP adapter/runtime/delivery queue, WeCom channel/extension, enterprise WeChat flows, or unrelated gateway server code.

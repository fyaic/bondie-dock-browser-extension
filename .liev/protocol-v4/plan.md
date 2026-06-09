# Plan: Browser Host Protocol 4 Hotfix

## Child-Owned Phases

- [x] Phase 1: Confirm original protocol mismatch and current code path
  - Read `~/.openclaw/logs/gateway.err.log`.
  - Confirmed the original installed extension advertised `minProtocol/maxProtocol = 3`.
  - Confirmed this task is not ACP, WeCom, or delivery queue work.

- [x] Phase 2: Implement protocol 4 compatibility in the Browser Host extension
  - Updated the protocol constant or negotiation helper so the extension advertises protocol 4 to the gateway.
  - Preserve existing auth, device identity, pairing, command list, and reconnect behavior.
  - Kept payload changes scoped to Browser Host connect/heartbeat compatibility.

- [x] Phase 3: Update docs and runbook
  - Updated gateway protocol notes and install/test docs to show protocol 4 compatibility.
  - Recorded the extension id and gateway log symptom used for validation.

- [x] Phase 4: Validate and package
  - Ran static validation.
  - Ran packaging.
  - Loaded the unpacked Chrome extension in a non-default local validation profile.
  - Verified `gateway.err.log` had no new `protocol mismatch` entries for `chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf` during the observation window.

- [x] Phase 5: Handoff
  - Pushed the review branch.
  - Commented validation evidence and local browser/gateway notes in Linear.
  - Moved the issue to `In Review` after validation evidence was present.

## Acceptance Criteria

- [x] Browser Host extension advertises/supports protocol 4 with the local OpenClaw gateway.
- [x] CLI/CDP validation profile loaded service worker `0.1.11` and no longer emitted `protocol mismatch` or `unauthorized role: node` after alpha.11 worker load.
- [x] Popup/options and existing page workflow capabilities are not regressed by syntax/package checks.
- [x] Docs mention gateway protocol 4 compatibility.
- [x] PR or review branch is created against `fyaic/openclaw-browser-host-extension`.

## Validation Command

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/background-entry.js"
node --check "extension/src/content.js"
node --check "extension/src/options.js"
node --check "extension/src/popup.js"
node --check "extension/src/confirm.js"
test ! -f "extension/src/history.js" || node --check "extension/src/history.js"
test ! -f "extension/src/pattern-memory.js" || node --check "extension/src/pattern-memory.js"
./scripts/package-extension.sh
```

## Browser / Gateway Validation

```bash
before="$(wc -l < ~/.openclaw/logs/gateway.err.log)"
# reload the unpacked extension in Chrome, then wait 60 seconds
sleep 60
tail -n +"$((before + 1))" ~/.openclaw/logs/gateway.err.log | rg "chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf|protocol mismatch" || true
```

Pass condition: no new `protocol mismatch` line for the Browser Host extension origin.

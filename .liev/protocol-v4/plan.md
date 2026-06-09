# Plan: Browser Host Protocol 4 Hotfix

## Child-Owned Phases

- [ ] Phase 1: Confirm protocol mismatch and current code path
  - Read `~/.openclaw/logs/gateway.err.log`.
  - Confirm `extension/src/background.js` sends `minProtocol/maxProtocol` as protocol 3.
  - Confirm this task is not ACP, WeCom, or delivery queue work.

- [ ] Phase 2: Implement protocol 4 compatibility in the Browser Host extension
  - Update the protocol constant or negotiation helper so the extension advertises protocol 4 to the gateway.
  - Preserve existing auth, device identity, pairing, command list, and reconnect behavior.
  - If protocol 4 requires a payload adjustment, keep it scoped to Browser Host connect/invoke compatibility.

- [ ] Phase 3: Update docs and runbook
  - Update gateway protocol notes and install/test docs to show protocol 4 compatibility.
  - Record the extension id and gateway log symptom used for validation.

- [ ] Phase 4: Validate and package
  - Run static validation.
  - Run packaging.
  - Reload the unpacked Chrome extension if local Chrome validation is available.
  - Verify `gateway.err.log` has no new `protocol mismatch` entries for `chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf` during the observation window.

- [ ] Phase 5: Handoff
  - Open a PR.
  - Comment validation evidence and any local browser/gateway blockers in Linear.
  - Move the issue to `In Review` only after validation evidence is present.

## Acceptance Criteria

- [ ] Browser Host extension advertises/supports protocol 4 with the local OpenClaw gateway.
- [ ] `~/.openclaw/logs/gateway.err.log` no longer emits `protocol mismatch` for extension origin after reload and 60 seconds observation.
- [ ] Popup/options and existing page workflow capabilities are not regressed by syntax/package checks.
- [ ] Docs mention gateway protocol 4 compatibility.
- [ ] PR is created against `veil-chow-fyaic/openclaw-browser-host-extension`.

## Validation Command

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

## Browser / Gateway Validation

```bash
before="$(wc -l < ~/.openclaw/logs/gateway.err.log)"
# reload the unpacked extension in Chrome, then wait 60 seconds
sleep 60
tail -n +"$((before + 1))" ~/.openclaw/logs/gateway.err.log | rg "chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf|protocol mismatch" || true
```

Pass condition: no new `protocol mismatch` line for the Browser Host extension origin.

# Issue Draft: Browser Host Protocol 4 Hotfix

## Title

Bug: OpenClaw Browser Host protocol 4 compatibility - fix Chrome extension gateway mismatch

## Description

## Background

The local OpenClaw gateway is rejecting the installed Chrome OpenClaw Browser Host extension during WebSocket connect.

Observed log:

```text
client=OpenClaw Browser Host node v0.1.0-alpha.7
min=3 max=3
expected=4 probeMin=4
origin=chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf
code=1002 reason=protocol mismatch
```

Meaning:

- Gateway expects protocol 4.
- Browser Host extension currently supports/advertises protocol 3 only.
- The extension retries `127.0.0.1:18789` and gets rejected.

Impact:

- Browser Host / Chrome plugin capabilities are affected: browser-side control, page context injection, extension bridge.

Not impacted and not in scope:

- ACP adapter.
- WeCom channel.
- Enterprise WeChat send/receive.
- ACP file delivery and delivery queue.

## Goal

Upgrade/fix OpenClaw Browser Host Chrome extension compatibility so it supports gateway protocol 4 and stops producing protocol mismatch logs.

## Repo

https://github.com/veil-chow-fyaic/openclaw-browser-host-extension

## Scope

- Inspect `extension/src/background.js` protocol negotiation and `sendOpenClawNodeConnect()`.
- Update the extension to support/advertise protocol 4.
- Preserve existing pairing/deviceToken, Ed25519 signature, invoke/result, `node.event`, popup/options, and Browser Workflow features.
- Update gateway protocol docs/runbook.
- Validate package and local gateway log behavior.

## Out of Scope

- ACP adapter/runtime/delivery queue.
- WeCom channel or extension.
- Enterprise WeChat send/receive flow.
- OpenClaw gateway server changes unless extension-side compatibility is impossible; if so, record a blocker.
- Native Messaging, new broad permissions, local command execution, or secrets.

## Acceptance Criteria

- [ ] Extension advertises/supports protocol 4 when connecting to gateway.
- [ ] `~/.openclaw/logs/gateway.err.log` has no new `protocol mismatch` lines for `chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf` after extension reload and 60 seconds observation.
- [ ] Static/package validation passes.
- [ ] Docs/runbook mention protocol 4 compatibility.
- [ ] PR opened and validation proof posted.

## Validation

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

Browser/gateway validation:

```bash
before="$(wc -l < ~/.openclaw/logs/gateway.err.log)"
# reload unpacked Chrome extension, then wait
sleep 60
tail -n +"$((before + 1))" ~/.openclaw/logs/gateway.err.log | rg "protocol mismatch.*chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf|chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf.*protocol mismatch" || true
```

Pass only if the command finds no new protocol mismatch line for the extension origin.

## Liev Workspace Contract

Use planning artifacts from `.liev/protocol-v4/` if present. If missing in the worker clone, recreate:

- `.liev/brief.md`
- `.liev/plan.md`
- `.liev/validation.md`
- `.liev/progress.md`
- `.liev/status.sh`

from the issue body and keep the plan child-owned.

## Handoff

- Open a PR against `veil-chow-fyaic/openclaw-browser-host-extension`.
- Include summary, validation, browser/gateway proof, publishing path, risks, and rollback.
- Move this issue to `In Review` only after evidence.

## Related Issues

### Parent Issue

- No parent issue. This is a scoped Browser Host protocol hotfix for the existing browser host lane.

### Related Work

- AIC-2586 / AIC-2587: Browser Host workflow agent MVP context.
- AIC-2085: OpenClaw channel integration and stability攻坚 context, but this issue must not touch ACP or WeCom.

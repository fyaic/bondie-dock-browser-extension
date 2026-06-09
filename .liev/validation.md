# Validation Gates: OpenClaw Browser Workflow Agent P0 MVP

## Required Commands

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/content.js"
node --check "extension/src/options.js"
node --check "extension/src/popup.js"
node --check "extension/src/confirm.js"
./scripts/package-extension.sh
```

Commands must run in a clean worker clone. Do not use local-only operator checks such as runtime registry inspection, LaunchAgent state, or machine-specific secrets as worker validation gates.

## Artifact-Specific Gate

Type: browser-extension

Required evidence:

- [ ] Required command block passes and output is summarized in the PR and Linear proof.
- [ ] PR diff is limited to extension source, docs, `.liev` progress evidence, and packaging-safe artifacts.
- [ ] Existing OpenClaw node-compatible transport behavior is preserved.
- [ ] No new dependency or broad framework migration is introduced.
- [ ] No default `<all_urls>`, Native Messaging, file-system access, or silent page-body collection is added.
- [ ] `docs/browser-test-runbook.md` includes Pattern Memory, Context Capture, Suggestion, privacy, and extension load checks.
- [ ] If browser validation is blocked, the issue moves to non-active Blocked/Backlog or enters In Review only with an explicit blocker and no auto-merge.

## Browser Extension Gate

Use when the issue touches browser extension behavior:

- [ ] Extension loads in Chrome/Edge unpacked mode from `extension/`, or the blocker is documented.
- [ ] Manifest JSON parses.
- [ ] Service worker starts and does not report syntax errors.
- [ ] Popup/options page opens when touched and text fits without layout overlap at normal extension popup size.
- [ ] Runtime message path works for Pattern save/list/open, Context Capture, and suggestion feedback.
- [ ] Storage/alarm/permission behavior is asserted: Pattern data persists locally, hourly alarm exists, privacy switches persist, and page text access remains user-triggered.
- [ ] No unexpected host permissions or default `<all_urls>`.
- [ ] PR includes validation evidence and browser-validation notes.

## Completion Rule

If required validation is blocked or inconclusive, AIC-2587 must move to a non-active `Blocked` state, or to `Backlog` when the team has no `Blocked` state. It must not remain in Symphony `active_states`, and it must not move to `Done` as if validation passed. Browser/UI auto-merge is disabled.

## Review Gate

Run the parent-scoped closure command from the Liev kit repo during review:

```bash
node runtime/node/liev-lanes.mjs closure openclaw-browser-host-extension --issues AIC-2587
```

Closure passes only when heartbeat, PR evidence, validation result, and final goal evidence are present for AIC-2587.

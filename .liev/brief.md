# Liev Execution Brief: OpenClaw Browser Workflow Agent P0 MVP

## Goal

Implement the P0 browser workflow agent MVP in `openclaw-browser-host-extension`: local-first Pattern Memory, user-triggered Context Capture, OpenClaw Recap/Suggestion protocol handling, privacy controls, documentation, and validation evidence in one scoped PR.

## Repo

veil-chow-fyaic/openclaw-browser-host-extension

## Planning Artifacts

- Design: `.liev/design.md`
- Plan: `.liev/plan.md`
- Validation: `.liev/validation.md`
- Progress: `.liev/progress.md`
- Status script: `.liev/status.sh`

## Linear

- Project: `liev - OpenClaw Browser Workflow Agent`
- Lane id: `openclaw-browser-host-extension`
- Parent issue: AIC-2586
- Current child issue: AIC-2587
- Scoped closure command:

```bash
node runtime/node/liev-lanes.mjs closure openclaw-browser-host-extension --issues AIC-2587
```

## Definition Of Done

- AIC-2587 opens a GitHub PR against `veil-chow-fyaic/openclaw-browser-host-extension`.
- The PR implements Pattern Memory, Context Capture, Recap/Suggestion protocol, privacy controls, and runbook updates within the P0 scope.
- Required static/package validation passes, or the exact blocker is recorded and the issue is moved to non-active Blocked/Backlog.
- Browser-extension gate evidence is present: extension load path, service worker, popup/options, storage/alarm/permission behavior, and no default `<all_urls>`.
- The worker records progress heartbeat and final validation evidence in `.liev/progress.md`.
- The issue reaches In Review only after PR creation and required evidence; parent AIC-2586 is not auto-closed by the child worker.

## Pre-Approved Actions

- Work only inside the Symphony workspace for AIC-2587.
- Create and use branch `liev/aic-2587` from current main.
- Edit extension source, docs, `.liev` progress artifacts, and packaging-safe generated output when required by `./scripts/package-extension.sh`.
- Run local validation commands, `gh pr create`, and normal `git push` using existing authentication.
- Use GitHub Git API fallback if local `.git` writes are blocked in the worker workspace.
- Move AIC-2587 to In Review after PR and evidence are posted.

## Off-Limits Without Human Input

- Do not modify `main` directly.
- Do not add default `<all_urls>`, silent page-body collection, full browsing-history upload, Native Messaging, local file access, command execution, Windows exe behavior, or new dependencies.
- Do not rewrite the OpenClaw node transport or introduce a second WebSocket protocol.
- Do not implement Harmony, Mercury, broad AgentProvider expansion, store publishing material, or brand naming.
- Do not auto-merge; this browser/UI task requires human review.
- Do not read, print, create, or modify secrets.

## Notes For Future Agent

- Preserve existing PoC behavior: pairing/deviceToken, node-compatible WebSocket, invoke/result, node.event, notifications, current tab info, page summary, downloads summary, confirm UI, keepalive, and paired vs online lifecycle.
- Prefer small helpers around Pattern storage, event upload, and invoke dispatch rather than a broad rewrite.
- Pattern snapshots must record only URL, origin, title, windowId, tabId, active, pinned, timestamp.
- Context Capture may read selected text or text preview only after explicit user action.
- Browser validation may require manual Chrome/Edge extension loading; if unavailable, document the blocker and keep auto-merge disabled.
- Goal evidence rule: if `/goal` is used, record goal status, `thread_id` when available, validation result, and final `Goal achieved` or blocked reason in `.liev/progress.md`.

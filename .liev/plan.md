# Plan: OpenClaw Browser Workflow Agent P0 MVP

## Scope-Depth Decision

Path: B

Rationale:

- This is a browser/UI/extension task with privacy and transport risk, so it needs an upfront architecture boundary and validation contract.
- A full multi-phase product build would overreach; the current DoD is the P0 local-first MVP from `docs/ai-handoff-browser-workflow-agent.md`.
- The implementation is kept in one runnable child issue to avoid cross-PR conflicts in `background.js`, `popup.js`, `popup.html`, `options.js`, and `styles.css`.

## Phases

- [x] Phase 1: Pattern Memory core
  - Goal: add local snapshot capture, retention, pattern data model, hourly alarm scheduling, manual current-window save, simple co-occurrence analysis, and pattern open helper.
  - Depends on: existing `chrome.tabs`, `chrome.windows`, `chrome.storage.local`, `chrome.alarms`, and current node event helper.
  - Validation: syntax checks, package script, storage/alarm behavior noted in PR evidence.
  - Done when: local patterns can be saved, listed from storage, opened, and generated from repeated snapshots without reading page bodies.

- [x] Phase 2: Popup and options surface
  - Goal: expose Pattern list/actions, capture action, privacy toggles, retention controls, upload switch, and clear local data.
  - Depends on: Phase 1 storage helpers and existing popup/options message flow.
  - Validation: popup/options syntax checks and manual extension runbook steps.
  - Done when: users can save/open patterns, send current page context, toggle collection/upload, and clear local data.

- [x] Phase 3: Context Capture event path
  - Goal: implement user-triggered capture payload with URL, title, selectedText, textPreview, capturedAt, and upload through `browser.context.capture`.
  - Depends on: existing current tab/page summary user-triggered access path.
  - Validation: node event payload shape documented in PR evidence; no silent page-body capture.
  - Done when: capture success/failure is visible in popup and event upload reuses existing OpenClaw node event transport.

- [x] Phase 4: Recap/Suggestion protocol
  - Goal: implement `browser.suggestion.show`, `browser.pattern.open`, suggestion accept/dismiss feedback, and pattern events.
  - Depends on: existing invoke dispatcher and Pattern open helper.
  - Validation: invoke/result path documented; accept/dismiss sends `browser.suggestion.accepted` or `browser.suggestion.dismissed`.
  - Done when: incoming suggestions can be displayed and user feedback is emitted.

- [x] Phase 5: Documentation and final validation
  - Goal: update `docs/browser-test-runbook.md`, run static/package validation, record browser-extension gate evidence, and open a PR.
  - Depends on: Phases 1-4.
  - Validation: required command block in `.liev/validation.md`.
  - Done when: Linear AIC-2587 reaches In Review with PR URL, validation output, artifact gate status, and any manual browser-validation blocker.

## Issue Graph

Parent issue:

- AIC-2586: `[Parent] OpenClaw 浏览器智能工作流 Agent P0 MVP`

Child issues:

- AIC-2587: implement the P0 MVP vertical slice for Pattern Memory, Context Capture, Recap/Suggestion protocol, privacy controls, runbook update, validation, and PR handoff.

Follow-ups:

- Pattern management page, rename/delete/pin/merge controls, site exclusion UX, daily recap scheduling, store assets, product naming, Native Messaging, Windows exe integration, and multi-agent adapters are deferred outside this DoD.

## Acceptance Criteria

- [x] Static validation and packaging pass:
  `python3 -m json.tool`, `node --check` for all extension JS entrypoints/modules, and `./scripts/package-extension.sh`.
- [x] Pattern Memory stores only URL, origin, title, windowId, tabId, active, pinned, timestamp, with retention limits and no page-body capture.
- [x] Hourly snapshots use `chrome.alarms` and are idempotently initialized from the service worker.
- [x] Popup supports manual save current window, Pattern listing, and one-click open.
- [x] Simple co-occurrence analysis can produce candidate Patterns from repeated snapshots.
- [x] Context Capture is only user-triggered and sends `browser.context.capture` with URL, title, selectedText, textPreview, capturedAt.
- [x] Suggestion invoke and feedback events work through the existing OpenClaw node-compatible transport.
- [x] Options expose Pattern collection/upload controls and clear local Pattern/snapshot data.
- [x] `docs/browser-test-runbook.md` covers new Pattern, capture, suggestion, privacy, and browser-extension validation steps.
- [x] No default `<all_urls>` permission, no Native Messaging, no new dependency, and no direct `main` changes.

## Final Acceptance

- [x] Child issue AIC-2587 is In Review with a PR, validation evidence, and browser-extension gate result.
- [x] The parent closure command is scoped to AIC-2587:

```bash
node runtime/node/liev-lanes.mjs closure openclaw-browser-host-extension --issues AIC-2587
```

- [x] Closure passes with fresh `.liev/progress.md` heartbeat evidence or records the exact blocker.
- [x] Docs and Linear issue state agree; parent AIC-2586 remains the human acceptance object until closure passes.

## Goal Contract / Hard Metrics

- Intake gate: source document is `docs/ai-handoff-browser-workflow-agent.md`, repo is `veil-chow-fyaic/openclaw-browser-host-extension`, parent is AIC-2586, child is AIC-2587.
- Planning gate: `.liev/design.md`, `.liev/plan.md`, `.liev/brief.md`, `.liev/validation.md`, `.liev/progress.md`, and `.liev/status.sh` validate with `validate-liev-artifacts.mjs --type browser-extension`.
- Execution gate: AIC-2587 worker reads `.liev/brief.md`, runs `.liev/status.sh`, updates `.liev/progress.md`, and opens one scoped PR from `liev/aic-2587`.
- Validation gate: required command block passes or the blocker is recorded and the issue moves to non-active Blocked/Backlog.
- Review gate: `node runtime/node/liev-lanes.mjs closure openclaw-browser-host-extension --issues AIC-2587` reports fresh heartbeat, PR evidence, and final validation state.

## Progress Heartbeat Rule

- AIC-2587 must append at least one dated `.liev/progress.md` entry every 30 minutes while active.
- Meaningful heartbeat verbs are `validated`, `opened`, `blocked`, `fixed`, `shipped`, or `filed`.
- Stale heartbeat blocks parent closure even if a PR exists.

## Codex Goal Worker Rule

- If `/goal` is available, the child worker launch path is:

```bash
node runtime/node/liev-lanes.mjs goal-worker /Users/fuyo-aic/code/liev-symphony-workspaces-openclaw-browser-host-extension/AIC-2587 --json
```

- Goal objective source: `.liev/brief.md`, `.liev/plan.md`, and `.liev/validation.md`.
- Goal evidence rule: record goal status, `thread_id` when available, validation result, and final `Goal achieved` or blocked reason in `.liev/progress.md` before review.

# Liev Planning Handoff

> 归档提示：本文件是 2026-05-25 的 Liev 规划草稿，保留用于追溯。当前有效仓库、版本和执行口径以 `.liev/brief.md`、`.liev/design.md`、`.liev/plan.md`、`README.md` 和 `docs/manual-handoff-2026-06-09.md` 为准。

## Status

- Planning status: ready
- Artifact gate ready: true
- Approved: true
- Workspace contract mode: embedded
- Execution contract: /Users/fuyo-aic/Projects/openclaw-browser-host-extension/.liev/handoff/execution-contract.md

## Parent Issue Draft

### Goal

Deliver the P0 browser workflow agent MVP for `openclaw-browser-host-extension`: Pattern Memory, Context Capture, and Recap/Suggestion protocol support must work as a local-first Chrome/Edge extension flow, while preserving the existing OpenClaw node-compatible transport and privacy boundaries.

### Background

The repo is currently at `0.1.0-alpha.11`: Manifest V3, OpenClaw Gateway pairing, protocol 4 node-compatible transport, node invoke/result, node events, notifications, current tab metadata, page summary, downloads summary, confirmation UI, keepalive, stale-token recovery, page intelligent services, history/notification cards, and Pattern Memory scaffolding are already present. The current product direction from `docs/ai-handoff-browser-workflow-agent.md` is to stabilize the page-to-knowledge-note workflow first, then make Pattern Memory genuinely useful instead of merely manual save/restore.

### Scope

- Implement Pattern Memory MVP: data model, tab/window snapshot capture, hourly `chrome.alarms` scheduling, local retention limits, simple co-occurrence analysis, manual save of the current window, popup list, and one-click open.
- Implement Context Capture MVP: popup action to send current page context, selected text and text preview collection through the existing active user-triggered page access path, `browser.context.capture` event upload, and visible success/failure state.
- Implement Recap/Suggestion protocol MVP: handle `browser.suggestion.show`, `browser.pattern.open`, `browser.suggestion.accepted`, `browser.suggestion.dismissed`, and related pattern events through the existing OpenClaw node transport.
- Add privacy controls for Pattern Memory and upload behavior without requesting default `<all_urls>` or reading full browsing history.
- Update `docs/browser-test-runbook.md` with the new manual validation path.
- Keep the implementation small and direct; refactor only where needed to avoid a larger `background.js` trap.

### Out Of Scope

- Native Messaging, Windows exe/Bondie behavior, tray apps, startup services, local file watching, local command execution, or directory scanning.
- Brand/name decisions, Chrome Web Store or Edge Add-ons publishing materials, logos, screenshots for store listing, or privacy-policy copy beyond in-product notes needed by this MVP.
- Multi-agent provider work beyond preserving a clear OpenClaw boundary; no Harmony or Mercury implementation.
- Default page-body scraping, full browsing-history upload, default `<all_urls>` host permissions, or silent background capture of page text.
- Direct modification of `main`; the implementation worker must branch from current main using `liev/aic-2587`.

### Architecture Review

- Existing constraints: Manifest V3 service worker lifecycle, existing WebSocket transport in `extension/src/background.js`, popup/options pages in plain HTML/CSS/JS, no build step, and validation centered on syntax checks plus packaging.
- Integration boundaries: Pattern storage and analysis should be local extension logic; OpenClaw event upload should reuse the existing node event helper; invoke handling should extend the existing dispatcher rather than introduce a second protocol.
- Permission boundaries: tab/window metadata can use current `tabs` and `storage` permissions; page text access must remain user initiated via active tab/site permission flow; the manifest must not gain default `<all_urls>`.
- UI boundaries: popup should remain a functional control surface, not a marketing page; options should host privacy and retention controls.
- Locked decisions: first release is local-first, OpenClaw-only, no new WebSocket protocol, no Native Messaging, no broad host permission, no background page-body collection.
- Repo/lane boundary: canonical repo is `/Users/fuyo-aic/Projects/openclaw-browser-host-extension`; the Symphony worker must use `/Users/fuyo-aic/code/liev-symphony-workspaces-openclaw-browser-host-extension/AIC-2587`.

### Risks

- MV3 service worker suspension can interrupt scheduled snapshots. Mitigation: use `chrome.alarms`, idempotent startup initialization, and local storage as source of truth.
- Popup and background changes may collide if split across multiple PRs. Mitigation: run this MVP as one scoped child issue with an explicit end-to-end validation gate.
- Browser validation may be partly manual because extension loading depends on a real browser profile. Mitigation: require documented manual evidence in `docs/browser-test-runbook.md`; do not auto-merge if browser validation is blocked.
- Privacy regression risk is high because Pattern Memory touches browsing metadata. Mitigation: record only URL, origin, title, windowId, tabId, active, pinned, timestamp; avoid page body and full history upload by default.
- Transport regression could break existing Browser Host behaviors. Mitigation: preserve existing invoke/result/event paths and run all documented syntax/package checks.

### Issue Graph

Parent issue:

- AIC-2586: `[Parent] OpenClaw 浏览器智能工作流 Agent P0 MVP`

Child issues:

- AIC-2587: implement the P0 MVP vertical slice for Pattern Memory, Context Capture, Recap/Suggestion protocol, privacy controls, runbook update, validation, and PR handoff.

Follow-ups:

- Pattern management page, rename/delete/pin/merge controls, site exclusion UX, daily recap scheduling, store assets, product naming, Native Messaging, Windows exe integration, and multi-agent adapters are deferred outside this DoD.

### Acceptance Criteria

- [ ] Static validation and packaging pass:
  `python3 -m json.tool`, `node --check` for all extension JS entrypoints, and `./scripts/package-extension.sh`.
- [ ] Pattern Memory stores only URL, origin, title, windowId, tabId, active, pinned, timestamp, with retention limits and no page-body capture.
- [ ] Hourly snapshots use `chrome.alarms` and are idempotently initialized from the service worker.
- [ ] Popup supports manual save current window, Pattern listing, and one-click open.
- [ ] Simple co-occurrence analysis can produce candidate Patterns from repeated snapshots.
- [ ] Context Capture is only user-triggered and sends `browser.context.capture` with URL, title, selectedText, textPreview, capturedAt.
- [ ] Suggestion invoke and feedback events work through the existing OpenClaw node-compatible transport.
- [ ] Options expose Pattern collection/upload controls and clear local Pattern/snapshot data.
- [ ] `docs/browser-test-runbook.md` covers new Pattern, capture, suggestion, privacy, and browser-extension validation steps.
- [ ] No default `<all_urls>` permission, no Native Messaging, no new dependency, and no direct `main` changes.

### Final Acceptance

- [ ] Child issue AIC-2587 is In Review with a PR, validation evidence, and browser-extension gate result.
- [ ] The parent closure command is scoped to AIC-2587:

```bash
node runtime/node/liev-lanes.mjs closure openclaw-browser-host-extension --issues AIC-2587
```

- [ ] Closure passes with fresh `.liev/progress.md` heartbeat evidence or records the exact blocker.
- [ ] Docs and Linear issue state agree; parent AIC-2586 remains the human acceptance object until closure passes.

### Stop / Escalation Rules

- Stop and record a blocker if implementation requires default `<all_urls>`, full browsing-history upload, silent page-body capture, new production Gateway behavior, Native Messaging, or new dependencies.
- Stop and record a blocker if the existing OpenClaw node transport cannot carry the required events/invokes without a protocol rewrite.
- If the same validation command fails three times after real fixes, record the attempts and move the child issue to a non-active Blocked or Backlog state.
- If browser validation is unavailable or inconclusive, open a PR only with the blocker documented; do not auto-merge or mark Done.

## Child Issue Draft

### Goal

Implement the P0 browser workflow agent MVP in `openclaw-browser-host-extension`: local-first Pattern Memory, user-triggered Context Capture, OpenClaw Recap/Suggestion protocol handling, privacy controls, documentation, and validation evidence in one scoped PR.

### Repo

fyaic/openclaw-browser-host-extension

### Parent

Use the parent issue created from the draft above.

### Scope

- Implement Pattern Memory MVP: data model, tab/window snapshot capture, hourly `chrome.alarms` scheduling, local retention limits, simple co-occurrence analysis, manual save of the current window, popup list, and one-click open.
- Implement Context Capture MVP: popup action to send current page context, selected text and text preview collection through the existing active user-triggered page access path, `browser.context.capture` event upload, and visible success/failure state.
- Implement Recap/Suggestion protocol MVP: handle `browser.suggestion.show`, `browser.pattern.open`, `browser.suggestion.accepted`, `browser.suggestion.dismissed`, and related pattern events through the existing OpenClaw node transport.
- Add privacy controls for Pattern Memory and upload behavior without requesting default `<all_urls>` or reading full browsing history.
- Update `docs/browser-test-runbook.md` with the new manual validation path.
- Keep the implementation small and direct; refactor only where needed to avoid a larger `background.js` trap.

### Out Of Scope

- Native Messaging, Windows exe/Bondie behavior, tray apps, startup services, local file watching, local command execution, or directory scanning.
- Brand/name decisions, Chrome Web Store or Edge Add-ons publishing materials, logos, screenshots for store listing, or privacy-policy copy beyond in-product notes needed by this MVP.
- Multi-agent provider work beyond preserving a clear OpenClaw boundary; no Harmony or Mercury implementation.
- Default page-body scraping, full browsing-history upload, default `<all_urls>` host permissions, or silent background capture of page text.
- Direct modification of `main`; the implementation worker must branch from current main using `liev/aic-2587`.

### Acceptance Criteria

- [ ] Static validation and packaging pass:
  `python3 -m json.tool`, `node --check` for all extension JS entrypoints, and `./scripts/package-extension.sh`.
- [ ] Pattern Memory stores only URL, origin, title, windowId, tabId, active, pinned, timestamp, with retention limits and no page-body capture.
- [ ] Hourly snapshots use `chrome.alarms` and are idempotently initialized from the service worker.
- [ ] Popup supports manual save current window, Pattern listing, and one-click open.
- [ ] Simple co-occurrence analysis can produce candidate Patterns from repeated snapshots.
- [ ] Context Capture is only user-triggered and sends `browser.context.capture` with URL, title, selectedText, textPreview, capturedAt.
- [ ] Suggestion invoke and feedback events work through the existing OpenClaw node-compatible transport.
- [ ] Options expose Pattern collection/upload controls and clear local Pattern/snapshot data.
- [ ] `docs/browser-test-runbook.md` covers new Pattern, capture, suggestion, privacy, and browser-extension validation steps.
- [ ] No default `<all_urls>` permission, no Native Messaging, no new dependency, and no direct `main` changes.

### Validation Command

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/content.js"
node --check "extension/src/options.js"
node --check "extension/src/popup.js"
node --check "extension/src/confirm.js"
./scripts/package-extension.sh
```

### Artifact Gate

Type: browser-extension

Required evidence:

- [ ] Required command block passes and output is summarized in the PR and Linear proof.
- [ ] PR diff is limited to extension source, docs, `.liev` progress evidence, and packaging-safe artifacts.
- [ ] Existing OpenClaw node-compatible transport behavior is preserved.
- [ ] No new dependency or broad framework migration is introduced.
- [ ] No default `<all_urls>`, Native Messaging, file-system access, or silent page-body collection is added.
- [ ] `docs/browser-test-runbook.md` includes Pattern Memory, Context Capture, Suggestion, privacy, and extension load checks.
- [ ] If browser validation is blocked, the issue moves to non-active Blocked/Backlog or enters In Review only with an explicit blocker and no auto-merge.

### Forbidden

- Do not modify `main` directly.
- Do not add default `<all_urls>`, silent page-body collection, full browsing-history upload, Native Messaging, local file access, command execution, Windows exe behavior, or new dependencies.
- Do not rewrite the OpenClaw node transport or introduce a second WebSocket protocol.
- Do not implement Harmony, Mercury, broad AgentProvider expansion, store publishing material, or brand naming.
- Do not auto-merge; this browser/UI task requires human review.
- Do not read, print, create, or modify secrets.

### Handoff

- Paste `execution-contract.md` into the runnable child issue unless the .liev files are committed to the target repo.
- Run bootstrap preflight with `--workspace-contract embedded`.
- Do not move the child issue to Todo until preflight returns `ready: true`.

### Notes For Future Agent

- Preserve existing Browser Host behavior: pairing/deviceToken, protocol 4 node-compatible WebSocket, invoke/result, node.event, notifications, current tab info, page summary, downloads summary, confirm UI, keepalive, and paired vs online lifecycle.
- Prefer small helpers around Pattern storage, event upload, and invoke dispatch rather than a broad rewrite.
- Pattern snapshots must record only URL, origin, title, windowId, tabId, active, pinned, timestamp.
- Context Capture may read selected text or text preview only after explicit user action.
- Browser validation may require manual Chrome/Edge extension loading; if unavailable, document the blocker and keep auto-merge disabled.
- Goal evidence rule: if `/goal` is used, record goal status, `thread_id` when available, validation result, and final `Goal achieved` or blocked reason in `.liev/progress.md`.

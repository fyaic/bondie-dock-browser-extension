# Design: OpenClaw Browser Workflow Agent P0 MVP

## Goal

Deliver the P0 browser workflow agent MVP for `openclaw-browser-host-extension`: Pattern Memory, Context Capture, and Recap/Suggestion protocol support must work as a local-first Chrome/Edge extension flow, while preserving the existing OpenClaw node-compatible transport and privacy boundaries.

## Background

The repo is currently at `0.1.0-alpha.11` and has moved beyond the early browser-side host experiment: it preserves Manifest V3, OpenClaw Gateway pairing, node invoke/result, node events, notifications, current tab metadata, page summary, downloads summary, confirmation UI, keepalive, and online lifecycle handling, while adding protocol 4 compatibility, stale device-token recovery, Media to Notes ownership, history/notification surfaces, and the first Pattern Memory scaffolding. The next product direction from `docs/ai-handoff-browser-workflow-agent.md` is to stabilize the page-to-knowledge-note workflow first, then make Pattern Memory genuinely useful instead of merely manual save/restore.

## User Scenario

An OpenClaw user opens a normal browser session, saves or recovers groups of pages that are commonly used together, actively sends the current page context to OpenClaw when needed, and receives low-interruption link suggestions that can be accepted or dismissed with feedback sent through the existing node event path.

## Scope

- Implement Pattern Memory MVP: data model, tab/window snapshot capture, hourly `chrome.alarms` scheduling, local retention limits, simple co-occurrence analysis, manual save of the current window, popup list, and one-click open.
- Implement Context Capture MVP: popup action to send current page context, selected text and text preview collection through the existing active user-triggered page access path, `browser.context.capture` event upload, and visible success/failure state.
- Implement Recap/Suggestion protocol MVP: handle `browser.suggestion.show`, `browser.pattern.open`, `browser.suggestion.accepted`, `browser.suggestion.dismissed`, and related pattern events through the existing OpenClaw node transport.
- Add privacy controls for Pattern Memory and upload behavior without requesting default `<all_urls>` or reading full browsing history.
- Update `docs/browser-test-runbook.md` with the new manual validation path.
- Keep the implementation small and direct; refactor only where needed to avoid a larger `background.js` trap.

## Out Of Scope

- Native Messaging, Windows exe/Bondie behavior, tray apps, startup services, local file watching, local command execution, or directory scanning.
- Brand/name decisions, Chrome Web Store or Edge Add-ons publishing materials, logos, screenshots for store listing, or privacy-policy copy beyond in-product notes needed by this MVP.
- Multi-agent provider work beyond preserving a clear OpenClaw boundary; no Harmony or Mercury implementation.
- Default page-body scraping, full browsing-history upload, default `<all_urls>` host permissions, or silent background capture of page text.
- Direct modification of `main`; the implementation worker must branch from current main using `liev/aic-2587`.

## Architecture Review

- Existing constraints: Manifest V3 service worker lifecycle, existing WebSocket transport in `extension/src/background.js`, popup/options pages in plain HTML/CSS/JS, no build step, and validation centered on syntax checks plus packaging.
- Integration boundaries: Pattern storage and analysis should be local extension logic; OpenClaw event upload should reuse the existing node event helper; invoke handling should extend the existing dispatcher rather than introduce a second protocol.
- Permission boundaries: tab/window metadata can use current `tabs` and `storage` permissions; page text access must remain user initiated via active tab/site permission flow; the manifest must not gain default `<all_urls>`.
- UI boundaries: popup should remain a functional control surface, not a marketing page; options should host privacy and retention controls.
- Locked decisions: first release is local-first, OpenClaw-only, no new WebSocket protocol, no Native Messaging, no broad host permission, no background page-body collection.
- Repo/lane boundary: canonical repo is `/Users/fuyo-aic/Projects/openclaw-browser-host-extension`; the Symphony worker must use `/Users/fuyo-aic/code/liev-symphony-workspaces-openclaw-browser-host-extension/AIC-2587`.

## Risks

- MV3 service worker suspension can interrupt scheduled snapshots. Mitigation: use `chrome.alarms`, idempotent startup initialization, and local storage as source of truth.
- Popup and background changes may collide if split across multiple PRs. Mitigation: run this MVP as one scoped child issue with an explicit end-to-end validation gate.
- Browser validation may be partly manual because extension loading depends on a real browser profile. Mitigation: require documented manual evidence in `docs/browser-test-runbook.md`; do not auto-merge if browser validation is blocked.
- Privacy regression risk is high because Pattern Memory touches browsing metadata. Mitigation: record only URL, origin, title, windowId, tabId, active, pinned, timestamp; avoid page body and full history upload by default.
- Transport regression could break existing Browser Host behaviors. Mitigation: preserve existing invoke/result/event paths and run all documented syntax/package checks.

## Open Questions

- No product blocker for implementation. Naming, store listing, and multi-agent provider decisions are deliberately deferred.

## Stop / Escalation Rules

- Stop and record a blocker if implementation requires default `<all_urls>`, full browsing-history upload, silent page-body capture, new production Gateway behavior, Native Messaging, or new dependencies.
- Stop and record a blocker if the existing OpenClaw node transport cannot carry the required events/invokes without a protocol rewrite.
- If the same validation command fails three times after real fixes, record the attempts and move the child issue to a non-active Blocked or Backlog state.
- If browser validation is unavailable or inconclusive, open a PR only with the blocker documented; do not auto-merge or mark Done.

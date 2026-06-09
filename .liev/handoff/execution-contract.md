## Liev Workspace Contract



Before editing code, materialize these files into `.liev/` if they are missing in the Symphony workspace. Keep `.liev/progress.md` append-only and concise.



### `.liev/brief.md`

````md
# Liev Execution Brief: OpenClaw Browser Workflow Agent P0 MVP

## Goal

Implement the P0 browser workflow agent MVP in `openclaw-browser-host-extension`: local-first Pattern Memory, user-triggered Context Capture, OpenClaw Recap/Suggestion protocol handling, privacy controls, documentation, and validation evidence in one scoped PR.

## Repo

fyaic/openclaw-browser-host-extension

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

- AIC-2587 opens a GitHub PR against `fyaic/openclaw-browser-host-extension`.
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

- Preserve existing Browser Host behavior: pairing/deviceToken, protocol 4 node-compatible WebSocket, invoke/result, node.event, notifications, current tab info, page summary, downloads summary, confirm UI, keepalive, and paired vs online lifecycle.
- Prefer small helpers around Pattern storage, event upload, and invoke dispatch rather than a broad rewrite.
- Pattern snapshots must record only URL, origin, title, windowId, tabId, active, pinned, timestamp.
- Context Capture may read selected text or text preview only after explicit user action.
- Browser validation may require manual Chrome/Edge extension loading; if unavailable, document the blocker and keep auto-merge disabled.
- Goal evidence rule: if `/goal` is used, record goal status, `thread_id` when available, validation result, and final `Goal achieved` or blocked reason in `.liev/progress.md`.
````

### `.liev/plan.md`

````md
# Plan: OpenClaw Browser Workflow Agent P0 MVP

## Scope-Depth Decision

Path: B

Rationale:

- This is a browser/UI/extension task with privacy and transport risk, so it needs an upfront architecture boundary and validation contract.
- A full multi-phase product build would overreach; the current DoD is the P0 local-first MVP from `docs/ai-handoff-browser-workflow-agent.md`.
- The implementation is kept in one runnable child issue to avoid cross-PR conflicts in `background.js`, `popup.js`, `popup.html`, `options.js`, and `styles.css`.

## Phases

- [ ] Phase 1: Pattern Memory core
  - Goal: add local snapshot capture, retention, pattern data model, hourly alarm scheduling, manual current-window save, simple co-occurrence analysis, and pattern open helper.
  - Depends on: existing `chrome.tabs`, `chrome.windows`, `chrome.storage.local`, `chrome.alarms`, and current node event helper.
  - Validation: syntax checks, package script, storage/alarm behavior noted in PR evidence.
  - Done when: local patterns can be saved, listed from storage, opened, and generated from repeated snapshots without reading page bodies.

- [ ] Phase 2: Popup and options surface
  - Goal: expose Pattern list/actions, capture action, privacy toggles, retention controls, upload switch, and clear local data.
  - Depends on: Phase 1 storage helpers and existing popup/options message flow.
  - Validation: popup/options syntax checks and manual extension runbook steps.
  - Done when: users can save/open patterns, send current page context, toggle collection/upload, and clear local data.

- [ ] Phase 3: Context Capture event path
  - Goal: implement user-triggered capture payload with URL, title, selectedText, textPreview, capturedAt, and upload through `browser.context.capture`.
  - Depends on: existing current tab/page summary user-triggered access path.
  - Validation: node event payload shape documented in PR evidence; no silent page-body capture.
  - Done when: capture success/failure is visible in popup and event upload reuses existing OpenClaw node event transport.

- [ ] Phase 4: Recap/Suggestion protocol
  - Goal: implement `browser.suggestion.show`, `browser.pattern.open`, suggestion accept/dismiss feedback, and pattern events.
  - Depends on: existing invoke dispatcher and Pattern open helper.
  - Validation: invoke/result path documented; accept/dismiss sends `browser.suggestion.accepted` or `browser.suggestion.dismissed`.
  - Done when: incoming suggestions can be displayed and user feedback is emitted.

- [ ] Phase 5: Documentation and final validation
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

## Final Acceptance

- [ ] Child issue AIC-2587 is In Review with a PR, validation evidence, and browser-extension gate result.
- [ ] The parent closure command is scoped to AIC-2587:

```bash
node runtime/node/liev-lanes.mjs closure openclaw-browser-host-extension --issues AIC-2587
```

- [ ] Closure passes with fresh `.liev/progress.md` heartbeat evidence or records the exact blocker.
- [ ] Docs and Linear issue state agree; parent AIC-2586 remains the human acceptance object until closure passes.

## Goal Contract / Hard Metrics

- Intake gate: source document is `docs/ai-handoff-browser-workflow-agent.md`, repo is `fyaic/openclaw-browser-host-extension`, parent is AIC-2586, child is AIC-2587.
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
````

### `.liev/validation.md`

````md
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
````

### `.liev/status.sh`

```bash
#!/usr/bin/env bash
set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$repo_root" ]; then
  echo "ERROR: not inside a git repo."
  exit 1
fi

cd "$repo_root"
now="$(date '+%Y-%m-%d %H:%M:%S %Z')"
heartbeat_minutes="${LIEV_HEARTBEAT_MINUTES:-30}"

echo "=== liev-status @ $now ==="
echo

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  else
    echo ""
  fi
}

epoch_of() {
  date -j -f '%Y-%m-%d %H:%M:%S %Z' "$1" '+%s' 2>/dev/null ||
    date -d "$1" '+%s' 2>/dev/null ||
    true
}

echo "=== Brief Change Detection ==="
if [ -f ".liev/brief.md" ]; then
  cur_hash="$(sha256_of ".liev/brief.md")"
  last_acked_hash=""
  if [ -f ".liev/progress.md" ]; then
    last_acked_hash="$(grep -oE 'ack-hash:[[:space:]]*[0-9a-f]{64}' ".liev/progress.md" | tail -1 | awk '{print $NF}')"
  fi
  if [ -z "$cur_hash" ]; then
    echo "(sha256 utility unavailable; brief-change detection disabled)"
  elif [ -z "$last_acked_hash" ]; then
    echo "(first observation; add a progress entry with ack-hash: $cur_hash)"
  elif [ "$cur_hash" != "$last_acked_hash" ]; then
    echo "BRIEF UPDATED SINCE LAST ACK"
    echo "ack-hash: $cur_hash"
  else
    echo "(brief unchanged since last ack)"
  fi
else
  echo "WARNING: .liev/brief.md missing."
fi
echo

echo "=== Git ==="
echo "Branch: $(git branch --show-current)"
git status --short | sed -n '1,40p'
echo

echo "Recent commits:"
git log --oneline -5
echo

echo "=== Liev Brief ==="
if [ -s ".liev/brief.md" ]; then
  sed -n '1,120p' ".liev/brief.md"
else
  echo "WARNING: .liev/brief.md missing or empty."
fi
echo

echo "=== Plan Progress ==="
if [ -f ".liev/plan.md" ]; then
  total="$(grep -cE '^[[:space:]]*-[[:space:]]*\[[ xX]\]' ".liev/plan.md" 2>/dev/null || true)"
  done_count="$(grep -cE '^[[:space:]]*-[[:space:]]*\[[xX]\]' ".liev/plan.md" 2>/dev/null || true)"
  echo "Checkboxes: ${done_count:-0} / ${total:-0}"
  echo "Next unchecked:"
  grep -nE '^[[:space:]]*-[[:space:]]*\[ \]' ".liev/plan.md" | sed -n '1,8p' || true
else
  echo "WARNING: .liev/plan.md missing."
fi
echo

echo "=== Validation Gate ==="
if [ -f ".liev/validation.md" ]; then
  validation_total="$(grep -cE '^[[:space:]]*-[[:space:]]*\[[ xX]\]' ".liev/validation.md" 2>/dev/null || true)"
  validation_done="$(grep -cE '^[[:space:]]*-[[:space:]]*\[[xX]\]' ".liev/validation.md" 2>/dev/null || true)"
  echo "Checkboxes: ${validation_done:-0} / ${validation_total:-0}"
  echo "Unchecked validation:"
  grep -nE '^[[:space:]]*-[[:space:]]*\[ \]' ".liev/validation.md" | sed -n '1,12p' || true
else
  echo "WARNING: .liev/validation.md missing."
fi
echo

echo "=== Health ==="
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    echo "gh auth: OK"
  else
    echo "gh auth: FAILED"
  fi
else
  echo "gh: unavailable"
fi

df_line="$(df -h / 2>/dev/null | awk 'NR==2')"
if [ -n "$df_line" ]; then
  echo "Disk /: $(echo "$df_line" | awk '{print "used "$3" of "$2" ("$5" full); "$4" free"}')"
else
  echo "Disk /: unavailable"
fi
echo

origin="$(git remote get-url origin 2>/dev/null | sed -E 's#.*[:/]([^/]+/[^/.]+)(\\.git)?$#\\1#')"

echo "=== GitHub API ==="
if [ -n "$origin" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh api rate_limit --jq '.resources.core | "core remaining: \(.remaining)/\(.limit)"' 2>/dev/null || echo "(gh rate limit unavailable)"
else
  echo "(no GitHub origin, gh unavailable, or unauthenticated)"
fi
echo

echo "=== Open PRs ==="
if [ -n "$origin" ] && command -v gh >/dev/null 2>&1; then
  gh pr list -R "$origin" --state open --json number,title,headRefName,mergeStateStatus,statusCheckRollup \
    --jq '.[] | "#\(.number) \(.title) — \(.headRefName) — \(.mergeStateStatus) — checks pass:\([.statusCheckRollup[]? | select((.conclusion // "") == "SUCCESS")] | length) pending:\([.statusCheckRollup[]? | select((.status // "") != "COMPLETED")] | length) fail:\([.statusCheckRollup[]? | select(["FAILURE","CANCELLED","TIMED_OUT","ACTION_REQUIRED","STARTUP_FAILURE"] | index((.conclusion // "")))] | length)"' 2>/dev/null || echo "(gh pr list failed)"
else
  echo "(no GitHub origin or gh unavailable)"
fi
echo

echo "=== Progress Signals ==="
if [ -f ".liev/progress.md" ]; then
  progress_entries="$(grep -cE '^- 20[0-9]{2}|^- initialized\\.' ".liev/progress.md" 2>/dev/null || true)"
  shipped_lineno="$(grep -nEi '^- .* (opened|merged|closed|complete[d]?|shipped|filed|fixed|validated|blocked)' ".liev/progress.md" 2>/dev/null | tail -1 | cut -d: -f1)"
  if [ -z "$shipped_lineno" ]; then
    entries_since_ship="${progress_entries:-0}"
  else
    entries_since_ship="$(awk -v ln="$shipped_lineno" 'NR>ln && /^- /{c++} END{print c+0}' ".liev/progress.md")"
  fi
  echo "Progress entries: ${progress_entries:-0}"
  echo "Entries since last shipped/blocked event: ${entries_since_ship:-0}"
  latest_dated_line="$(grep -E '^- 20[0-9]{2}-[0-9]{2}-[0-9]{2} ' ".liev/progress.md" 2>/dev/null | tail -1 || true)"
  if [ -n "$latest_dated_line" ]; then
    latest_ts="$(echo "$latest_dated_line" | sed -E 's/^- ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} [A-Za-z_+0-9-]+).*/\1/')"
    latest_epoch="$(epoch_of "$latest_ts")"
    now_epoch="$(date '+%s')"
    if [ -n "$latest_epoch" ]; then
      age_minutes="$(( (now_epoch - latest_epoch) / 60 ))"
      echo "Latest dated progress age: ${age_minutes}m"
      if [ "$age_minutes" -gt "$heartbeat_minutes" ] 2>/dev/null; then
        echo "WARN: stale progress heartbeat; latest dated progress is older than ${heartbeat_minutes}m."
      fi
    else
      echo "Latest dated progress: $latest_ts"
    fi
  else
    echo "Latest dated progress: none"
    echo "WARN: missing dated progress heartbeat."
  fi
  if [ "${entries_since_ship:-0}" -gt 5 ] 2>/dev/null; then
    echo "WARN: possible spin; more than 5 progress entries since last shipped/blocked event."
  fi
  max_len="$(awk '/^- /{if(length>max) max=length} END{print max+0}' ".liev/progress.md")"
  echo "Max progress entry length: $max_len"
  if [ "$max_len" -gt 220 ] 2>/dev/null; then
    echo "WARN: progress entries are too long; keep reasoning in issues/PRs."
  fi
else
  echo "WARNING: .liev/progress.md missing."
fi
echo

echo "=== Progress Tail ==="
if [ -f ".liev/progress.md" ]; then
  tail -25 ".liev/progress.md"
else
  echo "WARNING: .liev/progress.md missing."
fi
```

---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: "liev-openclaw-browser-workflow-agent-144f29e2b7c3"
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Canceled
    - Cancelled
    - Duplicate
polling:
  interval_ms: 5000
workspace:
  root: /Users/fuyo-aic/code/liev-symphony-workspaces-openclaw-browser-host-extension
hooks:
  after_create: |
    git clone --depth 1 https://github.com/veil-chow-fyaic/openclaw-browser-host-extension.git .
    python3 -m json.tool "extension/manifest.json" >/dev/null
    node --check "extension/src/background.js"
    node --check "extension/src/content.js"
    node --check "extension/src/options.js"
    node --check "extension/src/popup.js"
    node --check "extension/src/confirm.js"
    ./scripts/package-extension.sh
  before_run: |
    issue_key="$(basename "$PWD" | tr '[:upper:]' '[:lower:]')"
    branch="liev/${issue_key}"
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      current="$(git branch --show-current || true)"
      if [ "$current" = "main" ] || [ "$current" = "master" ] || [ -z "$current" ]; then
        git switch -c "$branch" 2>/dev/null || git switch "$branch"
      fi
    fi
agent:
  max_concurrent_agents: 1
  max_turns: 20
codex:
  command: npx -y @openai/codex@0.133.0 --config shell_environment_policy.inherit=all --config 'model="gpt-5.5"' app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
    networkAccess: true
server:
  port: 4104
---

You are working on a Linear issue for the Liev/Symphony lane of `veil-chow-fyaic/openclaw-browser-host-extension`.

Issue:

- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- Current status: {{ issue.state }}
- Labels: {{ issue.labels }}
- URL: {{ issue.url }}

Description:

{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

## Operating Rules

- Work only inside the current Symphony workspace.
- Use the target repo named in the issue `Repo` section. Do not infer another repo.
- Keep changes minimal and scoped to the issue. Follow KISS, YAGNI, DRY, and SOLID.
- Do not read, print, create, or modify secrets.
- Do not add dependencies unless the issue explicitly requires them.
- This lane is pre-authorized for unattended `git commit`, `git push`, and `gh pr create` for scoped changes in `veil-chow-fyaic/openclaw-browser-host-extension`.
- Use a task branch named `liev/{{ issue.identifier | downcase }}`. Never leave a successful scoped patch as dirty changes on `main`.
- Use existing `gh` CLI authentication. Do not request plugin installation or interactive re-authentication.
- Do not merge PRs. Browser extension/UI work requires human review unless a future issue explicitly opts into `agent-automerge` and all visual/browser gates pass.
- The autonomous closure target is `In Review`, not `Done`.
- If a PR can be created, create it, report proof to Linear, and move the issue to `In Review`.
- If a PR cannot be created, write the exact blocker to Linear and move the issue to a non-active `Blocked` state, or `Backlog` when the team has no `Blocked` state.

## Liev Contract Rules

- If `.liev/brief.md`, `.liev/plan.md`, `.liev/validation.md`, or `.liev/status.sh` exist, treat them as the execution contract.
- If `.liev/brief.md`, `.liev/plan.md`, or `.liev/validation.md` is missing and the Linear issue description contains `## Liev Workspace Contract`, create the exact `.liev/` files from the fenced sections before editing code.
- If this medium browser-extension task has neither workspace files nor an issue-embedded contract, record a blocker and move the issue to a non-active `Blocked` or `Backlog` state.
- Re-read `.liev/brief.md` before editing, run `.liev/status.sh` when present, and update `.liev/progress.md` with dated shipped/validated/opened/blocked events.
- If `.liev/status.sh` reports `BRIEF UPDATED SINCE LAST ACK`, re-read the brief and append a `BRIEF UPDATED` entry with the reported `ack-hash`.
- Do not open a new phase until the current phase plan and validation evidence are updated.
- If the same test, command, CI check, PR state, or exception fails three times after real fixes, stop retrying that path and record a blocker.

## Browser Extension Boundaries

- Do not add default `<all_urls>`.
- Do not silently read page body text or upload complete browsing history.
- Do not add Native Messaging, file-system access, local command execution, Windows exe behavior, or multi-agent adapters.
- Preserve existing pairing/deviceToken, node-compatible WebSocket, invoke/result, node.event, notification, current tab, page summary, downloads summary, confirmation UI, keepalive, and paired-vs-online behavior.
- Pattern snapshots may store URL, origin, title, windowId, tabId, active, pinned, and timestamp only.
- Context Capture must stay user-triggered.

## Expected Workflow

1. Inspect the repo and materialize `.liev` contract if needed.
2. Run `.liev/status.sh` if present.
3. Implement the smallest correct change for the next unchecked phase in `.liev/plan.md`.
4. Run the issue validation command:

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/content.js"
node --check "extension/src/options.js"
node --check "extension/src/popup.js"
node --check "extension/src/confirm.js"
./scripts/package-extension.sh
```

5. Satisfy the browser-extension gate in `.liev/validation.md`; if browser loading is blocked, document the blocker and disable auto-merge.
6. Append a concise dated event to `.liev/progress.md`.
7. Commit, push, and open a PR.
8. Include in the PR body: Linear issue, summary, tests, browser-extension gate, browser validation result/blocker, publishing path, risks, and rollback note.
9. Report proof back to Linear and move the issue to `In Review`; stop immediately after the issue is in `In Review`, `Blocked`, or `Done`.

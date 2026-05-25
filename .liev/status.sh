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

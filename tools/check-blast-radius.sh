#!/usr/bin/env bash
# tools/check-blast-radius.sh — Layer 2 of three-layer enforcement.
#
# ⚠️ TIER 0 — Red zone file. This script protects itself: agents cannot modify
# it without HITL approval. See ARCHITECTURE.md §7.1.
#
# Invoked:
#   (a) by the orchestrator's file-ops wrapper before every agent write
#   (b) by the pre-commit hook against staged files in every consumer repo
#   (c) by the Layer 3 CI workflow (.github/workflows/blast-radius.yml)
#
# Logic:
#   1. Parse Red zone glob patterns from CLAUDE.md (Layer 1)
#   2. Glob-match the candidate file path against each pattern
#   3. If no match: exit 0 (file is not in Red zone)
#   4. If match: require BLAST_RADIUS_APPROVED env var to be set with a valid HITL approval id
#   5. Verify the approval record exists and covers this path; allow OR exit 1
#
# Usage:
#   check-blast-radius.sh <file-path>
#
# Env vars:
#   BLAST_RADIUS_APPROVED   HITL approval id (matches a record in .audit/<date>/hitl/<id>.json)
#   CLAUDE_MD_PATH          Path to CLAUDE.md (default: CLAUDE.md in current dir or parents)
#   AUDIT_DATE              ISO date for the approval record lookup (default: today UTC)
#
# Exit codes:
#   0 — file is outside Red zone OR is in Red zone AND has valid approval
#   1 — Red zone breach (no approval or invalid approval)
#   2 — usage error (missing args, malformed CLAUDE.md)

set -euo pipefail

# ─── helpers ─────────────────────────────────────────────────────────────────

die() {
  echo "❌ BLAST RADIUS HOOK — $1" >&2
  if [ -n "${2:-}" ]; then
    echo "   $2" >&2
  fi
  exit "${3:-1}"
}

find_claude_md() {
  # Search upward from CWD for CLAUDE.md
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/CLAUDE.md" ]; then
      echo "$dir/CLAUDE.md"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# ─── parse args ──────────────────────────────────────────────────────────────

FILE_PATH="${1:-}"
if [ -z "$FILE_PATH" ]; then
  die "missing argument" "Usage: check-blast-radius.sh <file-path>" 2
fi

CLAUDE_MD_PATH="${CLAUDE_MD_PATH:-$(find_claude_md || true)}"
if [ -z "$CLAUDE_MD_PATH" ] || [ ! -f "$CLAUDE_MD_PATH" ]; then
  die "CLAUDE.md not found" "Layer 1 source-of-truth is missing; cannot determine Red zone" 2
fi

AUDIT_DATE="${AUDIT_DATE:-$(date -u +%Y-%m-%d)}"
APPROVAL_ID="${BLAST_RADIUS_APPROVED:-}"

# ─── parse Red zone patterns from CLAUDE.md ──────────────────────────────────
#
# Format expected in CLAUDE.md (anywhere in the file, but typically under
# "## Blast Radius — Red Zone files"):
#
#   ### Tier 0
#   - path/glob
#   - path/glob
#
#   ### Tier 1
#   - path/glob
#
# We extract every '- ' bullet inside Tier 0 or Tier 1 sections. Comments after '#' are stripped.

RED_ZONE_TIER0=$(
  awk '
    /^### Tier 0/    { tier=0; next }
    /^### Tier 1/    { tier=1; next }
    /^### Tier [234]/{ tier=-1; next }
    /^## /           { tier=-1; next }
    tier==0 && /^- / {
      # strip leading "- ", trailing comment "  # ..."
      sub(/^- /, "")
      sub(/[ ]+#.*$/, "")
      print
    }
  ' "$CLAUDE_MD_PATH"
)

RED_ZONE_TIER1=$(
  awk '
    /^### Tier 0/    { tier=-1; next }
    /^### Tier 1/    { tier=1; next }
    /^### Tier [234]/{ tier=-1; next }
    /^## /           { tier=-1; next }
    tier==1 && /^- / {
      sub(/^- /, "")
      sub(/[ ]+#.*$/, "")
      print
    }
  ' "$CLAUDE_MD_PATH"
)

# Combine into a single list for matching
RED_ZONE_ALL="$RED_ZONE_TIER0
$RED_ZONE_TIER1"

if [ -z "${RED_ZONE_ALL//[[:space:]]/}" ]; then
  # No Red zone declared — nothing to check
  exit 0
fi

# ─── match the file path against each pattern ────────────────────────────────

MATCHED_PATTERN=""
MATCHED_TIER=""

while IFS= read -r pattern; do
  # Skip blank lines
  [ -z "${pattern// /}" ] && continue

  # Normalize: strip trailing whitespace
  pattern="${pattern%% *}"

  case "$FILE_PATH" in
    $pattern | $pattern/*)
      MATCHED_PATTERN="$pattern"
      # Determine tier
      if echo "$RED_ZONE_TIER0" | grep -qFx -- "$pattern"; then
        MATCHED_TIER=0
      else
        MATCHED_TIER=1
      fi
      break
      ;;
  esac
done <<< "$RED_ZONE_ALL"

if [ -z "$MATCHED_PATTERN" ]; then
  # File not in Red zone — allow
  exit 0
fi

# ─── file is in Red zone; check approval ─────────────────────────────────────

if [ -z "$APPROVAL_ID" ]; then
  die \
    "Red zone write blocked: $FILE_PATH (matched pattern '$MATCHED_PATTERN', Tier $MATCHED_TIER)" \
    "Agents must obtain HITL approval (G2/G3) before writing to Red zone files.
   Set env BLAST_RADIUS_APPROVED=<hitl-id> after user signs the HITL request.
   See https://github.com/piyushgupta27/ai-sdlc/blob/main/HITL.md for the gate process." \
    1
fi

# Look up the HITL record. Path: <repo-root>/.audit/<date>/hitl/<id>.json
REPO_ROOT="$(dirname "$CLAUDE_MD_PATH")"
HITL_RECORD="$REPO_ROOT/.audit/$AUDIT_DATE/hitl/${APPROVAL_ID}.json"

if [ ! -f "$HITL_RECORD" ]; then
  # Fallback: scan the last 7 days in case the approval is stale-but-still-valid
  for delta in 0 1 2 3 4 5 6 7; do
    if [ "$(uname)" = "Darwin" ]; then
      check_date=$(date -u -v-"${delta}"d +%Y-%m-%d 2>/dev/null || echo "")
    else
      check_date=$(date -u -d "${delta} days ago" +%Y-%m-%d 2>/dev/null || echo "")
    fi
    [ -z "$check_date" ] && continue
    candidate="$REPO_ROOT/.audit/$check_date/hitl/${APPROVAL_ID}.json"
    if [ -f "$candidate" ]; then
      HITL_RECORD="$candidate"
      break
    fi
  done
fi

if [ ! -f "$HITL_RECORD" ]; then
  die \
    "Red zone breach: approval id '$APPROVAL_ID' has no audit record" \
    "Expected at $REPO_ROOT/.audit/$AUDIT_DATE/hitl/${APPROVAL_ID}.json (or last 7 days).
   The approval token was set but does not point at a real HITL approval record." \
    1
fi

# Verify the approval covers THIS file path. The HITL record JSON should contain
# an "approvedPaths" array or a "taskId" that we can cross-reference.
# We use simple grep here (jq may not be available in all CI environments).

if grep -q "\"approvedPaths\"" "$HITL_RECORD"; then
  # Strict mode: approval lists explicit paths
  if ! grep -q "\"$FILE_PATH\"" "$HITL_RECORD"; then
    die \
      "Red zone breach: approval '$APPROVAL_ID' does not cover '$FILE_PATH'" \
      "The HITL approval record at $HITL_RECORD lists approvedPaths but '$FILE_PATH' is not among them." \
      1
  fi
fi

# All checks passed — log + allow
echo "✅ blast-radius: Red zone write approved (tier=$MATCHED_TIER, pattern='$MATCHED_PATTERN', hitl=$APPROVAL_ID, path='$FILE_PATH')" >&2
exit 0

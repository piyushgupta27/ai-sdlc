#!/usr/bin/env bash
# bootstrap-project-board.sh — one-shot setup for a new ai-sdlc testbed.
#
# Creates the GitHub Project (v2), rewrites the Status field with the
# canonical 7 columns ai-sdlc expects, and creates the canonical issue
# labels on the repo. Idempotent: re-running on an already-set-up project
# is a no-op (project lookup by title, label `--force`, Status mutation
# replaces existing options).
#
# Requires gh CLI authenticated with `repo` + `project` scopes.
#   gh auth refresh -s project
#
# Usage:
#   ./tools/sdlc/scripts/bootstrap-project-board.sh <slug> <owner> [<repo>]
#
# Example (ai-sdlc itself):
#   ./tools/sdlc/scripts/bootstrap-project-board.sh ai-sdlc piyushgupta27
#
# Example (testbed in another repo):
#   ./tools/sdlc/scripts/bootstrap-project-board.sh trip-research piyushgupta27 piyushgupta27/trip-research

set -euo pipefail

SLUG="${1:-}"
OWNER="${2:-}"
REPO="${3:-${OWNER}/${SLUG}}"

if [[ -z "$SLUG" || -z "$OWNER" ]]; then
  echo "Usage: $0 <slug> <owner> [<repo>]"
  exit 2
fi

echo "→ Bootstrapping project board for $SLUG (owner: $OWNER, repo: $REPO)"

# ─── 1. Find or create the Project ─────────────────────────────────────

EXISTING=$(gh project list --owner "$OWNER" --format json \
  | jq -r --arg slug "$SLUG" '.projects[] | select(.title | ascii_downcase | contains($slug | ascii_downcase)) | .number' \
  | head -n1)

if [[ -n "$EXISTING" ]]; then
  PROJ_NUM="$EXISTING"
  echo "  ✓ Found existing project #$PROJ_NUM"
else
  echo "  ▸ Creating project '$SLUG pipeline'..."
  CREATE_OUT=$(gh project create --owner "$OWNER" --title "$SLUG pipeline" --format json)
  PROJ_NUM=$(echo "$CREATE_OUT" | jq -r '.number')
  echo "  ✓ Created project #$PROJ_NUM"
fi

# ─── 2. Look up Status field id ────────────────────────────────────────

STATUS_FIELD_ID=$(gh project field-list "$PROJ_NUM" --owner "$OWNER" --format json \
  | jq -r '.fields[] | select(.name=="Status") | .id')

if [[ -z "$STATUS_FIELD_ID" || "$STATUS_FIELD_ID" == "null" ]]; then
  echo "  ✗ No Status field found on project #$PROJ_NUM"
  exit 1
fi
echo "  ✓ Status field: $STATUS_FIELD_ID"

# ─── 3. Rewrite Status options with canonical 7 ────────────────────────
# Note: this REPLACES all existing options. Safe on empty projects;
# on populated projects it orphans items currently assigned to dropped
# options. Run before any items are added.

echo "  ▸ Setting canonical Status options (Ready/Building/QA/Review/Done/Blocked/Skipped)..."

gh api graphql -f query='
mutation ($fieldId: ID!) {
  updateProjectV2Field(input: {
    fieldId: $fieldId
    singleSelectOptions: [
      { name: "Ready",    color: GRAY,   description: "Triaged, has AC. pnpm sdlc dispatch picks from here." }
      { name: "Building", color: YELLOW, description: "Agent fleet running. Watch via pnpm sdlc dashboard." }
      { name: "QA",       color: ORANGE, description: "Tests passing locally; CI/integration in flight." }
      { name: "Review",   color: PURPLE, description: "REVIEWER verdict pending, or awaiting human eyes." }
      { name: "Done",     color: GREEN,  description: "Merged. Audit row written." }
      { name: "Blocked",  color: RED,    description: "HITL gate fired or retry cap hit — needs human." }
      { name: "Skipped",  color: GRAY,   description: "Deliberately not done — descoped or out-of-tier." }
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField { options { name color } }
    }
  }
}' -f fieldId="$STATUS_FIELD_ID" > /dev/null

echo "  ✓ Status options set"

# ─── 4. Create canonical issue labels on the repo ──────────────────────

echo "  ▸ Creating canonical labels on $REPO..."

create_label () {
  local name="$1" color="$2" desc="$3"
  gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" --force > /dev/null
  echo "    · $name ($color)"
}

create_label "tier:0"       "B60205" "ALWAYS HITL — security, auth, cookies, rollback. Never auto-merged."
create_label "tier:1"       "D93F0B" "High blast radius — architecture, contracts, migrations, public APIs."
create_label "tier:2"       "FBCA04" "Standard feature work — default tier."
create_label "tier:3"       "0E8A16" "Low-risk — bug fixes, refactors, internal-only."
create_label "tier:4"       "C5DEF5" "Cosmetic — typos, docs, comments."
create_label "blocked"      "D73A4A" "Companion to Status:Blocked — surfaces in default issue list."
create_label "hitl-pending" "FBCA04" "A HITL gate fired and is awaiting your reply."

echo
echo "✓ Project board for $SLUG is ready."
echo "  Project: https://github.com/users/$OWNER/projects/$PROJ_NUM"
echo "  Repo:    https://github.com/$REPO"
echo
echo "Next:"
echo "  pnpm sdlc onboard --slug $SLUG --repo \$(pwd) --owner $OWNER --runtime node --visibility public"
echo "  pnpm sdlc board --project $SLUG"

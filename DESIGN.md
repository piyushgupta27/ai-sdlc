# ai-sdlc · DESIGN

> CLI surface, dashboard UX, issue/PR templates, error message format, notification design. Updated 2026-05-22.

This is the user-facing design spec. While [ARCHITECTURE.md](./ARCHITECTURE.md) defines the internal system, this doc defines what the user actually sees and types. Implementation in Phase A.

---

## Table of contents

1. [CLI design — `pnpm sdlc *`](#1-cli-design)
2. [Dashboard UX (:3001)](#2-dashboard-ux)
3. [Issue templates](#3-issue-templates)
4. [PR template](#4-pr-template)
5. [Label taxonomy](#5-label-taxonomy)
6. [Error message format](#6-error-message-format)
7. [Notification design (macOS)](#7-notification-design-macos)
8. [Audit log query DSL](#8-audit-log-query-dsl)

---

## 1. CLI design

### 1.1 Command groups

```
pnpm sdlc <group> <verb> [args]
```

| Group | Purpose |
|---|---|
| `onboard` | Add a new project as a testbed |
| `deboard` | Remove a project (target repo untouched) |
| `start` | Run pipeline on an epic / task |
| `tick` | SCOUT cron entry point |
| `status` | Project/pipeline state |
| `audit` | Query audit log |
| `replay` | Re-run an agent on past inputs |
| `readiness` | Compute / display Repo Readiness Score |
| `next` | Show next pending HITL gate |
| `vacation` | Pause notifications + expire clocks |
| `force-exempt` | Override a guardrail (audit-logged) |
| `config` | View / edit per-project + global config |

### 1.2 Help structure

```
$ pnpm sdlc --help

ai-sdlc · autonomous SDLC platform
Usage: pnpm sdlc <command> [options]

Project lifecycle
  onboard            Add a new project as a testbed
  deboard            Remove a project from ai-sdlc management
  status             Show project state and pipeline health

Pipeline operations
  start              Start pipeline on an epic or task
  tick               Run SCOUT proactive checks (cron entry)
  next               Show the next pending HITL gate
  readiness          Compute Repo Readiness Score for a project

Audit + replay
  audit              Query audit log
  replay             Re-run an agent on past inputs

Maintenance
  vacation           Pause notifications + expire clocks
  force-exempt       Override a guardrail (audit-logged)
  config             View / edit configuration

Common flags
  --project <slug>   Target project (required for most commands)
  --json             Output JSON instead of human-readable
  --verbose          Show internal reasoning

For help on a specific command:
  pnpm sdlc <command> --help

Documentation: https://github.com/piyushgupta27/ai-sdlc
```

### 1.3 Per-command help

Every command has `--help` that shows:
- 1-line summary
- Usage signature
- All flags with 1-line descriptions
- 2-3 example invocations
- Related commands

Example:

```
$ pnpm sdlc onboard --help

Onboard a new project as an ai-sdlc testbed.

Usage:
  pnpm sdlc onboard --repo <path> --slug <name> [options]

Required:
  --repo <path>      Local path to the target project's git repo
  --slug <name>      Short name (kebab-case) — used in CLI + audit logs

Options:
  --owner <handle>   GitHub handle of project owner (defaults to git config)
  --skip-test-debt   Skip the test-debt-first rule (logs audit warning)
  --tier-defaults <file>  Custom tier classification rules
  --dry-run          Show what would happen; don't write anything

Examples:
  # Standard onboarding
  pnpm sdlc onboard --repo ~/Workspace/trip-research --slug trip-research

  # Onboard with custom owner
  pnpm sdlc onboard --repo ~/Workspace/piyush-portfolio --slug portfolio --owner piyushgupta27

  # Dry-run to preview the bootstrap
  pnpm sdlc onboard --repo ~/Workspace/trip-research --slug trip-research --dry-run

Related: status, deboard, readiness
```

### 1.4 Common interaction patterns

**Project-scoped commands:** Almost everything requires `--project <slug>`. The CLI refuses to run with ambiguous scope.

```
$ pnpm sdlc start 3.2.2
Error: no project specified. Add --project <slug>.
Available: trip-research, piyush-portfolio, career-automation
```

**Persistent default project:** Set via `pnpm sdlc config set default-project trip-research`. Then `--project` is optional.

**Discoverable verb-noun ordering:** Always `<noun-group> <verb>` like `gh pr create`, never `<verb> <noun>` like `git add`. Consistent across the surface.

**Status output:**

```
$ pnpm sdlc status --project trip-research

Project: trip-research
  Repo: ~/Workspace/trip-research
  Onboarded: 2026-06-15 (7 days ago)
  Trust state: SUPERVISED
  Readiness: 72/100 (Context: 30/40 · Testing: 24/30 · CI/CD: 18/30)
  In-flight: 2 tasks (3.2.2 in REVIEW · 3.2.4 in BUILD)
  HITL queue: 2 pending (1 G2, 1 G3)
  Defect rate (7d): 3.0%
  Cost (7d): $4.23

Next pending HITL gate:
  G2 REVIEW — task 3.2.2 — opened 14 min ago
  Run: pnpm sdlc next --project trip-research
```

### 1.5 Conventions

- **Output is human-readable by default.** Use `--json` for machine parsing.
- **Colors used sparingly.** Red for errors / blocks, yellow for warnings, green for success, gray for metadata. Respects `NO_COLOR=1`.
- **Spinner only for long ops.** Never on commands that complete in <1s (`status`, `next`).
- **Confirmation for destructive ops.** `deboard`, `force-exempt`, `replay --force` require typing the project slug.

---

## 2. Dashboard UX (:3001)

### 2.1 Information architecture

```
localhost:3001/sdlc
├── /                     # Cross-project overview
├── /projects/<slug>      # Per-project view
├── /queue                # All pending HITL gates
├── /audit                # Audit log search
├── /metrics              # Trends + cohort analysis
└── /config               # Settings, vacation mode, etc.
```

### 2.2 Home page (cross-project)

```
┌─ ai-sdlc dashboard ────────────────────────────────────┐
│ 4 projects · 3 pending gates · last activity 12m ago    │
└─────────────────────────────────────────────────────────┘

┌─ Pending HITL gates (3) ───────────────────────────────┐
│ ● G2 REVIEW · trip-research/3.2.2 · 14m old · Tier 1   │
│ ● G3 DEMO · portfolio/1.4.1 · 1h old · Tier 2          │
│ ● G5 POST · career-auto/2.1.3 · 18h old · expires 6d   │
│                                                  [Open queue ▶] │
└─────────────────────────────────────────────────────────┘

┌─ Projects ─────────────────────────────────────────────┐
│ trip-research   SUPERVISED  72%  2 in-flight  $4.23/7d │
│ portfolio       MANUAL      45%  1 in-flight  $1.10/7d │
│ career-auto     STEADY-ST   88%  0 in-flight  $0.84/7d │
│ ai-finance      MANUAL      28%  0 in-flight  $0.00    │
└─────────────────────────────────────────────────────────┘

┌─ Recent activity ──────────────────────────────────────┐
│ 12m ago · portfolio · COMMIT merged · PR #14            │
│ 28m ago · trip-research · REVIEW pass · task 3.2.1     │
│ 1h ago  · portfolio · BUILD complete · task 1.4.1      │
│ 1h ago  · trip-research · PLAN approved · epic 3.2     │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

### 2.3 HITL gate view

Single-page focused interaction for each pending gate:

```
┌─ G2 REVIEW · trip-research/3.2.2 ─────────────────────┐
│ MMT search scraper                                      │
│ Tier 1 · 234 LOC · opened 14 min ago                    │
│                                                          │
│ Reviewer fleet verdict: CHANGES_REQUESTED               │
│   SECURITY    PASS                                       │
│   CODE-QUAL   CHANGES (1 finding, confidence 0.78)      │
│   BUG-DETECT  PASS                                       │
│                                                          │
│ Finding (after AI filter):                              │
│   packages/adapters/mmt/index.ts:142                    │
│   "Missing rate-limit on detail-page fetch"             │
│   "Without throttling, parallel requests will hit MMT's │
│    rate limiter and trigger cookie invalidation"        │
│                                                          │
│   Suggested fix: wrap detail fetch in PromisePool with  │
│   concurrency 3 + 2s minimum delay between requests.    │
│                                                          │
│ [View diff] [View audit log] [View demo (none for REV)] │
│                                                          │
│ ┌─ Your decision ──────────────────────────────────────┐│
│ │ ( ) Approve as-is                                     ││
│ │ ( ) Approve with follow-up TODO                       ││
│ │ (●) Request changes  ◄── recommended                  ││
│ │ ( ) Reject                                            ││
│ │ ( ) Escalate to deeper review (more reviewers)        ││
│ │                                                        ││
│ │ Comment (optional, sent to BUILDER):                  ││
│ │ ┌────────────────────────────────────────────────────┐││
│ │ │                                                    │││
│ │ └────────────────────────────────────────────────────┘││
│ │                                                        ││
│ │                                       [Submit]         ││
│ └────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

Keyboard shortcuts:
- `1-5` — select decision option
- `Cmd+Enter` — submit
- `j / k` — next / previous gate in queue
- `?` — show shortcut help

### 2.4 Audit view (search + filter)

```
┌─ Audit log ────────────────────────────────────────────┐
│ Project: trip-research ▼   Agent: any ▼   Date: 7d ▼   │
│ Filter: [outcome=success]                              │
│                                                         │
│ 2026-06-22T11:23:45 · builder · task 3.2.2 · BUILD     │
│   Sonnet 4.6 · 18.4s · $0.087 · cache 21K/24K tokens   │
│   Output: packages/adapters/mmt/index.ts                │
│   [Expand row]                                          │
│                                                         │
│ 2026-06-22T11:23:12 · planner · epic 3.2 · PLAN        │
│   Opus 4.7 · 31.2s · $0.142                            │
│   Output: 8 tasks queued                                │
│   [Expand row]                                          │
│                                                         │
│ ... (210 more rows)                            [Load 50 more ▼] │
└─────────────────────────────────────────────────────────┘
```

Each row has [Expand] showing the full JSONL record. Replay button on each row.

---

## 3. Issue templates

Used both for ai-sdlc itself and for onboarded testbeds. PLANNER reads these to determine intake type.

### 3.1 epic.md

```yaml
---
name: Epic
about: Multi-task scope of work
title: "[epic] "
labels: ["kind:epic", "status:proposed"]
---

## Outcome
<What user-visible outcome this epic delivers.>

## Success criteria (acceptance criteria)
- [ ] AC1
- [ ] AC2
- [ ] AC3

## Stories (rough decomposition)
- Story 1: <one-line>
- Story 2: <one-line>

## Tier classification (proposed)
**Tier:** <0-4>
**Why:** <one-line justification — see CLAUDE.md Red zone>

## Estimated cost
**Budget:** $<amount>  (default $20/epic; require ADR if >$50)

## Open questions (Q-AI style)
- <Anything PLANNER needs human input on before decomposing>

## Dependencies
<Other epics / external work this depends on>

## Definition of Done (DoD)
- [ ] All AC ticked
- [ ] Coverage ≥70% on changed files
- [ ] CONTEXT.md updated per bubble-up rule
- [ ] ADR(s) written if architectural decisions made
- [ ] G5 post-merge feedback positive
```

### 3.2 feature.md

```yaml
---
name: Feature
about: A new capability or enhancement
title: "[feature] "
labels: ["kind:feature", "status:proposed"]
---

## Problem
<What pain this solves; for whom; what's the current workaround>

## Proposed solution
<1-paragraph sketch>

## Tier classification
**Tier:** <0-4>

## Acceptance criteria
- [ ] AC1
- [ ] AC2

## Alternatives considered
<List alternatives, why rejected>

## Dependencies
```

### 3.3 bug.md

```yaml
---
name: Bug
about: Something's broken
title: "[bug] "
labels: ["kind:bug", "status:reported"]
---

## What's broken
<One-line description>

## Reproduction
1. <step>
2. <step>

## Expected
<What should happen>

## Actual
<What does happen>

## Environment
- Branch / commit:
- Browser / OS / runtime:

## Severity
- [ ] Critical (data loss, security)
- [ ] High (feature broken)
- [ ] Medium (workaround exists)
- [ ] Low (cosmetic)

## Tier (auto-set from severity)
**Tier:** <0-4>
```

### 3.4 adr.md

```yaml
---
name: ADR — Architectural Decision Request
about: Request a decision that crosses module boundaries
title: "[adr] "
labels: ["kind:adr", "status:proposed"]
---

## Context
<What forces this decision; what's at stake>

## Options
### Option A — <name>
- **Approach:** <description>
- **Pros:** <list>
- **Cons:** <list>
- **Cost:** S / M / L
- **Reversibility:** one-way / two-way door

### Option B — <name>
- ...

## Recommendation
<Which option + why, in 2-3 sentences>

## Alternatives explicitly rejected
<Approaches not even worth full consideration; one-liner why>

## Decision (filled in after G1.5)
<Final decision + date + signed by>

## Rollback path if wrong
<What's the cost of being wrong; how to reverse>
```

### 3.5 discussion.md

For non-blocking thinking-aloud. Routed to GitHub Discussions for public repos.

```yaml
---
name: Discussion
about: Open-ended thinking / question / proposal
title: ""
labels: ["kind:discussion"]
---

## What I'm thinking about
<Paragraph>

## What I'd like input on
<Specific question OR "just sharing">

## Related
<Links to issues, ADRs, PRs>
```

---

## 4. PR template

```markdown
## Summary
<1-2 sentences: what changed and why>

## Linked epic / issue
<Closes #N>

## Tier
- [ ] Tier 0 (extreme; never autonomous)
- [ ] Tier 1 (high blast radius)
- [ ] Tier 2 (yellow zone)
- [ ] Tier 3 (green, polish)
- [ ] Tier 4 (trivial)

## Acceptance criteria satisfied
- [ ] AC1: <description>
- [ ] AC2: <description>

## Audit log
**Run ID:** <ai-sdlc audit run id; or "manual" for human-authored PRs>
**Diff path:** `.audit/<date>/diffs/<task>.diff`

## Tests
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] E2E test added (if UI changed)
- [ ] Coverage delta: ___ → ___ (target ≥70%)

## CONTEXT.md updates
- [ ] Updated `<path>/CONTEXT.md` per bubble-up rule
- [ ] N/A (no API surface changes)

## ADR
- [ ] No ADR required
- [ ] ADR written at `docs/adr/<id>.md`

## Rollback path
<git revert is implicit; document only if revert alone insufficient>

## Reviewer fleet verdict
<Filled by AGGREGATOR if agent-authored>

---

🤖 Generated-By: agent:<role>@<model>  (for agent-authored PRs)
```

---

## 5. Label taxonomy

Applied via `gh label create` during onboarding. Used by ai-sdlc for routing.

### 5.1 Tier labels

| Label | Color | Meaning |
|---|---|---|
| `tier:0` | red | Never autonomous; all 5 HITL gates fire |
| `tier:1` | red | High blast radius; HITL at PLAN + REVIEW + COMMIT + POST |
| `tier:2` | yellow | Standard; HITL on confidence threshold |
| `tier:3` | green | Polish; mostly autonomous |
| `tier:4` | green | Trivial; fully autonomous |

### 5.2 Kind labels

| Label | Meaning |
|---|---|
| `kind:bug` | Something broken |
| `kind:feature` | New capability |
| `kind:epic` | Multi-task scope |
| `kind:adr` | Architectural decision request |
| `kind:discussion` | Open-ended thinking |
| `kind:docs` | Documentation-only change |
| `kind:refactor` | Code restructure, no behavior change |
| `kind:test` | Test-only addition |
| `kind:chore` | Dep update, build config, etc. |
| `kind:security` | Security fix or hardening |
| `kind:scout` | Filed by SCOUT cron job |

### 5.3 Status labels

| Label | Meaning |
|---|---|
| `status:proposed` | Filed, not yet planned |
| `status:planned` | PLANNER has decomposed; queued |
| `status:in-flight` | Active build |
| `status:in-review` | Reviewer fleet running OR G2 pending |
| `status:demo` | DEMO running OR G3 pending |
| `status:blocked` | Blocked by a dependency |
| `status:blocked-on-decision` | Blocked on user G1/G1.5 response |
| `status:done` | Merged |
| `status:revoked` | Closed without merge |

### 5.4 Area labels (per project, customized)

| Label (example for trip-research) | Meaning |
|---|---|
| `area:frontend` | apps/web changes |
| `area:adapter` | packages/adapters/* |
| `area:data` | packages/data/* |
| `area:pipeline` | tools/sdlc/* (ai-sdlc-internal only) |
| `area:docs` | docs/* + *.md |

### 5.5 HITL approval labels (special)

| Label | Meaning |
|---|---|
| `hitl-approved-tier-0` | Applied by dashboard on G3 approval of Tier 0 PR |
| `hitl-approved-tier-1` | Applied by dashboard on G3 approval of Tier 1 PR |
| `cla-signed` | Applied by cla-assistant.io bot |
| `regression-from-PR-N` | Applied when a defect is traced to a specific PR (defect tracking) |

---

## 6. Error message format

Per principle "every error has problem + cause + fix + docs link":

### 6.1 Anatomy

```
❌ <Problem in plain language>

   <Cause: what triggered it; what's invariant being violated>

   <Fix: specific next action>

   <Docs link>
```

### 6.2 Examples

**Bad (vague):**
```
Error: confidence below threshold
```

**Good:**
```
❌ Reviewer fleet confidence too low to auto-approve.

   AGGREGATOR returned confidence 0.78 (threshold 0.85).
   SECURITY-REVIEWER flagged: missing rate-limit on detail-page fetch
   (medium severity, CWE-770).

   Either:
     1. Open the G2 gate and approve manually:  pnpm sdlc next --project trip-research
     2. Address the finding in a follow-up commit
     3. Raise the threshold permanently in projects/trip-research/config.json

   Docs: https://github.com/piyushgupta27/ai-sdlc/blob/main/HITL.md#g2-review-gate
```

### 6.3 Categories

| Category | Prefix | Example |
|---|---|---|
| User-recoverable | `❌` red | Missing flag, file not found |
| Validation failure | `⚠️` yellow | Coverage below threshold |
| Block (security/safety) | `🛑` red | Red zone write without approval |
| Pipeline pause (transient) | `⏸️` yellow | HITL queue full; waiting |
| Internal error | `💥` red | "This shouldn't happen; please file an issue with the run id below" |

---

## 7. Notification design (macOS)

### 7.1 osascript notification format

```bash
osascript -e 'display notification "<body>" with title "<title>" subtitle "<subtitle>" sound name "<sound>"'
```

### 7.2 Per-gate format

| Gate | Title | Subtitle | Body | Sound |
|---|---|---|---|---|
| G1 | "ai-sdlc · PLAN approval needed" | "<project>" | "Epic '<title>' · <N> tasks proposed · Tier <T>" | "Funk" (gentle) |
| G1.5 | "ai-sdlc · ADR needs your call" | "<project>" | "<ADR title> · 2 options on the table" | "Glass" |
| G2 | "ai-sdlc · Review verdict" | "<project> / <task>" | "<verdict> · confidence <c> · <findings count> findings" | "Pop" |
| G3 | "ai-sdlc · Demo ready" | "<project> / <task>" | "All AC pass · visual diff <d>% · ready for merge" | "Glass" |
| G5 | "ai-sdlc · How did this go?" | "<project> / <task>" | "Merged 24h ago · did it work as expected?" | "Tink" (subtle) |

### 7.3 Click behavior

Notifications include a payload (JSON file path) that opens the dashboard at the specific gate on click. Implemented via `osascript` + `open` chained:

```bash
osascript -e 'display notification ... return result' && open 'http://localhost:3001/sdlc/queue?gate=G2-trip-research-3.2.2'
```

(On macOS, clicking the notification triggers the URL handler.)

### 7.4 Quiet hours

Notifier checks current time + user's `config.notifications.quiet_hours` before firing. If in quiet window: queue persists, no sound, no banner. On exit from quiet hours, batch summary banner: "3 HITL gates pending — open dashboard".

### 7.5 Vacation mode

`pnpm sdlc vacation start --until 2026-06-15` writes a config flag. Notifier early-exits. Expire clocks paused on existing gates. End command: `pnpm sdlc vacation end`.

---

## 8. Audit log query DSL

`pnpm sdlc audit` supports a small filter language for searching the audit log.

### 8.1 Syntax

```
pnpm sdlc audit --project <slug> --filter '<expression>'
```

### 8.2 Expression grammar

```
expr      := term ( ('AND' | 'OR') term )*
term      := field op value | '(' expr ')'
field     := 'agent' | 'task_id' | 'stage' | 'outcome' | 'model' | 'date' | 'cost_usd' | ...
op        := '=' | '!=' | '<' | '>' | '<=' | '>=' | 'IN' | 'LIKE'
value     := string | number | array
```

### 8.3 Examples

```bash
# All failed reviewer runs in the last 7 days
pnpm sdlc audit --project trip-research --filter 'agent=security AND outcome=fail AND date>="7d"'

# Tasks that cost more than $1
pnpm sdlc audit --project trip-research --filter 'cost_usd > 1.0'

# Specific task's full history
pnpm sdlc audit --project trip-research --filter 'task_id=3.2.2'

# All Tier 0/1 work in the last 30 days
pnpm sdlc audit --project trip-research --filter 'tier IN [0,1] AND date>="30d"' --json
```

### 8.4 Output

Default: tabular human-readable.

```
TIMESTAMP             AGENT       TASK    STAGE     OUTCOME   COST    DURATION
2026-06-22T11:23:45   builder     3.2.2   BUILD     success   $0.087  18.4s
2026-06-22T11:25:01   tester      3.2.2   TEST      success   $0.034  9.2s
2026-06-22T11:25:48   security    3.2.2   REVIEW    changes   $0.112  14.6s
...
```

With `--json`: streaming JSONL.

With `--replay <row-id>`: fetches the exact inputs + re-fires the agent. Output goes to a temporary dir for diff comparison.

---

## 9. Onboarding flow CLI example (end-to-end)

```bash
$ pnpm sdlc onboard --repo ~/Workspace/trip-research --slug trip-research

✓ Verified repo exists at ~/Workspace/trip-research
✓ Verified GitHub remote: git@github.com:piyushgupta27/trip-research.git
✓ Verified gh CLI auth
⚠ Branch protection not enabled on main
  → Enable now? [Y/n] Y
✓ Branch protection enabled

Drafting CLAUDE.md with proposed Red zone...
  Red zone files (proposed):
    Tier 0: private/, packages/security/, tools/check-blast-radius.sh, CLAUDE.md
    Tier 1: packages/adapters/*/contract.ts, packages/data/migrations/*

⏸  G1.5 ADR gate fired. Open dashboard:
   http://localhost:3001/sdlc/queue?gate=G1.5-trip-research-onboard-001

(waiting for your approval...)

✓ G1.5 approved at 2026-06-22T12:14:23Z

✓ Wrote CLAUDE.md (1.4KB)
✓ Wrote CONTEXT.md (root) (820B)
✓ Wrote .github/ISSUE_TEMPLATE/{bug,feature,epic,adr,discussion}.md (5 files)
✓ Wrote .github/pull_request_template.md
✓ Wrote .github/workflows/{ci,e2e,blast-radius}.yml (3 workflows)
✓ Wrote tools/check-blast-radius.sh + made executable
✓ Wrote CODEOWNERS
✓ Created 20 GitHub labels
✓ Created Phase A milestone
✓ Committed bootstrap as PR #1
✓ ai-sdlc project registered: projects/trip-research/

Onboarding complete in 4m 28s.

Next step: Phase 2 — establish test coverage.
Run: pnpm sdlc start --project trip-research --epic 'establish-test-coverage'
```

---

## 10. Design principles followed

| Principle | Where applied |
|---|---|
| **Zero friction at T0** | Onboarding flow is 1 command; first feedback in <2s |
| **Decide for me, let me override** | Sensible defaults (tier classification, label set, workflows) + `--config` for customization |
| **Fight uncertainty** | Every error message names problem + cause + fix + docs |
| **Show code in context** | Audit log + dashboard show real artifact paths, not abstract "task succeeded" |
| **Magical moment** | First time the pipeline merges a PR autonomously — that's the moment. Calendar notification logged so you remember the date. |
| **Subtraction default** | No status icons everywhere; no decorative gradients; tables over prose |
| **Hierarchy as service** | Dashboard home is "what needs my attention now"; everything else one click away |

---

## Implementation note

This doc specifies the SURFACE. The implementation arrives during Phase A. The dashboard at :3001, the `pnpm sdlc` CLI, the issue templates, the workflows — all Phase A deliverables.

Until then, this is the contract. The Phase A audit suite will verify the implementation matches this design.

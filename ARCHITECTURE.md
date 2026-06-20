# ai-sdlc · ARCHITECTURE

> Full system design: orchestrator, agents, multi-tenant infrastructure, gates, transports, audit, trust expansion. Updated 2026-05-22.

This is the load-bearing technical spec. Cross-referenced by every other doc in the suite. Updates here propagate to consumer code through CONTEXT.md per module.

---

## Table of contents

1. [Parent references](#1-parent-references)
2. [Vision](#2-vision)
3. [Pipeline architecture](#3-pipeline-architecture)
4. [Agent roster](#4-agent-roster)
5. [Workflow stages](#5-workflow-stages)
6. [Tier system + zone mapping](#6-tier-system--zone-mapping)
7. [Guardrails — three-layer enforcement](#7-guardrails--three-layer-enforcement)
8. [Auditability + observability](#8-auditability--observability)
9. [Context layer (CONTEXT.md per module)](#9-context-layer)
10. [Rollback + trust contraction](#10-rollback--trust-contraction)
11. [Trust expansion model](#11-trust-expansion-model)
12. [Tooling + transports](#12-tooling--transports)
13. [Multi-tenant infrastructure](#13-multi-tenant-infrastructure)
14. [File organization](#14-file-organization)

---

## 1. Parent references

ai-sdlc inherits patterns from two production references:

- **Razorpay Slash** — production autonomous SDLC at enterprise scale. Source: https://razorpay.com/blog/razorpay-engineers-built-slash-slash-builds-the-rest/
  - Three entry points (Slack/CLI/cron)
  - Specialized reviewer fleet (per-dimension sub-agents in parallel)
  - Repo Readiness Score (80%+ threshold for autonomy)
  - AI filter layer (drops false positives before human review)
  - Production scale: 1,000 PRs/week, ~33% auto-merge with zero human comments
- **a prior internal Jira-to-PR pattern doc (private)** — the maintainer's authored canonical pattern doc (private)
  - Blast-radius zones (Green/Yellow/Red)
  - Three-layer enforcement (CLAUDE.md + pre-write hook + CI)
  - Trust expansion criteria (20+ tickets, 0 incidents, ≥85% coverage, owner sign-off)
  - Model routing (Sonnet default, Opus fallback)
  - Prompt caching cost model (95% savings on cached context)
  - 12-sprint phased rollout

ai-sdlc is the personal-projects sibling: same DNA, smaller scale (~5 tickets/week across 4-5 testbeds), Claude Code Subagent transport only (no separate API keys), single-Mac deployment.

---

## 2. Vision

A multi-tenant autonomous SDLC pipeline that builds, tests, reviews, and ships code across a portfolio of products with calibrated human-in-the-loop intervention. Treats agentic AI as the primary engineer; the human is reviewer, product owner, and architecture decision-maker.

Design principles:

1. **Agents do routine work. Humans intervene where it matters.** The 5 HITL gates ([HITL.md](./HITL.md)) define where.
2. **Trust expands on data, not intuition.** Zone reclassification has formal criteria (R-AISDLC-38).
3. **Auditability is non-negotiable.** Every agent action is one JSONL row; replayable.
4. **Multi-tenant from day 1.** One pipeline manages N projects; no cross-project bleed.
5. **Boring infrastructure.** Git worktrees, SQLite, Next.js, Claude Code Subagent. No exotic deps.
6. **Three-layer safety on Red zone.** Each layer independent; all three must fail for a breach.
7. **Test-debt-first.** New project's first task = establish test coverage. No autonomous work below 70%.

---

## 3. Pipeline architecture

> **v1 scope note (2026-05-23):** This section describes the **full target architecture**. v1 (slim Phase A, ~6 days) wires a subset: orchestrator + 4 agents (PLANNER, BUILDER, TESTER, REVIEWER as one generalist, REPORTER) + G2 HITL gate + plain JSONL audit + Layers 1+2 of enforcement + GitHub Project board substrate. The specialized reviewer fleet (§4.4 subsections beyond a generalist REVIEWER), AGGREGATOR + AI filter (§4.4-AGG), full 5-gate HITL (§7 G1/G1.5/G3/G5), trust state machine (§11), hash-chained audit (§8), Layer 3 CI enforcement (§7 G1.3), and Repo Readiness Score (§5.0) are pre-specified here but **graduate per the v1.5+ table in [ROADMAP.md](./ROADMAP.md)**. Read this section as architectural intent; read ROADMAP for what ships when.

### 3.1 Entry points

Adopted from Razorpay's three-door pattern + Eric Tech's Superboard mobile-dispatch pattern, adapted for solo use:

| # | Door | When it fires | Implementation |
|---|---|---|---|
| 1 | **CLI** (`pnpm sdlc start <epic-id> --project <slug>`) | Piyush explicitly invokes the pipeline on an epic | Default path; lowest ceremony |
| 2 | **Slash commands** (`/sdlc-run`, `/sdlc-lint`, `/sdlc-status`, `/sdlc-board`, `/sdlc-next`) | Interactive Claude session; thin wrappers over CLI | R-AISDLC-107; lives at `.claude/commands/sdlc-*.md` |
| 3 | **macOS notification reply + dashboard** at `localhost:3001/sdlc` | HITL gates fire back to user; click → dashboard → approve/reject | Q-AI-3 decision |
| 4 | **Mobile webhook** via ntfy.sh (`pnpm sdlc dispatch --webhook <topic>`) | Remote trigger from anywhere; "I shipped from my phone" demo capability | Q-AI-25 / R-AISDLC-104; Superboard pattern (Telegram → ntfy.sh adapted) |
| 5 | **Cron schedule** (`pnpm sdlc tick`) | Every 6h: SCOUT runs proactive checks (dep updates, DOM drift for adapters, perf regressions) and files issues PLANNER picks up on next CLI run | Replaces Razorpay's scheduled skills |

No GitHub webhook on issue creation in v1 — that's Phase E territory.

### 3.1.5 Orchestration substrate: GitHub Projects board (Q-AI-21, R-AISDLC-100)

The state machine for each onboarded repo IS its GitHub Project board. Orchestrator reads/writes column state via `gh project item-edit`. Canonical columns:

```
Ready  →  Building  →  QA  →  Review  →  Done
              ↑              (auto-merge → develop branch — Q-AI-24)
              ↑
        Blocked / Skipped (manual gates; "add a column" meta-pattern per R-AISDLC-106)
```

Why this substrate (adopted from Eric Tech's Superboard):
- **Native to GitHub** — no separate UI; uses what every developer already has
- **Public for public repos** — recruiter-visible kanban progress; portfolio signal
- **State is visible** — anyone can see what's in flight without dashboard access
- **Onboarding creates it** — `pnpm sdlc onboard` provisions the project board with canonical columns

The local dashboard at `:3001` supplements (audit log query, cohort analytics, cost) but doesn't gatekeep — the GitHub Project board is the canonical "what's where" surface.

### 3.2 Pipeline diagram

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                       USER (Piyush)                              │
   │   answers G1 PLAN · G1.5 ADR · G2 REVIEW · G3 DEMO · G5 POST    │
   └──────────────────────────┬───────────────────────────────────────┘
              ▲               │
   ┌──────────┼───────────────┼─────────────────────────────────────┐
   │  ENTRY POINTS            ▼                                       │
   │  ┌──────┐  ┌──────────┐  ┌─────────┐                             │
   │  │ CLI  │  │macOS noti│  │ cron 6h │                             │
   │  └──────┘  └──────────┘  └─────────┘                             │
   └──────────┬───────────────┬────────────┬──────────────────────────┘
              │               │            │
              ▼               ▼            ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                    ORCHESTRATOR                                  │
   │                                                                  │
   │  - reads target project's PLAN.md (epics → stories → tasks)     │
   │  - selects next task per dependencies + tier + WIP limits        │
   │  - spawns agent in target project's worktree                     │
   │  - writes audit row to .audit/<date>/runs/*.jsonl                │
   │  - handles failures, retries (≤3), escalation                    │
   │  - dispatches HITL gates G1/G1.5/G2/G3/G5 per tier matrix        │
   └─┬─────────┬──────────┬──────────────┬──────────┬─────────┬──────┘
     │         │          │              │          │         │
     ▼         ▼          ▼              ▼          ▼         ▼
   PLAN     BUILD       TEST         REVIEWER     DEMO     COMMIT
  agent    agent       agent         FLEET §4.4   agent     agent
     ↓         ↓          ↓              ↓          ↓         ↓
                                  ┌──────────────┐
                                  │ AGGREGATOR + │
                                  │  AI filter   │
                                  └──────────────┘
                                         ↓
  ──────────────────────────────────────────────────────────────────
       SHARED INFRASTRUCTURE
       - audit log (90d JSONL in target repo + SQLite archive in ~/.gstack/)
       - context layer (CLAUDE.md + CONTEXT.md per module in target repo)
       - git (canonical state; worktrees for agent sandboxes)
       - model router (Sonnet default + Opus fallback + Haiku for AGGREGATOR)
       - guardrail enforcer (three-layer: CLAUDE.md + pre-write hook + CI)
       - prompt-cache (CLAUDE.md + CONTEXT.md tree cached per run)
       - dashboard at :3001 (Next.js sub-app)
       - HITL queue (.sdlc-queue/pending-hitl/*.json per project)
```

### 3.3 Key properties

- **Each agent is stateless.** Receives a brief, returns a result, no side effects outside its sandbox until ORCHESTRATOR commits them.
- **Orchestrator is the only stateful component.** Knows in-flight tasks, blocked tasks, just-completed work.
- **Audit log is append-only.** Hash-chained. Tampering detected on read.
- **HITL gates are explicit.** Orchestrator pauses + writes structured request + pings user.
- **Project namespace is enforced.** Audit, prompts, sandboxes all keyed by project slug; no cross-project access without explicit override.

### 3.4 What lives where

| Component | Location | Notes |
|---|---|---|
| Orchestrator | `tools/sdlc/orchestrator/` in ai-sdlc | TypeScript; runs locally |
| Agents | `tools/sdlc/agents/<agent-name>/` | One module per agent |
| Project configs | `projects/<slug>/config.json` | Per-target metadata |
| Project state | `projects/<slug>/state.json` | Trust state, readiness, in-flight |
| Project prompts | `projects/<slug>/prompts/` | Project-specific prompt overrides |
| Audit log (recent) | `.audit/<date>/runs/*.jsonl` in TARGET repo | 90 days; git-tracked |
| Audit log (archive) | `~/.gstack/audit/<slug>/` SQLite | >90 days |
| HITL queue | `.sdlc-queue/pending-hitl/*.json` in TARGET repo | gitignored |
| Agent sandboxes | `.sdlc-sandboxes/<task-id>/` worktrees in TARGET repo | gitignored |
| Living docs | `**/CONTEXT.md` in TARGET repo | Updated by BUILDER on relevant commits |
| ADRs | `docs/adr/*.md` in TARGET repo | Written by BUILDER on G1.5 approval |
| Dashboard | `tools/sdlc/dashboard/` Next.js sub-app on :3001 | Reads queue + audit log |

---

## 4. Agent roster

Each agent is a thin shell around a Claude Code Subagent call with a focused prompt, scoped tools, and explicit output schema.

### 4.1 PLANNER

- **Job:** Take an epic spec (from GitHub issue with `epic.md` template) → produce stories + tasks with full DoD/AC/Tier/Est/Deps
- **Inputs:** epic spec, target project's PLAN.md, recent git log, CONTEXT.md tree, prior epic outcomes
- **Tools:** read-only file tools; codebase search; ADR catalog read
- **Output:** structured JSON; written to `projects/<slug>/queue/<epic-id>.json` + posted to G1 HITL queue
- **Model:** Opus 4.7 (strong reasoning, low frequency)
- **Self-check:** Has DoD? Has AC? Has rollback? Tasks ≤8h each? Deps form a DAG? Tier classification justified?
- **Escalation:** if epic spans >4 weeks or >12 stories, ask user for sub-epic decomposition

### 4.2 BUILDER

- **Job:** Take one task → produce code change in feature branch
- **Inputs:** task spec, current code, CONTEXT.md for affected modules, relevant ADRs, project's `tasks/lessons.md`
- **Tools:** read/write/edit in sandbox worktree; run tests; run lint; git ops
- **Output:** git commit on `feature/<task-id>` branch
- **Model:** Sonnet 4.6 default; Opus 4.7 fallback (Tier 0/1 OR first attempt fails validation)
- **Self-check:** Compiles? Lints? Inline tests pass? No new `any`? Type-safety honored? CONTEXT.md updated if applicable?
- **Escalation:** if file count >10 OR LOC >500, request PLANNER re-decomposition. If ADR-worthy decision, draft ADR and fire G1.5.
- **Merge-conflict policy (#15):** BUILDER must not modify `package.json` version pins or `scripts` unless the AC explicitly names the change. `git checkout --theirs/--ours` is forbidden for any file — a conflict means `outcome: "escalated"`. Platform-side: `maybeCreatePr()` in `dispatch.ts` runs `pnpm install --frozen-lockfile` (the lockfile drift guard) when BUILDER's commit touches `package.json`/`pnpm-lock.yaml`; if specifiers are out of sync the push is blocked.

### 4.3 TESTER

- **Job:** Given a built task, produce unit + integration tests; e2e if a view changed
- **Inputs:** built diff, task AC, existing test suite, project's testing conventions from CONTEXT.md
- **Tools:** read/write in sandbox; run vitest; run playwright
- **Output:** additional commits with tests; coverage report
- **Model:** Sonnet 4.6 default; Opus 4.7 if TESTER fails coverage target twice
- **Self-check:** Every public function tested? At least one negative path? Coverage ≥70% on changed files (≥85% Tier 0/1)?

### 4.4 REVIEWER FLEET (specialized, parallel)

Replaces "one big reviewer" with narrow specialists. Dispatched in parallel; verdicts aggregated through §4.4-AGG before HITL ping.

#### Phase A fleet — 2 reviewers (always-on)

##### 4.4a SECURITY-REVIEWER

- **Job:** Detect secrets, unsafe deserialization, auth bypass, cookie leakage, unsafe Playwright `evaluate`, browser allowlist violations
- **Inputs:** diff + tests + adapter contracts + project's R-BEH allowlist (if applicable)
- **Tools:** gitleaks; semgrep with custom rules (`docs/security-rules/`); read-only code search
- **Output:** `verdict: PASS | CHANGES_REQUESTED | BLOCK`; severity per finding (low/med/high/critical); CWE refs
- **Model:** Opus 4.7 with cold-read hostile-eye prompt, temperature 0.7 (Q-AI-2 amendment + Q-AI-18)
- **Hard rule:** Any **critical** finding → BLOCK; pipeline pauses for G2 HITL regardless of tier (overrides tier matrix)

##### 4.4b CODE-QUALITY-REVIEWER

- **Job:** Spot dead code, premature abstractions, missing error handling, leaky abstractions, type-safety bypass, magic numbers, anti-patterns from `tasks/lessons.md`
- **Inputs:** diff + CONTEXT.md for affected modules + repo lint config + lessons file
- **Tools:** read-only; biome; codebase search
- **Output:** `verdict: PASS | CHANGES_REQUESTED | FAIL`; confidence 0-1; inline annotations
- **Model:** Opus 4.7 with code-smell-focused hostile-eye prompt, temperature 0.7

#### Phase B additions — 2 more reviewers (~week 4)

##### 4.4c BUG-DETECTOR

- **Job:** Pre-mortem-style — "what could break this?" Race conditions, off-by-one, null/undefined, async error swallowing, retry storms, missing rate-limits
- **Inputs:** diff + relevant CONTEXT.md + last 5 git revert SHAs in this area
- **Output:** ranked bug-likelihood report; each entry has reproduction sketch
- **Model:** Opus 4.7 (heavy reasoning), temperature 0.5

##### 4.4d DESIGN-CONSISTENCY-REVIEWER

- **Job:** For frontend diffs only — verify design system tokens, typography scale, no off-system colors, view-paradigm contract honored
- **Inputs:** diff + `design/DESIGN.md` + relevant component CONTEXT.md
- **Tools:** read-only; screenshot diff against locked baselines
- **Output:** per-design-rule pass/fail; visual diff %
- **Model:** Sonnet 4.6 + vision

#### v1.5 fleet — 2 more (full Razorpay set)

##### 4.4e PERF-REGRESSION-REVIEWER (Phase E+)

Detects bundle-size growth, render-time regressions, network-waterfall changes, query-plan regressions. Activated when first perf-critical workload lands.

##### 4.4f I18N / COPY-REVIEWER (Phase E+)

Untranslated strings, hardcoded currency symbols outside helpers, voice-guide violations. Activated when multi-currency or multi-locale lands.

### 4.4-AGG AGGREGATOR + AI filter

A deterministic Node module (NOT an LLM call for aggregation itself) that:

1. Waits for all active fleet members to return (with per-reviewer timeout 3 min)
2. **Applies AI filter layer** — Haiku-class call (independent from family-scale to provide some independence) asks "Is this finding real or a false positive?" Drops findings with `real=false AND confidence>0.7`
3. Computes overall verdict: `BLOCK > FAIL > CHANGES_REQUESTED > PASS`
4. Emits unified review report to `.audit/<date>/review/<task-id>.json`
5. Decides HITL escalation per the tier matrix

Failure modes handled:
- One reviewer times out → partial report; orchestrator decides retry vs proceed
- Reviewers contradict on the same line → flagged in report; G2 forced regardless of tier
- AI filter drop rate >40% for a reviewer over 100 calls → reviewer's prompt flagged for revision

### 4.5 DEMO

- **Job:** Run the app end-to-end (Playwright for UI, integration tests for backend, smoke for CLI); validate against AC
- **Inputs:** reviewed diff, AC
- **Tools:** Playwright; screenshot diff; HAR capture
- **Output:** demo video + screenshot set + per-AC pass/fail
- **Model:** Sonnet 4.6 + vision (mostly orchestration; vision checks visual diff)

### 4.6 COMMIT

- **Job:** Open PR, write commit messages + PR description, link epic/story/task, request review
- **Tools:** `gh` CLI; git
- **Output:** PR URL + auto-merged on green CI (per tier)
- **Model:** Haiku 4.5 (formulaic, fast)
- **Escalation:** Tier 0/1 PR always requires human merge (G3 gate)

### 4.7 REPORTER

- **Job:** Summarize what shipped to the user. Optionally: detect "post-worthy moment" and draft a markdown file to `piyush-portfolio/content/drafts/` (R-FUT-9, Phase B+)
- **Inputs:** merged change, audit log slice
- **Tools:** read-only
- **Output:** ≤200-word message + risks/follow-ups
- **Model:** Haiku 4.5

### 4.8 DEBUGGER (special-case)

- **Job:** When test/review/demo fails, diagnose root cause and propose fix
- **Triggered by:** failure event from any stage
- **Output:** root-cause analysis + proposed fix as a new task
- **Model:** Opus 4.7
- **Limit:** max 3 attempts per task before escalating to human

### 4.9 SCOUT (cron, proactive)

- **Job:** Monitor: dep updates, adapter DOM drift (fixture diff for adapter-based projects), known-bad patterns, perf regressions
- **Schedule:** every 6h via `pnpm sdlc tick`
- **Output:** GitHub issues opened automatically with `kind:scout` label; triaged by PLANNER on next CLI run
- **Model:** Haiku 4.5

---

## 5. Workflow stages

The canonical pipeline flow. Deviations are exceptions.

### 5.0 Stage 0 — REPO READINESS GATE (per Razorpay)

Orchestrator refuses to advance any task to STAGE 6 (COMMIT) — i.e. refuses auto-merge — until the target project scores ≥70% on Repo Readiness (≥80% from Phase B onwards). Below threshold, all stages still run but every PR drops into manual review.

| Pillar | Signal | Auto-measured how | Weight |
|---|---|---|---|
| **Context** | CONTEXT.md exists at repo root + every top-level dir | File presence + frontmatter `updated` within 60 days | 40% |
| **Testing** | Coverage on changed files; e2e present for every view/route | `vitest --coverage` + Playwright run count vs view count | 30% |
| **CI/CD** | Branch protection on; required checks (typecheck + lint + unit + e2e + security + blast-radius); rollback path tested in last 90d | `gh api` + `.audit/rollback-tests/` newest entry | 30% |

Computed by `pnpm sdlc readiness --project <slug>` (deterministic; no LLM). Re-runs daily.

### 5.1 AI filter layer

Razorpay pattern: filter sits between reviewer fleet output and HITL queue. Without it, every nit becomes a ping.

Implementation:
1. REVIEWER FLEET emits N findings
2. AGGREGATOR groups by file+line
3. For each finding group: a small Haiku call evaluates "Real issue or false positive? Use diff + CONTEXT.md + last 5 commits in file as evidence." 1-line JSON: `{"real": bool, "confidence": 0-1, "reason": "..."}`
4. Findings with `real=false AND confidence>0.7` dropped (logged in audit for replay)
5. Findings with `real=true` proceed to aggregated verdict
6. Drop rate tracked per cohort; >40% triggers prompt review for that reviewer

### 5.2 Stage table

```
USER ───── files epic (GH issue) ────► ORCHESTRATOR
                                          │
                                          ▼
                                   [STAGE 0: READINESS] ← gates auto-merge
                                          │
                                          ▼
                                   [STAGE 1: PLAN]     ← PLANNER agent
                                          │
                                          ▼
                                   [GATE G1: HITL approve epic + task breakdown]
                                          │
                                          ▼
                              orchestrator queues N tasks
                                          │
              ┌───────────────────────────┴───────────────────────────┐
              ▼                                                        ▼
         (task A)                                                  (task B)         ◄── parallel
              │                                                        │
              ▼                                                        ▼
      [STAGE 2: BUILD] ← BUILDER                              [STAGE 2: BUILD]
              │                                                        │
              │ (may fire G1.5 ADR gate if architectural decision)
              │
              ▼                                                        ▼
      [STAGE 3: TEST] ← TESTER                                [STAGE 3: TEST]
              │                                                        │
              ▼                                                        ▼
      [STAGE 4: REVIEW] ← REVIEWER FLEET + AGGREGATOR         [STAGE 4: REVIEW]
              │                                                        │
              ▼                                                        ▼
      [GATE G2: tier-based HITL]                               [GATE G2: ...]
              │                                                        │
              ▼                                                        ▼
      [STAGE 5: DEMO] ← DEMO                                  [STAGE 5: DEMO]
              │                                                        │
              ▼                                                        ▼
      [GATE G3: tier-based HITL + visual diff]                 [GATE G3: ...]
              │                                                        │
              ▼                                                        ▼
      [STAGE 6: COMMIT] ← COMMIT                              [STAGE 6: COMMIT]
              │                                                        │
              ▼                                                        ▼
      [GATE CI-green (automated, never blocks human)]
              │                                                        │
              └────────────────────────┬──────────────────────────────┘
                                       ▼
                              [STAGE 7: REPORT] ← REPORTER
                                       │
                                       ▼
                              USER dashboard / macOS noti
                                       │
                                       ▼ (after 24h)
                              [GATE G5: POST-MERGE HITL]
                                       │
                                       ▼
                              Trust expansion data updated
```

Per-stage detail tables (inputs, outputs, validations, failure handling) are in [PLAN.md](./PLAN.md) under Phase A deliverables.

---

## 6. Tier system + zone mapping

Already defined in [HITL.md](./HITL.md) §"Tier ↔ gate matrix" and per-project CLAUDE.md. Shared vocab with the prior pattern doc:

| Tier | Blast zone | Color | Examples (target project's files) | Three-layer enforcement |
|---|---|---|---|---|
| **0** | Red (critical) | 🔴 | Cookie loader, auth middleware, audit log writer, rollback scripts, security rules | All three layers active. Red zone NEVER reclassifies. |
| **1** | Red (high) | 🔴 | Adapter contracts, dedup algorithm, DB schema migrations, currency math | All three layers active |
| **2** | Yellow | 🟡 | New views, new adapters, search runner, scoring formulas | Pre-write hook + CI; CLAUDE.md declaration optional |
| **3** | Green | 🟢 | UI polish, copy edits, theme tweaks, new icons | CI only |
| **4** | Green (trivial) | 🟢 | Typos, comments, dep patches behind lockfile | CI only |

Why two tiers map to Red: a prior project's Red zone collapses what we split into Tier 0 ("never autonomous, ever") vs Tier 1 ("never autonomous without human at COMMIT"). The split lets us run Tier 1 work through PLAN + BUILD + REVIEW + DEMO while still gating the actual merge.

---

## 7. Guardrails — three-layer enforcement

The 6 non-negotiables (R-GRD-1..6) instantiated. R-GRD-1 is the most architecturally interesting.

### G1. Tier 0 — extreme caution (three-layer enforcement, the prior pattern doc §7.1)

Tier 0 and Tier 1 files = Red zone. Require **all three layers to fail simultaneously for a breach**. Each layer is independent.

#### G1.1 Layer 1 — CLAUDE.md declaration (source of truth)

Target project's repo-root `CLAUDE.md` declares Red zone files/dirs. Format example:

```markdown
## Red zone (Tier 0/1) — NEVER autonomous

### Tier 0
- private/                                  # cookies, secrets — git-crypt encrypted
- packages/security/                        # auth, signing, scope guards
- tools/check-blast-radius.sh               # this hook itself
- CLAUDE.md                                 # this file
- .github/workflows/blast-radius.yml        # the CI layer

### Tier 1
- packages/adapters/*/contract.ts           # adapter interface
- packages/data/migrations/*                # schema migrations
- packages/data/dedup/                      # canonical dedup algorithm
- packages/data/currency/                   # money math
```

List is authoritative. Both Layer 2 and Layer 3 read from it (parsed at load time).

#### G1.2 Layer 2 — pre-write hook

Runs before every agent file-write in the orchestrator. Refuses writes to Red zone paths unless `BLAST_RADIUS_APPROVED=<hitl-id>` env var is set AND the HITL record exists.

Hook is `tools/check-blast-radius.sh` in the target repo, invoked from `tools/sdlc/orchestrator/file-ops.ts`'s wrapper around all agent write calls. Pre-commit hook also runs the same script against staged files, so a manual human commit cannot bypass it either.

Hook logic:
1. Parse Red zone glob patterns from CLAUDE.md
2. For each candidate file path: glob-match against patterns
3. If match + no `BLAST_RADIUS_APPROVED` env → exit 1 with "BLAST RADIUS BREACH"
4. If match + env set: verify HITL record at `.audit/<date>/hitl/<id>.json` covers this path
5. If verified → allow write, log to audit
6. If not verified → exit 1

The script is itself in Red zone (Layer 0 protection of Layer 2).

#### G1.3 Layer 3 — CI validation

`.github/workflows/blast-radius.yml` in each consumer repo:

```yaml
name: blast-radius
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Detect Red zone files in PR
        run: |
          CHANGED=$(git diff --name-only origin/main...HEAD)
          for f in $CHANGED; do
            ./tools/check-blast-radius.sh "$f" || exit 1
          done
      - name: Require HITL approval label
        if: ${{ steps.check.outputs.touched_red_zone == 'true' }}
        uses: actions/github-script@v7
        with:
          script: |
            const labels = context.payload.pull_request.labels.map(l => l.name)
            if (!labels.includes('hitl-approved-tier-0') && !labels.includes('hitl-approved-tier-1')) {
              core.setFailed('Red zone PR requires hitl-approved-tier-0 or hitl-approved-tier-1 label')
            }
```

The label is applied by the dashboard when the user approves a Tier 0/1 HITL G2 request. Branch protection prevents manual label edits.

#### G1.4 Three-way failure scenario

A breach requires all three to fail simultaneously:
1. Layer 1 (CLAUDE.md): agent must have failed to read it or have a buggy parser
2. Layer 2 (hook): hook must have been skipped (`--no-verify`) or orchestrator wrapper bypassed
3. Layer 3 (CI): PR must have skipped CI or had label fraudulently applied

SCOUT runs weekly review of audit log + git history to detect retrospective breaches. RCA automatic; learning filed; layers patched.

### G2. Agent output never bypasses CI/CD

Same pipeline as human code: lint, typecheck, unit, integration, e2e, security scan, dependency audit. BUILDER cannot push directly to main (branch protection). BUILDER cannot use `--no-verify` (pre-commit hooks); attempts logged as suspicious. AI-generated commits get `Generated-By: agent:<role>@<model>` trailer.

### G3. Automate validation before human review

Stage transitions gated by:
- **Static:** tsc, biome, gitleaks, semgrep
- **Semantic:** zod schemas on every data boundary; API contracts checked against OpenAPI
- **Architectural:** import graph rules (e.g. `apps/web` cannot import from `packages/adapters` directly)
- **Test:** coverage threshold, all tests pass, mutation testing on Tier 0/1

Only after all pass does the G2 HITL request fire. No "agent submitted broken code for me to review" situations.

### G4. Rollback is mandatory

Every change has documented + tested rollback. Code: `git revert`. Schema: `down()` migration tested in CI. Settings: snapshot before write. Pipeline binary: known-good cached + restorable. Tested quarterly via chaos exercise.

### G5. Trust expands on data

See §11.

### G6. Document learnings

Every epic completion produces `docs/learnings/<epic>.md` in target repo. Read by future PLANNER runs as context in retrieval prompt. Auto-summarized to `tasks/lessons.md` (file-level pattern lessons).

---

## 8. Auditability + observability

### 8.1 Audit log structure

Every agent action = one JSONL row in `.audit/<date>/runs/<agent>-<task>-<n>.jsonl`:

```jsonc
{
  "ts": "2026-06-01T11:23:45.123Z",
  "project": "trip-research",
  "agent": "builder",
  "model": "claude-sonnet-4-6",
  "model_transport": "claude-code-subagent",
  "task_id": "3.2.2",
  "stage": "BUILD",
  "duration_ms": 18430,
  "prompt_tokens": 4521,
  "completion_tokens": 1843,
  "cache_tokens_read": 18200,
  "cost_usd": 0.087,
  "input_files": ["packages/adapters/mmt/index.ts", "packages/types/adapter.ts"],
  "output_diff_path": ".audit/2026-06-01/diffs/3.2.2-build.diff",
  "decisions": [
    { "what": "extended BaseAdapter", "why": "matches contract", "alternatives_considered": ["compose, not inherit"] }
  ],
  "validations": { "tsc": "pass", "lint": "pass", "secrets": "pass" },
  "outcome": "success",
  "next_stage": "TEST",
  "prev_row_hash": "sha256:abc...",
  "row_hash": "sha256:def..."
}
```

Audit log is:
- **Project-scoped** (each project has its own `.audit/`)
- **Git-tracked** for the last 90 days (small enough; ~1MB/week typical)
- **Archived** to `~/.gstack/audit/<slug>/` SQLite for older rows
- **Hash-chained** (`prev_row_hash` links to previous row in same project)
- **Append-only** at storage layer (writers refuse to modify existing rows)
- **Queryable** via `pnpm sdlc audit --project <slug> --filter ...`

### 8.2 Replayability

Every agent run can be replayed:
- `pnpm sdlc replay <project>/<run-id>` re-fires the same agent on the same inputs
- Useful for: debugging bad output, validating prompt fixes, regression-testing the pipeline

### 8.3 Metrics dashboard (`:3001`)

Per-project + cross-project views:
- Active tasks (in-flight per stage)
- HITL queue (pending user actions per gate)
- 7/14/28-day defect rate per project
- Cost ($ spent across LLM calls; flat-rate sub usage tracked)
- Throughput (tasks/day; LOC/day)
- Per-agent confidence distribution
- Top failure modes (clustered)
- AI filter drop rate per reviewer

### 8.4 Cost controls

- Per-task budget cap (default $1; configurable per tier; Tier 0/1 up to $5)
- Per-epic budget cap (default $20)
- Hard monthly cap $50-150 (Q-AI-4 amended; flat-rate sub absorbs most cost)
- Cost spike >2× rolling 7d avg triggers contraction protocol (§10.2)
- Cost logged per agent call; real-time in dashboard

---

## 9. Context layer

> **Parent reference:** the prior pattern doc Appendix A "CLAUDE.md template" is the structural source. Fields adapted per project stack.

The thing that makes future-agent runs not lose context.

### 9.1 CONTEXT.md hierarchy (per consumer project)

```
CLAUDE.md                                     # repo-root — global rules + Red zone declaration
CONTEXT.md                                    # repo-level — project context
├── apps/
│   └── web/
│       ├── CONTEXT.md                        # the app
│       └── components/
│           └── ...
└── packages/
    ├── adapters/
    │   ├── CONTEXT.md                        # adapter contract + rules
    │   ├── booking/CONTEXT.md
    │   └── ...
    ├── data/CONTEXT.md
    └── types/CONTEXT.md
```

CLAUDE.md (repo-root) is global behavior + Red zone. CONTEXT.md per module is what the prior pattern template gives us.

### 9.2 CONTEXT.md template (adapted from the prior pattern doc Appendix A)

```markdown
---
name: <module-name>
purpose: <one-sentence>
status: stable | in-flux | deprecated
tier: 0 | 1 | 2 | 3 | 4
updated: <ISO date>
updated_by: <agent or user>
---

# <module>

## Service overview
<2-3 sentences>

## Blast radius
- **Tier:** <0-4>
- **Why this tier:** <one line>
- **Red zone files in this module:** <list, or "none">
- **Downstream blast:** <list of modules that depend on this one>

## Architecture
- **Pattern:** <adapter, strategy, pipeline, state machine, controller-view>
- **Key types:** <3-5 most important type names>
- **Boundary:** <what crosses the module boundary>

## Code conventions (this module)
- <conventions that differ from repo defaults>

## Error handling
- <how this module signals failure; what callers must handle>

## Logging
- <structured-log fields; what NEVER gets logged>

## Money & amounts (if applicable)
- <currency, rounding, tax>

## Database / persistence (if applicable)
- <tables, migration ownership, tx boundaries>

## API contracts (if applicable)
- <inbound + outbound; versioning>

## Testing
- <where tests live; integration prereqs; fixtures>

## Local dev
- <how to run / iterate this module alone>

## Dependencies
- <upstream deps + why; pinning policy>

## Known quirks
- <subtle gotchas; "if you change X, also touch Y">

## Public API
| Symbol | Kind | Purpose |
|---|---|---|

## Do's / Don'ts
- <invariants + anti-patterns>

## Recent changes
<auto-generated by SCOUT: last 10 commits>

## Open questions
<unresolved items; revisited by planner>
```

### 9.3 Update rules

- On every commit affecting module M, BUILDER + REVIEWER FLEET check if `M/CONTEXT.md` needs updating
- Yes (public API changed, type added/removed, new error mode, tier changed) → BUILDER includes CONTEXT.md update in same commit (atomic)
- No → skip
- Weekly: SCOUT runs drift check, diffs CONTEXT.md vs code, flags inconsistencies

### 9.4 Bubble-up rule (the prior pattern doc §A.3)

When a leaf CONTEXT.md changes substantially:
- Public API addition/removal
- Tier change
- New cross-module dependency
- New "Don't" rule
- Status change to/from `in-flux`

→ Parent CONTEXT.md updated in SAME commit. Propagates upward to repo-root CONTEXT.md within one commit.

Pre-write hook checks: if leaf CONTEXT.md modified, was parent also touched? If not, BUILDER rejected. Mechanical, not stylistic.

### 9.5 Prompt caching of CONTEXT tree

The entire CONTEXT tree (CLAUDE.md + per-module CONTEXT.md + lessons.md) loads as prefix on every agent run. Anthropic prompt cache stores at 0.1× input price. Per agent run that doesn't modify the tree, cache hit ~95% of input tokens. Per-task cost drops ~22%.

Cache key = sha256(file paths + last-commit SHAs of those paths). Invalidates automatically on any cached file change.

**Anti-pattern guard:** cache MUST NOT include agent-specific state (current diff, task-specific brief). Those go in un-cached suffix.

---

## 10. Rollback + trust contraction

### 10.1 Rollback paths (pipeline-specific)

| Scenario | Trigger | Path |
|---|---|---|
| Bad commit merged to main | Detected by user (G5) or by CI nightly | `git revert <sha>`; re-fires pipeline; orchestrator notes incident |
| Pipeline itself misbehaves | Agent produces consistently bad output | Manual stop; replay with different prompt; if still bad, demote project to MANUAL |
| Cookies leaked into a commit | Pre-commit hook caught OR gitleaks scan | Force-rewrite history; rotate cookies; user notified; audit log entry |
| Audit log tampered | Hash chain mismatch | Pipeline halts for that project; user notified; audit rebuilt from git history |
| Cost runaway | Crossed monthly cap | Pipeline pauses; user authorizes continuation or sets new cap |
| HITL queue grows unbounded | Queue >20 pending for a project | Pipeline stops accepting new tasks for that project; reminds user; resumes when queue ≤5 |
| Reviewer false-positive rate >40% | AI filter layer reports it | Auto-rollback prompts to last-known-good versions; cohort flagged for prompt review |

### 10.2 Trust contraction protocol (the prior pattern doc §7.2 — autonomy reduces on incidents)

Expansion criteria are in §11. **Contraction** is symmetric. Both directions explicit, automatic, reversible.

**Contraction triggers (ranked by severity):**

| Trigger | Immediate effect | Reset after |
|---|---|---|
| **Tier 0 incident** (Red zone change caused real harm) | All tiers demoted by one level immediately for that project; Red zone reclassified read-only forever; PERMANENT review of CLAUDE.md Red zone list | RCA + 2 weeks clean + user sign-off |
| **Tier 1 incident** (Red/Yellow zone bug reached main) | Affected zone drops to MANUAL for 14 days | 14 days clean + RCA filed |
| **G5 negative response** ("broke something") | Pipeline pauses 24h for that project; RCA written; agent prompt versioned + reviewed | 24h pause + RCA |
| **Defect rate >5% over 7d** | Auto-demote: every tier drops one HITL gate to manual for that project | Defect rate <3% for 7d |
| **Reviewer fleet disagreement >30%** | AI filter recalibrated; aggregator auto-PASS threshold raised 0.85 → 0.95 | Disagreement <20% for 14d |
| **Cost spike >2× rolling 7d avg** | Pipeline pauses for that project; check for runaway loop | Cost normal for 7d |

**Reversibility rule:** every contraction logs the exact previous state in `.audit/<date>/trust-contractions.jsonl` so dashboard can show "current vs pre-incident state" and reset has a known target.

**Red zone special rule:** Red zone NEVER reclassifies downward. Even after years of clean record, cookie loaders / auth middleware / audit chain stay Red. Permanent architectural decision, not trust signal.

---

## 11. Trust expansion model

> **Parent reference:** the prior pattern doc §7.2.

### 11.1 Formal expansion criteria (the prior pattern doc §7.2, all required)

Zone reclassification upward only when **all** demonstrably true:

1. **20+ tickets processed** in this zone by the pipeline (BUILDER + REVIEWER FLEET + DEMO + COMMIT all ran)
2. **0 production incidents** caused by agent code in this zone in trust window
3. **≥85% test coverage** of files in this zone
4. **User explicit approval** recorded in `.audit/<date>/reclassifications/<project>-<zone>.json` with reasoning
5. **Reclassification documented + reversible** — previous state + reason captured

**Red zone never reclassifies downward.** Prior pattern doc calls it a "permanent architectural decision, not a trust signal." Adopted verbatim.

### 11.2 Measurement methodology

**Defect rate:**
- Each merged PR is "in trust window" for 7 days
- Defect = any of: `git revert`, hotfix tagged `fixes <PR>`, failing test caused by that PR (regression in CI), G5 negative response, user-opened issue tagged `regression-from-PR-N`
- Rate = defects ÷ PRs merged in last X days

**User-approval rate:**
- At each HITL gate, user chooses approve / request changes / reject
- Rate = approves ÷ total HITL responses
- Tracked per agent + per tier + per project

**Cohort tracking:**
Pipeline records agent (model + prompt version + temperature) producing each PR. When defect rate spikes, identify which cohort regressed. Enables safe A/B testing of prompt changes:
- Prompt v17 ships to 20% of tasks for 7d
- If defect rate of v17 cohort ≤ baseline: roll to 100%
- If worse: rollback to v16; file learning

Per-cohort metrics: `.audit/cohorts/<prompt-hash>.json` per project.

### 11.3 Trust state machine (per project)

```
        [MANUAL]
       (everything HITL)
            │
            │ Phase A onboarding pass (week 4)
            ▼
       [SUPERVISED]
       (Tier 4 auto, Tier 3 HITL at COMMIT)
            │
            │ 20+ Tier 4 tickets · 0 incidents · 85% cov · user sign-off
            ▼
       [TRUSTED-LOW]
       (Tier 3-4 auto; Tier 2 HITL at REVIEW + COMMIT)
            │
            │ 20+ Tier 3 tickets · 0 incidents · 85% cov · user sign-off
            ▼
       [TRUSTED-MID]
       (Tier 2-4 auto with confidence gate; Tier 1 always HITL)
            │
            │ Reaches steady-state; Tier 0/1 forever HITL
            ▼
       [STEADY-STATE]
```

Each transition logged at `.audit/trust-transitions.jsonl`. Contractions move state backward; same logging.

---

## 12. Tooling + transports

### 12.1 Core tech choices

| Need | Choice | Why |
|---|---|---|
| Agent SDK | **Claude Code Subagent tool** | Q-AI-2 amendment: no API keys needed; Max subscription absorbs cost |
| Code review | **Claude (Opus + cold-read prompt)** | Q-AI-2 amended from Codex — no Codex CLI; mitigated via temperature + prompt diff |
| CI | GitHub Actions | Free for private repos; integrated with branch protection |
| Sandboxing | git worktrees + Playwright isolated contexts (Q-AI-8) | No Docker overhead; familiar |
| Audit storage | Hybrid: JSONL in-repo (90d) + SQLite local archive (older); Q-AI-5 | Self-contained; git-trackable; no SaaS |
| Dashboard | Next.js on port 3001 | Reuses Next.js skill stack |
| Notifications | macOS osascript + local dashboard (Q-AI-3) | Local-first; no Slack workspace |
| Cost tracking | Logged per call; aggregated in dashboard | No external service |
| Domain (portfolio) | Cloudflare DNS, .dev TLD | Engineer signal, free DNS |

### 12.2 Smart model routing (the prior pattern doc §5.4)

Per Q-AI-2 amendment: Claude-only family for v1. Mitigations via temperature + cold-read prompt + AGGREGATOR scale-independence.

| Agent | Default model | Fallback | Transport | When fallback |
|---|---|---|---|---|
| PLANNER | Opus 4.7 | — | Claude Code Subagent | Always Opus (heavy reasoning, low frequency) |
| BUILDER | Sonnet 4.6 | Opus 4.7 | Subagent | First attempt fails validation; OR task tagged `complex`; OR Tier 0/1 |
| TESTER | Sonnet 4.6 | Opus 4.7 | Subagent | TESTER fails coverage target twice |
| 4.4a SECURITY-REVIEWER | Opus 4.7 (cold-read, temp 0.7) | — | Subagent | Always — different prompt + temp from BUILDER provides partial independence |
| 4.4b CODE-QUALITY-REVIEWER | Opus 4.7 (cold-read, temp 0.7) | — | Subagent | Same |
| 4.4c BUG-DETECTOR | Opus 4.7 (temp 0.5) | — | Subagent | Always — heavy reasoning |
| 4.4d DESIGN-REVIEWER | Sonnet 4.6 + vision | — | Subagent | Vision required |
| AGGREGATOR / AI filter | Haiku 4.5 | Sonnet 4.6 | Subagent | Filter accuracy <70% in last 100 calls |
| DEMO | Sonnet 4.6 + vision | — | Subagent | Vision for visual diff |
| COMMIT | Haiku 4.5 | — | Subagent | Formulaic |
| REPORTER | Haiku 4.5 | — | Subagent | Same |
| DEBUGGER | Opus 4.7 | — | Subagent | Always |
| SCOUT | Haiku 4.5 | — | Subagent | Cron; cost-sensitive |

Routing decision made by `tools/sdlc/router/select-model.ts` — deterministic; logs every choice + reason.

### 12.3 Prompt caching policy (the prior pattern doc §10.2 — ~22% cost reduction)

**Always cache:** repo-root CLAUDE.md, repo-root CONTEXT.md, entire `tasks/lessons.md`, architecture diagrams from `docs/adr/`

**Cache per-module:** when agent enters module M, M/CONTEXT.md + all ancestors up to repo-root cached with TTL 5 min

**Cache key:** sha256(file paths + last-commit SHAs of those paths)

**Anti-pattern guard:** Cache MUST NOT include agent-specific state. Those go in un-cached suffix.

Per-ticket cost savings: $0.91 → $0.71 (~22% at enterprise scale; less at our scale due to smaller CONTEXT tree).

### 12.4 What we do NOT use

- LangChain / LangGraph — too much abstraction
- Devin / Cursor — vendor lock-in
- Docker for sandboxes — git worktrees suffice
- Sentry / Datadog — local-only
- Linear / Jira — GitHub Issues + Projects sufficient
- Codex CLI / OpenAI API — Q-AI-2 amendment (no keys)
- Slack — no team

---

## 13. Multi-tenant infrastructure

ai-sdlc manages N consumer projects. Per-tenant isolation is enforced through naming, not access control (since solo user; no auth boundary).

### 13.1 Tenant identification

Every operation requires a `--project <slug>` arg or env. CLI commands fail if absent. Orchestrator refuses cross-project access.

### 13.2 Tenant directory structure

```
ai-sdlc/
└── projects/
    ├── trip-research/
    │   ├── config.json        # repo path, GitHub remote, owner, runtime
    │   ├── state.json         # trust state, readiness, in-flight tasks
    │   ├── prompts/           # project-specific prompt overrides
    │   │   ├── planner.md     # optional override
    │   │   ├── builder.md
    │   │   └── ...
    │   └── fixtures/          # project-specific regression test fixtures
    ├── piyush-portfolio/
    ├── career-automation/
    └── ...
```

### 13.3 Per-tenant state

`projects/<slug>/state.json`:

```jsonc
{
  "slug": "trip-research",
  "onboarded_at": "2026-06-15T12:00:00Z",
  "trust_state": "SUPERVISED",
  "readiness_score": 72,
  "readiness_breakdown": { "context": 30, "testing": 24, "cicd": 18 },
  "last_readiness_check": "2026-06-22T08:00:00Z",
  "in_flight_tasks": ["trip-research/3.2.2", "trip-research/3.2.4"],
  "active_cohorts": { "planner": "v3", "builder": "v8", "code-quality": "v5" },
  "hitl_queue_depth": 2,
  "defect_rate_7d": 0.03
}
```

State writes are atomic (write to tmp + rename). Reads are cheap.

### 13.4 Cross-project operations (rare)

The only legitimate cross-project view is the dashboard. CLI commands intentionally lack a "do this for all projects" flag — forces explicit project selection.

Exception: `pnpm sdlc readiness --all` runs readiness check across all onboarded projects. Read-only; no side effects.

---

## 14. File organization

### 14.1 ai-sdlc repo layout

```
ai-sdlc/                         # this repo
├── LICENSE                      # AGPL-3.0
├── README.md                    # repo intro
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── .gitignore
├── PLAN.md
├── ARCHITECTURE.md              ← this file
├── REQUIREMENTS.md
├── ONBOARDING.md
├── HITL.md
├── ROADMAP.md
├── DESIGN.md
├── projects/                    # per-tenant config + state (some gitignored)
│   ├── trip-research/
│   ├── piyush-portfolio/
│   └── ...
├── tools/
│   └── sdlc/                    ← Phase A delivers this
│       ├── orchestrator/
│       │   ├── index.ts
│       │   ├── audit-log.ts
│       │   ├── file-ops.ts      # wraps writes; invokes blast-radius hook
│       │   └── rollback.ts
│       ├── agents/
│       │   ├── planner/
│       │   ├── builder/
│       │   ├── tester/
│       │   ├── reviewer-fleet/
│       │   │   ├── security/
│       │   │   ├── code-quality/
│       │   │   ├── bug-detector/   # Phase B
│       │   │   ├── design/         # Phase B
│       │   │   ├── perf/           # v1.5
│       │   │   └── i18n/           # v1.5
│       │   ├── aggregator/
│       │   ├── demo/
│       │   ├── commit/
│       │   ├── reporter/
│       │   ├── debugger/
│       │   └── scout/
│       ├── router/              # smart model routing
│       ├── cache/               # prompt-cache key + TTL logic
│       ├── hooks/
│       │   └── check-blast-radius.sh
│       ├── dashboard/           # Next.js sub-app at :3001
│       └── prompts/             # versioned, audited
├── docs/
│   └── adr/                     # ai-sdlc's own ADRs
└── .github/
    ├── workflows/
    │   ├── ci.yml
    │   ├── release.yml
    │   └── (no sdlc.yml here; ai-sdlc tests itself)
    └── ISSUE_TEMPLATE/
```

### 14.2 Target repo layout (after onboarding)

```
<target-repo>/
├── CLAUDE.md                    # ai-sdlc-managed; declares Red zone
├── CONTEXT.md
├── PLAN.md                      # project's plan (ai-sdlc reads this)
├── package.json
├── apps/, packages/, etc.
├── docs/
│   ├── adr/
│   ├── learnings/
│   └── rollback-tests/
├── tasks/
│   └── lessons.md
├── .audit/                      # ai-sdlc writes here
│   ├── <date>/runs/*.jsonl
│   ├── <date>/diffs/*.diff
│   ├── <date>/demo/*.webm
│   ├── <date>/review/*.json
│   ├── <date>/hitl/*.json
│   └── trust-transitions.jsonl
├── .sdlc-queue/                 # gitignored
│   └── pending-hitl/*.json
├── .sdlc-sandboxes/             # gitignored worktrees
└── .github/
    ├── workflows/
    │   ├── ci.yml
    │   ├── e2e.yml
    │   └── blast-radius.yml     # Layer 3
    └── tools/
        └── check-blast-radius.sh # Layer 2
```

Detailed CLI commands, dashboard UX, and template specifications are in [DESIGN.md](./DESIGN.md).

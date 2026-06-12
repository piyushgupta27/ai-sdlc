# ai-sdlc · ONBOARDING — How a new project joins the pipeline

> The procedure for getting a new consumer project onto ai-sdlc. Updated 2026-05-22.

ai-sdlc is multi-tenant from day 1. Every onboarded project is a "tenant" with its own CLAUDE.md, Red zone declaration, audit log namespace, Repo Readiness Score, and HITL queue slice. Onboarding is a designed flow, not a one-off setup.

This doc describes the canonical onboarding procedure. Variations per testbed are noted in [ROADMAP.md](./ROADMAP.md).

---

## Prerequisites

Before a project can onboard:

1. **Standalone repo.** Project lives at `~/Workspace/<slug>/` as its own git repo. (Optionally symlinked into a local vault for navigation.)
2. **GitHub remote** (public or private — both work; ai-sdlc respects visibility for what it surfaces).
3. **Owner identified.** For solo projects, that's you. For team projects, defined in `CODEOWNERS`.
4. **Initial PLAN.md** exists in the project repo's root. The pipeline reads from PLAN.md to discover epics.

---

## The onboarding phases (per project)

Onboarding is itself a multi-step process. It takes ~1-2 days of pipeline time per project once the initial commits are written. Each step has a HITL gate.

### Phase 0 — Prerequisites verification (~1h)

- Verify the repo exists at `~/Workspace/<slug>/`
- Verify the optional local-vault symlink, if used
- Verify GitHub remote is reachable
- Verify `gh` CLI has access (auth works)
- Verify branch protection on `main` is enabled (or enable it)
- Verify the project's `package.json` (or equivalent) declares the build/test/lint commands ai-sdlc will invoke

If any check fails, ai-sdlc emits a clear "missing X, run command Y" message and pauses.

### Phase 1 — Bootstrap project-specific files (~2h, HITL at G1)

ai-sdlc writes the following into the target repo:

| File | Purpose | HITL? |
|---|---|---|
| `CLAUDE.md` (root) | Project-level rules + Red zone declaration | **G1.5 ADR** (you approve the Red zone list) |
| `CONTEXT.md` (root) | Project overview, status, owner | G1 |
| `.github/ISSUE_TEMPLATE/{bug,feature,epic,adr,discussion}.md` | Issue templates for ai-sdlc to file structured issues | Auto |
| `.github/pull_request_template.md` | PR template ai-sdlc fills in | Auto |
| `.github/workflows/ci.yml` | typecheck + lint + unit | Auto (template) |
| `.github/workflows/e2e.yml` | Playwright (if applicable) | Auto (template) |
| `.github/workflows/blast-radius.yml` | Three-layer enforcement Layer 3 | **G1.5 ADR** (Red zone gate) |
| `tools/check-blast-radius.sh` | Pre-write hook for Red zone | Auto (template) |
| `.audit/.gitkeep` | Audit log directory placeholder | Auto |
| `.sdlc-queue/.gitkeep` | HITL queue placeholder | Auto |
| `CODEOWNERS` | Red zone → @<owner> reviewer | **G1.5 ADR** |
| Labels (via `gh label create`) | tier:0/1/2/3/4, kind:*, status:*, area:* | Auto |
| Milestones | Phase A goals for THIS project | G1 |

After this phase, the project has the structural scaffolding to be managed by ai-sdlc. It is NOT yet doing autonomous work.

### Phase 2 — Establish test coverage (first real Tier 2 epic)

**This is the canonical first work for every onboarded project.** Test-debt-first is a non-negotiable rule: ai-sdlc refuses to run autonomous work against a repo with <70% test coverage on critical files.

The orchestrator files a Tier 2 epic: `"Establish test coverage on existing code"`.

- PLANNER decomposes into per-file test-writing tasks
- BUILDER writes tests using existing implementation as reference (not modifying source unless tests prove existing behavior is broken)
- REVIEWER FLEET verifies tests aren't tautological (testing implementation, not contract)
- DEMO runs the test suite + checks coverage delta per file
- G2 fires for each task (you approve test sets; HITL load is high in this phase by design — it's the test-debt-paydown investment)

Pass criteria: coverage ≥70% on changed files, ≥85% on Tier 0/1 zones.

**Why this is the first task, always:**
- An untested repo can't be safely refactored by anyone, agent or human
- Test-writing tasks are low-blast-radius — pipeline practices on a safe surface
- The act of writing tests forces ai-sdlc to learn the codebase
- After Phase 2, all subsequent autonomous work has a regression safety net

### Phase 3 — First feature epic (Tier 3, smoke test)

Pick a low-risk Tier 3 epic from the project's PLAN.md backlog (e.g. a UI polish, copy update, or dep patch). Run it end-to-end through the pipeline.

- All 5 HITL gates fire (since this is the first feature epic for the project)
- Audit log captures every step; you review post-merge
- Outcome calibrates the pipeline's prompts for this project's codebase

Pass criteria:
- 1 feature epic merged via pipeline with HITL gates exercised at every level
- 0 production incidents from the change
- Audit log is queryable end-to-end (`pnpm sdlc audit --project <slug> --task <id>`)

### Phase 4 — Trust expansion begins

Once 3 feature epics have merged with 0 incidents AND coverage stays ≥70%, the trust state machine for THIS project advances from `MANUAL` to `SUPERVISED`. From there, the prior pattern doc §7.2 formal criteria apply (20+ tickets per zone before reclassification, etc.). See [ARCHITECTURE.md](./ARCHITECTURE.md) §"Trust expansion model" for the full state machine.

---

## CLAUDE.md template (per project)

ai-sdlc generates a `CLAUDE.md` per project using the structure below. The Red zone declaration is the load-bearing part — three-layer enforcement reads from it.

```markdown
# CLAUDE.md — <project-name>

## Project overview
<2-3 sentences. What this project is, who uses it, what it depends on.>

## Owner
@<github-handle>

## Blast Radius — Red Zone files (Tier 0 and Tier 1)

The following paths require human sign-off at COMMIT (G3). Agents MUST refuse to write
to these files outside a planned Tier 0/1 task with explicit HITL approval recorded
in `.audit/<date>/hitl/`.

### Tier 0 (extreme caution; never autonomous; Red zone NEVER reclassifies downward)
- private/                                  # secrets, cookies — encrypted
- packages/security/                        # auth, signing, scope guards
- tools/check-blast-radius.sh               # the hook itself
- .github/workflows/blast-radius.yml        # the CI layer
- CLAUDE.md                                 # this file

### Tier 1 (high blast radius)
- packages/adapters/*/contract.ts           # interface contracts
- packages/data/migrations/*                # schema migrations
- packages/data/dedup/                      # canonical algorithms
- packages/data/currency/                   # money math

## Architecture
<Pattern. Key types. Module boundaries.>

## Code conventions (deviations from defaults)
<What this project does differently from repo defaults.>

## Local dev
<How to run, test, debug.>

## Known quirks
<Subtle gotchas; "if you change X you must also touch Y".>
```

Phase 1 fills in the project-specific content; you approve via G1.5 ADR gate.

---

## What ai-sdlc reads from the target repo

The pipeline operates on the target repo's filesystem. Specifically:

| Path | Used by | Notes |
|---|---|---|
| `PLAN.md` (root) | PLANNER | Source of epics, stories, tasks |
| `CONTEXT.md` (root + per module) | All agents | Living docs; updated by BUILDER per bubble-up rule |
| `CLAUDE.md` (root) | All agents + hooks | Project rules + Red zone declaration |
| `package.json` (or equiv) | Orchestrator | Detect runtime (Node/Python/etc.), invoke build/test commands |
| `tasks/lessons.md` (if exists) | All agents | Project-specific anti-patterns to avoid |
| `docs/adr/` | PLANNER + BUILDER | Past architectural decisions |
| `.audit/` (last 90d) | All agents + REPORTER | Recent history |
| `tests/` or `__tests__/` | TESTER | Existing test conventions |

---

## What ai-sdlc writes into the target repo

ai-sdlc writes commits to the target repo via the BUILDER agent, with full git history. The orchestrator itself does not commit to the target repo — only agents do, via PRs.

Files ai-sdlc may touch (per tier):

| Tier of change | Files ai-sdlc writes (without HITL approval) |
|---|---|
| 0 | None (always HITL) |
| 1 | None without HITL approval |
| 2 | Source code outside Red zone; tests; CONTEXT.md updates; ADR drafts |
| 3 | Same as Tier 2; auto-merge after CI green if confidence high |
| 4 | Same; full auto-merge |

The `tools/check-blast-radius.sh` hook is invoked on every write to enforce Red zone protection.

---

## Multi-project state in ai-sdlc

ai-sdlc itself stores per-project state separately. From the ai-sdlc repo root:

```
ai-sdlc/
├── projects/
│   ├── trip-research/
│   │   ├── config.json            # repo path, GitHub remote, owner
│   │   ├── state.json             # current phase, trust state, readiness score
│   │   └── prompts/               # project-specific prompt overrides
│   ├── piyush-portfolio/
│   │   └── ...
│   └── career-automation/
│       └── ...
├── tools/sdlc/                    # the platform code
├── PLAN.md                        # ai-sdlc's own plan
└── ...
```

Each project's config + state is git-ignored if it contains paths; tracked if it contains only structural data. Cookies / secrets never live in ai-sdlc/projects/* — only in the target repo's private/ (git-crypt encrypted).

---

## Onboarding workflow (command)

Conceptual command (Phase A delivers the actual CLI):

```bash
pnpm sdlc onboard --repo ~/Workspace/trip-research/ --slug trip-research --owner piyushgupta27
```

This runs Phase 0-1 (verification + bootstrap) end-to-end with HITL at G1.5 for Red zone approval. After it returns, the project is queryable:

```bash
pnpm sdlc status --project trip-research
# → State: bootstrapped. Coverage: 0%. Trust: MANUAL. Next: Phase 2 (test coverage).
```

---

## Onboarding effort estimate per project

| Project | Phase 0 verify | Phase 1 bootstrap | Phase 2 test coverage | Phase 3 first epic | Total wall time |
|---|---|---|---|---|---|
| trip-research | 1h | 2-3h (mostly your G1.5 reviews) | 3-5 days (existing untested code) | 1-2 days | ~1 week |
| piyush-portfolio | 1h | 2-3h | 0 (greenfield, no debt) | 1-2 days | ~3 days |
| career-automation | 1h | 2-3h | 1-2 days (existing tests exist; audit + fill gaps) | 1-2 days | ~4-5 days |
| ai-finance-tracker | 1h | 2-3h | TBD (depends on existing state) | 1-2 days | ~4-5 days |
| ai-health-agent | 1h | 2-3h | TBD | 1-2 days | ~4-5 days |

Greenfield projects (portfolio) onboard fastest because there's no test debt to pay down before autonomous work can start.

---

## Failure modes during onboarding

| Failure | What happens | Recovery |
|---|---|---|
| Repo doesn't have a clear runtime (no package.json, etc.) | Orchestrator emits "ambiguous runtime; specify in `ai-sdlc-config.json`" | Add the config; retry |
| Red zone list rejected at G1.5 | Bootstrap pauses | Revise Red zone; resubmit ADR |
| Phase 2 coverage cannot reach 70% (e.g. UI without testable surface) | Orchestrator emits "Phase 2 cannot complete; project remains in MANUAL forever" | Manually exempt with `pnpm sdlc force-exempt --project <slug> --reason "..."`; logged in audit |
| First Tier 3 epic produces a regression | Trust state stays at MANUAL; reviewer fleet prompts versioned for retry | RCA + prompt revision |

---

## Deboarding (uncommon but documented)

To remove a project from ai-sdlc:

```bash
pnpm sdlc deboard --project <slug> --confirm
```

Effect:
- Removes `ai-sdlc/projects/<slug>/`
- Leaves the target repo untouched (audit log, commits, branches all intact)
- Trust state archived (deboard doesn't reset to MANUAL if re-onboarded later — preserves history)
- Orchestrator deletes any in-flight HITL gates for the project

The target repo remains usable; you just lose the ai-sdlc management.

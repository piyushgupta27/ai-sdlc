# ai-sdlc · REQUIREMENTS

> Registry of every requirement (R-AISDLC-*) and locked decision (Q-AI-*). Source of truth for what must be true about the platform. Updated 2026-05-22.

This file is **append-mostly**. Old requirements stay (auditable history); status changes (`active` → `superseded` → `revoked`) move them forward. R-IDs are stable; never renumber.

---

## ID scheme

| Prefix | Domain |
|---|---|
| **R-AISDLC-1..9** | Pipeline workflow contract |
| **R-AISDLC-10..19** | Autonomy goals |
| **R-AISDLC-20..29** | Pipeline design directives (auditability, context, validation, HITL, harness) |
| **R-AISDLC-30..49** | Patterns adopted from prior internal work + Razorpay |
| **R-AISDLC-50..69** | Multi-tenancy + onboarding |
| **R-AISDLC-70..89** | Test-debt + readiness |
| **R-AISDLC-90..99** | HITL gate spec |
| **R-AISDLC-100..119** | UX + orchestration patterns adopted from Eric Tech's Superboard |
| **R-GRD-1..9** | Non-negotiable guardrails |
| **R-OPS-1..9** | Operational + repo policy |
| **R-FUT-*** | Future scope (v1.5+) |
| **AC-AISDLC-N** | Acceptance criteria |
| **Q-AI-N** | Locked open questions (decisions) |

---

## v1 vs v1.5+ scope summary (added 2026-05-23)

> Most R-AISDLC entries below describe the full architectural target. **v1 (slim Phase A, ~6 days) ships a subset; v1.5+ items graduate when data justifies them.** Nothing is deleted from this registry — sequencing is documented in [ROADMAP.md](./ROADMAP.md) "v1 / v1.5+ scope split."

**v1 ships:**
- R-AISDLC-1..13 (pipeline workflow + autonomy goals) — yes, with 1 reviewer not fleet
- R-AISDLC-20..24 (5 design directives: auditability, context, validations, HITL, harness) — yes, in slim form
- R-AISDLC-30 (CLAUDE.md per module) — yes, but slim Red zone (secrets + cookies only, 2-3 paths)
- R-AISDLC-32 (three-layer enforcement) — Layers 1+2 only; Layer 3 CI is v1.5+
- R-AISDLC-36 (smart model routing) — Sonnet default, Opus for review + debug, Haiku for reporter
- R-AISDLC-37 (ticket readiness check) — via `pnpm sdlc lint` verb
- R-AISDLC-50..57 (multi-tenancy basics) — yes, but full multi-tenant infra activates when 2nd testbed onboards
- R-AISDLC-70..73 (test-debt-first onboarding) — yes
- R-AISDLC-90 G1 + R-AISDLC-92 G2 — **G2 only in v1**; G1 deferred to v1.5+
- R-AISDLC-100..104 (Eric Tech absorptions: GH Projects, lint, PR loop history, develop branch, ntfy.sh) — yes
- R-AISDLC-108 (parent references) — yes

**v1.5+ graduates:**
- R-AISDLC-31 (specialized reviewer fleet 4.4a-f) — single REVIEWER in v1; fleet graduates per ROADMAP triggers
- R-AISDLC-33 (Repo Readiness Score) — manual 70% coverage check in v1
- R-AISDLC-34 (AI filter layer) — needs reviewer fleet first
- R-AISDLC-35 (prompt caching of CONTEXT tree) — defer until cost crosses $50/mo
- R-AISDLC-38 (trust expansion formal criteria) — ad-hoc MANUAL↔AUTO toggle in v1
- R-AISDLC-91 G1.5 ADR + R-AISDLC-93 G3 DEMO + R-AISDLC-94 G5 POST-MERGE — graduate per ROADMAP triggers
- R-AISDLC-105 (tier-aware retry caps) — global max-3 in v1; tier-aware refinement in v1.5+
- R-AISDLC-106 ("add a column" meta-pattern) — applies in v1.5+ when block-cluster data accumulates
- R-AISDLC-107 (slash command shortcuts) — defer; CLI is enough for v1

The full architectural target stays the north star. Each v1.5+ item activates on a specific trigger documented in ROADMAP.md's v1.5+ table.

---

## Table of contents

1. [Pipeline workflow](#1-pipeline-workflow-contract)
2. [Autonomy goals](#2-autonomy-goals)
3. [Pipeline design directives](#3-pipeline-design-directives-r-aisdlc-20s)
4. [Patterns adopted from prior internal work + Razorpay](#4-patterns-adopted-from-prior-internal-work--razorpay-r-aisdlc-30s)
5. [Multi-tenancy + onboarding](#5-multi-tenancy--onboarding-r-aisdlc-50s)
6. [Test-debt + readiness](#6-test-debt--readiness-r-aisdlc-70s)
7. [HITL gate spec](#7-hitl-gate-spec-r-aisdlc-90s)
7.5. [UX patterns adopted from Eric Tech's Superboard](#75-ux--orchestration-patterns-adopted-from-eric-techs-superboard-r-aisdlc-100s)
8. [Non-negotiable guardrails (R-GRD)](#8-non-negotiable-guardrails-r-grd)
9. [Operational + repo policy (R-OPS)](#9-operational--repo-policy-r-ops)
10. [Future scope (R-FUT)](#10-future-scope-r-fut)
11. [Locked decisions (Q-AI)](#11-locked-decisions-q-ai)
12. [Change log](#change-log)

---

## 1. Pipeline workflow contract

The pipeline must implement this canonical workflow:

| ID | Requirement | Source |
|---|---|---|
| **R-AISDLC-1** | PLAN → EPIC/STORY/TASKS → parallel EPIC streams | User's workflow diagram |
| **R-AISDLC-2** | Each task → UNIT + INTEGRATION TESTS (with observability where helpful) | Same |
| **R-AISDLC-3** | Then DEEP CODE REVIEW (via specialized reviewer fleet) | Same |
| **R-AISDLC-4** | Then QA + AUTOMATION + UI TESTING (via DEMO agent) | Same |
| **R-AISDLC-5** | Then PRODUCT DEMO to verify everything works (HITL G3) | Same |
| **R-AISDLC-6** | Then CODE COMMIT (auto on green CI per tier) | Same |
| **R-AISDLC-7** | Then SUMMARY OF CHANGES SHARED WITH USER (REPORTER agent) | Same |
| **R-AISDLC-8** | Epics run in parallel; stories within an epic run sequentially | Same |

---

## 2. Autonomy goals

| ID | Requirement | Source |
|---|---|---|
| **R-AISDLC-10** | Goal: zero user intervention between epic approval and merge for routine work | User stated |
| **R-AISDLC-11** | Increase user's parallelism across multiple products | User stated |
| **R-AISDLC-12** | End state: ecosystem of self-hosted products built by the same pipeline (Phase E) | User stated |
| **R-AISDLC-13** | Research how others have done this; cite parent implementations | User stated (Razorpay + prior pattern doc v2) |

---

## 3. Pipeline design directives (R-AISDLC-20s)

The 5 "things to take care of":

| ID | Requirement | Source |
|---|---|---|
| **R-AISDLC-20** | **Auditability** — all changes, all actions auditable; easy-to-navigate; every agent action logged + traceable | User direct ask |
| **R-AISDLC-21** | **Context layer** — repo + every module/sub-module documented (CONTEXT.md per module); living docs updated on each commit; bubble-up rule | User direct ask |
| **R-AISDLC-22** | **Validations / guardrails** — automated checks + secondary agent + human sign-off; no bad change pushed, no regression | User direct ask |
| **R-AISDLC-23** | **HITL** — review surface where user can check; intervention points defined + calibrated to blast radius | User direct ask |
| **R-AISDLC-24** | **Documented harness** — inputs, trigger conditions, guardrails, validation, rollback all written down per stage | User direct ask |

---

## 4. Patterns adopted from prior internal work + Razorpay (R-AISDLC-30s)

Following the post-correction 2026-05-20 alignment with Razorpay Slash + Piyush's own a prior internal pattern doc (private):

| ID | Requirement | Source |
|---|---|---|
| **R-AISDLC-30** | **CLAUDE.md per module** — prior pattern doc Appendix A template (Service Overview / Blast Radius / Red Zone Files / Architecture / Code Conventions / Error Handling / Logging / Money & Amounts / Database / API Contracts / Testing / Local Dev / Dependencies / Known Quirks). Adapted to per-project stack. | prior pattern doc App. A; Q-AI-9 DECIDED 2026-05-21 |
| **R-AISDLC-31** | **Specialized reviewer fleet** — REVIEWER is multiple narrow sub-agents in parallel (Phase A: SECURITY + CODE-QUALITY; Phase B: + BUG-DETECTOR + DESIGN; v1.5: + PERF + I18N). AGGREGATOR merges verdicts. | Razorpay Slash blog; Q-AI-11 DECIDED 2026-05-21 |
| **R-AISDLC-32** | **Three-layer enforcement for Tier 0/1 (Red zone)** — (1) CLAUDE.md declares Red zone files/dirs; (2) pre-write hook `check-blast-radius.sh` blocks unapproved writes; (3) CI workflow rejects PRs touching Red zone without HITL label. All three independent. | prior pattern doc §7.1 |
| **R-AISDLC-33** | **Repo Readiness Score gate** — orchestrator refuses auto-merge until repo scores ≥70% across Context + Testing + CI/CD pillars in Phase A. Threshold rises to 80% at Phase B. Per project. | Razorpay Slash blog; Q-AI-10 DECIDED 2026-05-21 |
| **R-AISDLC-34** | **AI filter layer** — Haiku-class call between reviewer fleet output and HITL queue drops likely false positives (real=false AND confidence>0.7). Drop rate tracked per cohort; >40% triggers prompt review. | Razorpay Slash blog |
| **R-AISDLC-35** | **Prompt caching of CONTEXT tree** — repo-root CLAUDE.md + CONTEXT.md tree + lessons.md cached per agent run at Anthropic's 0.1× rate. Expected savings ~22% per ticket. Cache key = sha256(paths + commit SHAs). | prior pattern doc §10.2 |
| **R-AISDLC-36** | **Smart model routing** — see §11 model router table. Sonnet default for BUILDER/TESTER; Opus fallback on validation failure or Tier 0/1; Haiku for AGGREGATOR/COMMIT/REPORTER/SCOUT. All via Claude Code Subagent transport (Q-AI-2 amendment, see below). | prior pattern doc §5.4 |
| **R-AISDLC-37** | **Ticket / epic readiness check** — PLANNER refuses to break down an epic unless DoD + AC + tier + estimated cost are present. Gate before agent run. | prior pattern doc §5.2 |
| **R-AISDLC-38** | **Trust expansion formal criteria** — zone reclassification (upward) requires: 20+ tickets processed, 0 production incidents in trust window, ≥85% test coverage in zone, owner explicit approval, reversible recording. Red zone NEVER reclassifies downward. | prior pattern doc §7.2 |
| **R-AISDLC-39** | **Parent reference: a prior internal pattern doc (private)** at `~/Workspace/local-vault/projects/active/internal-project/docs/jira-to-pr-creator-execution-plan-v2.md`. ai-sdlc is the personal-projects sibling. Pattern changes here propagate from there. | Piyush correction 2026-05-20 |
| **R-AISDLC-40** | **Industry exemplar: Razorpay Slash** at https://razorpay.com/blog/razorpay-engineers-built-slash-slash-builds-the-rest/ — production reference for fleet pattern, readiness scoring, filter layer, three-door entry points. | Piyush correction 2026-05-20 |

---

## 5. Multi-tenancy + onboarding (R-AISDLC-50s)

| ID | Requirement | Source |
|---|---|---|
| **R-AISDLC-50** | Pipeline is **multi-tenant from day 1**. One ai-sdlc instance manages N consumer projects (testbeds). | 2026-05-22 pivot |
| **R-AISDLC-51** | **Standalone repos for testbeds.** Every shippable project lives at `~/Workspace/<slug>/` as its own git repo, symlinked into local-vault. No incubation in local-vault for projects that will be onboarded. | 2026-05-22 pivot |
| **R-AISDLC-52** | **Onboarding flow is a Phase A deliverable**, not Phase E. `pnpm sdlc onboard --repo <path> --slug <slug>` is the canonical command. | 2026-05-22 pivot |
| **R-AISDLC-53** | Per-project state lives at `ai-sdlc/projects/<slug>/{config.json, state.json, prompts/}`. Secrets never live here. | Same |
| **R-AISDLC-54** | Audit log is project-scoped: `.audit/<date>/runs/*.jsonl` in the TARGET repo, not in ai-sdlc itself. | Same |
| **R-AISDLC-55** | **Per-repo public/private decision.** ai-sdlc + portfolio public from day 1; testbeds private until per-project sign-off. (Amends Q-AI-7.) | 2026-05-22 pivot |
| **R-AISDLC-56** | **Per-repo license per pattern.** ai-sdlc = AGPL-3.0 + CLA; portfolio = MIT for code + ARR for content; testbeds = ARR placeholder. | 2026-05-22 pivot |
| **R-AISDLC-57** | **Deboarding command** for clean project removal (`pnpm sdlc deboard --project <slug>`). Target repo untouched; trust state archived. | 2026-05-22 |

---

## 6. Test-debt + readiness (R-AISDLC-70s)

| ID | Requirement | Source |
|---|---|---|
| **R-AISDLC-70** | **Test-debt-first rule.** For every onboarded project, the FIRST ai-sdlc managed task is "establish test coverage on existing code." Tier 2; HITL at REVIEW. | 2026-05-22 pivot |
| **R-AISDLC-71** | Coverage target: 70% on changed files (general), 85% on Tier 0/1 zones. No autonomous work proceeds against a repo with <70% coverage. | Same |
| **R-AISDLC-72** | Exemption process: `pnpm sdlc force-exempt --project <slug> --reason "..."` for legitimate cases (e.g. pure-UI projects where the testable surface is thin). Logged in audit. | Same |
| **R-AISDLC-73** | Repo Readiness Score formula: 40% Context pillar + 30% Testing pillar + 30% CI/CD pillar. Computed daily. Gates auto-merge below threshold. | Razorpay-derived; R-AISDLC-33 |

---

## 7. HITL gate spec (R-AISDLC-90s)

Per [HITL.md](./HITL.md) — five gates total.

| ID | Requirement | Source |
|---|---|---|
| **R-AISDLC-90** | **G1 — PLAN gate.** Fires when PLANNER drafts epic decomposition. Answers user's "answer key questions to proceed." | User stated 2026-05-22 |
| **R-AISDLC-91** | **G1.5 — ADR gate.** New gate. Fires when BUILDER drafts an architectural decision (heuristic: >1-module impact, >1yr cost-of-change, Red zone, 2+ viable approaches, irreversible). Answers user's "direct the approach." | New 2026-05-22 |
| **R-AISDLC-92** | **G2 — REVIEW gate.** Fires after reviewer fleet aggregates + AI filter applies. Answers user's "review outputs as HITL." | User stated |
| **R-AISDLC-93** | **G3 — DEMO gate.** Fires after CI green, before merge. Demo video + per-AC screenshots + visual diff. Answers user's "review the end product." | User stated |
| **R-AISDLC-94** | **G5 — POST-MERGE gate.** New gate. Fires 24h after merge; user reports if change worked in real use. Feedback loops into trust expansion. Answers user's "test and start using." | New 2026-05-22 |
| **R-AISDLC-95** | Quiet hours respected on all gates. 11pm-8am IST default; no notifications fire. | User stated |
| **R-AISDLC-96** | Vacation mode (`pnpm sdlc vacation`) suspends notifications + pauses expire clocks. | New 2026-05-22 |
| **R-AISDLC-97** | All gate responses recorded in audit log with timestamp + reply + reasoning. | R-AISDLC-20 derived |
| **R-AISDLC-98** | Gate responses reversible within 1h via dashboard "undo". After 1h, requires new task. | New 2026-05-22 |

---

## 7.5 UX + orchestration patterns adopted from Eric Tech's Superboard (R-AISDLC-100s)

Following review of Eric Tech's autonomous SDLC framework "Superboard" (YouTube: `nX_bGyIOFM4`, production proof at bookzero.ai). His skills bundle (`superboard` + `superbuild` + `superqa` + `superreview`) ships pull requests overnight via GitHub Project board state machine. We absorb the UX patterns that improve developer experience without compromising our safety architecture (tier system, three-layer enforcement, reviewer fleet stay as-is).

| ID | Requirement | Source |
|---|---|---|
| **R-AISDLC-100** | **GitHub Projects board as primary orchestration surface.** Orchestrator reads/writes column state (Ready / Building / QA / Review / Done / Blocked / Skipped) instead of treating dashboard at :3001 as the only state. Public-repo benefit: visible kanban progress for portfolio reviewers. | Superboard pattern; bookzero.ai validated |
| **R-AISDLC-101** | **`pnpm sdlc lint` as a standalone CLI verb.** Pre-dispatch ticket clarification step. Reads tickets in Ready column, flags vague AC, proposes fixes, applies on user approval. Operationalizes R-AISDLC-37 (ticket readiness check). | Superboard `/lint` UX |
| **R-AISDLC-102** | **PR description auto-populated with iteration history.** COMMIT agent appends "Loop history" section listing each builder/QA/reviewer cycle with model + verdict + duration. Tier 0/1 also includes full audit-log run id table. | Superboard PR pattern |
| **R-AISDLC-103** | **`develop` branch as default autonomous merge target.** Onboarding flow creates `develop` if absent + sets as merge target. `main` requires manual promotion (human PR from `develop`). Per-project override (set `mergeTarget: "main"` in `projects/<slug>/config.json` for greenfield projects with no production users). | Superboard pattern + safer production posture |
| **R-AISDLC-104** | **Mobile dispatch via webhook.** Lightweight HTTP webhook trigger (ntfy.sh preferred over Telegram bot to avoid extra account ceremony). `pnpm sdlc dispatch --webhook <slug>` reads pending tickets in Ready, fires orchestrator headless. "I shipped from my phone" is a real demo capability. | Superboard Telegram pattern |
| **R-AISDLC-105** | **Tier-aware iteration caps.** Refines the prior global "max 3 build/review cycles." New table: Tier 0 → 0 retries (HITL on first failure); Tier 1 → 1 retry; Tier 2 → 3 (current); Tier 3 → 5; Tier 4 → unlimited until manual stop. Cap exhaustion → Block column + auto-G2 HITL. | Superboard 3-cap + tier-aware refinement |
| **R-AISDLC-106** | **"Add a column when blocked repeatedly" meta-pattern.** When N≥3 tickets cluster in Block with the same root cause within a 14-day window, raise an ADR (G1.5) to add a new pipeline stage + specialized agent. Example from Eric: Lighthouse <90 mobile blocked 3 times → add PERF stage + PERF-REVIEWER. This is how the pipeline grows. | Superboard "extend pipeline" pattern |
| **R-AISDLC-107** | **Slash command shortcuts in `.claude/commands/`.** Thin wrappers over CLI verbs for interactive Claude sessions: `/sdlc-status`, `/sdlc-lint`, `/sdlc-run`, `/sdlc-next`, `/sdlc-board`. Coexists with `pnpm sdlc <verb>`; same source of truth. | Superboard `/board` `/lint` UX |
| **R-AISDLC-108** | **Reference: Eric Tech's Superboard** (YouTube `nX_bGyIOFM4`; production proof at bookzero.ai). Adoption rationale documented per ID 100–107 above. Pattern changes here propagate as Eric's framework evolves. | Cross-model validation of architectural choices |

---

## 8. Non-negotiable guardrails (R-GRD)

User explicitly enumerated six. Violation = pipeline halt + RCA.

| ID | Guardrail | Source |
|---|---|---|
| **R-GRD-1** | **Tier 0 = extreme caution.** Cookie/auth/security/rollback code requires human sign-off at every stage. Never autonomous. | User stated |
| **R-GRD-2** | **Agent output never bypasses checks or CI/CD.** Same pipeline as human code. | User stated |
| **R-GRD-3** | **Automate validation before human review.** Schema, contracts, tests, arch rules in the harness. | User stated |
| **R-GRD-4** | **Rollback is mandatory.** Every workflow has a documented + tested rollback path. | User stated |
| **R-GRD-5** | **Trust expands on data.** Start tight, expand on measured success/defect rate. NOT intuition. | User stated |
| **R-GRD-6** | **Document learnings along the way.** Infra, pipeline, code, tests, process, product, output, metrics. | User stated |

---

## 9. Operational + repo policy (R-OPS)

| ID | Requirement | Source |
|---|---|---|
| **R-OPS-1** | Standalone repos for shippable projects, symlinked into local-vault. | 2026-05-22 |
| **R-OPS-2** | git-crypt for secrets in testbed repos; key at `~/Workspace/.<slug>-gitcrypt-key`. | career-automation pattern |
| **R-OPS-3** | Branch protection on `main` for all repos: required CI checks, no direct push, linear history. | Phase A deliverable |
| **R-OPS-4** | CODEOWNERS file in every repo: Red zone → @owner. | Phase A deliverable |
| **R-OPS-5** | Conventional Commits style for all commits. Agent commits get `Generated-By:` trailer. | Phase A |

---

## 10. Future scope (R-FUT)

Deferred to v1.5+ or later. Not in scope for v1.

| ID | Future requirement | Rationale |
|---|---|---|
| **R-FUT-1** | Multi-machine pipeline orchestration | Personal scale only for v1 |
| **R-FUT-2** | Web-based onboarding UI | CLI only for v1 |
| **R-FUT-3** | IDE integration (VSCode extension) | Defer; gstack covers most of the need |
| **R-FUT-4** | Mobile HITL gate review | macOS dashboard only for v1 |
| **R-FUT-5** | SaaS hosting of ai-sdlc | AGPL allows self-hosting; no managed offering planned |
| **R-FUT-6** | Substack newsletter integration | Skipped per 2026-05-22 decision |
| **R-FUT-7** | Codex CLI / OpenAI API integration for reviewer fleet | Q-AI-2 amended to Claude-on-Claude for v1; revisit at v1.5 |
| **R-FUT-8** | Capability registry (prior pattern doc §11.3) | Phase E + |
| **R-FUT-9** | "Post-worthy moment" detector for portfolio content drafts | REPORTER enhancement, Phase B+ |
| **R-FUT-10** | Linear/Jira/Notion integration | GitHub Issues + Projects is enough |

---

## 11. Locked decisions (Q-AI)

Decisions made + locked. Future changes require Q-AI-N+1 amendments, NOT edits to locked rows.

### Originals (Q-AI-1 through Q-AI-8, locked 2026-05-21)

| # | Question | Decision | Date | Notes |
|---|---|---|---|---|
| **Q-AI-1** | Pipeline location | **Own repo from day 1** (ai-sdlc, not nested in trip-research) | 2026-05-22 | **Amended** from original "trip-research repo for v1" |
| **Q-AI-2** | Multi-model strategy | **Builder Claude (Sonnet), Reviewer Claude (Opus + cold-read prompt)** for v1; revisit at v1.5 | 2026-05-22 | **Amended** from original "Builder Claude, Reviewer Codex" — no Codex CLI access; mitigated via temperature + prompting differences |
| **Q-AI-3** | HITL notification channel | macOS notifications + local dashboard | 2026-05-21 | — |
| **Q-AI-4** | Monthly LLM cost cap | $50-150/month (flat-rate subscription model now applicable since Q-AI-2 amendment) | 2026-05-22 | **Amended** — flat-rate sub absorbs cost; previously was pay-per-call |
| **Q-AI-5** | Audit log location | Hybrid: 90d JSONL in-repo + SQLite archive at `~/.gstack/audit/<project>/` | 2026-05-21 | — |
| **Q-AI-6** | When pipeline starts | **Pipeline first** (against ai-sdlc itself as testbed), then onboard products | 2026-05-22 | **Amended** from "parallel with trip-research" |
| **Q-AI-7** | Repo public/private | **Per-repo**: ai-sdlc + portfolio public; testbeds private | 2026-05-22 | **Amended** from "all private until v1.5" |
| **Q-AI-8** | Sandbox isolation | Git worktrees per task | 2026-05-21 | — |

### Post-correction additions (Q-AI-9 through Q-AI-12, locked 2026-05-21)

| # | Question | Decision | Date |
|---|---|---|---|
| **Q-AI-9** | a prior CLAUDE.md template | Adopt structure verbatim, adapt content per project stack | 2026-05-21 |
| **Q-AI-10** | Repo Readiness threshold | Start at 70% (Phase A), raise to 80% at Phase B | 2026-05-21 |
| **Q-AI-11** | Reviewer fleet size | 2 (Phase A) → 4 (Phase B) → 6 (v1.5) | 2026-05-21 |
| **Q-AI-12** | When pipeline extracts to own repo | **Day 1** (this commit) | 2026-05-22 | **Amended** from "at trip-research v1 ship" |

### Bonus locks (2026-05-22)

| # | Question | Decision |
|---|---|---|
| **Q-AI-13** | License for ai-sdlc | AGPL-3.0 + CLA (preserves dual-license optionality, closes SaaS loophole) |
| **Q-AI-14** | License for portfolio | MIT for code + "All Rights Reserved" for content |
| **Q-AI-15** | License for private testbeds | "All Rights Reserved" placeholder |
| **Q-AI-16** | Content destination (blog) | Own domain piyushgupta.io only; no Medium revival, no Substack |
| **Q-AI-17** | Domain | piyushgupta.io (user-owned; short, memorable, tech-industry-recognized TLD; DNS via Cloudflare) |
| **Q-AI-18** | Reviewer fleet anti-monoculture mitigation (since same family) | Different temperature (0.3 builder, 0.7 reviewer) + cold-read hostile-eye reviewer prompt + smaller AGGREGATOR (Haiku) for scale-based independence |
| **Q-AI-19** | Trust expansion data source | Real-use feedback via G5 (post-merge) + audit log defect rate + cohort tracking |
| **Q-AI-20** | Cookie storage | git-crypt-encrypted JSON in `private/` per target repo; key at `~/Workspace/.<slug>-gitcrypt-key` |

### Eric Tech Superboard adoptions (2026-05-23)

After cross-validation against Eric Tech's "Superboard" framework (YouTube `nX_bGyIOFM4`; production proof at bookzero.ai). His pattern ships PRs overnight via GitHub Project board + dispatch loop. We adopt the UX surfaces that improve discoverability + portfolio appeal; keep our safety architecture (tier system, three-layer enforcement, reviewer fleet) unchanged because Eric's framework targets demo apps without secrets/PII while ours manages products with both.

| # | Question | Decision |
|---|---|---|
| **Q-AI-21** | Primary orchestration surface | **GitHub Projects board** (Ready / Building / QA / Review / Done / Blocked / Skipped). Local dashboard at :3001 supplements but doesn't gatekeep. ADOPTED from Superboard. |
| **Q-AI-22** | Pre-dispatch ticket clarification | **`pnpm sdlc lint <epic-id>`** as standalone CLI verb. Surfaces vague tickets + proposed AC fixes for user approval BEFORE orchestrator dispatches headless agents. ADOPTED from Superboard `/lint`. |
| **Q-AI-23** | PR iteration history visibility | **COMMIT agent auto-populates PR body** with "Loop history" section: each build/QA/review cycle with model + verdict + duration. Audit log run id table for Tier 0/1. ADOPTED from Superboard. |
| **Q-AI-24** | Default autonomous merge target | **`develop` branch** (not `main`). Onboarding flow creates `develop` + sets as target. `main` requires manual promotion via human PR from `develop`. Per-project override via `projects/<slug>/config.json` `mergeTarget` field. ADOPTED from Superboard + safer production posture. |
| **Q-AI-25** | Mobile dispatch mechanism | **ntfy.sh webhook** (preferred over Telegram bot — no account setup, no token rotation, self-hostable). `pnpm sdlc dispatch --webhook <ntfy-topic>` triggers orchestrator headless. "I shipped from my phone" demo capability. ADOPTED-LITE from Superboard. |
| **Q-AI-26** | Iteration cap policy | **Tier-aware** (refines prior global "max 3"): Tier 0 = 0 retries (HITL on first build failure); Tier 1 = 1 retry; Tier 2 = 3 (current); Tier 3 = 5; Tier 4 = unlimited until manual stop. Cap exhaustion → Block column + G2 HITL. REFINES prior decision. |

---

## Acceptance criteria

| ID | Criterion | Source |
|---|---|---|
| **AC-AISDLC-1** | Every agent action has a row in `.audit/<date>/runs/*.jsonl` with prompt + response + decision | R-AISDLC-20 |
| **AC-AISDLC-2** | Every module has a `CONTEXT.md` updated within the same commit when its public API changes | R-AISDLC-21, R-AISDLC-30 |
| **AC-AISDLC-3** | No PR merges without: lint + tsc + tests + security + reviewer fleet PASS + readiness ≥70% | R-AISDLC-22, R-AISDLC-31, R-AISDLC-33 |
| **AC-AISDLC-4** | HITL gates fire per tier matrix; user receives structured request via dashboard + macOS noti | R-AISDLC-23, R-AISDLC-90-94 |
| **AC-AISDLC-5** | Every stage transition has documented inputs, validations, outputs, rollback procedure | R-AISDLC-24 |
| **AC-AISDLC-6** | Red zone files declared in CLAUDE.md; pre-write hook blocks without approval token; CI rejects PRs without `hitl-approved-tier-{0,1}` label | R-AISDLC-32 |
| **AC-AISDLC-7** | Prompt cache hit rate ≥80% by Phase C; logged in `.audit/cache/` | R-AISDLC-35 |
| **AC-AISDLC-8** | Zone reclassification logs (both directions) at `.audit/trust-transitions.jsonl` with reversible state pointers | R-AISDLC-38 |
| **AC-AISDLC-9** | Onboarding command (`pnpm sdlc onboard`) completes Phase 0-1 in <1 day wall time | R-AISDLC-52 |
| **AC-AISDLC-10** | Test-debt-first rule enforced: refuses autonomous work below 70% coverage on changed files | R-AISDLC-70, R-AISDLC-71 |
| **AC-AISDLC-11** | All 5 HITL gates can be exercised end-to-end against ai-sdlc itself in Phase A | R-AISDLC-90-94 |
| **AC-AISDLC-12** | `pnpm sdlc replay <run-id>` produces deterministic output | Phase A pass criterion |

---

## Change log

| Date | Change |
|---|---|
| 2026-05-22 | Initial draft. Migrated R-SDLC-* + Q-AI-1..12 from trip-research/REQUIREMENTS.md. Renamed prefix to R-AISDLC-* (this is the platform now, not a sub-section of trip-research). Added Q-AI-13..20 + R-AISDLC-50..57 (multi-tenancy) + R-AISDLC-70..73 (test-debt) + R-AISDLC-90..98 (HITL spec). |
| 2026-05-23 | Domain swap: piyushgupta.dev → piyushgupta.io (user owns). |
| 2026-05-23 | Absorbed Eric Tech Superboard patterns (cross-model architectural validation from YouTube nX_bGyIOFM4 + bookzero.ai production proof). Added Q-AI-21..26 + R-AISDLC-100..108: GitHub Projects as orchestration surface, `pnpm sdlc lint` verb, PR iteration history auto-population, develop-branch as default merge target, ntfy.sh mobile dispatch, tier-aware iteration caps, "add a column when blocked" meta-pattern, slash commands. |

---

## How to update this doc

- **Adding a requirement:** assign next ID; add row; cross-reference in source doc.
- **Modifying a requirement:** keep ID; update text; add change_log note.
- **Revoking:** mark `status: revoked`; do NOT delete row; add note.
- **Superseding:** mark old `status: superseded`; create new ID; link old → new.

This file is append-mostly. History matters.

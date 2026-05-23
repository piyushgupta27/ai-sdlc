# ai-sdlc · ROADMAP

> What gets built, when, and in what order. Updated 2026-05-22.

ai-sdlc is the autonomous SDLC platform; the testbeds are the products it builds. This doc tracks both layers: the platform's phase plan (A→E) and the testbed onboarding sequence.

---

## Platform phases

| Phase | Window | Goal | Status |
|---|---|---|---|
| **Phase 0** | week 0 | GitHub presence setup: profile README, this repo bootstrap, issue/PR templates, labels, branch protection | ✅ In progress (this commit) |
| **Phase A** | weeks 1-3 | Foundation: orchestrator + 4 agents (PLANNER, BUILDER, SECURITY-REVIEWER, CODE-QUALITY-REVIEWER) + AGGREGATOR + multi-tenant infra + HITL queue + dashboard + three-layer enforcement (Layer 1+2) | Not started |
| **Phase B** | week 4 | Onboard testbed #1 (trip-research) — first real autonomous epic; add 2 more reviewers (BUG-DETECTOR + DESIGN); Repo Readiness Score reaches 70% | Not started |
| **Phase C** | weeks 5-6 | Onboard testbed #2 (piyush-portfolio) — net-new project, validates "pipeline builds from zero"; interview-urgent | Not started |
| **Phase D** | weeks 7-10 | Onboard testbed #3 (career-automation); pipeline manages all 3 in parallel; trust expansion data accumulates; reviewer fleet stress-tested | Not started |
| **Phase E** | weeks 11+ | Onboard testbeds #4 + #5 (ai-finance-tracker, ai-health-agent); v1.5 reviewer fleet (PERF + I18N); steady state | Not started |

Phase pass criteria are in [PLAN.md](./PLAN.md).

---

## v1 / v1.5+ scope split

Phase A below describes the full pipeline. **v1 ships the slim subset; v1.5+ items are pre-planned but graduate only when real data justifies them.** This sequencing is the difference between shipping in ~6 days vs ~3 weeks for the foundation.

### v1 — slim Phase A (~6 days, ship-it MVP)

The minimum to operate as team lead with AI agents as devs:

| # | Deliverable | Notes |
|---|---|---|
| 1 | GitHub Projects board with canonical columns | Ready / Building / QA / Review / Done / Blocked |
| 2 | 4 agents: PLANNER, BUILDER, TESTER, REVIEWER (single, generalist), REPORTER | Specialized fleet (2→4→6) is v1.5+ |
| 3 | CLI verbs: `pnpm sdlc onboard / lint / dispatch / status / board` | Other verbs land in v1.5+ as needed |
| 4 | Simple JSONL audit log per agent run | Hash chain + SQLite archive is v1.5+ |
| 5 | **G2 REVIEW gate only** (Block column for HITL escalation) | G1, G1.5, G3, G5 are v1.5+ |
| 6 | CLAUDE.md per project — Red zone for **secrets + cookies only** (2-3 paths max) | Full tier 0/1 system is v1.5+ |
| 7 | Pre-commit hook checks Red zone (Layer 2 only) | Layer 3 CI workflow is v1.5+ |
| 8 | `develop` branch as merge target | Per-project override later |
| 9 | Global max-3 retries → Block | Tier-aware caps (Q-AI-26) is v1.5+ |
| 10 | ntfy.sh mobile dispatch | Per Q-AI-25 |
| 11 | PR body auto-populated with iteration history | Per Q-AI-23 |

That's it. Eleven items. ~6 days. Real working pipeline shipping PRs to develop.

### v1.5+ — graduates when data justifies

The full pipeline as documented in ARCHITECTURE.md / HITL.md / REQUIREMENTS.md. Each pattern below has a specific trigger:

| v1.5+ pattern | Graduates when |
|---|---|
| Specialized reviewer fleet (4.4a-f) | Single reviewer misses a class of bugs 3+ times; OR new dimension surfaces (perf, i18n) |
| G1 PLAN gate | PLANNER produces decompositions you wish you'd approved before they ran |
| G1.5 ADR gate | You're making architectural calls in GitHub Discussions and want a structured surface |
| G3 DEMO gate | A PR ships and the AC was met but the user experience was wrong |
| G5 POST-MERGE gate | A merge passes G2 but you discover it broke in real use 24h later |
| Three-layer enforcement Layer 3 (CI workflow) | Pre-commit hook missed a Red zone touch in one of the testbeds |
| Hash-chained audit log | You go multi-user OR need cryptographic tamper detection (rare; expect to defer) |
| Trust state machine (5 states + formal trust criteria) | Ad-hoc MANUAL ↔ AUTO toggle stops scaling; you want data-driven autonomy expansion |
| Tier system 0-4 (full) + tier-aware retry caps | 2-tier (HITL / no-HITL) coarseness causes friction |
| Repo Readiness Score (40/30/30) | You onboard 3+ projects and want consistent gating |
| Multi-tenant infrastructure (full) | 2nd testbed onboards (career-automation, portfolio) |
| AI filter layer for reviewer findings | First time a reviewer comment is dropped that turned out to be real |
| Prompt cache derivation logic | Cost crosses $50/month sustained |
| Slash command shortcuts (`.claude/commands/sdlc-*`) | Interactive Claude sessions feel slower than CLI for your daily workflow |

### Why this split

- **Eric's Superboard** ships PRs in production at single-developer scale with much less apparatus. We don't need more until we have data showing we do.
- **Razorpay's Slash** earns its complexity at 1000 PRs/week across 200+ engineers. We're at ~5 PRs/week solo.
- The slim v1 is enough to "act as team lead with AI agents as devs."
- v1.5+ patterns are pre-planned (ARCHITECTURE.md / HITL.md / REQUIREMENTS.md), so adding them later isn't from-scratch work. This section is just a sequencing decision.
- **Nothing is deleted from the planning suite.** Everything stays as the architectural north star. We just don't build it all in Phase A.

---

## Testbed onboarding sequence

The order is deliberate. trip-research first because it has existing code (validates pipeline on legacy + test-debt scenario). Portfolio second because it's net-new (validates pipeline on greenfield) AND interview-urgent. Career-automation third because it's the most complex existing project. Finance and health follow as lower-priority private repos.

| Order | Project | Why this slot | Public? | First task once onboarded |
|---|---|---|---|---|
| 1 | **trip-research** | Existing code; pipeline writes tests against working CLI; validates legacy + test-debt scenario | Private (→ v1.5) | Establish 70% test coverage on `src/` (Tier 2, HITL required) |
| 2 | **piyush-portfolio** | Net-new; validates greenfield path; interview-urgent (4-8 weeks before next major round) | Public | Bootstrap Next.js + MDX + first project case study |
| 3 | **career-automation** | Existing, production-like personal use; validates pipeline on complex existing code | Private (forever) | Audit existing test coverage; fill gaps |
| 4 | **ai-finance-tracker** | Existing repo; lower urgency | Private (forever) | Audit + onboard |
| 5 | **ai-health-agent** | Existing repo; lower urgency | Private (forever) | Audit + onboard |
| 6+ | **ai-interview-copilot** | Lower priority; user has live-interview pressure with known browser-audio issues; onboard when stable | Private | Audit + onboard |

Each onboarding follows the procedure in [ONBOARDING.md](./ONBOARDING.md). The first task for every project is establishing test coverage; no autonomous work proceeds against an untested repo.

---

## Orchestration substrate: GitHub Projects board

**Primary surface** (per Q-AI-21, R-AISDLC-100): the GitHub Project board for each onboarded repo. Columns mirror the pipeline state machine:

```
Ready → Building → QA → Review → Done
              ↑                         ↓
              ↑                  (auto-merge → develop)
              ↑
        Blocked / Skipped (manual gates)
```

Why this substrate:
- **Public** for public repos = recruiter-visible kanban progress (portfolio signal)
- **Native to GitHub** = no separate UI to maintain; uses what's already there
- **State machine IS visible** = anyone can see what's in flight
- **Onboarding flow** (`pnpm sdlc onboard`) creates the project board with the canonical columns

Local dashboard at `:3001` supplements (audit log query, cohort analytics, cost dashboard) but doesn't gatekeep — the GitHub Project is the source of truth for "what's where."

## The "add a column when blocked" meta-pattern (R-AISDLC-106)

How the pipeline grows over time. When 3+ tickets cluster in the Block column with the same root cause within a 14-day window, that's the signal to add a new stage + specialized agent:

| Repeated block reason | Suggested response | Adds which agent/stage |
|---|---|---|
| Lighthouse mobile <90 | Add PERF stage + PERF-REVIEWER (4.4e) | v1.5 reviewer fleet, brought forward if needed |
| Untranslated string in changed files | Add I18N stage + I18N-REVIEWER (4.4f) | Same |
| Visual diff >5% on UI changes | Add VISUAL-DIFF gate before COMMIT | New gate G2.5 |
| Lint config keeps blocking BUILDER | Add LINT-AUTOFIX pre-stage | New agent: LINT-FIXER |
| Test coverage drops below threshold | Add coverage-recovery stage | Per project, optional |

Each addition follows: 3+ Block instances → ADR via G1.5 → user approves → new stage code lands → ROADMAP updated.

## Public artifacts strategy

What gets shaped into interview-facing public artifacts as a byproduct of ai-sdlc operating:

| Artifact | Built by | Cadence |
|---|---|---|
| GitHub Issues per repo (structured templates) | PLANNER agent + manual triage | Continuous |
| PRs with structured descriptions (linked epic, AC, tier, audit run id) | BUILDER + COMMIT agents | Every merged change |
| Public ADR commits in `docs/adr/` (per public repo) | BUILDER agent + HITL G1.5 gate | Per architectural decision |
| Audit log JSONL (per repo, last 90 days in-repo) | Orchestrator | Every agent action |
| Release notes / changelog | COMMIT agent + GitHub Actions | Per release |
| `content/drafts/` post-worthy moment detections | REPORTER agent | Per epic completion |
| Public roadmap milestones | Manual + ROADMAP doc updates | Per phase transition |

---

## License + visibility policy (per repo)

| Repo | Visibility | License | Why |
|---|---|---|---|
| **ai-sdlc** | Public from day 1 | AGPL-3.0 + CLA | Adoption + dual-license optionality; closes SaaS loophole |
| **piyush-portfolio** | Public when built | MIT for code; "All Rights Reserved" for content | Standard split |
| **trip-research** | Private (→ v1.5) | "All Rights Reserved" placeholder | Cookie code + adapter techniques sensitive; review before public |
| **career-automation** | Private (forever) | "All Rights Reserved" | Personal data |
| **ai-finance-tracker** | Private (forever) | "All Rights Reserved" | PII |
| **ai-health-agent** | Private (forever) | "All Rights Reserved" | PII |

---

## What's explicitly NOT in this roadmap

- Open-sourcing ai-sdlc's CONTEXT.md tree for testbeds. CONTEXT.md travels with each testbed repo, not centrally maintained.
- Marketing for ai-sdlc (Hacker News submission, conference talks). May happen organically post-v1, not a deliverable.
- Multi-user / SaaS hosting of ai-sdlc. Personal-scale only for v1.
- Cross-machine pipeline orchestration. Single-Mac for v1.

These appear in TODOs / future-scope (see REQUIREMENTS.md `R-FUT-*`) but not on this roadmap.

---

## Update policy

This file is updated when a phase transitions, a testbed onboards, or a major decision changes the sequence. Date the change in the table cell. Old entries stay (auditable history); status fields move forward.

Last update: 2026-05-22 (initial draft, Phase 0 in progress).

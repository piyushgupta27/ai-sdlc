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

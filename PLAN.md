# ai-sdlc · PLAN

> Phase-by-phase deliverables, success criteria, and owners. Updated 2026-05-22.

This is the platform's plan — what ai-sdlc itself ships, when, and what "done" looks like for each phase. Testbed onboarding order is in [ROADMAP.md](./ROADMAP.md); architectural details are in [ARCHITECTURE.md](./ARCHITECTURE.md); requirements are tracked in [REQUIREMENTS.md](./REQUIREMENTS.md).

---

## Vision

Build an autonomous SDLC pipeline that ships a portfolio of personal products at engineering-team velocity with single-engineer overhead. Pipeline is multi-tenant from day 1 across 4-5 testbed projects. Trust expands based on measured defect data, not intuition. HITL gates calibrated to blast radius.

End state: 5 self-hosted products in production, all built and maintained by ai-sdlc, with the user reviewing only HITL gates (~5h/week).

---

## Success criteria — platform level

The pipeline is successful when:

| # | Criterion | Measurement |
|---|---|---|
| **G1** | Onboards a new project in <2 days of wall time | Wall clock from `sdlc onboard` to first feature epic merged |
| **G2** | 2+ projects managed concurrently without context bleed | Audit log shows clean separation; no cross-project commits |
| **G3** | ≥80% of merged commits are autonomous (Tier 3-4) | Audit log query: autonomous commits / total commits |
| **G4** | <1 production incident per quarter from agent-generated code | Manually tracked + RCA per incident |
| **G5** | HITL load <5h/week sustained | Self-reported time spent in dashboard |
| **G6** | Cost <$50/month (flat subscription model after Q-AI-2 amendment) | Anthropic + ChatGPT subs |
| **G7** | Cold-start TTHW <45 min (from fresh clone to first task ran) | `time` on the onboarding flow |
| **G8** | Audit replay works end-to-end | `pnpm sdlc replay <run-id>` produces deterministic output |

These are the hard gates for declaring v1 complete.

---

## Phase plan

### Phase 0 — GitHub presence + bootstrap (~1 week, week 0)

**Goal:** Reserve public artifacts (repo, profile, domain), establish issue/PR templates and labels for ai-sdlc itself.

| Deliverable | Path | Success criteria | Owner |
|---|---|---|---|
| Profile README revived | `github.com/piyushgupta27/piyushgupta27` | Public README live with positioning + projects + recognition | ✅ Done |
| ai-sdlc repo bootstrap | `github.com/piyushgupta27/ai-sdlc` | LICENSE (AGPL-3.0) + README + CONTRIBUTING + CoC + SECURITY + .gitignore committed and pushed | ✅ Done |
| Initial planning docs | This repo | 7 docs (PLAN, ARCHITECTURE, REQUIREMENTS, ONBOARDING, HITL, ROADMAP, DESIGN) | 🟡 In progress |
| Issue templates | `.github/ISSUE_TEMPLATE/` | bug, feature, epic, adr, discussion templates | Phase A |
| PR template | `.github/pull_request_template.md` | Structured template (epic link, AC, tier, audit run) | Phase A |
| Labels | GitHub labels API | tier:0/1/2/3/4, kind:*, status:*, area:* | Phase A |
| Branch protection on main | GitHub repo settings | Required CI checks, no direct push, linear history | Phase A |
| Domain registration | `piyushgupta.io` | Domain owned, parked on Cloudflare DNS | Pending (user) |

**Pass criteria for Phase 0:** ai-sdlc repo is public + has the planning suite + has hygiene files. GitHub profile signals the work.

### Phase A — Foundation (~2 weeks, weeks 1-3)

**Goal:** Orchestrator + 4 agents + multi-tenant infra + HITL queue + dashboard, all running end-to-end against ai-sdlc itself as the first testbed.

| Deliverable | Path | Success criteria | HITL load |
|---|---|---|---|
| Orchestrator skeleton | `tools/sdlc/orchestrator/` | Reads PLAN.md from any target repo; selects next task; spawns one agent; writes one audit row | High (design reviews) |
| Audit log writer (JSONL + hash chain) | `tools/sdlc/orchestrator/audit-log.ts` | Append-only; tampering detected; replay command works | — |
| Project namespace | `tools/sdlc/projects/` | Per-project config + state + prompts | — |
| PLANNER agent | `tools/sdlc/agents/planner/` | Given a one-line epic spec from a GitHub issue, produces structured tasks JSON | High |
| BUILDER agent | `tools/sdlc/agents/builder/` | Given a task, produces a passing commit on a feature branch in a worktree | High |
| SECURITY-REVIEWER | `tools/sdlc/agents/reviewer-fleet/security/` | Catches 5 seeded vulns in regression suite | High |
| CODE-QUALITY-REVIEWER | `tools/sdlc/agents/reviewer-fleet/code-quality/` | Catches 5 seeded anti-patterns in regression suite | High |
| AGGREGATOR + AI filter | `tools/sdlc/agents/aggregator/` | Drops ≥40% of seeded false positives; never drops a real critical | Medium |
| Three-layer enforcement (Layer 1+2) | `CLAUDE.md` Red zone format + `tools/check-blast-radius.sh` | Red zone write blocked; unblocked with valid HITL approval token | Medium |
| Three-layer enforcement (Layer 3) | `.github/workflows/blast-radius.yml` per onboarded repo | PR touching Red zone files requires `hitl-approved-tier-{0,1}` label | Medium |
| Model router | `tools/sdlc/router/select-model.ts` | Routes per §12.2 table; logs decision; logs cost per call | — |
| HITL queue | `.sdlc-queue/pending-hitl/` directory structure | Gate records (G1, G1.5, G2, G3, G5) written + read by dashboard | — |
| Dashboard | `tools/sdlc/dashboard/` Next.js app on :3001 | Shows HITL queue + active tasks + 7d defect rate (zero data ok) | — |
| GitHub Projects integration (Q-AI-21, R-AISDLC-100) | `tools/sdlc/orchestrator/github-projects.ts` | Reads/writes column state via gh CLI; onboarding creates project board with canonical columns | — |
| `pnpm sdlc lint` verb (Q-AI-22, R-AISDLC-101) | `tools/sdlc/cli/commands/lint.ts` | Surfaces vague tickets in Ready + proposed AC fixes; user approves before dispatch | — |
| PR iteration-history populator (Q-AI-23, R-AISDLC-102) | `tools/sdlc/agents/commit/pr-body.ts` | Auto-populates "Loop history" in PR body each cycle | — |
| Tier-aware retry policy (Q-AI-26, R-AISDLC-105) | `tools/sdlc/orchestrator/retry-policy.ts` | Per-tier budget; exhaustion → Block + G2 | — |
| `develop`-branch merge target (Q-AI-24, R-AISDLC-103) | onboarding flow + per-project config | Creates develop if absent; main requires manual PR from develop | — |
| Mobile dispatch via ntfy.sh (Q-AI-25, R-AISDLC-104) | `tools/sdlc/cli/commands/dispatch.ts` + webhook config | `pnpm sdlc dispatch --webhook <topic>` fires orchestrator headless | — |
| Slash command shortcuts (R-AISDLC-107) | `.claude/commands/sdlc-*.md` | Thin wrappers over CLI for interactive sessions | — |
| First end-to-end pipeline run (ai-sdlc as testbed) | Audit log entry for first toy task | One Tier 3 toy task (e.g. add a typo fix to README) merged via pipeline | Critical — G1 + G1.5 + G2 + G3 + G5 all exercised |
| Three-layer enforcement adversarial test | Audit log + RCA file | Manual attempt to write to `private/` blocked at all 3 layers | Critical |

**Phase A pass criteria:**
1. One Tier 3 task merged via the pipeline against ai-sdlc itself
2. All 5 HITL gates exercised at least once
3. Audit log queryable end-to-end
4. Three-layer enforcement adversarial test passes
5. Dashboard renders correctly with zero data and with data
6. Cost per Tier 3 task < $0.50
7. GitHub Project board reflects ticket's journey across columns (Ready → ... → Done)
8. `pnpm sdlc lint` flags a deliberately-vague test ticket with proposed AC fixes
9. PR body contains auto-populated "Loop history" section
10. Tier 0 retry cap (=0) tested: a deliberate Tier 0 build failure fires G2 immediately, no auto-retry

### Phase B — Testbed #1 (~1 week, week 4)

**Goal:** Onboard trip-research as the first real-product testbed. Run its first epic through the pipeline. Add 2 more reviewers.

| Deliverable | Success criteria | HITL load |
|---|---|---|
| Onboard trip-research | Phase 0-1 from ONBOARDING.md complete; symlink + CLAUDE.md + Red zone + CI workflows in place | High (G1.5 ADR for Red zone) |
| Execute trip-research MIGRATION.md | `~/Workspace/trip-research/` exists as standalone repo + symlink in local-vault; git-crypt key at `~/Workspace/.gitcrypt-key` | Tier 0 — explicit user "go" |
| BUG-DETECTOR (4.4c) added | Operational in fleet; catches 1+ seeded bug in regression | Medium |
| DESIGN-CONSISTENCY-REVIEWER (4.4d) added | Catches 1+ seeded token-violation in regression | Medium |
| TESTER agent | Produces tests achieving ≥70% coverage on changed files | High |
| DEMO agent | Playwright e2e produces video; visual diff threshold tuned | Medium |
| COMMIT + REPORTER agents | Auto-PR with PR body containing audit summary | Low |
| trip-research Phase 2 (test coverage) | trip-research's `src/` reaches 70% coverage via pipeline-written tests | High — G2 per task batch |
| trip-research Phase 3 (first feature epic) | One Tier 3 epic merged via pipeline with HITL at PLAN + REVIEW + COMMIT | Critical |
| 1 reclassification rehearsal | Demote a zone via §10.2; restore via §11.1; both audit rows present | Medium |

**Phase B pass criteria:**
1. trip-research is fully onboarded
2. trip-research's test coverage reaches 70% via pipeline
3. First feature epic merged via pipeline (all 5 HITL gates exercised)
4. Repo Readiness Score for trip-research reaches 70%

### Phase C — Testbed #2 (~2 weeks, weeks 5-6)

**Goal:** Onboard piyush-portfolio (greenfield) — interview-urgent. Validates "pipeline builds from zero."

| Deliverable | Success criteria | HITL load |
|---|---|---|
| Create `~/Workspace/piyush-portfolio/` (Next.js + MDX scaffold) | Empty repo with package.json + Next.js + MDX + Tailwind + shadcn | — (manual scaffold) |
| Onboard piyush-portfolio | Phase 0-1 from ONBOARDING.md complete | Medium |
| Pipeline builds portfolio v0.1 | Home page + 2 project case studies + 1 blog post live on piyushgupta.io | High — multi-epic |
| Vercel deployment pipeline | Auto-deploy on push to main | Auto |
| Open Graph image generation | Vercel OG generates social cards per post | Auto |

**Phase C pass criteria:**
1. piyushgupta.io is live
2. 2 project case studies + 1 blog post visible
3. Pipeline produced ≥60% of the code
4. Domain DNS routed correctly

### Phase D — Steady state with 3 projects (~4 weeks, weeks 7-10)

**Goal:** Onboard career-automation (testbed #3). Pipeline manages 3 projects in parallel. Trust expands based on accumulated data.

| Deliverable | Success criteria |
|---|---|
| Onboard career-automation | Phase 0-3 from ONBOARDING.md complete |
| Trust state machine reaches `SUPERVISED → TRUSTED-LOW` for trip-research | 20+ tasks in zone processed; 0 incidents; ≥85% coverage; user sign-off recorded |
| Repo Readiness Score reaches 80% for all 3 projects | `pnpm sdlc readiness` returns ≥80 per project |
| Cohort tracking demonstrated | At least 1 prompt revision A/B-tested with measured outcome |
| Prompt caching ≥80% hit rate | Dashboard metric panel populated |

**Phase D pass criteria:** ≥80% of merged commits across all 3 projects are autonomous (Tier 0/1 excluded from denominator).

### Phase E — Scale to 4-5 projects + v1.5 fleet (~weeks 11+)

**Goal:** Onboard ai-finance-tracker + ai-health-agent. Add v1.5 reviewer fleet members.

| Deliverable | Success criteria |
|---|---|
| Onboard ai-finance-tracker | Phase 0-3 complete |
| Onboard ai-health-agent | Phase 0-3 complete |
| PERF-REGRESSION-REVIEWER (4.4e) added | Catches 3 seeded perf regressions in regression suite |
| I18N / COPY-REVIEWER (4.4f) added | Catches 3 seeded i18n issues in regression suite |
| Capability registry pattern | Reviewer fleet, hooks, audit format versioned + reusable |
| v1.0 release | Tagged release with changelog; SECURITY.md updated; CHANGELOG.md complete |

**Phase E pass criteria:** All 8 success criteria (G1-G8) above are met. v1.0 declared.

---

## Bootstrap order — first commits to ai-sdlc

The order of work for Phase A specifically:

1. **Week 1, day 1:** This commit (planning docs + hygiene) — ✅ Done
2. Week 1, days 2-4: Orchestrator skeleton + audit log writer + project namespace
3. Week 1, days 5-7: PLANNER agent + BUILDER agent + first end-to-end run against ai-sdlc itself
4. Week 2, days 1-3: SECURITY-REVIEWER + CODE-QUALITY-REVIEWER + AGGREGATOR
5. Week 2, days 4-7: Three-layer enforcement + adversarial test
6. Week 3, days 1-4: Model router + dashboard + HITL queue
7. Week 3, days 5-7: End-to-end Tier 3 toy task with all 5 HITL gates

By end of week 3, Phase A is done.

---

## Out of scope for v1

The following are explicitly NOT in v1 (deferred per Q-AI-* or labeled R-FUT-*):

- Multi-machine pipeline orchestration (single-Mac only)
- SaaS-hosted ai-sdlc (others can self-host via AGPL, but no managed offering)
- Web-based onboarding UI (CLI only)
- IDE integration (VS Code extension, JetBrains plugin)
- Mobile app for HITL gate review (macOS dashboard only)
- Open-sourcing the testbeds' code (only ai-sdlc + portfolio are public)
- Multi-user / team ai-sdlc deployments
- Integration with Linear / Jira / Notion (GitHub Issues only)
- Real-time monitoring dashboards beyond what Vercel Analytics provides

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Phase A takes >3 weeks; product delivery feels stalled | A19 [CORE] auto-invalidation trigger fires; re-plan ai-sdlc, trip-research continues manually |
| Reviewer fleet false-positive rate too high (>40%) | AI filter layer recalibrates; cohort of prompts versioned; if persistent, drop reviewer pending fix |
| Claude Code Subagent rate limits hit | Pipeline rate-limits itself; cron jobs spread; batch agent calls where possible |
| Pipeline writes a bug to main that reaches user (G5 caught it) | Contraction protocol: demote tier; RCA; prompt versioning |
| Cookie leak from a testbed | Three-layer enforcement should catch; if missed, force-rewrite history + rotate cookies + add new Red zone rule |
| Cost runaway from runaway agent loop | Per-task budget cap; orchestrator kills agent after $1 per task / $20 per epic |
| User unavailable (vacation) → HITL queue grows | `pnpm sdlc vacation` mode; queue holds; no notifications fire |
| ai-sdlc's own tests not maintained | Phase 2 test-debt rule applies to ai-sdlc itself recursively (yes, the platform tests itself) |

---

## Update policy

- Phase deliverables move from "Not started" → "🟡 In progress" → "✅ Done"
- New deliverables added in new commits with a note in the change log below
- Pass criteria can be tightened (raise the bar) but not loosened without ADR + G1.5 approval

## Change log

| Date | Change |
|---|---|
| 2026-05-22 | Initial draft. Phase 0 in progress (this commit). |

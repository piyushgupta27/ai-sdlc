# ai-sdlc · Roadmap 2026 — Issue Execution Plan

**Last updated:** 2026-06-18  
**Status:** Plan confirmed, pending GitHub execution (milestones not yet created; all issues at milestone: none)  
**Source:** Distilled from `docs/boulders.md`, pre-compact session analysis, and live issue audit against GitHub.  
**Companion doc:** `docs/boulders.md` — strategic context and rationale for each boulder/priority.

**Document authority:** This file is the canonical execution plan for 2026. `docs/boulders.md` is the forward-looking strategic view. `ROADMAP.md` and `PLAN.md` are retrospective Phase A records (stale as forward roadmap — see docs-currency-sprint issue in July section). When docs conflict, this file and `docs/boulders.md` take precedence.

---

## Milestone Structure

| Milestone | Due date | Theme | Gate | Sequence rule |
|---|---|---|---|---|
| **July 2026** | 2026-07-31 | Safety floor + pipeline stability | All `phase:0-floor` security items + blocking bugs | Before any autonomous dispatch |
| **August 2026** | 2026-08-31 | Intake discipline + operational foundation | DoR gate, onboarding hardening, weekly rhythm | Before scaling dispatch volume |
| **September 2026** | 2026-09-30 | North star becomes visible | TEAM-LEAD, evidence bundle, dashboard, unattended runner | First auto-merge; metric measured |
| **October 2026** | 2026-10-31 | Quality measurement + portfolio delivery | Eval harness, CONTEXT.md enforcement, piyush-portfolio live | Publishable quality claim |
| **November 2026** | 2026-11-30 | Trust automation + fleet hardening | Auto-promotion, cross-vendor reviewer, always-on verification | Trust machine drives itself |
| **December 2026** | 2026-12-31 | Scale primitives | Audit chain safety, MicroVM sandbox, ApFS worktree | Multi-task parallelism foundations |
| **Q1 2027** | 2027-03-31 | Durable execution + concurrent dispatch | DBOS, event-sourced replay, concurrent dispatch | Crash-safe; deterministic debug; parallelism |

**Sequencing invariant:** Every `phase:0-floor` issue must land before the first unattended-autonomy feature (first auto-merge in September). Issues labeled both `phase:0-floor` and `autonomy` are prerequisites for themselves — they enable the pattern.

---

## July 2026 — Safety Floor + Pipeline Stability

**Goal:** Pipeline reliable and safe on all 4 onboarded projects. No active security bypasses. Blocking bugs cleared.

**Capacity note:** 16 existing issues are milestone assignments, not new engineering sprints — most are already in-flight or small. New engineering work: clear #83 (active bypass), triage sprint (90 min), docs sprint. Load is manageable.

### Existing issues to update

| # | Title (abbreviated) | Milestone | Label changes |
|---|---|---|---|
| #83 | Platform-hardened blast-radius enforcement | July 2026 | add `security` (has `phase:0-floor` only) |
| #121 | Hard-block agent from governance labels | July 2026 | add `tier:1`, `phase:0-floor` (has `security` only) |
| #9 | Mechanize the approval gate | July 2026 | no label changes (has `tier:1,security,phase:0-floor`) |
| #11 | CI security gates (secret-scan + SAST + dep-audit) | July 2026 | add `phase:0-floor` (has `tier:2,security`) |
| #13 | SHA-pin pnpm/action-setup in ci.yml | July 2026 | no label changes (has `tier:3,security`) |
| #14 | Moderate dev-dep CVEs | July 2026 | no label changes (has `tier:4,security`) |
| #113 | pnpm build-script approval in sandbox | July 2026 | no label changes (has `bug,tier:1`) |
| #114 | BUILDER ignores AC artifact shape | July 2026 | no label changes (has `bug,tier:1`) |
| #16 | BUILDER post-commit hang (300s timeout) | July 2026 | no label changes (has `tier:2`) |
| #15 | `--theirs` rebase silently reverts upgrades | July 2026 | no label changes (has `tier:2`) |
| #77 | agent.invalid-response hard-fails a converged task | July 2026 | no label changes (has `tier:2`) |
| #53 | sdlc doctor reads stale local checkouts | July 2026 | no label changes (has `bug,stage-2-dogfood`) |
| #37 | Platform artifact dirs cause false gate failures | July 2026 | no label changes (has `bug,stage-2-dogfood`) |
| #39 | Retire develop-branch requirement | July 2026 | add `bug` (has `stage-2-dogfood` only) |
| #2 | Update README status — Phase A is shipped | July 2026 | no label changes (has `tier:3`) |
| #1 | Add a typo fix to README | July 2026 | no label changes (has `tier:4`) |

### New issues to create

| Title | Labels | Notes |
|---|---|---|
| Issue triage sprint — label, milestone, close stale | `documentation` | 90-min session; turns 60+ open issues from noise to signal |
| Docs currency sprint — ROADMAP.md + PLAN.md reflect current state | `documentation`, `tier:4` | May 2026 spec says Phase A "not started"; update retrospective view |

---

## August 2026 — Intake Discipline + Operational Foundation

**Goal:** No dispatch without a ready ticket. Human has a defined weekly workflow. Runtime hardened before scaling.

**Capacity note:** 16 existing issues assigned here; the onboarding cluster (#34/#35/#41/#47/#50) is the largest block. B1 (DoR gate = #116) and B4 long-term prep (#88 pre-work) are the heaviest. `#10` (runtime hardening) is the last `phase:0-floor` item — clears here, not July, because it's deeper runtime work than the quick security fixes.

### Existing issues to update

| # | Title (abbreviated) | Milestone | Label changes |
|---|---|---|---|
| #10 | Agent runtime hardening + egress allow-list | August 2026 | add `phase:0-floor` (has `tier:1,security`) |
| #116 | RC2: Intake discipline (DoR gate) | August 2026 | no label changes (has `enhancement,tier:1`) |
| #109 | Dispatch conflates EPIC=STORY=TASK | August 2026 | no label changes (has `enhancement,tier:1`) |
| #91 | PLANNER bulk-decomp + one-click epic approval | August 2026 | no label changes (has `enhancement,autonomy,phase:2-demand`) |
| #52 | Dispatch must gate on project contract | August 2026 | add `enhancement`, `tier:2` (unlabeled) |
| #50 | Evaluate sdlc doctor + harden | August 2026 | no label changes (has `enhancement`) |
| #41 | Onboarding force-propagates ruleset | August 2026 | no label changes (has `enhancement,stage-2-dogfood`) |
| #47 | Extend onboarding + sdlc doctor | August 2026 | no label changes (has `enhancement`) |
| #35 | onboard Phase 1 scaffolding not implemented | August 2026 | no label changes (has `enhancement,tier:1`) |
| #34 | Harden onboarding: install safety gates | August 2026 | no label changes (has `enhancement,tier:1`) |
| #31 | Runtime-validate agent output envelopes (zod) | August 2026 | no label changes (has `tier:2`) |
| #30 | Transport hardening follow-ups | August 2026 | no label changes (has `tier:2`) |
| #64 | Surface CLI error subtype distinctly | August 2026 | add `tier:2` (unlabeled) |
| #65 | Test coverage for validationCommands threading | August 2026 | add `tier:2` (unlabeled) |
| #66 | TESTER coverage-floor self-check validationCommands | August 2026 | add `tier:2` (unlabeled) |
| #111 | Standardize continuation docs into private vault | August 2026 | no label changes (has `enhancement`) |

### New issues to create

| Title | Labels | Notes |
|---|---|---|
| Weekly operational rhythm — Sunday roadmap ritual + daily review digest | `enhancement`, `phase:2-demand` | Design the human-side workflow; without it "≤1h/day" is aspirational |
| CHECKER 2-option gate completion standard | `enhancement`, `tier:2` | Prevent gate boundary improvisation; from awslabs pattern |
| Per-agent iteration caps — complement global retry budget | `enhancement`, `tier:2` | BUILDER tier:0/1 max 5 tool-call iterations; TESTER max 3 |

---

## September 2026 — North Star Becomes Visible

**Goal:** First Tier 3/4 auto-merge. `merged-PRs / review-hour` measured for the first time.

**Intra-month dependency:** Within September, the floor items (#86/#80/#25 — evidence gates) must land before the autonomy features (#88 unattended runner, #21 CHECKER/TEAM-LEAD, #90 trust gate at merge time). Monthly granularity hides this; treat the evidence cluster as Week 1-2 and the autonomy features as Week 3-4.

### Existing issues to update

| # | Title (abbreviated) | Milestone | Label changes |
|---|---|---|---|
| #86 | Signed gate-evidence bundle + verifier | September 2026 | no label changes (has `enhancement,tier:1,security,phase:0-floor`) |
| #80 | Independent review evidence gate | September 2026 | no label changes (has `enhancement,tier:1,security,phase:0-floor`) |
| #25 | Trusted test-evidence artifacts (sandbox-signed) | September 2026 | no label changes (has `enhancement,phase:0-floor`) |
| #88 | Unattended scheduled dispatch runner | September 2026 | no label changes (has `enhancement,autonomy,phase:0-floor`) |
| #21 | Build CHECKER + TEAM-LEAD (Stage 1) | September 2026 | no label changes (has `enhancement,autonomy,phase:2-demand`) |
| #90 | Relocate trust gate to merge-time | September 2026 | no label changes (has `enhancement,tier:1,phase:2-demand`) |
| #89 | OTel + 6 KPI dashboard | September 2026 | no label changes (has `enhancement,phase:1-visibility`) |
| #48 | Actionable G2 notifications (ntfy Approve/Reject) | September 2026 | no label changes (has `enhancement,phase:2-demand`) |
| #104 | Trust-enablement: evidence-rich PR review | September 2026 | no label changes (has `enhancement,tier:1`) |

### New issues to create

| Title | Labels | Notes |
|---|---|---|
| Ranked review digest — batched prioritized PR review surface | `enhancement`, `phase:2-demand` | Sort open PRs by tier×staleness; surface in daily ntfy; distinct from #48 (buttons); source: `docs/reviews/2026-06-16-competitive-review-v2.md` §Razorpay |

---

## October 2026 — Quality Measurement + Portfolio Delivery

**Goal:** Publishable quality benchmark. Portfolio live at piyushgupta.io. CONTEXT.md moat enforced.

### Existing issues to update

| # | Title (abbreviated) | Milestone | Label changes |
|---|---|---|---|
| #92 | Eval harness (golden-set + semantic AI eval) | October 2026 | no label changes (has `enhancement,autonomy,phase:3-trust`) |
| #79 | Quality-gate enforcement layer (hard gates) | October 2026 | no label changes (has `enhancement,tier:1,security`) |
| #115 | RC1: Always-on machine verification | October 2026 | no label changes (has `enhancement,tier:1`) |
| #75 | TRD standard for Tier 0/1 | October 2026 | no label changes (has `enhancement,tier:1`) |
| #74 | Codify the engineering lifecycle | October 2026 | no label changes (has `enhancement,tier:1`) |
| #82 | Coverage floor unreachable for browser-glue | October 2026 | add `bug`, `tier:2` (unlabeled) |
| #22 | Preflight health check before agent work | October 2026 | no label changes (has `enhancement,autonomy`) |
| #24 | Tier-calibrated skip of H-phase re-verify | October 2026 | no label changes (has `enhancement`) |
| #3 | Per-project AI SDLC status dashboard (terminal TUI) | October 2026 | add `phase:1-visibility` (has `enhancement`) |
| #120 | Platform versioning + distribution | October 2026 | no label changes (has `enhancement`) |
| #101 | Enforce UI-testing gate for UI-class repos | October 2026 | no label changes (has `enhancement,tier:1`) |

### New issues to create

| Title | Labels | Notes |
|---|---|---|
| piyush-portfolio Phase 1 — homepage + 2 case studies live on piyushgupta.io | `enhancement` | Interview-urgent since May 2026; pipeline-built showcase; moved here from September — October's theme fits product delivery better |
| CONTEXT.md bubble-up enforcement — mechanize API change → parent update rule | `enhancement`, `tier:2` | Pre-commit hook; keyword-triggered context injection; source: `docs/reviews/2026-06-16-research-appendix.md` §B.4 (OpenHands microagent pattern) |
| Monthly prompt quality cadence — CHECKER verdicts → agent prompt improvements | `enhancement`, `phase:3-trust` | No tooling required; monthly ritual; starts generating signal that #92 eval harness will later automate |

---

## November 2026 — Trust Automation + Fleet Hardening

**Goal:** Trust expands without manual steps. Structural reviewer independence. Second model catches Claude blind spots.

### Existing issues to update

| # | Title (abbreviated) | Milestone | Label changes |
|---|---|---|---|
| #93 | Cross-vendor final reviewer | November 2026 | no label changes (has `enhancement,tier:1,phase:3-trust`) |
| #20 | Per-repo runtime contract (auto-selected) | November 2026 | no label changes (has `enhancement,autonomy`) |
| #23 | Codify the critical-interrupt taxonomy | November 2026 | no label changes (has `enhancement,autonomy`) |
| #17 | TESTER verify production Vercel deploy state | November 2026 | no label changes (has `tier:2`) |
| #51 | Phase 2: strong auth for the dashboard | November 2026 | no label changes (has `enhancement,security`) |

### New issues to create

| Title | Labels | Notes |
|---|---|---|
| Automated trust promotion — logic to advance TrustState from empirical criteria | `enhancement`, `tier:1`, `phase:3-trust`, `autonomy` | Trust machine is built; auto-promotion logic isn't; requires B3 eval harness data; distinct from #104 (richer review content) and #90 (gate placement) |

---

## December 2026 — Scale Primitives

**Goal:** Audit chain safe for concurrent writes. Sandbox path decided and scaffolded. Foundations ready for Q1 concurrent dispatch.

**Note:** `#73` (concurrent dispatch) moved to Q1 2027 — it requires `#95` (DBOS durable execution) as a prerequisite per B9 sequencing. December lays the foundations (#70, #71, #72); concurrent dispatch ships after DBOS lands.

### Existing issues to update

| # | Title (abbreviated) | Milestone | Label changes |
|---|---|---|---|
| #70 | Audit-chain concurrency safety | December 2026 | no label changes (has `enhancement,tier:1,autonomy,phase:4-scale`) |
| #72 | ApfsCloneSandbox (copy-on-write worktree) | December 2026 | add `phase:4-scale` (has `enhancement,tier:2,autonomy`) |
| #71 | MicroVmSandbox provider | December 2026 | no label changes (has `enhancement,tier:1,security,autonomy,phase:4-scale`) |
| #96 | Event-driven dispatch (GitHub webhook → workflow) | December 2026 | no label changes (has `enhancement,autonomy,phase:4-scale`) |
| #98 | Per-tenant usage attribution + sub-budgets | December 2026 | no label changes (has `enhancement,phase:4-scale`) |

---

## Q1 2027 — Durable Execution + Concurrent Dispatch

**Goal:** Crash-safe overnight runs. Concurrent task parallelism enabled. Deterministic debug of any pipeline run.

**Dependency order within Q1:** `#95` (DBOS) → `#73` (concurrent dispatch). `#73` is blocked on DBOS because long-running concurrent tasks need crash-safe checkpointing to be safe to restart.

### Existing issues to update

| # | Title (abbreviated) | Milestone | Label changes |
|---|---|---|---|
| #95 | DBOS durable execution | Q1 2027 | no label changes (has `enhancement,tier:1,phase:4-scale`) |
| #73 | Concurrent dispatch | Q1 2027 | add `phase:4-scale` (has `enhancement,tier:1,autonomy`) — **moved from December; requires #95** |
| #97 | Self-host full dogfood loop | Q1 2027 | no label changes (has `enhancement,autonomy,phase:4-scale`) |

### New issues to create

| Title | Labels | Notes |
|---|---|---|
| `pnpm sdlc replay <run-id>` — deterministic event-sourced replay (AC-12) | `enhancement`, `tier:1`, `autonomy` | Type every orchestrator decision as a typed event; state reconstruction is a pure function of the event log; source: `docs/reviews/2026-06-16-research-appendix.md` §B.2 (OpenHands V0→V1 migration) |

---

## Execution Checklist

Pre-execution (not yet done):
- [ ] Commit + push `docs/boulders.md`, `docs/roadmap-2026.md`, `docs/reviews/2026-06-16-*.md` — so GitHub issue body links resolve
- [ ] Create 7 milestones (July 2026 → Q1 2027)

GitHub operations:
- [ ] Create 11 new issues (marked above under each milestone)
- [ ] Update ~55 existing issues: set milestone + label corrections

---

## Issue Count Summary

| Milestone | Existing issues | New issues | Total |
|---|---|---|---|
| July 2026 | 16 | 2 | 18 |
| August 2026 | 16 | 3 | 19 |
| September 2026 | 9 | 1 | 10 |
| October 2026 | 11 | 3 | 14 |
| November 2026 | 5 | 1 | 6 |
| December 2026 | 5 | 0 | 5 |
| Q1 2027 | 3 | 1 | 4 |
| **Total** | **65** | **11** | **76** |

*Changes from initial plan: piyush-portfolio moved September→October (thematic fit); #73 moved December→Q1 2027 (requires #95 DBOS as prerequisite per B9). Total count unchanged.*

---

## New Issue Bodies

Full body text for the 11 new issues to create. Use verbatim when running `gh issue create`.

---

### July — Issue triage sprint

**Labels:** `documentation`  
**Milestone:** July 2026

60+ open issues are unlabeled and unphased. The stage-2 dogfood bugs (#53, #37, #39) and security cluster (#83, #9, #10, #11) were both buried in unlabeled backlog and would have been missed without a manual audit. A single 90-minute session clears the noise.

**Work:**
- Close issues superseded by shipped PRs (comment "closing: superseded by #N")
- Add `phase:*` labels to everything unlabeled
- Assign milestones per `docs/roadmap-2026.md`
- Convert legitimate issues to boulder-linked work items where applicable
- Close speculative issues from 2025+ with no champion (comment "closing: stale, no champion — reopen if this becomes relevant")

**Exit criteria:** Every open issue has at minimum one label and one milestone (or explicit `backlog` tag). No issues older than 6 months without a label.

---

### July — Docs currency sprint

**Labels:** `documentation`, `tier:4`  
**Milestone:** July 2026

`ROADMAP.md` and `PLAN.md` were written in May 2026. They describe Phase A as "not started" and features like the hash-chain audit log and 5-state trust machine as "v1.5+ (not yet built)" — both are now running. Any new collaborator or future session reading these docs gets a misleading picture.

**`docs/boulders.md`** and **`docs/roadmap-2026.md`** now cover the forward-looking view. ROADMAP.md and PLAN.md should cover the retrospective view accurately.

**Work:**
- Mark Phase A complete in ROADMAP.md with actual ship date
- Promote "v1.5+ not built" items that have shipped to "shipped in Phase A"
- Link ROADMAP.md forward roadmap section → `docs/boulders.md`
- Add a "current state" snapshot table (matches the one in boulders.md intro)
- `#2` (Update README status) is a sub-task of this sprint

**Exit criteria:** A reader of ROADMAP.md can accurately understand what shipped in Phase A and where to find the forward roadmap.

---

### August — Weekly operational rhythm

**Labels:** `enhancement`, `phase:2-demand`  
**Milestone:** August 2026

The DoD vision says "set roadmap Sunday, bulk-approve epics in 30 min, spend ≤1h/day on review digest." But what exactly happens Sunday, what the review digest looks like, how G2 items are cleared, what the batch-approval flow looks like — is entirely undefined. Without a practice, the human defaults to ad-hoc interrupts and the north star metric stays invisible.

**Design needed (no new tooling required — use what exists):**
1. **Sunday ritual:** How PLANNER decompositions are reviewed and bulk-approved. How the Ready queue is populated. What signals indicate "ready to dispatch."
2. **Daily review digest:** How G2 items are prioritized. What the ntfy notification contains (#48). What "approve" triggers.
3. **Weekly KPI check:** Which 6 metrics (#89 dashboard) to look at. What thresholds signal a week worth investigating.

**Deliverable:** A written 1-2 page practice doc (`docs/practices/weekly-rhythm.md`) describing the weekly cadence, with actions mapped to the platform tools.

**Exit criteria:** The practice doc exists and has been run for at least one full week. The human's review time is tracked for the first time.

---

### August — CHECKER 2-option gate completion standard

**Labels:** `enhancement`, `tier:2`  
**Milestone:** August 2026  
**Research source:** `docs/reviews/2026-06-16-extended-research.md` §1 — awslabs/aidlc-workflows "standardized completion messages" pattern

At every gate boundary, CHECKER must choose from exactly `{PASS, REFIRE, ESCALATE}` with a structured reason. Currently the CHECKER system prompt is not explicit about this format, allowing the model to add narrative or invent intermediate states. This is a gate-boundary improvisation risk.

**Implementation:**
1. Add a standardized completion format to the CHECKER system prompt: (a) one of three exact verdict strings, (b) a `reason` field (≤100 words), (c) a structured diff of what changed vs. expected AC
2. Wire the dispatch layer to reject any CHECKER output that doesn't match this schema — use the existing zod boundary validation from `#31`
3. Add a test fixture for each verdict type

**Exit criteria:** CHECKER output is zod-validated at the dispatch boundary. A malformed verdict causes a structured `REFIRE` with `error_code: invalid_checker_output`, not a crash.

---

### August — Per-agent iteration caps

**Labels:** `enhancement`, `tier:2`  
**Milestone:** August 2026  
**Research source:** `docs/reviews/2026-06-16-research-appendix.md` §A.4 — CrewAI `max_iter` pattern

`MAX_RETRIES_V1=3` is a full-pipeline retry count (BUILDER → TESTER → REVIEWER → CHECKER cycle). It does not limit within-turn tool-call loops. An agent can read the same file in a loop, or make 20 tool calls in one turn, without hitting any cap. This allows the "reading in circles" failure mode.

**Add per-role caps (distinct from and complementary to the existing `noProgressTimer`):**
- BUILDER on Tier 0/1: max 5 consecutive tool-call iterations before escalation to HITL G2 with `agent_stuck` reason
- BUILDER on Tier 2-4: max 8 iterations
- TESTER: max 3 iterations
- REVIEWER/CHECKER: unlimited (they read, don't write in loops)

`noProgressTimer` is time-based; these are call-count-based. Both are needed.

**Exit criteria:** A BUILDER that loops on the same file 6 times on a Tier 1 task is escalated to HITL with `agent_stuck` rather than running indefinitely.

---

### September — Ranked review digest

**Labels:** `enhancement`, `phase:2-demand`  
**Milestone:** September 2026  
**Research source:** `docs/reviews/2026-06-16-competitive-review-v2.md` §Razorpay — 67% of 1,000 PRs/week routed to ranked digest; 33% auto-merged

As PR throughput increases, the human reviewer needs a prioritized view of what to review next, not a raw GitHub notifications list. The "≤1h/day review" north-star target requires batching and prioritization.

**Distinct from `#48`:** `#48` is the Approve/Reject button infrastructure (ntfy action). This issue is the ranking + batching logic that decides *what* the button is for.

**Design:**
1. Daily or per-dispatch digest that ranks open PRs by `tier × staleness × blast-radius`
2. Surfaces the top 3-5 for immediate action
3. Includes quick-approve links for Tier 3/4 items via `#48`'s ntfy action buttons
4. Archived digest in `docs/reviews/digests/YYYY-MM-DD.md` for weekly KPI check

**Exit criteria:** Human receives one ranked digest notification per day (not per-PR). The digest correctly surfaces highest-tier + most-stale PRs first. Review time per PR is measurably tracked.

---

### October — piyush-portfolio Phase 1

**Labels:** `enhancement`  
**Milestone:** October 2026

piyush-portfolio is the primary product testbed and interview-urgent deliverable. The platform exists to build products; the portfolio is the most immediate one. Has been "interview-urgent (4-8 weeks)" since May 2026. No user-visible features have shipped. This is a pipeline showcase — build it with the pipeline, not around it.

**Phase 1 scope:**
1. Homepage live at piyushgupta.io with: hero section, about, project list
2. Two case studies: (a) ai-sdlc pipeline — the meta-case (built by the pipeline, case study about the pipeline); (b) one other product built with it
3. Responsive design, no broken links, Vercel deployment
4. Fast — Lighthouse performance ≥90

**Exit criteria:** Live URL accessible. Content accurate (no placeholder text). Mobile-responsive. At least one case study published with the ai-sdlc pipeline story. Vercel preview → production deploy via the pipeline itself.

---

### October — CONTEXT.md bubble-up enforcement

**Labels:** `enhancement`, `tier:2`  
**Milestone:** October 2026  
**Research source:** `docs/reviews/2026-06-16-research-appendix.md` §B.4 — OpenHands microagent pattern (keyword-triggered context injection)

When a leaf module changes its public API (exported functions, types, constants), the co-located `CONTEXT.md` must update in the same commit. Currently enforced by agent instruction only — no mechanical check. Silent drift is possible whenever an agent skips the context update.

**Implementation:**
1. Pre-commit hook: detect exported symbol additions/removals in changed `.ts` files; verify the co-located `CONTEXT.md` was also modified; fail with a clear message if not
2. CI step running the same check on PRs (Layer 3 enforcement)
3. Keyword-triggered context injection: when a task description contains module-name keywords ("router", "audit", "auth"), automatically inject the relevant `CONTEXT.md` into the agent's context — reduces context budget vs. always-load-all

**Exit criteria:** A PR that adds an exported function without updating the co-located `CONTEXT.md` fails the pre-commit hook and CI. The keyword injection fires for at least 3 distinct module keywords.

---

### October — Monthly prompt quality cadence

**Labels:** `enhancement`, `phase:3-trust`  
**Milestone:** October 2026

No defined practice for reviewing and improving agent prompts. If BUILDER consistently makes the same class of mistake (wrong artifact shape, wrong scope), no systematic process exists to catch and fix it. The eval harness (`#92`) will eventually surface this automatically; until then, it needs a manual ritual.

**Practice (monthly, ~1-2 hours; no new tooling required):**
1. Read the last 30 days of `ESCALATE` and `REFIRE` verdicts from the audit log
2. Group by agent (BUILDER vs. TESTER vs. REVIEWER)
3. Identify the top 2-3 recurring failure patterns per agent
4. Update the relevant agent's system prompt to address the pattern (bump prompt version)
5. Commit the prompt change with a version bump; record in `docs/practices/prompt-quality-log.md`

**Exit criteria:** The practice has run for 1 full month. At least one agent system prompt has been updated based on audit log evidence. `docs/practices/prompt-quality-log.md` exists with the first entry.

**Connection to `#92`:** Running this ritual for 3-6 months before building the eval harness means you know what the harness needs to measure and which patterns to include in the golden set.

---

### November — Automated trust promotion

**Labels:** `enhancement`, `tier:1`, `phase:3-trust`, `autonomy`  
**Milestone:** November 2026  
**Research source:** `docs/reviews/2026-06-16-research-appendix.md` §B.2 — OpenHands agent capability assessment methodology

The 5-state trust machine is built in `tools/sdlc/trust-gate.ts` with MANUAL → SUPERVISED → TRUSTED_LOW → TRUSTED_MID → STEADY_STATE transitions and tier-calibrated thresholds. What's missing: logic to automatically advance trust state when the empirical criteria are met.

**Distinct from:**
- `#104` (richer PR review to *build* trust faster — that's the input side)
- `#90` (trust gate placement at merge time — that's where the gate fires)
- This issue: the promotion logic itself (measure → propose → approve)

**Implementation:**
1. Nightly/weekly job reads audit log + eval harness results (`#92`)
2. For each project×tier: check criteria (20+ tickets processed, 0 incidents, ≥85% coverage, owner sign-off recorded)
3. When criteria met: queue a "trust promotion proposal" to HITL G2 queue — human approves or rejects
4. Machine does the measurement and paperwork; human makes the trust decision

**Prerequisites:** `#92` (eval harness) must have ≥1 month of data. `#89` (6-KPI dashboard) must be running.

**Exit criteria:** A promotion proposal is generated for at least one project×tier that meets criteria. The proposal appears in the HITL G2 queue. A human approval advances the trust state.

---

### Q1 2027 — `pnpm sdlc replay <run-id>`

**Labels:** `enhancement`, `tier:1`, `autonomy`  
**Milestone:** Q1 2027  
**Research source:** `docs/reviews/2026-06-16-research-appendix.md` §B.2 — OpenHands V0→V1 migration (event-sourced state convergence)

AC-12 from PLAN.md. Any pipeline run should be deterministically replayable for debugging. Currently the audit log is a JSONL log but doesn't support event-sourced state reconstruction — `state.json` is an independent mutable file, not derived from the log.

**Implementation path:**
1. Type every orchestrator decision as a discriminated union (`AgentStarted`, `ToolCalled`, `GateDecision`, `HITLQueued`, `TrustTransition`, etc.) in `tools/sdlc/types/events.ts`
2. Remove `state.json` mutation; derive all state by replaying the event log from the start of the run
3. Add `pnpm sdlc replay <run-id>` CLI command: loads event log, reconstructs state up to any point
4. Add `--from-event N` flag for partial replay (debug from a specific decision point)
5. Add `--dry-run` flag: replay without re-executing agent calls (state reconstruction only)

**Prerequisites:** Audit log extended with typed events (currently stores text-formatted JSONL). Heavy migration; schedule for Phase 4 after DBOS (#95) lands.

**Exit criteria:** `pnpm sdlc replay <run-id>` produces identical final state to the original run for any run in the last 30 days. `--from-event N` allows partial reconstruction.

# ai-sdlc · Strategic Boulders

**Last updated:** 2026-06-18
**Source:** Distilled from four 2026-06-16 deep-review documents (system review, competitive review, extended research, research appendix). Evidence lives in vault at `projects/active/ai-sdlc/research/competitive-review-2026-06-16/`. This is the working decision surface — not a spec, not a backlog. The right document to open at the start of a session to decide what to pick up next.

**North star:** `merged-PRs / review-hour` (human leverage, not agent throughput)

---

## Current State Snapshot

What exists and runs today (confirmed from code, not spec):

| Layer | Status | Notable |
|---|---|---|
| Pipeline (BUILDER→TESTER→REVIEWER→CHECKER) | ✅ Running | 4 projects onboarded; PR #99 = first autonomous self-dispatch |
| 5-state trust machine | ✅ Running | `trust-gate.ts`; tier×state threshold table fully wired |
| Hash-chained audit log | ✅ Running | sha256 chain; `.chain-tip.json`; tamper-evident |
| Rollback machinery | ✅ Built | `rollback.ts`; no competitor has this |
| Progress watchdog | ✅ Running | PR #127; noProgressTimer tier-aware (180/300/500s) |
| Pre-PR validation gate | ✅ Running | PR #128; red CI blocks push; card → Blocked |
| HITL (G2 only) | ✅ Running | G1/G1.5/G3/G5 not yet active |
| PLANNER agent | ⚠️ Built, not wired | Directory exists; `runTask()` bypasses it (#109) |
| TEAM-LEAD agent | ❌ Not built | Biggest missing lever for north star |
| Eval harness | ❌ Not built | North star and trust expansion are both blind without it |
| Observability (KPIs) | ❌ Not built | 6 metrics in spec; none visible in real time |
| DoR gate | ❌ Not built | Pre-dispatch readiness scoring; highest-leverage gap |
| Signed evidence bundle | ❌ Not built | #86; prerequisite for merge-time gating |
| Automated trust promotion | ❌ Not built | Trust machine is built; the auto-promotion logic isn't |

**Operational mode today:** HYBRID. Tier-4 chores auto-flow; anything larger is supervised. Unattended overnight dispatch is not safe until #88 (Mac sleep / durable execution).

---

## Build Philosophy + Phase Model

### One repo — scope grows by phases, not forks

ai-sdlc's build strategy is a single public repo that advances through 4 phases, not a series of separate projects or prototypes. Phases are **scope gates**, not forks: Phase 0 code stays in main; Phase 1 adds on top of it; each phase makes the previous phase demonstrably more robust. This means:

- Every commit is portfolio signal — the git history IS the proof of progression
- No "rewrite from scratch for the production version" — architectural decisions must survive to Phase 4
- Phase graduation criteria: the previous phase's RISKS are resolved, not just its features shipped

### Phase curriculum (build target → skill developed)

| Phase | Milestone | Build Target | Skill Developed |
|---|---|---|---|
| **0** | July 2026 | Safety floor: budget guard, zod envelope, protected files, auth, clickUrl fix | Cost engineering for subscription-billed agents; secure-by-default local services |
| **1** | Aug–Sep 2026 | Eval harness (`sdlc eval`), KPI dashboard, DoR gate | Agent evals and regression gates; measuring quality without human review per PR |
| **2** | Oct 2026 | Worktree isolation, overnight dispatch, single-demo ("The Movie"), piyush-portfolio | Git internals and process isolation; single-vs-multi-agent trade-offs at demo quality |
| **3** | Nov 2026 | Agent SDK integration, OS sandbox, deeper reviewer fleet | Harness engineering internals; how the harness shapes what agents can and cannot do |
| **4** | Q1 2027 | Suspend/resume (DBOS), TEAM-LEAD, concurrent dispatch, trust replay | Distributed-systems patterns applied to AI orchestration; durable execution |

Phase 0 is the safety floor — it must be complete before Phase 1 work starts. Phases 1–4 stack; a later phase cannot skip its predecessor without leaving the north star metric blind.

---

## Quick Wins (not boulders — pick these off opportunistically)

Fix first before scaling anything:

| Item | Why it blocks | Issue |
|---|---|---|
| pnpm fails in sandbox | Silent quality risk on any task adding a dependency | #113 |
| BUILDER ignores AC artifact shape | Agent not doing what it was asked; trust degradation | #114 |
| Block agent from adding `manager-approved` label | Prevents self-approval bypass | #121 |

---

## The Boulders

Ordered by impact on north star. Each is a multi-session initiative, not a single PR.

---

### B1 · Definition-of-Ready Gate

**What:** Pre-dispatch scoring of every ticket against a readiness rubric (has clear AC, has tier label, no open blockers, description above a length floor). Below threshold → return structured clarifying questions to the issue author. Don't dispatch until ready.

**Why it's #1:**
Every serious production system in the research has this. awslabs/aidlc-workflows: blocking gate. ai-sdlc-framework: live since May 2026 (RFC-0011). CrewAI's most common failure pattern is BUILDER timeout on vague tickets — exactly #109. A bad ticket wastes a full Opus 4.8 run. Scoring readiness costs one Haiku call. ROI is obvious.

This is the correct fix upstream of wiring PLANNER. PLANNER needs a well-formed ticket to decompose; a DoR gate ensures it gets one.

**What it unlocks:** Reduces BUILDER timeout rate; makes PLANNER wiring tractable; reduces wasted Opus runs; raises effective quality floor without changing any agent.

**Scope:** Medium. The skeleton is `pnpm sdlc lint`. Extend it with a rubric-scoring step and structured question output. Wire into `dispatch` as a blocking pre-check.

**Related:** #109 (PLANNER gap), `pnpm sdlc lint` (existing hook), awslabs `aidlc-evaluator/` (reference)

---

### B2 · TEAM-LEAD Agent + Signed Evidence Bundle

**What:** Two components that must ship together:
1. **TEAM-LEAD:** An agent that reviews the evidence bundle post-CHECKER and either auto-merges (Tier 3/4) or queues for human review (Tier 0/1/2). Today every PR — including cosmetic Tier-4 changes — needs a human merge action.
2. **Signed evidence bundle (#86):** A cryptographically-signed record of gate outcomes (which gates fired, which model, which verdicts) that TEAM-LEAD reads before merging. Without this, auto-merge is on the honor system.

**Why it's #2:**
TEAM-LEAD is the single biggest lever on merged-PRs/review-hour. Without it, the human is in the merge loop for every PR regardless of tier. The trust machine is built; the merge automation that uses it isn't. Evidence bundle is the keystone — without it the trust machine's STEADY_STATE tier-2-4 auto-merge has no cryptographic backing.

Razorpay's 1,000 PRs/week at 33% auto-merge is what this looks like at scale. The architecture to get there is specced (AGENT-SPECS.md). Execution is what's needed.

**What it unlocks:** Tier 3/4 auto-merge without human touch. Human load drops to Tier 0/1/2 review only. North star metric starts moving.

**Scope:** Large. Two components. TEAM-LEAD needs to read the evidence bundle, apply trust-gate logic, and either merge or queue. Evidence bundle needs signing (private key) and verification at merge time.

**Related:** #86 (evidence bundle), AGENT-SPECS.md (TEAM-LEAD spec), HITL.md (G3 gate)

---

### B3 · Eval Harness + 6 KPI Dashboard

**What:** Two components that make quality and leverage visible:
1. **Eval harness (#92):** Golden test cases (human-authored, representative tasks) + semantic AI eval (LLM-as-judge scoring correctness) + CI integration. Steal the three-part structure from awslabs/aidlc-workflows `scripts/aidlc-evaluator/` — don't build from scratch.
2. **OTel + KPI dashboard (#89):** Wire OpenTelemetry instrumentation into the audit log reader. Surface the 6 KPIs (merged-PRs/review-hour, revert+rework rate ≤7d, defect-escape rate by tier, cost per merged PR, % auto-flowed by tier, stale-PR queue depth) via Grafana Cloud free tier.

**Why it's #3:**
The north star metric (merged-PRs/review-hour) is currently invisible. All 6 KPIs are unmeasured. Trust expansion (automated promotion logic) is empirically blind — currently based on ticket count, not measured quality. "Can't improve what you can't see."

Competitive pressure: OpenHands has a SWE-bench number; Devin has session analytics; Cursor has Mission Control. ai-sdlc has raw JSONL. The audit log has everything; the dashboard layer doesn't.

The eval harness also enables the first meaningful quality claim: "X% of representative tasks pass end-to-end without HITL." That's the ai-sdlc equivalent of SWE-bench — a publishable benchmark for the platform's actual task format.

**What it unlocks:** Quality visibility. Trust promotion with real evidence (not just ticket count). Ability to catch quality regressions as autonomy expands. A capability claim with evidence.

**Scope:** Medium each. Eval harness: ~3-5 golden fixture tasks + runner script + CI step. Dashboard: OTel spans on key orchestrator paths + Grafana dashboard with 6 panels.

**Related:** #92 (eval harness), #89 (dashboard), awslabs `aidlc-evaluator/` (reference impl)

---

### B4 · Unattended Overnight Runner

**What:** Resolve the Mac sleep problem so the pipeline can run unattended for hours. Two-part solution:
1. **Short-term:** `caffeinate` wrapper + ntfy.sh notification on completion/failure. Prevents sleep during dispatch; notifies if it stalls.
2. **Long-term (#88/#95):** Adopt DBOS or Temporal for durable execution. Crash-safe, idempotent dispatch, exactly-once execution. The long-running Node orchestrator process on a Mac is the single point of failure for overnight runs.

**Why it's #4:**
A pipeline that needs the Mac awake is a pipeline you can't trust to a cron job. The compound effect of B1+B2+B3 is only fully realized when the pipeline runs while the human is asleep and the north star is measured in the morning. Every competitor (Devin, GitHub Copilot, Razorpay Slash) runs in the cloud — crash-safety is built-in. We're one kernel panic away from a lost overnight run.

**What it unlocks:** True overnight dispatch. "Set a weekly roadmap Sunday, bulk-approve Sunday evening, check the results Monday morning" — the DoD vision in the system review.

**Scope:** Short-term = small (caffeinate + signal handler). Long-term = large (DBOS/Temporal integration). Start with short-term; defer long-term to Phase 4 timing.

**Related:** #88 (unattended runner), #95 (DBOS durable execution)

---

### B5 · CONTEXT.md Bubble-Up Enforcement

**What:** Mechanize the rule: "when a leaf module changes its API, the parent CONTEXT.md updates in the same commit." Currently enforced by convention (the agent is asked to; no check exists). Add a pre-commit hook or CI step that:
- Detects public API changes in changed files
- Verifies the corresponding CONTEXT.md was also updated
- Blocks the commit if not

Additionally: implement keyword-triggered context injection (load `auth/CONTEXT.md` automatically when task description contains "auth") — borrowed from OpenHands microagent pattern.

**Why it's #5:**
The CONTEXT.md hierarchy is ai-sdlc's most distinctive structural advantage over every competitor. No one else has curated, atomically-updated, agent+human-maintained module-level context. But its value degrades silently if skipped. The loopmaxxing article names "comprehension debt" as the biggest risk in autonomous AI development — CONTEXT.md is the answer; enforcement is what makes it work.

Keyword-triggered injection extends the hierarchy from "always load all modules" to "load what's relevant" — better context budgeting as the repo grows.

**What it unlocks:** Prevents quality degradation as the fleet scales. Protects the structural moat that differentiates ai-sdlc from RAG-based competitors.

**Scope:** Medium. Hook is straightforward; the hard part is the heuristic for "API changed in this file."

**Related:** AC-2 (CONTEXT.md in same commit), OpenHands microagents (keyword-trigger pattern reference)

---

### B6 · Reviewer Fleet + Structural Independence

**What:** Two upgrades to the reviewer layer:
1. **Fleet specialization:** Split the single generalist REVIEWER into 3-6 specialized agents (security, bug-detection, code quality as initial set). The AI filter layer aggregates their verdicts and drops false positives.
2. **Cross-vendor reviewer (#93):** At least one reviewer from a different model family (e.g. Gemini or GPT-4o reviewing Claude's code). Structural independence — if Claude has a systematic blind spot, a different-model reviewer catches it.

**Why it's #6:**
The current single generalist REVIEWER is a workaround, not a design choice. Temperature + prompt differences on the same Claude model family simulate independence; they don't provide it. ai-sdlc-framework's DSSE attestations enforce "Claude cannot review its own code." Razorpay's 6-agent fleet provides narrow focus — each reviewer only looks for one class of problem, so it catches more of that class.

Trigger for graduating: when **blocked tickets cluster on the same root cause** — not just post-merge reviewer misses. The pre-merge signal (tickets stalling on identical gaps) fires earlier and more reliably than waiting for escaped defects. See "Corrections to Boulder Notes" below for the full rationale (R-AISDLC-106).

**What it unlocks:** Higher defect-escape detection. Structural independence from model blind spots. Shorter path to autonomous Tier 2 merge (evidence quality improves).

**Scope:** Large. Fleet: three new agent prompts + aggregator logic. Cross-vendor: API key management for second model provider.

**Related:** #93 (cross-vendor reviewer), AGENT-SPECS.md (fleet spec), Razorpay fleet (reference)

---

### B7 · OS-Level Sandbox

**What:** Replace git worktrees with OS-level isolation before any dispatch of untrusted input. Options (adopt one; don't build):
- macOS Seatbelt (Cursor's approach) — available on the current Mac
- Linux Landlock (on a Linux runner/VM)
- E2B, Daytona, or Fly Machines (cloud sandbox providers) — Docker-in-Docker pattern; escape path is a cloud VM not the host

**Do NOT:** mount `/var/run/docker.sock` in Docker. OpenHands uses this and it's a known full-host-escape vector with published exploits.

**Why it's #7:**
Worktrees share the host OS. A malicious code change or injected prompt can read environment variables, SSH keys, or other files. For trusted personal code this is fine. For any untrusted input (external PRs, fetched web content, user-provided prompts via ntfy) it's a real attack surface.

Our own roadmap calls worktrees "isolation theater against prompt-injection." This is the prerequisite before any of the following: external PR dispatch, multi-user mode, or anything that processes untrusted content.

**What it unlocks:** Safe dispatch of external input. Prerequisite for any future multi-user or SaaS deployment.

**Scope:** Medium (adopt Seatbelt) to Large (E2B/Daytona cloud). Start with Seatbelt on the existing Mac.

**Related:** #71 (sandbox decision), Cursor (Seatbelt reference), OpenHands (Docker escape risk documentation)

---

### B8 · Automated Trust Promotion + Event-Sourced Replay

**What:** Two capabilities that sustain long-term autonomy:
1. **Automated trust promotion:** Logic to advance trust state based on empirical criteria (20+ tickets, 0 incidents, ≥85% coverage, owner sign-off). Currently trust promotion is a manual step — the machine is built but it doesn't drive itself.
2. **Event-sourced replay (AC-12):** `pnpm sdlc replay <run-id>` produces deterministic output. Path: type every orchestrator decision as a typed event; make state reconstruction a pure function of the event log. Reference: OpenHands' V0→V1 migration.

**Why it's B8 (not higher):**
Both require B3 (eval harness) to be meaningful. Automated trust promotion without a quality measurement is auto-promotion on noise. Replay without structured events is JSONL-grep, not true replay. These are enablers that become powerful only once the measurement layer exists.

**What it unlocks:** Trust expansion that earns itself (not manual). Deterministic debug of any pipeline run. Foundation for durable execution (B4 long-term path).

**Scope:** Medium each. Trust promotion: policy engine reading eval harness output + KPI metrics. Replay: event typing pass on orchestrator + state reconstruction pure function.

**Related:** AC-8 (trust transitions log), AC-12 (replay), HITL.md (trust expansion criteria), OpenHands V0→V1 (reference)

---

### B9 · Concurrent Dispatch + Parallelism

**What:** Run multiple tasks in parallel across projects (concurrent BUILDER agents, parallel reviewer sub-agents per PR). Two prerequisites must land first: audit-chain concurrency safety (#70) and durable execution (B4 long-term).

**Why it's B9 (Phase 4):**
Cursor runs 8 parallel agents. Razorpay runs parallel reviewers per PR. ai-sdlc runs one task at a time. The throughput gap is real. But parallelism on an in-memory Node process with a shared JSONL log is a data-corruption risk — audit-chain concurrency safety must land first.

Once B4 (durable execution) and audit-chain safety are resolved, parallel dispatch is the primary throughput lever.

**What it unlocks:** Fleet-scale throughput. Multiple projects shipping simultaneously. Closer to the "TEAM-LEAD managing a fleet" end state.

**Scope:** Large. Requires durable execution substrate (DBOS/Temporal), audit-chain locking, and trust-gate concurrency semantics.

**Related:** #73 (concurrent dispatch), #70 (audit chain concurrency), B4 (durable execution prerequisite)

---

## The Sequencing Logic

```
B1 (DoR gate)          → reduces wasted Opus runs, makes B2+B3 more efficient
B2 (TEAM-LEAD + bundle)→ auto-merge fires; north star starts moving
B3 (eval + dashboard)  → north star becomes visible; trust promotion has data
B4 (overnight runner)  → pipeline runs while sleeping; B2+B3 compound overnight
B5 (CONTEXT.md enforce)→ quality doesn't degrade as fleet scales
B6 (reviewer fleet)    → evidence quality improves; Tier 2 merge becomes safe
B7 (sandbox)           → prerequisite for untrusted input; do before any external dispatch
B8 (trust promotion + replay) → requires B3; sustains autonomy long-term
B9 (concurrent dispatch) → requires B4 long-term + B8; Phase 4 throughput lever
```

B1–B4 compound together: DoR + TEAM-LEAD + eval + overnight = "set roadmap Sunday, review digest Monday." That's the DoD vision from the system review. B5–B9 harden and scale what B1–B4 prove works.

---

## What to NOT Build (confirmed by research)

A short list where competitive research gave specific negative signals:

| Don't build | Build instead | Evidence |
|---|---|---|
| Custom sandbox | Adopt macOS Seatbelt or E2B provider | Every competitor adopted existing isolation |
| Custom durable execution | Adopt DBOS or Temporal | Phase 4 only; solved problem with production libraries |
| Custom observability stack | Wire OTel + Grafana Cloud free tier | Standard; building custom would be reinventing Prometheus |
| CrewAI as a foundation | Keep current TypeScript orchestrator | #4783 + #3154 are open production bugs in the framework |
| Docker with `/var/run/docker.sock` | Docker-in-Docker or cloud sandbox | Published RCE exploit via prompt injection |
| Custom eval harness runner | Steal awslabs `aidlc-evaluator/` structure | Working reference implementation available |
| IDE integration | gstack already covers interactive sessions | Cursor/Windsurf own IDE with large teams |
| Linear/Jira/Notion integration | GitHub Issues + Projects (both the orchestration surface and portfolio signal) | Fragmentation loses the dual-purpose value |

---

## Gaps the Boulder Analysis Missed

Four things the original analysis underweighted — surfaced from the issue list and stage-2 dogfood:

### 1. The security cluster is more urgent than the boulders suggest

The boulders put OS-level sandbox as B7 (medium-term). But there's an active Phase 0 floor gap that's more immediate: **#83** — the blast-radius/Red-zone enforcement on trip-research used an LLM-generated CLAUDE.md with a path-quoting bug that allowed bypass. The lesson isn't "sandbox faster" — it's that the blast-radius check must be platform-hardened code, not per-repo LLM output. This is a different problem from sandboxing, and it's live on an onboarded project now.

The rest of the open security cluster (#9 mechanize approval gate, #11 CI secret-scan/SAST, #13 SHA-pin CI action) are all Phase 0 floor items that are known but unclosed. `#10` (network egress allow-list) is deeper runtime hardening — assigned August 2026, not July. Collectively: the gap between "enforcement exists on paper" and "enforcement is mechanized and unbypassable."

**Action:** July 2026 — clear #83, #121, #9, #11, #13. August 2026 — #10 (runtime hardening). All must land before enabling any unattended dispatch.

### 2. HITL UX is a north-star lever hiding as a quick win

**#48** — actionable G2 notifications (Approve/Reject directly from ntfy, not requiring a dashboard visit) — directly reduces human friction at the merge step. The pipeline can raise 10 PRs; if each approval requires opening a dashboard, the human is the bottleneck again. This isn't a boulder; it's a 1-2 day change that meaningfully moves merged-PRs/review-hour. It wasn't in the boulders doc and it should be a quick win alongside #113/#114/#121.

**Action:** Treat #48 as a quick win, September 2026.

### 3. RC1/RC2 epics (#115, #116) add a dimension the boulders conflate

**#116 (RC2 — intake discipline)** maps to B1. But **#115 (RC1 — always-on machine verification, separate from human trust-gating)** is a distinct idea: deterministic checks that run on every PR regardless of trust state or tier. It's not about *when* humans review — it's about ensuring machines always check, even when humans don't. The boulders conflate machine verification with HITL. These are two separate layers.

**Action:** #115 is October 2026 — distinct from the HITL/trust-gate work.

### 4. Stage-2 dogfood bugs are production-blocking on real work

**#53** (doctor reads stale checkouts), **#37** (platform artifact dirs cause false gate failures), **#39** (develop-branch requirement is wrong) all came from career-automation Stage-2 dogfood. They mean the platform is actively wrong on at least one onboarded project right now. These aren't unphased backlog items — they're reliability regressions found in actual use.

**Action:** July 2026 milestone — these block real work.

---

## Non-Boulder Priorities

The boulders answer "what to build next." These are the gaps that determine whether the boulders actually land:

### 1. Issue triage sprint — the backlog is a blind spot

60+ open issues, many unlabeled and unphased. A 90-minute triage session to label/phase/close everything would turn the GitHub Issues list from noise into signal. The stage-2 dogfood bugs and security cluster are in there, hidden. Until triaged, the actual work queue is unknown. This isn't a boulder; it's the housekeeping act that makes all the boulders clearer.

**Action:** Create as a July 2026 task. One session, 90 minutes.

### 2. Weekly operational rhythm — the practice is undefined

The DoD vision says "set roadmap Sunday, bulk-approve epics in 30 min, spend ≤1h/day on review digest." But the practice — what exactly happens Sunday, what the review digest looks like, how G2 items are cleared efficiently, what the batch-approval flow looks like — is entirely undefined. Without it, the human defaults to ad-hoc interrupts and the north star stays invisible. The tools (ntfy, dashboard, GitHub board) exist. The cadence and habit don't. This is a design problem, not an engineering problem.

**Action:** Create as an August 2026 issue — design the Sunday ritual + daily review digest workflow before TEAM-LEAD ships.

### 3. Product delivery milestone — piyush-portfolio is interview-urgent and hasn't shipped

Every boulder in this doc is platform work. The platform exists to build products. piyush-portfolio has been "interview-urgent (4-8 weeks)" since the ROADMAP was written in May 2026. It's now June 2026. The portfolio doesn't appear in the boulder list at all. At some point the platform needs to stop being the subject and start being the verb — a concrete "first public case study live on piyushgupta.io" milestone needs to be in the plan alongside the platform boulders. The pipeline can do this work; it just hasn't been directed to.

**Action:** Create as a September 2026 goal — homepage + 2 case studies (ai-sdlc + one other) live.

### 4. Prompt quality cadence — the fleet's quality is currently invisible

The eval harness (B3) will eventually make output quality measurable. But even before it's built, there's a practice question: when do the agent prompts get reviewed? Right now, if BUILDER consistently makes the same class of mistake, no one finds out until a human reviewer notices a pattern. A monthly "worst CHECKER verdicts from the last 30 days → prompt improvement" ritual costs nothing to define and starts generating signal immediately.

**Action:** Create as an October 2026 practice definition — no tooling required, just a ritual.

### 5. Documentation currency — ROADMAP.md and PLAN.md are from May 2026

The original spec docs describe a world where Phase A "hasn't started." The running system has diverged significantly (the system review found 5+ major corrections). Any new person or future session reading ROADMAP.md will get a misleading picture. This isn't a boulder — it's a 2-hour pass to date-stamp what's done, what changed, and what the current state actually is. `docs/boulders.md` partially solves this for the forward view; the docs need updating for the retrospective view.

**Action:** Create as a July 2026 task alongside issue triage — do both in the same session.

---

## Research-Derived Additions to the Priority Queue

Items surfaced by the research that weren't in ROADMAP.md or PLAN.md:

| Item | Source | What to do |
|---|---|---|
| DoR gate rubric design | awslabs RFC pattern + ai-sdlc-framework RFC-0011 | Design the 7-point rubric; wire into `sdlc lint` |
| CHECKER prompt: 2-option gate completion | awslabs "standardized completion messages" rule | Add to CHECKER system prompt; prevents improvisation at gate boundaries |
| Per-agent iteration caps (complement global retry) | CrewAI `max_iter` pattern | BUILDER on Tier 0/1: max 5 tool-call iterations; TESTER: max 3 |
| SLA tracking on HITL queue | CrewAI enterprise feature | Escalate if G2 not resolved in N hours; prevents silent stalls |
| Keyword-triggered context injection | OpenHands microagent pattern | When task contains "auth", inject auth/CONTEXT.md; better than always-load-all |
| HITL cryptographic verification (long-term) | ai-sdlc-framework DSSE pattern | Future: sign approval events; current HITL is audit-logged but not cryptographically bound |

---

## Active Risks Not Yet Filed as Issues

Findings from the research that represent active risks to the running pipeline — not boulders, but important enough to track.

**1. CHANGES_REQUESTED verdict is treated as PASS in v1**
`CHANGES_REQUESTED` from REVIEWER auto-proceeds to COMMIT (advisory, not blocking). Introduced as a deliberate v1 workaround: smoke tests on piyush-portfolio showed REVIEWER returning CHANGES_REQUESTED for commit-hygiene nits, triggering BUILDER retries that hit permission walls. The footgun: if REVIEWER signals a real issue as CHANGES_REQUESTED instead of FAIL/BLOCK, the pipeline ships it anyway. *Source: 2026-06-16 system review (vault) §Retry Policy. Track in the audit log — any CHANGES_REQUESTED on Tier 0/1 should trigger a human review.*

**2. CHECKER bypass: pipeline can ship unreviewed work if CHECKER is not composed**
If a caller invokes BUILDER and routes its result directly (bypassing CHECKER), the pipeline ships unreviewed work. Confirmed by the ai-sdlc-framework incident (2026-05-04): ~10 PRs shipped to main without reviewer verdicts when the assistant composed the pipeline manually. Their fix was an `execute` umbrella subcommand that enforces all steps compositionally. ai-sdlc doesn't have this guard yet. *Source: 2026-06-16 extended research (vault) §ai-sdlc-framework §3. Mitigation: `dispatch` should be the only entry point; direct agent invocation should require an explicit `--bypass-checker` flag that the audit log records.*

**3. HITL approval queue: current queue is audit-logged but not cryptographically bound**
A sufficiently motivated actor can forge `is_approve=true` — the queue is append-only logged but the approval event is not cryptographically tied to a specific PR/commit hash. The existing Research-Derived table notes this as "long-term" but the threat model makes it medium-term once the pipeline runs unattended on higher-tier tasks. *Source: 2026-06-16 research appendix (vault) §H.3. Distinct from #86 (evidence bundle at merge time) — this is the approval queue itself, upstream of merge.*

**4. Condensation loop risk in long BUILDER sessions**
OpenHands has a known bug (#8630): condensation can loop if context overflows repeatedly. For complex Tier 0/1 tasks, a BUILDER session making many tool calls will fill the context window, triggering condensation, which can cascade. Mitigation: track condensation as a typed event in the audit trail; if condensation fires twice in a single session, escalate to HITL G2 with `condensation_loop` reason before quality degrades silently. *Source: 2026-06-16 extended research (vault) §OpenHands §Condensation.*

---

## KPI Trip-Wire Thresholds (for when #89 dashboard lands)

The 6 KPIs have specific action thresholds — not just measurement targets. These are operational decision rules, not aspirational numbers. *Source: 2026-06-16 system review (vault) §Success Criteria.*

| KPI | Trip-wire | Action |
|---|---|---|
| Revert + rework rate | >10% | Auto-pause fleet |
| Tier 0/1 defect escape | Any | Freeze that tier, investigate |
| Cost per merged PR | >$5 | Investigate (not auto-pause) |
| Stale-PR queue growth | Growing | Stop scaling fleet |
| HITL queue wait time | TBD (no latency SLO set yet — **gap**) | N/A until SLO defined |
| Trust state progression | Stalled >30 days | Review criteria, not the fleet |

**Success criteria gaps (not yet defined anywhere):**
- No latency SLO: "overnight" is implied but never stated as a target from ticket-filed to PR-raised
- No portfolio-level metric: all KPIs are per-project; "multiple products in parallel" has no measure
- No quality floor tied to trust expansion: the 20+/0/85% trust criteria don't appear in top-level success criteria, which means there's no forcing function to build the eval harness before expanding trust

---

## Implementation Facts Worth Preserving

Code state that's non-obvious and would confuse a future debugging session.

**Model routing: TESTER on Tier 0/1 first attempt uses Sonnet, not Opus**
BUILDER on Tier 0/1 first attempt uses Opus 4.8. TESTER on Tier 0/1 first attempt uses Sonnet 4.6; only on retry does it escalate to Opus. This divergence is intentional (tests are mechanical verification, not creative generation) but could look like a misconfiguration to someone debugging quality issues on Tier 0/1 tests. *Source: 2026-06-16 system review (vault) §Model Routing Table.*

**Tier-aware retry caps are pre-coded but not active in v1**
`TIER_RETRY_CAPS_V1_5` in `retry-policy.ts` defines: Tier 0→0 retries, Tier 1→1, Tier 2→3, Tier 3→5, Tier 4→∞. This is **not active** in v1 (flat cap instead). The roadmap August issue (per-agent iteration caps) addresses tool-call-loop caps within a single turn — a different concern. `TIER_RETRY_CAPS_V1_5` is a pipeline-level retry cap that will activate in v1.5. *Source: 2026-06-16 system review (vault) §Retry Policy.*

**Pacing gate preferred path is unavailable headless; it falls back to estimates**
The preferred numeric quota path (exact remaining token count) is not available in headless operation. The gate falls back to per-tier token estimates (`FALLBACK`). Throughput decisions during overnight runs are made on estimates, not actuals. Override via `SDLC_WINDOW_TOKEN_BUDGET` env var. *Source: 2026-06-16 system review (vault) §Pacing Gate.*

**#39 develop-branch retirement is intentional — not a regression from Eric Tech pattern**
The develop-branch-as-merge-target pattern (Q-AI-24, from Eric Tech's Superboard) was deliberately adopted, then deliberately retired in #39. The retirement is not a regression — it reflects a scope change (ai-sdlc no longer needs the develop → main promotion flow for the test cases). This matters if anyone reviews #39 without the history. *Source: 2026-06-16 competitive review (vault) (v1) §Already Adopted.*

---

## Corrections to Boulder Notes

**B6 (reviewer fleet) — "add a column" trigger is more specific than documented**
~~boulders.md B6 documents the trigger as "REVIEWER misses the same class of issue 3+ consecutive times."~~ **✅ Fixed 2026-06-18 — B6 body updated directly.** The trigger is now documented correctly in B6 as "blocked tickets clustering on the same root cause." Reviewer misses are post-merge quality signals; blocked tickets clustering is a pre-merge flow signal that fires earlier and more reliably for true systematic gaps. *Source: 2026-06-16 competitive review (vault) §Insight 3 / Razorpay pattern.*

**B3 (eval harness) — ai-sdlc-native benchmark should be spec'd before building the harness**
The research explicitly defines what the right ai-sdlc benchmark is: "what fraction of GitHub Project board items does the pipeline resolve correctly end-to-end, including tests passing and PR opened?" — a metric no one in this space publishes yet. SWE-bench is the wrong frame (it measures coding ability on isolated tasks, not SDLC throughput on a real project board). Design the golden fixture set spec before building the harness infra, or you'll build the wrong thing. *Source: 2026-06-16 research appendix (vault) §B.5.*

**B5 (CONTEXT.md enforcement) — comprehension debt compounds at scale, not just quality**
The loopmaxxing article frames the CONTEXT.md gap as a cognitive safety issue, not just a quality issue. As the fleet scales and ships faster, the gap between repo state and human understanding widens. Eventually the human engineer cannot debug their own codebase — not because the code is bad, but because the contextual map didn't track the code's evolution. B5 is not just about context injection for agents; it's about maintaining the human's ability to stay in the loop at scale. *Source: loopmaxxing article (vault) + 2026-06-16 extended research (vault) §Insight 4.*

---

## Watch Items (Phase B+, low urgency)

**AutoGen is in maintenance mode — use Microsoft MAF for new multi-agent work**
Microsoft put AutoGen into maintenance mode in early 2026. New projects should use Microsoft Agent Framework (MAF), which has an actor-model distributed-first architecture. If any onboarded project or future integration considers AutoGen for multi-agent comparison, this is a wrong turn. *Source: 2026-06-16 research appendix (vault) §C.1.*

**Google ADK "agent-as-service" pattern — watch for Phase B+ multi-tenant HTTP triggers**
Google ADK exposes agent pipeline stages as HTTP endpoints for external trigger. This is directly relevant to ai-sdlc's Phase B+ multi-tenant expansion (external systems triggering the pipeline via HTTP). Not urgent for Phase A, but the design decision point will come in Phase B. *Source: 2026-06-16 research appendix (vault) §C.4.*

---

*This document tracks the strategic boulder list — not individual PRs. Individual issues remain in GitHub Issues. For the original phase plan see `ROADMAP.md` and `PLAN.md`. For research evidence behind each priority see 2026-06-16 research (vault).*

*Update this doc when: a boulder is completed, a new boulder is identified, or the sequencing changes based on new data.*

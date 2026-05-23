# ai-sdlc · HITL — Human-in-the-Loop Gates

> Five gates where the human (you) intervenes. Calibrated to blast-radius tier. Updated 2026-05-23.

The whole point of ai-sdlc is to let agents do routine work AND let the human stay in control of the decisions that matter. This doc defines the five gates, what fires them, what you see, and how you respond.

---

## v1 vs v1.5+ scope (Phase A sequencing)

> **v1 ships ONE gate: G2 REVIEW.** The Block column on the GitHub Project board IS the v1 HITL surface. The other 4 gates below (G1 PLAN, G1.5 ADR, G3 DEMO, G5 POST-MERGE) are pre-specified architectural commitments that **graduate to v1 when data justifies them.** See [ROADMAP.md](./ROADMAP.md) "v1 / v1.5+ scope split" for the activation triggers per gate.
>
> The full 5-gate spec below is the architectural target. v1 implements only the G2 sections; v1.5+ adds the rest as needed.

---

## The five gates (full target spec — v1 implements G2 only)

| Gate | When it fires | What the human does |
|---|---|---|
| **G1 — PLAN** | Before epic decomposes into tasks | Approve epic scope; resolve open Q-AI-style decisions; confirm tier classification |
| **G1.5 — ADR** | When BUILDER drafts an architectural decision | Review ADR draft (options, recommendation, alternatives); approve / request changes / reject |
| **G2 — REVIEW** | After reviewer fleet verdict, before COMMIT | Review fleet's annotated diff + AI-filter-passed findings + confidence score |
| **G3 — DEMO** | After CI green, before merge | Watch demo video + per-AC screenshots + visual diff; verify product behavior |
| **G5 — POST-MERGE** | After merge, before trust expansion can count this PR | Report whether the change worked in real use; feedback loops into trust expansion data |

(There is no G4 — that gate was about CI being green, which is now automated and never blocks the human. We kept the numbering for compatibility with prior planning.)

---

## Gate-by-gate spec

### G1 — PLAN gate

**Triggered by:** A new epic is filed (via GitHub Issue using `epic.md` template) and the orchestrator picks it up for PLANNER.

**What the orchestrator does first (before firing the gate):**
1. PLANNER reads the epic, current PLAN.md, last 5 ADRs in the area
2. Drafts a structured task breakdown: tasks JSON with DoD + AC + tier + estimated cost + dependencies
3. Writes draft to `.sdlc-queue/pending-hitl/G1-<epic-id>.json`

**What you see (via dashboard + macOS notification):**
- Epic title + 2-sentence summary
- Proposed task breakdown (table: task, tier, est cost, dependencies)
- Open questions PLANNER couldn't resolve (similar to Q-AI-* format)
- "Approve" / "Request changes" / "Reject" buttons
- "Snooze 24h" option (defer until tomorrow)

**You respond:**
- **Approve** → orchestrator queues tasks for BUILDER
- **Request changes** → you write feedback inline; PLANNER iterates (max 3 cycles)
- **Reject** → epic returns to backlog; reason logged

**Fires for which tiers:**

| Tier | G1 behavior |
|---|---|
| 0 | Always fires |
| 1 | Always fires |
| 2 | Always fires |
| 3 | Auto-approves epic if estimated cost < $1 and DAG depth < 5 |
| 4 | Auto-approves (typos, comments, dep patches) |

**SLA / quiet hours:** No notifications between 11pm-8am IST. Pipeline holds the request in queue.

---

### G1.5 — ADR gate (new in this design)

**Triggered by:** During BUILD or PLAN, an agent decides an architectural decision is needed (e.g. "use Zustand vs Jotai", "store cookies in keychain vs git-crypt", "queue worker batch size = 10 or 100").

**Heuristic for "this needs an ADR":**
- Decision affects >1 module
- Decision has a >1-year cost-of-change
- Decision involves Red zone files (always)
- Decision has 2+ viable approaches with non-trivial tradeoffs
- Decision is irreversible (one-way door per Bezos taxonomy)

**What the orchestrator does first:**
1. BUILDER drafts an ADR using the `adr.md` template
2. ADR includes: context, options (≥2), tradeoffs per option, recommendation, alternatives considered, rollback path if wrong
3. Posts as a GitHub Discussion (for public repos) or an issue (private repos) AND writes to `.sdlc-queue/pending-hitl/G1.5-<adr-id>.json`

**What you see:**
- ADR title + context paragraph
- Side-by-side options table
- BUILDER's recommendation + WHY
- "Approve as recommended" / "Approve with different option" / "Discuss more" / "Reject"

**You respond:**
- **Approve as recommended** → BUILDER proceeds; ADR committed to `docs/adr/`
- **Approve with different option** → BUILDER swaps + commits
- **Discuss more** → Discussion stays open; you comment; BUILDER iterates after your final word
- **Reject** → BUILDER routes back to PLANNER for re-planning

**Fires for which tiers:**

| Tier | G1.5 behavior |
|---|---|
| 0 | Always fires; PLANNER pre-drafts ADRs proactively |
| 1 | Always fires |
| 2 | Fires when heuristic triggers |
| 3 | Skipped unless heuristic triggers (rare) |
| 4 | Skipped |

---

### G2 — REVIEW gate

**Triggered by:** Reviewer fleet completes its parallel run; AGGREGATOR produces a verdict; AI filter layer drops false positives.

**What the orchestrator does first:**
1. Each reviewer (SECURITY, CODE-QUALITY, BUG-DETECTOR, DESIGN where applicable) returns findings
2. AGGREGATOR merges findings by file:line, applies AI filter (drops findings with low confidence + no critical flag), computes overall verdict: `BLOCK | FAIL | CHANGES_REQUESTED | PASS`
3. Writes to `.sdlc-queue/pending-hitl/G2-<task-id>.json`

**What you see:**
- Task title + linked epic
- Reviewer fleet summary table (one row per reviewer with verdict + confidence)
- Aggregated findings (after AI filter), grouped by severity
- Inline diff view with annotations
- Audit log run id (for full replay if needed)
- "Approve" / "Approve with follow-up TODO" / "Request changes" / "Reject" / "Escalate to deeper review (more reviewers)"

**You respond:**
- **Approve** → task proceeds to DEMO
- **Approve with follow-up TODO** → task proceeds; an issue is filed for the deferred item
- **Request changes** → task returns to BUILDER with your feedback (iteration cap per tier — see §6.3)
- **Reject** → task discarded; reason logged

**Fires for which tiers (per the tier matrix):**

| Tier | G2 behavior |
|---|---|
| 0 | Always fires; multiple reviewers required |
| 1 | Always fires |
| 2 | Fires if aggregator confidence < 0.85 OR verdict is not PASS |
| 3 | Auto-passes if PASS; fires only on FAIL/BLOCK |
| 4 | Auto-passes always |

**Critical hard rule:** Any BLOCK verdict from SECURITY-REVIEWER fires G2 regardless of tier. Security never auto-passes.

---

### G3 — DEMO gate

**Triggered by:** DEMO agent completes its e2e run (Playwright for UI, integration tests for backend, smoke for CLI) and CI is green.

**What the orchestrator does first:**
1. DEMO runs the AC checklist against the actual built artifact
2. Captures per-AC pass/fail + screenshots + video
3. For UI changes: visual diff against locked baselines (`design/` directory)
4. Writes to `.sdlc-queue/pending-hitl/G3-<task-id>.json` with paths to artifacts

**What you see:**
- Task + epic + tier
- Demo video player (embedded in dashboard)
- Per-AC pass/fail table with screenshots
- Visual diff % (for UI changes)
- Network HAR (for adapter changes)
- "Approve + merge" / "Approve with follow-up" / "Request changes" / "Reject"

**You respond:**
- **Approve + merge** → COMMIT agent merges the PR
- **Approve with follow-up** → merges + creates issue for next iteration
- **Request changes** → task returns to BUILDER (cycle counter increments)
- **Reject** → discarded

**Fires for which tiers:**

| Tier | G3 behavior |
|---|---|
| 0 | Always fires |
| 1 | Always fires |
| 2 | Fires if visual diff > 5% OR any AC fails OR new error states surfaced |
| 3 | Auto-passes if all AC pass + visual diff < 5% |
| 4 | Auto-passes always |

---

### G5 — POST-MERGE gate

**Triggered by:** A PR has been merged to main for at least 24h (long enough for you to have used the change in real life).

**Why this gate exists:** The other 4 gates measure what the pipeline OUTPUT looks like. G5 measures whether it actually WORKED in real use. Without G5, the trust expansion model has only second-hand signals (CI green, reviewer PASS). G5 is first-hand reality data.

**What the orchestrator does first:**
1. REPORTER agent posts a summary in the dashboard 24h after merge
2. Summary includes: what shipped, where to use it, expected behavior
3. Writes to `.sdlc-queue/pending-hitl/G5-<task-id>.json`

**What you see:**
- "Did this work?" prompt with task summary
- Quick response buttons: "👍 worked as expected" / "👎 broke something" / "🟡 worked but feels off"
- Optional comment field

**You respond:**
- **👍** → counts as a positive signal for trust expansion in this zone
- **👎** → triggers contraction protocol; pipeline pauses 24h for RCA; agent prompts versioned and reviewed
- **🟡** → no trust state change; feedback logged for prompt iteration

**Fires for which tiers:**

| Tier | G5 behavior |
|---|---|
| 0 | Always fires |
| 1 | Always fires |
| 2 | Always fires |
| 3 | Fires once per epic (not per task) |
| 4 | Skipped |

**SLA:** G5 prompts expire after 7 days. If unanswered, treated as neutral (no trust state change). This prevents stale gates from blocking the pipeline.

---

## Request format (canonical schema)

Every gate writes a structured JSON record. Schema:

```jsonc
{
  "id": "hitl-G2-20260601-001",
  "gate": "G2",
  "tier": 1,
  "task_id": "trip-research/3.2.2",
  "summary": "MMT search scraper · 234 LOC · review verdict CHANGES_REQUESTED",
  "reason": "Confidence below threshold (0.78); SECURITY flagged missing rate-limit on detail fetch",
  "artifact_paths": {
    "diff": ".audit/2026-06-01/diffs/3.2.2.diff",
    "review_report": ".audit/2026-06-01/review/3.2.2.json",
    "demo_video": ".audit/2026-06-01/demo/3.2.2.webm",
    "audit_run": ".audit/2026-06-01/runs/3.2.2.jsonl"
  },
  "options": [
    { "id": "approve", "label": "Merge as-is" },
    { "id": "approve_with_followup", "label": "Merge + open follow-up issue" },
    { "id": "request_changes", "label": "Send back with comment", "requires_input": true },
    { "id": "reject", "label": "Discard" }
  ],
  "blocking": ["trip-research/3.2.3", "trip-research/3.2.4"],
  "auto_decision_at": null,
  "expires_at": "2026-06-08T00:00:00Z",
  "created_at": "2026-06-01T11:23:00Z"
}
```

`auto_decision_at` is `null` unless the user has set a "auto-approve after N hours" override for low-tier gates.

---

## Channels (where you actually see these)

Per the Q-AI-3 decision (locked 2026-05-21):

| Channel | Used for |
|---|---|
| **Local dashboard at `localhost:3001/sdlc`** | Primary surface. All gates appear here as a queue. |
| **macOS notification (osascript)** | Trigger for the dashboard. Clickable; opens the relevant gate. Respects quiet hours. |

Not used:
- Slack (no team)
- Email (too async for active gates)

Post-v1.5 reconsideration: mobile push if traveling without Mac in hand.

---

## Quiet hours

Configured per project (defaults to the user's calendar):

- 11pm IST → 8am IST: no macOS notifications fire. Gates queue up.
- Weekends: notifications fire but expire-clocks pause. A G5 gate fired Friday afternoon doesn't expire on Sunday.
- Vacation mode (`pnpm sdlc vacation start --until 2026-06-15`): all gates queue, no notifications, expire-clocks paused.

---

## Tier ↔ gate matrix (consolidated)

| Tier | G1 PLAN | G1.5 ADR | G2 REVIEW | G3 DEMO | G5 POST-MERGE | Total gates fired |
|---|---|---|---|---|---|---|
| **0** | ✅ | ✅ | ✅ | ✅ | ✅ | 5 |
| **1** | ✅ | ✅ | ✅ | ✅ | ✅ | 5 |
| **2** | ✅ | heuristic | conf<0.85 | diff>5% | ✅ | 3-5 |
| **3** | auto-OK | heuristic | FAIL only | diff>5% | per-epic | 0-3 |
| **4** | auto-OK | skip | auto-OK | auto-OK | skip | 0 |

Plus the SECURITY override: BLOCK verdict from SECURITY-REVIEWER fires G2 regardless of tier.

### 6.3 Tier-aware iteration caps (Q-AI-26)

Refines the previous global "max 3 build/review cycles." When BUILDER + REVIEWER FLEET cycle and REVIEW keeps returning CHANGES_REQUESTED, the orchestrator caps retries per-tier and routes excess to Block:

| Tier | Retry budget | What happens on cap exhaustion |
|---|---|---|
| **0** | 0 retries | HITL fires on FIRST build failure — Tier 0 is too risky to loop on |
| **1** | 1 retry | After 2 total attempts, Block column + G2 HITL with full audit trail |
| **2** | 3 retries (current default) | After 4 total attempts, Block column + G2 HITL |
| **3** | 5 retries | After 6 total attempts, Block column + G2 HITL |
| **4** | Unlimited until manual stop | No auto-block; user can `pnpm sdlc stop --task <id>` to halt |

**Rationale:**
- Tier 0/1 wrong = real harm. Looping wastes time + may compound damage. Cheaper to surface immediately to user.
- Tier 4 right answer is often "the agent is stuck on a typo"; let it grind cheaply.
- Tier 2/3 is the bulk of normal work; 3-5 retries matches Eric Superboard's validated default.

**Block reason format:** `cap-exhausted:tier-{N}:revision-{M}:{root-cause}` — surfaces in the Block column on the GitHub Projects board (Q-AI-21) AND in the dashboard. Examples:
- `cap-exhausted:tier-1:revision-2:contract-test-fails-after-fix-attempt`
- `cap-exhausted:tier-3:revision-6:lighthouse-mobile-below-90`

The block reason becomes input to the "add a column when blocked repeatedly" meta-pattern (R-AISDLC-106): if 3+ tickets cluster on the same root cause within 14d, an ADR is raised proposing a new pipeline stage + specialized agent for that class of work.

---

## "Direct the approach" — how G1.5 maps to your stated need

You explicitly asked for: "answer key questions to proceed / direct the approach / review outputs as HITL / review the end product / test and start using."

Mapping:

| Your need | Gate(s) |
|---|---|
| Answer key questions to proceed | G1 (epic-level questions) |
| Direct the approach | G1.5 (ADR-level decisions) — newly added |
| Review outputs as HITL | G2 (reviewer fleet output review) |
| Review the end product | G3 (DEMO video, screenshots, AC verification) |
| Test and start using | G5 (post-merge real-use feedback) — newly added |

G1 and G1.5 together replace the previous "single PLAN gate." Splitting them lets you stay light at epic scope (G1, fast) while still controlling architectural decisions (G1.5, slower, focused).

---

## Implementation notes

- All gate responses are recorded in the audit log with timestamp + your reply + reasoning text (if any)
- The dashboard at :3001 is the single source of truth for the gate queue; macOS notifications are triggers, not the surface
- Gate responses CAN be reversed within 1 hour of submission via "undo" in the dashboard (for accidental clicks)
- After 1 hour, reversal requires a new task explicitly reverting the change (full audit trail)

Detailed CLI surface and dashboard UX are in [DESIGN.md](./DESIGN.md).

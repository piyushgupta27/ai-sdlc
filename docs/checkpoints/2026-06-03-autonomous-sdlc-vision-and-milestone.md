---
name: autonomous-sdlc-vision-and-milestone-2026-06-03
description: Checkpoint — the vision becoming real, the decisions locked, and how far we are from the full autonomous pipeline running as a "movie".
created: 2026-06-03
status: checkpoint
type: vision + decision-log + roadmap
owner: piyush
tags: [vision, milestone, ai-sdlc, autonomy, checkpoint]
---

# Autonomous SDLC — vision & milestone checkpoint (2026-06-03)

> **Why this doc exists.** Mid-session, the MANAGER (Piyush) said:
> *"I was going with the flow with a vision in mind, which is seeming to become more
> realistic and something we can see, not just imagine."*
> This captures that moment — the vision, the decisions made to get here, the synthesis,
> and an honest estimate of the distance to the full pipeline running on its own.

---

## 1. The vision (in the MANAGER's words + synthesis)

**Verbatim intent from this session:**
- *"This exercise is not to just have an AI SDLC team but to experiment and build one in a way that I can leverage the same in scaled orgs as well."*
- *"We will be balancing out bias to action over right complicated technical solution as per the stage we are in and the pace with which we are progressing."*
- *"Whatever is not picked up is golden including sandbox / harness which are going to be obvious next phases."*
- The goal of a MANAGER-grade PR template: *"help me get all the information I need for a review without reaching out to you at all."*

**Synthesis.** We are not building a one-off "AI writes code" demo. We are building an
**operating system for an autonomous engineering team** — role-separated agents, gated
by blast radius, audited end-to-end, with a human as MANAGER on top — designed so the
*same machine* transfers to a real, scaled org. The north star is **N PRs/day through a
gated pipeline without losing MANAGER control**. The platform is meta-recursive: it is
meant to eventually build and maintain *itself*.

The shift the MANAGER experiences: from *writing code* → to **setting tasks, approving
high-blast-radius gates, and reviewing PRs**. The PR template we built this session is
literally that new interface — the MANAGER's cockpit.

---

## 2. The cast (the "team") and how a task flows

| Role | Who | Plays |
|---|---|---|
| **MANAGER** | Piyush (human) | Final authority. Approves Red-zone gates, reviews PRs, sets tasks. |
| ORCHESTRATOR | Node state machine | Tech lead. Dispatches agents, routes on verdicts, enforces gates, writes the audit log. |
| PLANNER | LLM | Epic → stories → tasks (+ DoD, tier, estimate). |
| BUILDER | LLM | Implements one task on a feature branch. |
| TESTER | LLM | Derives + runs the test matrix. |
| REVIEWER | LLM | Hostile-eye code review. |
| **CHECKER** | LLM (building now) | Independent quality gate — "did they actually do it well?" Drives selective refire. |
| **TEAM-LEAD** | LLM (specced) | Merges Tier 2–3 after the checklist; escalates Tier 0–1 to MANAGER. |
| REPORTER | LLM | Summarizes the run. |

**One task's journey (post-Stage-1):**

```
Task lands in "Ready" (MANAGER, or PLANNER decomposing an epic)
   │
ORCHESTRATOR provisions an isolated worktree, then:
   BUILDER → code + commit
   TESTER  → test matrix + commit
   REVIEWER→ verdict + findings
   CHECKER → semantic quality audit  +  orchestrator re-runs tsc/lint/test in Node
   │
   quality gap? → REFIRE only the owning agent with just those deficiencies
                  (bounded ≤N, each round logged to the hash-chained audit log)
   │ converge
   TEAM-LEAD → merges Tier 2–3 / escalates Tier 0–1 to MANAGER
   REPORTER  → summary; everything in the audit log with real token/$ cost
```

---

## 3. Decisions locked this session (with rationale)

1. **H1 deterministic re-verify runs in Node (orchestrator), not in the CHECKER LLM.**
   An LLM-with-a-shell reporting "tests pass" is still hearsay on a machine-checkable
   fact. The `[D]` gate must be a real machine run; the CHECKER does the semantic `[C]`
   audit on top and treats the already-run matrix as ground truth. *(Deviates from the
   original AGENT-SPECS stub; the stub was reconciled.)*

2. **Three-tier gate ordering, cheap → expensive** (from the MANAGER's "trust the
   evidence" idea):
   1. **Handoff-completeness** (Node, ~free) — REFIRE an incomplete handoff before any
      run or LLM call. This is the MANAGER's "bounce it back if evidence is incomplete."
   2. **Deterministic re-verify** (Node, once, authoritative) — H1.
   3. **Semantic audit** (CHECKER LLM) — H2/H3.
   Plus a SHA-cache so the refire loop never re-runs unchanged commits.

3. **Agent-supplied evidence can't replace re-running deterministic facts — yet.** In
   today's single-process model, an agent's "evidence" is just text it typed (forgeable).
   The re-run *is* the unforgeable evidence. True evidence-based skipping needs a
   sandbox harness emitting signed, commit-bound artifacts → filed as **#25**.

4. **Tier-calibrated skip of the re-run = deferred**, with a *measurable* graduation
   trigger (re-run cost > ~10% of pipeline spend, or Tier 3–4 > ~10/day) → **#24**.
   "Golden, not dropped."

5. **MAX_CHECKER_REFIRES = 2** — small, to protect throughput ("reserve refires for
   substantive gaps, not nitpicks").

6. **MANAGER-grade PR template** — a reviewer can approve/reject from the description
   alone. Clean style (bare `#N` refs, minimal inline code, prose-top/technical-bottom),
   tier-aware, with a security-review block. Propagation to all repos + a CI completeness
   gate → **#26**.

7. **Security review is risk-calibrated** — auto-`/cso` on Tier 0–1 + security-touching
   PRs; routine Tier 2–3 use the REVIEWER's security pass. The template surfaces findings
   + open security issues either way.

8. **Concurrency model** — separate worktrees/clones per concurrent agent (§7). Sub-agent
   parallelism this session was blocked by the sandbox (node@22 PATH + external paths
   denied to sub-agents); built sequentially instead. Per-task isolation is **#19**.

---

## 4. What shipped this session

- **PR #27** — F5 transport fix: real token usage + cost via `--output-format json`
  (was logging $0; this unblocks the cost audit G4 + budgets G5 + the template's
  auto-fill). Tier 1.
- **PR #28** — CHECKER contracts + agent + prompt + model route, **inert** (not wired).
  Tier 1.
- **PR #29** — the MANAGER-grade PR template (canonical + `.github/`). Tier 3.
- **Issues filed (golden, deferred):** #24 (tier-calibrated skip), #25 (trusted evidence
  artifacts / sandbox), #26 (template propagation + CI gate).
- All three PRs green on `typecheck + lint + test`; #27/#28 show the **expected** Red-zone
  gate "failure" (awaiting MANAGER approval — the gate working as designed).

---

## 5. Synthesis & insights (the non-obvious bits)

- **The manual work IS the design forge.** Every friction *I* (Claude, hand-playing all
  roles) hit this session — the broken cost parse, the format-check miss, the noisy PR
  body, the H1 trust question — is friction an *agent* would hit. Hand-building Stage 1 is
  how we discover what the agents need. The PR template, the gate ordering, and the F5/F1
  fixes are all artifacts of that discovery.
- **The bootstrapping paradox.** You cannot use the safety gate to build the safety gate.
  The CHECKER is what makes autonomous code-writing trustworthy — and the CHECKER is what
  we're building. So Stage-1's Tier-1 core is hand-authored *by design* (the CLAUDE.md
  even says: first agent-authored PR is a Tier-4 typo). You bootstrap by hand, then hand
  the machine progressively riskier work.
- **"Trust the evidence" collapses into "re-run it" — until there's a trusted witness.**
  The cleanest insight of the session: evidence is only worth what it costs to forge, and
  in a single process there's no trusted witness separating "the agent ran the test" from
  "the agent said it did." A sandbox that emits signed artifacts is the witness — and the
  unlock for skipping re-runs (#25).
- **Sequential now, team-of-engineers later.** Today the pipeline is one diligent
  engineer with a strict review process (roles in series, one task, shared tree). The
  "team of ten in parallel" is the scaling phase (isolation #19 + a merge queue).

---

## 6. How far from "the full pipeline as a movie"?

The MANAGER wants to *watch the whole SDLC run* — many actors, several scenarios, some in
parallel (a REFIRE here, an ESCALATE there, TEAM-LEAD merging, REPORTER narrating). Honest
distance, measured in platform **tasks/PRs** and rough **effort**:

| To see... | Needs | Est. tasks (PRs) | Rough effort |
|---|---|---|---|
| **One task fully autonomous** (BUILD→TEST→REVIEW→CHECKER refire→converge→PR) | PR3 only (orchestrator wiring + F1 + live proof) | 1 PR | ~1 focused session + MANAGER review. **Days.** |
| **The parallel "movie"** (N tasks at once, full roster, TEAM-LEAD auto-merge, visible) | PR3 + worktree isolation (#19) + TEAM-LEAD runtime + a seeded backlog of 5–8 real Tier 2–4 tasks | ~4–5 PRs | ~2–4 focused sessions. **~1–2 weeks part-time, or a few concentrated days.** |
| **Unattended Red-zone** (no human in the loop even for Tier 0–1) | + approval-gate mechanization (#9: bot identity + branch protection + human-review rewire) | ~2–3 PRs | Later; not needed for the movie (MANAGER approves Tier 0–1 manually). |

**The compounding payoff (answers "why don't we do this through ai-sdlc?"):** once PR3
lands, we **start routing the later work through the pipeline itself** — the worktree-
isolation chore, the backlog tasks, docs, even some movie content become *pipeline tasks*.
Building the movie becomes the movie. The hand-built share shrinks task by task; that
crossover is the whole point of a meta-recursive platform.

**The "movie" cast & scenarios we'll stage** (once isolation lands):
- 3–4 tasks dispatched together, each in its own clone, agents working concurrently.
- One task sails through clean (BUILD→TEST→REVIEW→CHECKER PASS→TEAM-LEAD merge).
- One hits a **CHECKER REFIRE** (TESTER missed a sad-path) → refire → converge — the
  hero scene.
- One **ESCALATES** to the MANAGER (ambiguous AC / Tier-1) → lands in the Blocked queue
  with a Change Decision Brief → MANAGER approves from phone via ntfy.
- One **fails a deterministic gate** (the orchestrator's re-run catches a "green" lie) →
  routed back to BUILDER.
- REPORTER narrates each; the hash-chained audit log + real $ cost is the closing credits.

---

## 7. Up next

1. **PR3** — orchestrator wiring (3-tier gate + bounded refire + F1) + the live
   REFIRE→converge proof. *Starts after #28 merges (no stacked PRs).*
2. Then **#19** (worktree isolation) + **TEAM-LEAD** runtime → unlocks the parallel movie.
3. Seed a real Tier 2–4 backlog on the board; run the movie; route its own follow-ups
   through the pipeline.

**Reference:** `docs/plans/2026-05-31-aisdlc-maturity-plan.md`, `AGENT-GOVERNANCE.md`,
`SDLC-ARCHITECTURE.md §3`, `AGENT-SPECS.md`, `docs/plans/verification-2026-05-31.md`.

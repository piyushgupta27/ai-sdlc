# SDLC-ARCHITECTURE.md

The **maturation layer**: how a change flows through the gated pipeline, the
decisions taken to reach N-PRs/day, and the one genuinely new role (the CHECKER).
This does **not** restate system internals — see `ARCHITECTURE.md` (§3 pipeline,
§4 roster, §6 tiers, §7 guardrails), `HITL.md` (gates), and `AGENT-GOVERNANCE.md`
(the rules contract). It records the *deltas* and the *flow*.

> Grounded in the 2026-05-31 verification (`docs/plans/verification-2026-05-31.md`):
> Phase-A machinery works end-to-end; F4 (agent write-permission) is fixed; CI is
> green and the red-zone MANAGER gate is functional.

## 1. North-star & the throughput/control trade
Ship **N PRs/day**. Rigor is justified only where it protects throughput or MANAGER
control. Hence: keep the core agents separate (separation of duties), but **defer**
the specialized reviewer fleet + AGGREGATOR until data justifies them (this *aligns*
with the existing v1=generalist / fleet=v1.5+ sequencing in `ARCHITECTURE.md §4.4`).

## 2. Pipeline flow (with the CHECKER inserted)
```
PLANNER → BUILDER → TESTER → REVIEWER → [CHECKER] → COMMIT → REPORTER
                       ▲__________________│ (refire: pointed feedback, bounded ≤N)
                                          │
                          Tier 0/1 or non-converging → MANAGER (HITL / G2)
```
- The existing orchestrator loop is **outcome-based** retry (BUILD/TEST/REVIEW fail → retry ≤3). 
- The CHECKER adds a **quality-based** gate on top: after a producer hands off, the CHECKER independently audits whether the *output quality* meets the bar (e.g., did TESTER's matrix cover the sad/edge paths implied by the diff?), and either passes it forward or **refires the owning agent with only the specific deficiencies**. It reuses the existing `retry-policy` counter — it does not add a parallel loop.
- Deterministic claims (build/lint/test/coverage) are **re-run** by the gate, never trusted from an agent's word (`AGENT-GOVERNANCE.md` H1).

## 3. The CHECKER (new — Stage 1)
- **What:** an independent, read-only L2 meta-checker (≈ AGGREGATOR-plus, but focused on *audit + refire* rather than multi-reviewer merge — which isn't needed until >1 reviewer exists).
- **Why it's the priority gap:** the existing pipeline can mark a task "done" on an agent's say-so; the CHECKER makes "did the agent actually do it well" a gate, with evidence, not trust. It's the piece that makes the MUST-haves enforceable.
- **Output contract (`CheckerOutput`, versioned):** `{ verdict: PASS | REFIRE | ESCALATE, deficiencies: Deficiency[], confidence }` where `Deficiency = { owner_role, severity (shared P0–P3), what, why_it_matters, evidence_ref, suggested_fix }`.
- **Loop bound:** ≤N iterations, each logged `{feedback-in, what-changed}` to the `AuditRow`; non-convergence → MANAGER escalation with full history.
- **Reuse, don't reinvent:** the `Agent<TPayload,TOutput>` interface, `AuditRow`, `Task`/`DoD`/`Tier`, HITL types, and the orchestrator retry-policy.

## 4. Autonomy switch (how control is kept)
- Stages run **autonomously within guardrails**, calibrated by blast radius (Tier) — see `AGENT-GOVERNANCE.md §4`.
- **Tier 2–3** routine work ships autonomously through the gated pipeline.
- **Tier 0–1** (auth/schema/secrets/external/irreversible) → MANAGER HITL with a Change Decision Brief; enforced in CI by the **red-zone gate** requiring the `manager-approved` label (proven working, PR #4).
- **CLAUDE.md changes (any repo) always require MANAGER approval**, regardless of tier.

## 5. Concurrency model (git isolation)
Parallel tasks/sessions never share a working tree. Per `AGENT-GOVERNANCE.md §7`:
the ORCHESTRATOR provisions an isolated tree (clone/worktree) per concurrent task;
sessions model "independent engineers" via separate clones coordinating through
origin + PRs. This is a **Stage-1 platform task** (the transport currently runs
agents in the shared `targetRepo`).

## 6. Known platform gaps (from verification; Stage-1 backlog)
| ID | Gap | Where |
|---|---|---|
| F1 | `AuditRow.validations` + `decisions` written empty | orchestrator `writeStageAudit` — CHECKER H1 populates |
| F4b | agent `--allowedTools` grant is broad (`Bash`) | tighten to command-scoped patterns |
| F5 | transport token/cost parse returns 0 | needed before real budgets (G5) |
| — | no per-task worktree isolation | orchestrator provisioning (§5) |
| — | CHECKER not built | Stage 1, slice 1 |

## 7. What this supersedes / defers
- **Defers** (per `ARCHITECTURE.md §4.4 / §4.4-AGG`): specialized reviewer fleet + AGGREGATOR until the generalist REVIEWER misses a class 3× (SECURITY splits first).
- **Adds**: the CHECKER role + `CheckerOutput`/`Deficiency` contracts; the clone-per-session concurrency model; the working red-zone `manager-approved` gate.
- **No contradiction** with `ARCHITECTURE.md`/`HITL.md`: this layer sequences and extends them. If a future edit here diverges from those, reconcile per `AGENT-GOVERNANCE.md` contradiction discipline.

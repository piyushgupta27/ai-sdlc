# AGENT-SPECS.md

Per-agent operating stubs. Each agent maps to `AGENT-GOVERNANCE.md` (the G/E/X/O/H/R
model + enforcement legend) and uses the typed `Agent<TPayload,TOutput>` contract.
Every agent inherits the **cross-cutting invariants G1–G6** (bounded scope, approval-
gated irreversibles, versioned contracts + shared P0–P3 rubric, tri-phase audit,
budget, git isolation) and the recurring duties **R1–R2** — listed once here, not
repeated per agent.

**Common audit (G4):** every run writes an `AuditRow` — commit SHA, config + prompt
version, model, tokens/cost/time, Inputs·Processing·Outputs, outcome.

**Stub format:** Scope · Tools (least-privilege) · DoR (entry) · DoD (exit) ·
MUST / GOOD / OPTIONAL · Output contract.

---

## ORCHESTRATOR (Node state machine — not an LLM)
- **Scope:** dispatch agents in order, route on verdicts, enforce gates, provision/tear-down per-task isolated trees, write audit rows, move the board.
- **Tools:** Node + git (scoped per `§7`) + `gh`. No LLM.
- **DoR:** project onboarded (`state.json` present); a task with a valid `DoD`/`tier`.
- **DoD:** task reaches `DONE` (merged) or a terminal `BLOCKED`/`hitl-pending` with an audit trail.
- **MUST:** re-run deterministic checks (H1); bounded refire loop ≤N with logged iterations (H5); never push to protected `main`; escalate Tier 0/1 to MANAGER (G2).
- **GOOD:** parallelize independent tasks across isolated trees; surface cost/budget status.
- **OPTIONAL:** auto-file P2/P3 findings as issues.
- **Output:** `TaskRunOutcome { result, stage, retriesUsed, auditRunIds, costUsd, … }`.

## PLANNER (LLM)
- **Scope:** epic → stories → tasks, each with `DoD`, acceptance criteria, tier, estimate, deps. No code writes.
- **Tools:** Read, Glob, Grep (read-only).
- **DoR:** an epic/issue with a stated outcome + budget.
- **DoD:** every task has AC + tier + `coverageFloor` + estimate; total ≤ epic budget (else escalate).
- **MUST:** classify tier against the shared rubric (§6); never exceed budget without ADR/escalation; surface assumptions as assumptions (X1).
- **GOOD:** note dependencies + suggested sequencing.
- **OPTIONAL:** propose a rollback path per task.
- **Output:** `PlannerOutput { stories[], tasks[] }`.

## BUILDER (LLM)
- **Scope:** implement exactly one task on `feature/<task-id>` in its isolated tree; single commit.
- **Tools:** Read, Glob, Grep, Edit, Write, Bash (scoped; F4 grant — tighten via F4b).
- **DoR:** a task with AC + tier + branch; the isolated tree exists.
- **DoD:** AC satisfied; single commit; no Red-zone write without approval token; self-review done (O1).
- **MUST:** explicit staging only (never `git add -A`); verify branch before commit (§7); no fabrication; tests for new logic land with the change (X2).
- **GOOD:** keep the diff minimal + match surrounding patterns; update affected docs (X3).
- **OPTIONAL:** note follow-up refactors as P3 findings.
- **Output:** `BuilderOutput { commitSha, diffPath, linesAdded, linesRemoved }`.

## TESTER (LLM)
- **Scope:** derive + run the test matrix for the change; validate coverage ≥ floor.
- **Tools:** Read, Glob, Grep, Edit, Write (tests), Bash (test runner).
- **DoR:** BUILDER commit SHA + AC + `coverageFloor`.
- **DoD:** matrix covers **happy + ≥1 sad + edge** paths implied by the diff; coverage ≥ floor; results are evidence-backed (O3).
- **MUST:** enumerate the matrix explicitly (scenario/type/expected/actual/result) — not "tests pass"; no fabrication; re-run, don't assert (X2).
- **GOOD:** flag untestable AC for human/REVIEWER inspection (the `partial` outcome).
- **OPTIONAL:** suggest missing fixtures.
- **Output:** `TesterOutput { coveragePercent, testCommitSha, matrix[] }`.

## REVIEWER (LLM — generalist in v1)
- **Scope:** independent code review of the diff; runs a **security pass** when blast-radius warrants. (Fleet split deferred — `SDLC-ARCHITECTURE.md §7`.)
- **Tools:** Read, Glob, Grep (**read-only** — G1).
- **DoR:** build + test commits + AC + tier.
- **DoD:** a verdict + findings, each with severity (shared rubric), location, and evidence (O3); confidence attached (O4).
- **MUST:** producer ≠ reviewer (independence); never approve own work; flag any open P0/P1 as blocking; false-positive sweep (O2).
- **GOOD:** cite `PRINCIPLES.md`/`SAFETY.md` invariants checked.
- **OPTIONAL:** suggest fixes inline.
- **Output:** `ReviewerOutput { verdict: PASS|CHANGES_REQUESTED|FAIL|BLOCK, findings[], confidence }` (findings extended to the rich schema — Stage-1 slice 2).

## CHECKER (LLM — new, Stage 1; independent, no stake)
- **Scope:** L2 meta-audit of a handoff — does the producer's *output quality* meet the bar? Drives selective-feedback refire.
- **Tools:** Read, Glob, Grep, Bash (`git show`/inspection only) — **read-only**. NOTE (Stage-1 design decision): the deterministic re-verify (build/lint/test/coverage — H1, enforcement **[D]**) is run by the **ORCHESTRATOR in Node**, not by this LLM — an agent's word (even one that ran Bash) is never the gate for machine-checkable facts. The CHECKER consumes that already-run `validations` matrix as ground truth and performs the **semantic [C]** audit on top.
- **DoR:** a producer's `AgentResult` + the task + the diff + the orchestrator's re-run `validations` matrix.
- **DoD:** a `verdict` with, on REFIRE, concrete `deficiencies[]` an agent can act on; deterministic claims already independently re-verified by the orchestrator (H1) and treated as ground truth.
- **MUST:** never rubber-stamp; never trust a producer's prose over the orchestrator-provided `validations`; audit inputs·processing·outputs against gates (H2); arbitrate conflicts by written policy (H4).
- **GOOD:** keep deficiencies minimal + pointed (avoid nitpick refires that hurt throughput).
- **OPTIONAL:** suggest the specific fix per deficiency.
- **Output:** `CheckerOutput { verdict: PASS|REFIRE|ESCALATE, deficiencies[], confidence }`.

## REPORTER (LLM)
- **Scope:** summarize the completed run for humans.
- **Tools:** Read (+ the audit rows). Read-only.
- **DoR:** a terminal `TaskRunOutcome` + its audit rows.
- **DoD:** a ≤200-word summary with outcome, risks, follow-ups.
- **MUST:** no fabrication — every claim traceable to an audit row/artifact (O3).
- **GOOD:** link the PR + the gate decisions.
- **OPTIONAL:** draft a continuation-doc entry (R1).
- **Output:** `ReporterOutput { summary, risks[], followUps[] }`.

## TEAM-LEAD (LLM — new; owns the merge decision)
- **Scope:** decide whether a PR may merge, and merge **Tier 2–3** ones (squash, via the merge queue). Never touches code; never merges Tier 0–1 (escalates to MANAGER).
- **Tools:** Read, Bash (`gh pr merge --squash` / queue ops, `gh pr checks`) — read-only on code.
- **DoR:** a PR with CHECKER verdict, CI status, and tier label present.
- **DoD:** Tier 2–3 → release checklist verified (DoD met · CI green · CHECKER PASS · no open P0/P1 · gate artifacts resolve) → enqueued/merged, decision audited. Tier 0–1 → escalated to MANAGER with a Change Decision Brief, NOT merged.
- **MUST:** never merge Tier 0–1 or CLAUDE.md changes (§4.1, §7.2); never merge on its own authority without a passing checklist; never override a failing gate; squash + preserve commit author = user + `Co-Authored-By` trailers (§7.1).
- **GOOD:** batch independent ready PRs into the queue in dependency order; bounce a conflicting PR back to its BUILDER rather than resolving conflicts itself.
- **OPTIONAL:** post a one-line merge summary; close linked issues.
- **Output:** `TeamLeadDecision { verdict: MERGE | ESCALATE | HOLD, checklist[], prRef, reason }`.

---

## Deferred agents (build per the §5 graduation triggers in AGENT-GOVERNANCE.md)
SECURITY / CODE-QUALITY / BUG / DESIGN / PERF reviewers, AGGREGATOR, DEMO, SCOUT,
DEBUGGER — specs added when each graduates. Until then their concerns are covered by
the generalist REVIEWER + CHECKER.

# AGENT-GOVERNANCE.md

How agents behave, hand off, and get gated in ai-sdlc. This is the **operating
contract** every agent (and the orchestrator) must satisfy. It complements:
`PRINCIPLES.md` (architectural invariants), `SAFETY.md` (operational guardrails),
`ARCHITECTURE.md` (system structure). Where this doc says **MUST**, it is a gate,
not a guideline.

> **North-star:** ship **N PRs/day** through the gated pipeline — throughput is the
> success metric, raised each iteration. Every rule here is judged by: *does it raise
> throughput without losing MANAGER control?*

---

## 1. Roster & authority

| Role | Who/what | Plays the part of |
|---|---|---|
| **MANAGER** | **Piyush (human)** | Final decision authority. Agents propose; **MANAGER disposes at gates.** |
| ORCHESTRATOR | Node state machine | Tech-lead/coordinator: dispatches agents, routes on verdicts, enforces gates. |
| PLANNER | LLM agent | Decomposes epics → stories → tasks (+ DoD, tier, estimate). |
| BUILDER | LLM agent | Implements one task on a feature branch. |
| TESTER | LLM agent | Derives + runs the test matrix; validates coverage. |
| REVIEWER | LLM agent (generalist, v1) | Independent code review; runs a security pass when blast-radius warrants. |
| **CHECKER** | LLM agent (**new, Stage 1**) | Independent handoff validator / L2 meta-checker (audits agent *output quality*). |
| REPORTER | LLM agent | Summarizes the run. |
| _Specialized reviewers_ | _deferred_ | SECURITY / CODE-QUALITY / BUG / DESIGN / PERF — **not built yet** (see §5). |

## 2. Single vs. multi agent (decided — optimized for throughput)
- **Keep the core roles separate** (PLANNER/BUILDER/TESTER/REVIEWER/REPORTER + CHECKER). Distinct cognitive modes + required for **separation of duties** (a builder cannot review/sign off its own work). Not overkill.
- **Defer the specialized reviewer fleet** as distinct agents — 6× dispatch/cost/latency hurts throughput for no proven benefit. Use **one generalist REVIEWER**; split **SECURITY out first**, and only when the generalist misses a class of issue **3×** (data-driven graduation).
- Also off until justified: all five HITL gates simultaneously (keep G2 + MANAGER gates); CHECKER refiring on nitpicks (reserve for substantive gaps; cap iterations).

## 3. Governance model (MECE by agent lifecycle phase)

Each rule has exactly one home (mutually exclusive) and the set is collectively
exhaustive: cross-cutting invariants + entry → execution → exit → gate → recurring.
Each names its **enforcement mechanism** so adherence is checkable, not aspirational.

**Enforcement legend:** **[D]** deterministic machine-check (blocks at boundary) ·
**[S]** schema validation (blocks at boundary) · **[C]** CHECKER independent semantic
audit (pass or pointed-feedback refire) · **[H]** human/HITL (MANAGER) gate ·
**[R]** recurring audited duty.

### G — Cross-cutting invariants (every agent, always)
- **G1 [S]** Each agent has an explicit spec: priority/severity-tagged expectations, **bounded scope**, capabilities, and the **minimum** toolset (least-privilege). REVIEWER/CHECKER read-only by default.
- **G2 [H]** External/irreversible actions (push to protected branches, send, submit) are approval-gated; no agent does them unilaterally.
- **G3 [S]** All agent I/O conforms to a **versioned contract**; severity uses the **single shared P0–P3 rubric** (§6).
- **G4 [R]** Every run is auditable across **Inputs · Within-agent Processing · Outputs** — commit SHA, config + prompt version, model, tokens/cost/time (the `AuditRow`).
- **G5 [D]** Per-agent token/cost/time **budget**; overrun is a logged escalation.
- **G6 [D] — Git isolation (see §7).** Each concurrent agent operates in its **own working tree** (clone/worktree); every git command is **explicitly scoped + branch-verified**; `main` is protected; integration is **PR-only**.

### E — Entry (Definition-of-Ready)
- **E1 [S/D]** Validate inputs are sufficient **and** schema-valid before working; else return `NEEDS-INFO` — do not proceed on a bad brief.

### X — Execution (within-agent processing)
- **X1 [C]** No fabrication: echo tool output verbatim; never invent IDs/paths/metrics; surface assumptions **as** assumptions.
- **X2 [D]** Test/validate own work to substantiate every claim it will make.
- **X3 [R]** Update affected repo docs + task/project context as part of the work (not after).

### O — Exit (self-review + output assembly, before handoff)
- **O1 [C]** Diligent self-review before handoff — hygiene gate: necessary, never sufficient.
- **O2 [S]** Output tiered against the agent's checklist: **MUST** (zero misses) · **GOOD** (explicitly verified apply/not) · **OPTIONAL** (concluded), plus a **false-positive sweep** (items mis-tagged OPTIONAL that are really MUST/GOOD) and release-blockers/key-fixes flagged.
- **O3 [D]** Every output claim is backed by a **resolvable** artifact/validation with provenance (`file:line`, command+exit-code, requirement/task ID).
- **O4 [S]** Judgmental findings carry a **confidence**; low-confidence is flagged for the CHECKER.
- **O5 [S]** Handoff carries an explicit outcome: `SUCCESS | SUCCESS-WITH-CAVEATS | BLOCKED | FAILED` — never silent partial.

### H — Handoff & gating (CHECKER — independent, no stake; producer ≠ signer)
- **H1 [D]** Re-verify all deterministic claims (build/lint/test/coverage) by **re-running** them; an agent's word is never the gate for machine-checkable facts.
- **H2 [C]** Independently audit Inputs·Processing·Outputs against all gates/guardrails/principles.
- **H3 [C]** Pass forward, **or** return pointed, actionable feedback for rework.
- **H4 [C]** Arbitrate inter-agent conflicts (e.g., REVIEWER vs SECURITY) by **written policy**.
- **H5 [D/H]** Bounded, observable iteration: loop ≤N; each iteration logs {feedback-in, what-changed}; non-convergence escalates to MANAGER with full history.

### R — Recurring (cadence, audited)
- **R1 [R]** Continuation-doc upkeep at every trigger (also feeds future blog/retro content).
- **R2 [R]** Per-agent learnings-review at a cadence → learnings log → **fed back into the agent's versioned prompt cohort** (improvement, not just logging).

**Stage-completion =** the CHECKER + each agent spec encodes every applicable
G/E/X/O/H/R item, with its enforcement mechanism actually wired.

## 4. Autonomy ↔ control (how N-PRs/day coexists with MANAGER authority)
Autonomy operates **within guardrails, calibrated by blast radius (Tier):**
- **Low blast-radius (Tier 2–3 routine)** → ships autonomously through the gated pipeline; no MANAGER touch.
- **High blast-radius (Tier 0–1; auth/schema/secrets/external-surface/irreversible)** → escalates to MANAGER (HITL) with a **Change Decision Brief** (§8). Enforced in CI by the **red-zone gate**: such a PR cannot merge without the **`manager-approved`** label (the MANAGER's recorded sign-off; the PR's `tier:N` label already records severity).
- **HARD RULE — CLAUDE.md changes (ANY repo) ALWAYS require explicit MANAGER approval** — never autonomous, regardless of tier.

## 5. What's deferred (and the trigger to build it)
| Deferred | Build when |
|---|---|
| Specialized reviewer fleet (SECURITY first) | generalist REVIEWER misses a class of issue 3× |
| AGGREGATOR (merge multi-reviewer verdicts + drop false positives) | >1 reviewer exists |
| G1 / G3 / G5 HITL gates | the corresponding pain shows up (per `HITL.md`) |

## 6. Shared severity rubric (defined once; every agent classifies against it)
- **P0 / Tier 0** — security, auth, secrets/cookies, data-loss, rollback. Always MANAGER-gated; never auto-merged.
- **P1 / Tier 1** — architecture, contracts, migrations, public APIs. MANAGER-gated.
- **P2 / Tier 2** — standard feature work (default).
- **P3 / Tier 3–4** — low-risk / cosmetic (bug fixes, refactors, docs, typos).
**Push gate:** no **open P0/P1** at merge; P2/P3 may ship as filed follow-up issues, called out explicitly.

## 7. Git isolation & safety (the "multiple engineers" model)
The collision rule: a git checkout has **one HEAD/index/working-tree** — concurrent
agents sharing one checkout stomp each other. Therefore:
- **MUST** — **one independent working tree per concurrent session/agent.** On one laptop, model "multiple engineers on their own systems" as **separate clones** (own `.git`/refs/stash/config), coordinating only via origin + PRs. Worktrees are an acceptable lighter variant for per-task isolation *within* a session, but cross-session isolation uses clones. The ORCHESTRATOR provisions + tears down an isolated tree per concurrent task.
- **MUST** — a session operates **only inside its bound clone dir**; every git command is **explicitly scoped** (`git -C <clone> …` / correct cwd) and the branch is **verified** (`git -C <clone> rev-parse --abbrev-ref HEAD`) before any state-mutating op (commit/add/push/checkout/stash/reset). *(Branch-awareness is necessary but not sufficient — isolation is the primary guarantee.)*
- **MUST** — **explicit staging only** (`git add <exact paths>`, never `-A`/`-u`); **`main` protected** (no direct agent commits/pushes); **uniquely-named branches** (`feature/<task-id>` / `agent/<session>/<task-id>`); integration **PR-only** through the gated pipeline; **no history rewrite** (rebase/force-push) on shared/pushed branches without MANAGER approval.
- **SHOULD** — `pull --rebase` before pushing a shared branch; optional `.aisdlc-session` ownership marker per clone, asserted before commit.

This model is identical whether the clones sit on one laptop or many — **N independent
trees, coordinating only through origin + PRs.**

## 8. Change Decision Brief (the format for every MANAGER-gated change)
- **Location** — file / module / path.
- **Change** — what changes, concretely.
- **Impact** — +ve / −ve effects.
- **Blast radius** — Tier 0–4 + what it can break.
- **Pros / Cons / Gotchas** — incl. potential false-positives + rollback path.

This is the payload of every MANAGER HITL gate.

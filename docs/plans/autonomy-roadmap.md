---
title: "TRD/Roadmap: Autonomy to ITP-0 — one human as a safe, high-throughput merge authority"
status: proposed
created: 2026-06-12
owner: "@piyushgupta27"
tags: [trd, roadmap, autonomy, strategy, north-star]
supersedes-context: [AGENT-GOVERNANCE.md north-star framing]
---

# Autonomy Roadmap — to ITP-0 and merged-PRs/review-hour

> Master plan synthesizing two independent senior reviews (architect + eng-leader, 2026-06-12) + the owner's decisions. Every GitHub work-item below links back here. Written to the canonical TRD template (#75).

## 1. Goals / Objectives
Turn ai-sdlc into a system where **one human is a safe, high-throughput *merge authority*** — not a per-step approver. The human's only jobs become **(1) review + merge PRs (async)** and **(2) set roadmap**. Agents own **ticket → PR-raised** end-to-end with zero human clicks; gates move to **merge-time**; a deliberately-small high-stakes tail (tier-0, irreversible, ambiguous) stays human — but *async*, so the fleet never idles.

## 2. Context
- Pipeline (PLANNER→BUILDER→TESTER→REVIEWER→CHECKER→COMMIT) ships into N tenant repos via `claude` CLI subagents on a Mac. Solo owner, public AGPL, $100/mo budget pool.
- Shipped: append-only audit log, HITL queue, trust ladder (#62), per-dispatch worktree isolation (#19), budget guard, branch protection on `main` (set 2026-06-12), guardian-Opus / tier-routed-labor model routing.
- The owner's pain: must sit clicking "yes" across sessions to get one PR; ~80% of the day is unusable.

## 3. Problem Statement
Two independent reviews converged on one correction: **ITP→0 optimizes PR *supply*; the human is the constraint at *merge*.** Driving ITP→0 alone just relabels the clicks ("approve-to-progress" → "approve-to-merge"). The binding goal is throughput **through** the human.

## 4. Success Criteria (the metric model)
**North star: merged-PRs per review-hour.** ITP is a *diagnostic sub-metric*, never the goal (it's gameable — an agent that escalates less scores better while shipping worse).

The 6 KPIs a solo operator runs on:

| KPI | Catches | Trip-wire |
|---|---|---|
| **Merged-PRs / review-hour** | human leverage (north star) | trending down = pipeline noisier |
| **Revert + rework rate (≤7d)** | ITP-gaming / defect escape | >10% → auto-pause fleet |
| **Defect-escape rate by tier** | quality regression as autonomy widens | any tier-0/1 escape → freeze that tier |
| **Cost per *merged* PR** | economic reality (reverts inflate it) | >$5 → investigate |
| **% auto-flowed by tier + trust-progression** | is autonomy actually widening? | tier-3 not auto-merging = #1 lever unbuilt |
| **Stale-PR age / open-agent-PR queue depth** | over-emit / leaky pipeline | queue growing = stop scaling fleet |

**Definition of "done" (6–12 mo):** *"I set a weekly roadmap Sunday, bulk-approve a PLANNER-decomposed epic tree in 30 min, and spend ≤1 hr/day clearing a ranked review digest while the fleet ships tier-3 unattended and queues tier-0/1 for me."*

## 5. Economic / capacity model
- Measured ground truth: career-automation #45 = **$3.18/PR** (BUILD $0.74 + TEST $0.60 + REVIEW $1.24 + CHECK $0.59) — but this is an **API-equivalent** figure, **not a bill**.
- **The plan is a rate-limited subscription, not a metered dollar pool.** The $100 plan = a token **quota that refreshes every 5h** + a **weekly cap**. Per-PR cost does *not* deplete a dollar budget; the binding ceilings are the **5h/weekly rate window** and **human review throughput** — not dollars. **10–20 PRs/day is feasible on the current plan** if paced under the rate window.
- **Guardian-Opus floor:** PLANNER+REVIEWER+CHECKER stay Opus *always* (quality floor, most critical on auto-merge tiers where no human looks). Tier-routing the *labor* (BUILDER/TESTER → Sonnet/Haiku for tier-3/4) optimizes token **volume** (= rate-window headroom), not a dollar bill.
- Architecture additions are mostly deterministic/infra → ~0 extra tokens. Only the cross-vendor gate reviewer adds tokens, scoped to the tier-0/1 tail.
- **The brake is therefore usage-window-aware, not dollar-metered (#87):** pace the fleet to ~**60–80%** of the 5h session quota during the owner's active window (**6PM–2AM IST** — leave personal headroom), **higher (~90–95%) off-hours**; fallback to estimated-tokens-by-tier + a configurable max cap if the quota-% isn't deterministically fetchable.
- **Bottom line:** you hit the *review* wall (human merge throughput) and the *rate window* long before any dollar wall. "1 dev orchestrating agents" is economically real — as a **merge-authority** role.

## 6. Architecture decisions (settled)
1. **ITP-0 is a trust-and-evidence problem, not plumbing.** Push+PR already works; what's missing is verifiable proof the gates held + observability + crash-safety + evals.
2. **Gate moves to MERGE — but only after a signed gate-evidence bundle exists.** Moving the gate before the bundle = rubber-stamping diffs you can't verify (the one ordering you cannot get wrong).
3. **Observability = 4 planes:** AUDIT (immutable/replay, keep the hash chain) · METRICS (OTel→Prometheus/Grafana) · TRACES (per-run) · LOGS. Stop hand-rolling analytics on the audit chain. ITP + the 6 KPIs as named SLOs.
4. **Guardian-Opus-always; tier-route the labor.** Codified invariant.
5. **Buy, don't build** the commodity layer (observability, scheduler, sandbox *provider*, auth, merge-queue, eval harness). Spend scarce hours only on the governance/trust-ladder IP — the actual differentiator.
6. **Self-host the loop on ai-sdlc itself** — but platform core (orchestrator/router/sandbox/trust-logic/CLAUDE.md/blast-radius) is **permanent human-merge Red zone forever**; version-pin the dispatcher away from the code it edits; a PR can never weaken its own verifier.
7. **Real sandbox (microVM/gVisor) before unattended/untrusted scale** — laptop worktrees are isolation theater against prompt-injection; adopt a provider, don't hand-build.

## 7. Execution plan — phases (checkpoints)

### Phase 0 — Safety floor (NOTHING runs unattended until this lands)
The minimum that makes hands-off-while-away safe rather than reckless.
- **Signed gate-evidence bundle + verifier** (required status check): tests-ran-hashes, review verdicts, audit-chain-advanced+verified, no-red-zone-touched-without-label, budget-within-cap — signed (Sigstore/cosign keyless) so an agent can't forge it. **The keystone.**
- **Spend BRAKE (hard halt) + revert-rate circuit breaker** — a log is not a brake.
- **#78** dispatch outcome correctness (runs must not lie / cards must not pre-claim Done).
- **#12** secure the ntfy webhook trigger (prereq for any triggered/unattended dispatch).
- **Sandbox provider decision** (adopt for the unattended/untrusted path).

### Phase 1 — Visibility (can't drive a metric you can't see)
- **First-class observability**: OTel instrumentation → light backend (Grafana Cloud free tier / single-binary); ITP + the 6 KPIs; repoint the :3001 dashboard to the metrics plane.

### Phase 2 — Demand lever (review-compression — buys back the day)
- **Auto-merge green tier-3** (TEAM-LEAD, #21) — the proof-of-life milestone; halves review load if ~50% of output is tier-3.
- **Relocate the trust gate to merge-time** — always raise the PR; gate the merge (safe once Phase 0 bundle exists).
- **Batched ranked review digest** (#48 extended) — review the tier-0/1 tail, not 12 PRs individually.
- **PLANNER bulk-approval** — one G1 approval → an epic→story→task tree; keeps the fleet fed (good intent is the scarce input).
- **Unattended scheduled runner** (budget-paced) — "PRs every few hours."

### Phase 3 — Earn trust with data
- **Eval harness** (golden-set + defect-escape; seed from audit history; nightly) — trust-progression keyed on *measured* quality, not ticket-counts. Fills the empty `fixtures/` keystone.
- **Cross-vendor final reviewer** — break the Claude-on-Claude monoculture at the gate (un-defer the typed openai/codex transports; tier-0/1 + final gate only).
- **Tiered model routing + guardian-Opus invariant + Opus 4.8 + Haiku-on-tier-4** (the decision of 2026-06-12).

### Phase 4 — Scale (only after correct + enforced + measured)
- **Per-task Merkle audit sub-chains** (#70) → **concurrent dispatch** (#73).
- **Durable-execution orchestrator (DBOS)** — crash-safe, idempotent, exactly-once dispatch for unattended hours.
- **Event-driven dispatch** (GitHub webhook → workflow; replace polling).
- **Self-host on ai-sdlc tier-3/4** (core red-zoned).
- **Per-tenant cost attribution + sub-budgets**.

## 8. Observability — Monitoring & Alerting
Per Phase 1. SLO alert: **tier-≥2 ITP > 0** (regression where autonomy was claimed) → page. Tier-0/1 ITP is expected (the merge gate) → excluded. Revert-rate >10% → auto-pause fleet (Phase 0 breaker).

## 9. Testing
Each capability ships with its own gate; the eval harness (Phase 3) becomes the meta-test for agent quality. Evidence bundle verifier is itself tier-0 (own human gate; can't be weakened in the PR that uses it).

## 10. Cost
Per §5. Phase work is mostly infra (~$0 token). The recurring cost is the fleet's per-PR spend × volume, governed by the budget brake.

## 11. Unknowns / Risks / Contingencies (ranked)
1. **MERGE-gating without the evidence bundle = silent bad merges.** Bundle MUST precede gate-relocation.
2. **Over-emit past review capacity** (leaky pipeline) → auto-merge tier-3 + WIP cap tied to review capacity + stale-PR KPI.
3. **Blown budget unattended** → hard spend brake.
4. **Prompt-injection → device/secret compromise** → real sandbox before scale; egress allowlist (#10); deny-env (shipped).
5. **Crash mid-task unattended** → durable execution.
6. **Roadmap starvation** (fleet outruns good intent) → PLANNER bulk-decomposition.
7. **Trust promoted on proxies not evals** → eval harness gates promotion.
8. **Platform self-bricks** → core permanent red-zone + version-pinned dispatcher.
9. **Audit-chain write contention under parallel** → per-task Merkle sub-chains before #73.
10. **Reviewer monoculture** through the gate → cross-vendor final reviewer.

## 12. External Research
Two senior reviews (2026-06-12). Standards cited: OpenTelemetry, Prometheus/Grafana, DBOS/Temporal (durable execution), Firecracker/gVisor microVMs (Cognition container→microVM), Sigstore/cosign (signing), GitHub App short-lived tokens. Benchmarks: ~2–8 PR-reviews/human/day; $3.18/PR measured.

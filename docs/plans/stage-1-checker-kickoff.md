# Stage 1 — CHECKER · kickoff prompt (paste into a fresh conversation)

> Copy everything in the fenced block below into a new Claude Code conversation
> started in `~/Workspace/ai-sdlc`. It's self-contained.

```
We're building Stage 1 of the ai-sdlc platform: the CHECKER agent. Work in
~/Workspace/ai-sdlc. Use Node 22: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` (pnpm 10).

READ FIRST (in order):
1. docs/plans/2026-05-31-aisdlc-maturity-plan.md — the overall plan (Stage 0→3) + agent governance model.
2. docs/plans/verification-2026-05-31.md — what Phase A actually does + findings F1/F4/F5.
3. AGENT-GOVERNANCE.md — the operating contract (MECE G/E/X/O/H/R model, roster incl. CHECKER + TEAM-LEAD, §7 git, §9 security). CHECKER is the H-phase enforcement.
4. SDLC-ARCHITECTURE.md §3 — the CHECKER design + CheckerOutput/Deficiency contracts already sketched.
5. AGENT-SPECS.md — CHECKER spec stub (scope/tools/DoR/DoD/MUST/output).
6. CONTINUATION.md top entry — current state.
7. CLAUDE.md — repo rules + Red zone (Tier 0/1) list; honor the MUST rules (agent NEVER self-approves; commits authored as Piyush; no direct main push — PR-only, squash).

AUTONOMY BACKLOG (raised from the CareerAutomation session's learnings-review 2026-06-03 —
on ai-sdlc Project #1, label `autonomy`; prioritize per MANAGER):
  #19 clone/worktree isolation per concurrent agent (the #1 multi-session blocker)
  #20 per-repo runtime contract auto-selected (Node 20/npm vs 22/pnpm)
  #21 build CHECKER + TEAM-LEAD ← THIS kickoff is #21, the first/biggest
  #22 preflight health check (toolchain + CI-green) before agent work
  #23 codify the critical-interrupt taxonomy (sharpen AGENT-GOVERNANCE §4)
These five are what get the platform to minimal-interrupt autonomy. Start with #21 (below).

WHAT TO BUILD (smallest viable slice first):
Slice 1 — CHECKER + selective-feedback refire. A read-only L2 meta-checker that audits whether a
producer agent's OUTPUT QUALITY meets the bar (e.g. did TESTER's matrix cover the sad/edge paths
implied by the diff?), emits structured deficiencies, and the orchestrator refires ONLY the owning
agent with ONLY those deficiencies. Extends the existing OUTCOME-based retry loop with a
QUALITY-based gate — does not replace it.
  1. Add `CHECKER` to the AgentRole enum; implement agents/checker/index.ts against the existing
     Agent<TPayload,TOutput> interface (read-only toolset per G1). Prompt at prompts/checker/v1.md.
  2. `CheckerOutput` schema (versioned, G3): { verdict: PASS | REFIRE | ESCALATE, deficiencies:
     Deficiency[], confidence }. Deficiency = { owner_role, severity (shared P0–P3), what,
     why_it_matters, evidence_ref, suggested_fix }. Deterministic facts (build/lint/test) are
     RE-RUN (H1), never trusted from the producer's word.
  3. Orchestrator wiring (tools/sdlc/orchestrator/index.ts — Tier 1 Red-zone, needs MANAGER approval
     to merge): after a producer handoff, dispatch CHECKER; on REFIRE re-dispatch the owning agent
     with the deficiencies as sole new input. Bounded loop ≤N (reuse retry-policy counter), each
     iteration logs {feedback-in, what-changed} to the AuditRow; non-convergence → HITL escalation.
  4. While here, close F1: populate AuditRow.validations (the deterministic matrix is written empty
     today at orchestrator/index.ts writeStageAudit) and F5: fix transport token/cost parse (returns 0).
Slice 2 (after Slice 1 lands) — richer ReviewerOutput.findings to match the Deficiency schema.
DEFER: specialized reviewer fleet + AGGREGATOR (graduation triggers in AGENT-GOVERNANCE §5).

REUSE, DON'T REINVENT: Agent interface, AuditRow, Task/DoD/Tier, HITL types, retry-policy.

PROCESS (non-negotiable):
- Reduce work to small atomic PRs. Pre-PR: `pnpm run typecheck && pnpm run lint && pnpm test` (full
  output, no pipe). Run /code-review before merge on non-trivial PRs.
- main is PR-only + squash-merge. Commits authored as Piyush (Co-Authored-By Claude). The agent NEVER
  self-approves/merges. Tier 0/1 (orchestrator/index.ts, types/, router/, CLAUDE.md, etc.) → post the
  PR link and WAIT for Piyush's review/merge. Tier 2/3 docs/agent-impl → still PR, Piyush merges (no
  TEAM-LEAD agent runtime exists yet — it's specced, not built).
- Operational/continuation docs ride the next PR (no standalone PR, no direct main push).
- Stage-1 DONE = CHECKER + both slices shipped, every applicable G/E/X/O/H/R item wired, full tests
  green, and ONE real dispatch showing a CHECKER REFIRE → bounded refire → converge in the audit log
  (use an isolated throwaway target like the Stage-0 smoke: a /tmp repo + projects/<slug> config, never
  the real Ready board). Verify the live cycle, don't just unit-test.

FIRST STEPS: read the docs above; confirm Phase A still builds/tests green on Node 22; then enter plan
mode and design Slice 1 before writing code.
```

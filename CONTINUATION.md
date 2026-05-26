---
name: ai-sdlc-continuation
description: Self-contained continuation doc. Read end-to-end after /compact and you have full context to resume without conversation memory.
status: live
created: 2026-05-26
updated: 2026-05-26
version: 1.0
owner: piyush
tags: [continuation, post-compact, resume]
---

# ai-sdlc · CONTINUATION

> **You are reading this after /compact.** The conversation buffer is empty. This document is your full context. Read it end-to-end before doing anything else.
>
> If you're a fresh agent: also read `README.md`, `ROADMAP.md`, `ARCHITECTURE.md`, and `REQUIREMENTS.md` at repo root.
>
> If you're Piyush: this is your "where were we?" doc.
>
> **Convention (per global CLAUDE.md §7):**
> - **Active context** (below) — checkpoints I (the assistant) append at meaningful moments. Newest first.
> - **Snapshots** (later, auto-appended by PreCompact hook at `~/.claude/scripts/snapshot-continuation.py`) — don't edit manually.
> - The marker file `.continuation-doc-path` in repo root tells the harness this doc is live.

---

## Active context

> Most recent first. Each entry is self-contained — a cold reader after /compact can resume from any entry without needing earlier ones.

### 2026-05-26 16:30 — Phase A shipped + first real end-to-end commit through the pipeline

**State:** v1 pipeline operational. First real-commit smoke test passed at 101s, 0 retries. SHA `3d91c7b` ("docs: update README status — Phase A shipped") authored on `feature/gh-2` by BUILDER (Sonnet 4.6), verified by TESTER + REVIEWER, audit chain intact. Card #2 on GH Project #1 → Done. Currently on `main` after switching off `feature/gh-2`.

**Just completed (this session, chronological):**
- v1 foundation shipped: types + audit log (hash chain) + blast-radius hook + file-ops wrapper + 5 agents (PLANNER, BUILDER, TESTER, REVIEWER, REPORTER) + orchestrator + router + CLI + dashboard. CI green (31/31 tests).
- Plumbing wired (commit `2c1c66a`): board/lint/dispatch read real GitHub Projects + ntfy outbound on G2.
- Bootstrap script (`305feee`): idempotent one-shot for new testbeds — creates GH Project, sets 7 canonical Status options via GraphQL, creates 7 issue labels.
- `projects/` gitignored (`125066f`) — machine-local runtime state.
- ai-sdlc onboarded as own testbed; GH Project #1 (`piyushgupta27/projects/1`) live with all 7 columns + `tier:0..4`/`blocked`/`hitl-pending` labels.
- Smoke test #1 (gh-1, tier:4 "fix typo"): MERGED no-op. Agents correctly diagnosed "no typo to fix," 166s, all 3 audit rows clean. Card → Done.
- 3 bugs fixed from smoke test #1 (`e8006fa`): (1) labels read from wrong JSON path in `github-projects.ts`; (2) JSON parser too brittle in `agents/base.ts` — added string-aware brace matching; (3) failed responses invisible — added stderr dump of first 800 chars.
- "Build commit:" notes fix (`6dc3efb`): clearer messaging when no commit produced.
- **Permissions postmortem:** smoke test #2 (gh-2, tier:3) first attempt failed — BUILDER timed out 3× at 300s each because `git checkout -b feature/gh-2` hit the Claude Code permission wall in the spawned subagent. BUILDER's audit notes self-diagnosed the issue: "Two permission blocks prevented completion."
- **Layer 2 fix (`516357b`):** Created `.claude/settings.json` (committed) with the explicit allowlist for spawned BUILDER/TESTER/REVIEWER — Edit/Write/Read/Glob/Grep + git read-only + branch/checkout/switch + add/commit + pnpm run typecheck/lint/test/build/exec. Pointedly excludes `git push`, `gh pr create`, destructive shell. Anyone cloning ai-sdlc + running `pnpm sdlc dispatch` now gets correct subagent perms automatically.
- Smoke test #2 retry: ✅ MERGED, 101s, 0 retries, SHA `3d91c7b`. Real commit, conventional format, exact AC compliance (1 file, 1 line, ~30 words, references ROADMAP).
- 2 new memory files written: [[personal-brand-portfolio-2026]], [[ai-sdlc-platform-and-testbeds]]
- This continuation doc set up (you're reading it).

**Up next (in order):**

1. **Polish 3 items surfaced by smoke test #2** (the "b" from user's `b -> c`, ~1 hr):
   - **COMMIT stage isn't wired.** Orchestrator says "ready for COMMIT stage in CLI" but no `gh pr create` happens. Card → Done via REVIEW pass; actual PR creation missing. Fix in `orchestrator/index.ts` finalizeSuccess() or in the dispatch CLI verb.
   - **Branch not reset after task.** Orchestrator left us on `feature/gh-2`; should `git checkout main` (or `develop`) after returning. Fix in dispatch's projectItemToTask flow or orchestrator post-success cleanup.
   - **TESTER outcome "partial"** on gh-2 — pipeline still merged, but worth understanding. Read the row's notes in `.audit/2026-05-26/audit.jsonl`. Likely: TESTER couldn't run full test suite due to permission patterns or scope.

2. **Phase B: trip-research onboarding** (Tier 0 — needs explicit user "go" beyond the upstream `b -> c`):
   - MIGRATION.md at `~/Workspace/ai-workspace/projects/active/trip-research/MIGRATION.md`
   - Before executing, summarize the destructive/structural actions and confirm
   - Then `bootstrap-project-board.sh trip-research piyushgupta27 piyushgupta27/trip-research`
   - Then `pnpm sdlc onboard --slug trip-research ...`
   - Then real testbed dispatch

3. **Open polish items remaining (not blocking):**
   - `pnpm sdlc onboard` should template `.claude/settings.json` into each new testbed automatically (so trip-research doesn't hit the same permission timeout)
   - Public dashboard URL config + click_url in ntfy push (for mobile HITL approval)
   - Anti-monoculture reviewer fleet (2→4→6) deferred to v1.5+; v1 uses single REVIEWER (Opus, temp 0.7)

**Reference docs:**
- `README.md` — repo-root overview, now reflects Phase A shipped
- `ARCHITECTURE.md` — full architecture, multi-tenant model, blast-radius tiers, HITL gates
- `REQUIREMENTS.md` — R-AISDLC-* requirements; Q-AI-* decisions (some amended during migration)
- `ROADMAP.md` — phase plan; Phase A complete, Phase B trip-research is next
- `HITL.md` — 5 HITL gates spec'd; v1 wires G2 only
- `ONBOARDING.md` — how to onboard a new testbed end-to-end
- `tools/sdlc/scripts/bootstrap-project-board.sh` — one-shot GH Project + labels setup
- `.claude/settings.json` — committed Claude Code permissions for spawned subagents

**Project board state (2026-05-26 16:30):**
- #1 "Add a typo fix to README" → Done (no-op, smoke test #1)
- #2 "Update README status — Phase A is shipped" → Done (real commit, smoke test #2)

**Memory references this session relied on:**
- [[continuation-doc-zero-exceptions]] — the rule I'm following now
- [[ai-sdlc-platform-and-testbeds]] — strategic framing
- [[personal-brand-portfolio-2026]] — user's blog/portfolio goal
- [[subagent-fabrication]] — sub-agent prompt discipline
- [[pre-pr-verification]] — local lint+build+test before pushing

---

## Snapshots

> Auto-appended by `~/.claude/scripts/snapshot-continuation.py` (PreCompact hook). Don't edit manually.

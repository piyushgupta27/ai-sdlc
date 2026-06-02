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

### 2026-06-02 21:30 — piyush-portfolio LIVE on Vercel · all 10 PRs merged · restoration fix applied

**State:** piyush-portfolio is fully live in production. All 10 originally-planned PRs (#7-#20) merged to `main`. Live production URL: **https://piyush-portfolio-topaz.vercel.app/** (canonical short alias Vercel auto-assigned; the bare `piyush-portfolio.vercel.app` is someone ELSE's site that claimed that short name first — NOT this project). Domain `piyushgupta.io` is NOT yet attached. Content verified live via curl: shows "Piyush Gupta", "Slice", "jumpingMinds", "piyushguptaece" with zero "Aaabad Touk" leakage.

**Project URLs:**
- Public: `https://piyush-portfolio-topaz.vercel.app/` ← canonical
- Team-scoped (SSO-protected): `piyush-portfolio-piyushguptaece-2914s-projects.vercel.app`
- Main branch alias (SSO-protected): `piyush-portfolio-git-main-piyushguptaece-2914s-projects.vercel.app`

**Major findings + fixes from this session:**

1. **Vercel MCP fully working** — `mcp__claude_ai_Vercel__*` tools loaded + used productively. Team `team_oARqsHsV5x5MPV3Bsmy3BUvn`, project `prj_1j416gQpZHnUPlNLgxvaEKsy7hMA`.

2. **Filed + dispatched 4 follow-up CSO tickets** via ai-sdlc:
   - #13 (gh-13) Move shadcn → devDeps + Next.js upgrade → PR #17
   - #14 (gh-14) Add CSP + security headers → PR #18
   - #15 (gh-15) Gitignore `.audit/`/`.sdlc-queue/` → PR #19
   - #16 (gh-16) Replace aaabad PII in footer/navbar/socials → PR #20
   3/4 dispatched fully autonomously; gh-16 had the gh-3-style post-commit hang → manually recovered.

3. **Merge-conflict cascade** — after PR #7 + #8 manually merged, all others had package.json conflicts (test scripts diverged). Rebased every branch onto current main with `git checkout --theirs`. All eventually merged.

4. **CRITICAL: `--theirs` rebase silently reverted upgrades** — taking older branches' package.json over newer main reverted PR #17's Next.js 16.2.6 upgrade + shadcn devDeps move, and PR #18's vitest devDeps. Lockfile still had new entries → `ERR_PNPM_OUTDATED_LOCKFILE` → prod deploys for #9/#10 ERRORED. Restored via commit `492cf4a` (manual package.json rewrite + lockfile regen).

5. **One aaabad ref missed by PR #20** — `hero.tsx:108` had GitHub `github.com/aaaby-code` + Twitter `x.com/aaabadcode` in a social-icon row out of #20's scope. Fixed in commit `37abf89` (GitHub → piyushgupta27, Twitter → LinkedIn).

6. **Wrong-URL mistake by me** — I initially told the user the site was at `https://piyush-portfolio.vercel.app/`. WRONG — that's someone else's site. The correct URL is `https://piyush-portfolio-topaz.vercel.app/`. User caught this. Recorded here so next session doesn't repeat.

**Done:**
- All 10 portfolio PRs merged into main
- Restoration commit `492cf4a` (deps + lockfile)
- Hero social-row fix `37abf89`
- Live deploy verified READY + serving Piyush's content
- CSO audit run earlier — report at `/tmp/piyush-portfolio-cso-report.md`
- This entry on main (you're reading it)

**Up next (in order):**

1. **End-to-end visual `/browse` verification** of https://piyush-portfolio-topaz.vercel.app/ — desktop + mobile screenshots, check every section. NOT done yet.
2. **Attach `piyushgupta.io` domain** in Vercel Settings → Domains (manual; needs DNS at registrar).
3. **Replace stock hero/about images** (CSO Finding #6) — `hero.tsx:16` and `about.tsx:32` are aaabad's stock Unsplash photos; need real photos before domain attach.
4. **File 3 ai-sdlc platform follow-ups** (against `piyushgupta27/ai-sdlc`):
   - `--theirs` rebase footgun: BUILDER shouldn't touch package.json scripts unless explicitly required; or ai-sdlc should auto-rebase open PRs with semantic-merge directives instead of blind --theirs
   - Post-commit hang pattern (gh-3 / gh-16): BUILDER commits then hangs on post-commit verification → 300s timeout. Investigate `pnpm install` TTY wait on build-script approval.
   - Vercel deploy verification: TESTER should poll Vercel deploy state post-PR-creation, fail the task if production deploy ERRORs.
5. **Phase B (deferred)**: trip-research onboarding via `~/Workspace/ai-workspace/projects/active/trip-research/MIGRATION.md` — Tier 0, needs explicit user "go".
6. **Tighten `.claude/settings.json`** (CSO Finding #7) — narrow `Bash(pnpm:*)`/`Bash(node:*)` wildcards to specific subcommands.

**Reference paths:**
- piyush-portfolio repo: `~/Workspace/piyush-portfolio/`
- Live URL: `https://piyush-portfolio-topaz.vercel.app/`
- Vercel project: `https://vercel.com/piyushguptaece-2914s-projects/piyush-portfolio`
- GH Project board: `https://github.com/users/piyushgupta27/projects/2`
- CSO audit report: `/tmp/piyush-portfolio-cso-report.md`

**Open PRs (piyush-portfolio):** NONE. All merged. Board: 10 cards in Done.

**Memory entries this session relied on:** [[ai-sdlc-platform-and-testbeds]], [[personal-brand-portfolio-2026]], [[github-contributions-authorship]], [[pre-pr-verification]], [[multi-session-awareness]] (violated twice on ai-sdlc; lesson: ALWAYS `git branch --show-current` before commit), [[continuation-doc-zero-exceptions]].

**Things needing user attention post-compact:**
1. Visit https://piyush-portfolio-topaz.vercel.app/ and visually verify it looks correct
2. Decide on piyushgupta.io domain attach timing
3. Decide whether to file the 3 ai-sdlc platform follow-up tickets

**Caveat about the OTHER session's branch:** The branch `chore/approval-authorship-must` (open PR on ai-sdlc) has its own earlier copy of this entry (commit `af2ab78`) WITH THE WRONG URL `piyush-portfolio.vercel.app`. When that PR merges, expect a merge conflict on CONTINUATION.md — keep main's version (this entry, with the correct topaz URL).

### 2026-05-31 12:55 — piyush-portfolio: 6 PRs open + Vercel just connected + MCP installed; restart needed

**State:** piyush-portfolio is the second ai-sdlc testbed and the focus this session. Six tickets dispatched, six PRs open (#7-#12 on `piyushgupta27/piyush-portfolio`). Vercel project created + connected; production deployed `main` (still aaabad's baseline because none of the PRs are merged yet). **Vercel coding-agent plugin just installed via `npx plugins add vercel/vercel-plugin`** — 26 skills + 6 cmds + 3 agents + hooks + MCP registered. **Requires Claude Code restart before the new `mcp__vercel__*` tools become available.**

**Just completed (this session):**
- Forked `aaaby-code/portfolio` → `~/Workspace/piyush-portfolio` (Next.js 16 + Tailwind v4 + shadcn + Geist + framer-motion)
- Swapped accent: cyan → Soft Teal (`oklch(0.87 0.10 175)` ≈ `#5eead4`)
- Pushed to `github.com/piyushgupta27/piyush-portfolio` (public)
- Bootstrapped as ai-sdlc testbed #2 (project #2, all canonical columns, tier labels)
- Filed 6 tickets, dispatched via ai-sdlc → 6 PRs open. **Result: 3 truly autonomous (PR #9/#10/#11), 3 needed manual cleanup (PR #7/#8/#12). 700+ lines of real code + tests.**
- **Fixed 3 ai-sdlc platform bugs surfaced by this dispatch** (commit `0319a8f` + `08ea5ff` on ai-sdlc main):
  - `gh project item-list --format json` parsing failed on multi-line issue bodies — added state-machine sanitizer
  - retry-policy.ts: `CHANGES_REQUESTED` triggered useless BUILDER retries — now passes through
  - dispatch.ts: loop broke on first HITL/failure — now continues, marks Blocked, moves on
- Vercel project deployed `main` to `piyush-portfolio-piyushguptaece-2914.vercel.app` (URL guessed; verify via dashboard)
- Discovered Vercel doesn't auto-create previews for pre-existing branches — needs push or API trigger
- Installed Vercel coding-agent plugin

**Up next (after Claude Code restart):**

1. **Use the new `mcp__vercel__*` MCP tools** to fetch real preview URLs for each of PRs #7-#12 (currently 404 on guessed URL patterns). If a branch has no preview, trigger one via `trigger_deployment`.
2. **For each preview URL**: `/browse` desktop + mobile, screenshot, capture console errors. Post the screenshots as comments on each PR.
3. **You wake up tomorrow to 6 PRs with embedded visual evidence** — review and merge.
4. **File ai-sdlc#N: VISUAL_VERIFIER agent** — extends TESTER with /browse-driven screenshots + lighthouse + axe, attaches to audit row. v1.5 architecture work.
5. **File ai-sdlc#N+1: PR body templating with visual evidence** — auto-embed screenshots in PR description from BUILDER's preview deploy.
6. **Phase B (deferred)**: trip-research MIGRATION.md execution. Still waiting on user "go" for Tier 0.

**Reference paths:**
- piyush-portfolio repo: `~/Workspace/piyush-portfolio/`
- GH Project: `https://github.com/users/piyushgupta27/projects/2`
- Vercel project: `https://vercel.com/piyushguptaece-2914/piyush-portfolio`
- ai-sdlc fixes shipped this session: commits `0319a8f` (retry/dispatch) + `08ea5ff` (gh JSON sanitizer)

**Open PRs (all on piyush-portfolio):**
- #7 — feature/gh-1 — hero copy
- #8 — feature/gh-2 — about bio
- #9 — feature/gh-4 — Slice + jM experience (autonomous)
- #10 — feature/gh-5 — contact links (autonomous)
- #11 — feature/gh-6 — site metadata (autonomous)
- #12 — feature/gh-3 — 5 projects (manual recovery after post-commit hang)

**Things explicitly NOT done yet:**
- piyushgupta.io custom domain attached to Vercel (Settings → Domains)
- Visual QA via Vercel previews (this is what restart unblocks)
- ai-sdlc visual-verifier agent (file as ticket)
- ai-sdlc gh-3-style post-commit-hang investigation (the 11-hour wall-time bug)

### 2026-05-26 16:45 — b complete: COMMIT stage wired + branch-reset + TESTER 'partial' documented

**State:** All 3 polish items from smoke test #2 addressed. ai-sdlc dispatch now does: BUILDER commits → push branch → `gh pr create` → card to Done → `git checkout main`. End-to-end autonomous PR creation, with deliberate permission gates for the first time push/gh pr create fire.

**Just completed:**
- `TaskRunOutcome` now carries `commitSha` and `branch` (orchestrator/index.ts) — threaded from finalizeSuccess.
- `dispatch.ts` got `maybeCreatePr()` + `resetToMain()` helpers. On merged + non-empty commitSha: push the feature branch, then `gh pr create --base main --head <branch>`. PR body templated from issue (Closes #N + summary + ticked AC checklist + ai-sdlc footer with short SHA).
- Best-effort error handling: push or PR-create failures log + continue (branch is local, user can finish manually). The user is prompted for `git push` + `gh pr create` permissions on first run; granting "always" makes subsequent runs fully autonomous.
- `git checkout main` after every task (success OR failure), preventing the "left on feature/gh-2" footgun from smoke test #2.
- `nextStageAfter` got a code-comment lock-in: TESTER 'partial' is intentional (human-verifiable ACs); never escalate to BLOCKED.

**Shipped at `660065c`.** 31/31 tests still pass. NOT yet live-tested — no smoke test for the PR-creation path yet.

**Up next (Phase B):**
1. Optionally: file a small test issue + dispatch to verify `maybeCreatePr` actually fires correctly (5 min). Recommended before Phase B, but skippable.
2. Read `~/Workspace/ai-workspace/projects/active/trip-research/MIGRATION.md`, summarize the Tier 0 destructive actions, get explicit user go.
3. Run `bootstrap-project-board.sh trip-research piyushgupta27 piyushgupta27/trip-research`.
4. `pnpm sdlc onboard --slug trip-research ...`
5. First real-world testbed dispatch.

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

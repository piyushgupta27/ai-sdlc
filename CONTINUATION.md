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

### 2026-06-03 — Stage-1 CHECKER plan LOCKED · building Slice 1 as 3 PRs (PR1‖PR2 parallel)

**State:** On `main` @ `9cb58f1`, Node 22, clean tree (only untracked `.audit/`, `.gstack/`, `docs/plans/stage-1-checker-kickoff.md`). Phase A green (typecheck clean, 31/31 tests, 1 pre-existing lint warning = F3 at dispatch.ts:465). Plan for Stage-1 Slice-1 (CHECKER + selective-feedback refire) is MANAGER-approved. Building now.

**Design decisions locked with MANAGER this session:**
- **H1 deterministic re-verify runs in Node (orchestrator), NOT in the CHECKER LLM.** An LLM-with-Bash reporting "tests pass" is still an agent's word; the `[D]` gate must be a real machine run. CHECKER (LLM) does the semantic `[C]` audit only. (Deviates from AGENT-SPECS.md §CHECKER stub — I update that stub in PR2.)
- **3-tier gate ordering (cheap→expensive), from MANAGER's evidence idea:** (1) handoff-completeness check (Node, ~free — REFIRE incomplete evidence before any run/LLM, enforces E1/O3/O5); (2) deterministic re-verify (Node, once, authoritative — H1, closes F1); (3) semantic audit (CHECKER LLM — H2/H3). Plus SHA-cache to avoid redundant re-runs in the refire loop.
- **Agent-supplied evidence can't replace re-running deterministic facts today** (single-process; agent evidence is forgeable text). True evidence-based skip needs a sandbox harness emitting signed commit-bound artifacts → filed #25.
- **Tier-calibrated skip of the re-run = DEFERRED** with measurable graduation trigger → filed #24 (not left as prose).
- **MAX_CHECKER_REFIRES = 2** (small, to protect throughput — "reserve for substantive gaps").

**PR decomposition (all 3 touch Tier-1 Red-zone → ALL need MANAGER review; agent never self-merges):**
- **PR1 — F5 transport fix** (`router/claude-code-subagent.ts` + `agents/base.ts`): switch to `claude --print --output-format json`, parse real `usage` tokens + `total_cost_usd` (verified the envelope shape live), replacing the broken stderr regex that returns 0. Threads accurate cost through DispatchResponse→base. Unit-tested.
- **PR2 — CHECKER contracts + agent + prompt** (`types/checker.ts` new, `types/audit.ts` AgentRole+='checker', `types/task.ts` Priority P0–P3 + Stage+='CHECK', `types/agent.ts` AgentTypeMap+isV1AgentRole, `router/select-model.ts` checker route Opus temp 0.4, `agents/checker/index.ts`, `prompts/checker/v1.md`). Ships **inert** (tested, not wired). File-disjoint from PR1.
- **PR3 — orchestrator wiring + F1 + live proof** (`orchestrator/index.ts`, new `orchestrator/validations.ts`, `retry-policy.ts` shouldRefire+MAX_CHECKER_REFIRES, `types/project.ts` validationCommands, builder/tester/reviewer payloads+prompts get `deficiencies?`). The 3-tier gate + bounded refire loop + audit `{feedback-in, what-changed}` + live REFIRE→converge proof on a throwaway `/tmp` repo. **Waits for PR2 merge** (no stacked PRs).

**Parallelization:** PR1 ‖ PR2 built concurrently via 2 worktree-isolated sub-agents (dogfoods §7). PR3 after PR2 merges.

**Up next (if "keep going"):** verify both sub-agent PRs (gates green, diffs sane), post both PR links, WAIT for MANAGER review/merge. Then build PR3 after PR2 lands.

**Open follow-ups:** #24 (tier-calibrated skip), #25 (trusted evidence artifacts/sandbox), #21 (autonomy 3/5 = this CHECKER+TEAM-LEAD work). F3 lint warning (cosmetic) can ride PR3.

**Reference docs:** `docs/plans/stage-1-checker-kickoff.md`, `docs/plans/2026-05-31-aisdlc-maturity-plan.md`, `AGENT-GOVERNANCE.md`, `SDLC-ARCHITECTURE.md §3`, `AGENT-SPECS.md §CHECKER`.

### 2026-06-02 (late) — Merge-strategy standard + TEAM-LEAD shipped (PR #18) · Stage-1 CHECKER is next · HANDOFF

**State (workstream B — platform/security/process; not piyush-portfolio):** Runway-clearing is essentially DONE. Next real feature = **Stage 1: build the CHECKER**. Full kickoff prompt for a fresh conversation: **`docs/plans/stage-1-checker-kickoff.md`** (read it + `docs/plans/2026-05-31-aisdlc-maturity-plan.md` + `AGENT-GOVERNANCE.md`).

**Just shipped / merged to ai-sdlc main:** PR #18 (squash) — governance §7.1 **squash-merge default + merge queue + no stacked PRs** (portfolio override = rebase), §7.2 + roster + AGENT-SPECS = new **TEAM-LEAD** agent (merges Tier 2–3 after release checklist; escalates Tier 0–1 to MANAGER), + the **ride-along policy** for operational docs. Earlier today: PR #8 (CLAUDE.md MUST: agent never self-approves) + career-automation PR #49 (dashboard 127.0.0.1 + traversal guards) both merged.

**Decisions locked this session:** merge = squash (per-repo override ok); TEAM-LEAD merges Tier 2–3 / MANAGER gates Tier 0–1; operational/continuation docs ride the next PR (never direct main push, never standalone PR); credential-isolation/bot-identity = long-term (Issue #9).

**Branch protection — guidance given, NOT yet applied (user to do):** Tier-1 now (require PR + status checks `typecheck + lint + test` & `red zone enforcement` + linear history + block force-push; `required_pull_request_reviews:null` because solo can't self-approve → don't require reviews until the bot identity exists). `gh api -X PUT repos/piyushgupta27/ai-sdlc/branches/main/protection` body in chat. Merge-queue + squash-only = UI toggles (Settings→Branches / Settings→General→PRs). Tier-2 (required CODEOWNER review + bot identity) = Issue #9.

**Open backlog (GH issues):** ai-sdlc #9 (mechanize approval gate — bot identity + branch protection + rewire blast-radius→human-review; credential isolation is the linchpin) #10 (sandbox+egress+F4b) #11 (CI secret/dep/SAST) #12 (ntfy auth) #13 (SHA-pin) #14 (dev CVEs) #15 (--theirs rebase footgun) #16 (BUILDER post-commit hang) #17 (TESTER poll Vercel); career-automation #50 (vitest v4) #51 (94MB wav→LFS).

**Env (critical):** ai-sdlc=**Node 22** (`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`, pnpm10); career-automation=**Node 20** (default; npm; better-sqlite3 binding breaks under Node 22).

**Git-state note at handoff:** shared ai-sdlc working tree had cross-session friction (CONTINUATION.md edited by both the portfolio session + this one). Local branch `chore/merge-strategy-team-lead` was merged (remote deleted) but a dirty CONTINUATION.md blocked the switch to main — resolve by committing/stashing the continuation edits (they ride the next PR) then `git checkout main`.

### 2026-06-02 23:?? — piyush-portfolio polish complete · PRs #21 + #22 merged · 3 platform tickets filed

**State:** Portfolio site live at https://piyush-portfolio-topaz.vercel.app/ continues to render Piyush's real content. PRs #21 + #22 merged to `main` on 2026-06-02 (16:18 + 16:30 UTC). 3 ai-sdlc platform-improvement tickets filed.

**Just shipped this session:**
- **piyush-portfolio PR #21** — `security: tighten .claude/settings.json subagent permissions (CSO #7)` — replaces `Bash(pnpm:*)/(node:*)/(npx:*)` wildcards with explicit 9-verb allowlist. Closes CSO Finding #7 (LOW). Local typecheck+lint green. Needs user review/merge.
- **piyush-portfolio PR #22** — `content: real blog posts + real headshot (replaces aaabad placeholders)` — two CSO-missed issues fixed: (a) 4 fictional blog posts in `src/data/blog.ts` swapped for 4 real Medium posts from piyushguptaece.medium.com with `target=_blank` link-outs, (b) stock Unsplash portrait in `about.tsx` swapped for real headshot at `public/images/headshot.jpg` (216KB JPG, user-provided). Local typecheck+lint green.
- **3 ai-sdlc platform tickets filed:**
  - [#15](https://github.com/piyushgupta27/ai-sdlc/issues/15) — `--theirs` rebase footgun (silently reverts dep upgrades; need semantic-merge or `--theirs` ban)
  - [#16](https://github.com/piyushgupta27/ai-sdlc/issues/16) — BUILDER post-commit hang pattern (300s timeout; likely pnpm 11 approve-builds wait; needs diagnostic logging first)
  - [#17](https://github.com/piyushgupta27/ai-sdlc/issues/17) — TESTER should poll Vercel deploy state and fail task on production ERROR
- **Visual verification of live portfolio** done via subagent — content clean (no aaabad leakage; all 6 expected strings render: Piyush Gupta, Available for Sr EM roles, Building autonomous AI tooling, Slice, jumpingMinds, piyushguptaece). Screenshots blocked by `/browse` perms; text extraction was sufficient.

**Two CSO-missed findings surfaced by visual verification:**
The CSO audit only flagged hardcoded handles + PII regex. It missed:
1. Fictional blog post titles attributed to Piyush (4 posts in `src/data/blog.ts`)
2. Generic "person" stock photo in About section labeled as Piyush

→ Lesson for future audits: also check for inherited *attributed* content (blog posts, case studies, testimonials, photos labeled with the new owner's name), not just hardcoded strings.

**Open follow-ups (after PRs #21 + #22 merge):**
1. **piyushgupta.io domain attach** — DNS: A `@` → `76.76.21.21`, CNAME `www` → `cname.vercel-dns.com`. Then Vercel Settings → Domains. User-driven.
2. **Phase B: trip-research onboarding** — deferred to a new session (see kickoff prompt below). Tier 0 — destructive/structural.
3. **Original ai-sdlc up-next backlog** (from 22:?? entry above): git merge-strategy + TEAM-LEAD design Q; Stage 1 CHECKER build.

**Reference paths:**
- piyush-portfolio repo: `~/Workspace/piyush-portfolio/`
- Live URL: `https://piyush-portfolio-topaz.vercel.app/`
- Open PRs: #21 (settings tightening), #22 (content cleanup)
- CSO report: `/tmp/piyush-portfolio-cso-report.md`
- Medium feed: https://medium.com/feed/@piyushguptaece

**Lockfile re-sync note:** Local `pnpm install` attempt during verification added an `esbuild: set this to true or false` line to `pnpm-workspace.yaml` (pnpm 11 approve-builds side effect). I reverted that locally before commit. If you see it reappear during future runs, decline-and-revert; don't commit.

**Memory references this session relied on:** [[continuation-doc-zero-exceptions]], [[pre-pr-verification]], [[explicit-git-add]] (caught the workspace.yaml false-positive), [[github-contributions-authorship]] (commits authored as Piyush), [[multi-session-awareness]] (chose handoff file over CONTINUATION.md write).

### 2026-06-02 22:?? — Platform maturation + security hardening checkpoint (workstream B; not the piyush-portfolio session)

**State:** Maturing ai-sdlc toward N PRs/day under MANAGER (Piyush) control. Stage 0 (verify) done; F4 + a big security/hygiene pass done; **Stage 1 (build the CHECKER) is the next real feature — not started.** Detailed plan: `docs/plans/2026-05-31-aisdlc-maturity-plan.md` + `docs/plans/verification-2026-05-31.md`.

**Merged to ai-sdlc `main` (`3da988e`):** PR #4 (F4 agent `--allowedTools` so dispatch can write) · #5 (Stage-0a docs: AGENT-GOVERNANCE/SDLC-ARCHITECTURE/AGENT-SPECS) · #6 (CRITICAL: deny-by-default agent env, `buildAgentEnv`, no host secrets) · #7 (security-as-SDLC §9 + human-review approval-gate model). CI rehabilitated (was never green); red-zone MANAGER gate functional.

**OPEN — pending MANAGER:** PR #8 (ai-sdlc, `chore/approval-authorship-must`) — CLAUDE.md MUST-rule "agent never self-approves; commits authored as user." Tier-0 → its red-zone CI is RED **by design** (awaiting your `manager-approved` label; agent must not self-apply). typecheck/lint/test pass. · PR #49 (career-automation) — dashboard bind-127.0.0.1 + traversal guards, verified, awaiting review.

**career-automation security DONE:** history scrub force-pushed to `main` (`8910920`) — 21 plaintext-sensitive paths removed from all history, `Kiran Palan`→`Asha Rao` redacted, git-crypt broadened (applications/interviews/state/profile), secrets safe, 51 commits + dates preserved (green intact), mirror backup at `~/Workspace/_backups/career-automation-mirror-20260602-201604.git`, local re-synced. Stale 0.0.0.0 dashboard killed.

**Backlog issues:** ai-sdlc #9 (mechanize approval gate: bot identity + branch protection + rewire blast-radius→human-review) #10 (sandbox+egress+F4b) #11 (CI secret/dep/SAST) #12 (ntfy auth) #13 (SHA-pin) #14 (dev CVEs); career-automation #50 (vitest v4) #51 (94MB wav→LFS).

**Env (critical):** ai-sdlc=**Node 22** (`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`, pnpm10); career-automation=**Node 20** (default; npm; better-sqlite3 binding breaks under Node 22 → 73 false DB-test failures).

**Up next:** (1) git merge-strategy standardization + TEAM-LEAD merge role (open design Q — user flagged rebase-and-merge serial-conflict pain; leaning squash + merge-queue + TEAM-LEAD; needs approval). (2) **Stage 1: build the CHECKER** (independent L2 meta-checker + CheckerOutput/Deficiency + orchestrator selective-feedback refire; also closes F1 empty audit validations + F5 token/cost parse).

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

---

## Snapshot · 2026-06-02T15:53:33Z · manual compact

| Field | Value |
|---|---|
| Project root | `/Users/piyush/Workspace/ai-sdlc` |
| Branch | `main` |
| CWD | `/Users/piyush/Workspace/ai-sdlc` |
| Session | `d2c84f0b-6e44-4d90-8743-e34ff416276c` |
| Transcript | `/Users/piyush/.claude/projects/-Users-piyush-Workspace-ai-workspace/d2c84f0b-6e44-4d90-8743-e34ff416276c.jsonl` |

### Git log (last 10)

```
3da988e docs(continuation): correct URL — site live at piyush-portfolio-topaz.vercel.app
90cc508 Merge pull request #7 from piyushgupta27/docs/security-governance
60233f2 docs(governance): enforce security as an SDLC aspect + fix approval to a human-review gate
569ce10 Merge pull request #6 from piyushgupta27/fix/scope-agent-env
071d84e fix(transport): allow proxy/CA passthrough in scoped agent env
f07acc3 fix(transport): scope agent env to deny-by-default allow-list (security finding #1)
3aa4edb Merge pull request #5 from piyushgupta27/docs/stage-0a-governance
167c226 docs: Stage-0a governance + architecture + agent specs (+ verification record)
a1c3064 Merge pull request #4 from piyushgupta27/fix/transport-agent-permissions
70c2f82 fix(ci): re-run blast-radius on label changes
```

### Uncommitted changes

```
?? .audit/
?? .gstack/
?? docs/plans/checkpoint-2026-06-02-platform-security.md
```

### Task docs touched in last 7 days

```
(none in last 7 days)
```

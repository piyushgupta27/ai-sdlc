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

### 2026-06-10 (later) — PAUSED Phase-0 D/E for testbed blockers (#38 → #45); fix plans + D/E gotchas pinned

**Why paused:** two dogfooding testbeds surfaced blockers; do these BEFORE PR-D/PR-E. After #38 + #45 + a `/compact` + 2 feature requests (user to share) → resume PR-D/PR-E.

**#38 — career-automation blocker (DO FIRST).** BUILDER/TESTER self-validate with **hardcoded** `pnpm run typecheck/lint/test` — and the hardcoding is in the **PROMPTS** (`prompts/builder/v1.md:18` + `prompts/tester/v1.md:39`, read verbatim, **no template substitution**), under the launcher's Node 22, ignoring the project's `validationCommands`. career-automation is Node-20-pinned (better-sqlite3) → every dispatch dies at TEST (`subagent.timeout` 300s burned on ~73 pre-existing Node-22 failures). Orchestrator H1 re-run (`orchestrator/validations.ts` `runValidations`) already uses `validationCommands` correctly — bring BUILDER/TESTER in line. **Fix (verified via Explore):** (a) add `validationCommands?: {typecheck?;lint?;test?}` to `BuilderPayload` + `TesterPayload` (`types/agent.ts`); (b) populate via existing `loadValidationCommands` in `orchestrator/index.ts` at the BUILDER build (~L129) + TESTER build (~L188) + both refire sites (~L497/L525); (c) **REWRITE both prompts** to run the payload's `validationCommands` (fall back to `pnpm run <check>` if unset) — payload alone is inert without the prompt change. Red-zone (`types/` + `orchestrator/index.ts` → `manager-approved`). **`runtimeBinPath` does NOT exist in main** (parallel-session WIP never merged) → out of scope for #38; career-automation's `validationCommands` carry the Node-20 pin inline. Repro task spec: `~/.sdlc-tasks/ca-45.json`. Worktree: `ai-sdlc-gh38` (`fix/gh38-validation-commands`).

**#45 — trip-research blocker (DO SECOND, after #38 merges).** Smart/activity-based subagent timeout (the `timeoutSec ?? 300` default in `router/claude-code-subagent.ts`). Same file as #38 → do after #38 merges (branch off updated main) to avoid the conflict. (Testbed also filed #52/#35 — details pending in the full request.)

**PR-D / PR-E verify-before-build gotchas (pinned so they're not lost):**
- **PR-D = zod envelope validation (IMP-02, #31):** zod discriminated unions per output contract (Builder/Tester/Reviewer/Checker + Deficiency) → parse failure = structured retry feedback; replaces the brace-balanced extraction in `agents/base.ts`. **Verify-before-build:** did PR #33 already add validation when it touched the Deficiency types? Fold the IMP-10 `decisions[]` audit field in here if trivial (same files). `agents/base.ts` + `types/` = Red-zone Tier 1.
- **PR-E = protected-files commit gate (IMP-03, #34/#9):** pre-COMMIT deny-list (`.audit/`, `CLAUDE.md`, `prompts/`, `config.json`, `.github/`, lockfiles) → fail + escalate to G2. **Verify-before-build:** read **#34** (its scope-2 *is* literally this) + **#9**; build on the existing `tools/check-blast-radius.sh`. Acceptance: an agent diff touching `prompts/` → task fails with a G2 escalation, not a commit. Likely Red-zone.

### 2026-06-10 (session close) — Phase 0 ~done: #49/#54/#55 merged · budget guard LIVE · dashboard token self-lockout

**State (disk/GitHub):** `main` @ `6b8ee03`. Phase-0 (personal-v1 plan) = **4 of 6 items merged; 2 remain.**
- **#49 MERGED** — IMP-36 dashboard auth: CSRF + same-Origin + bearer/`csrfToken` (timing-safe) + 409 idempotency on `POST /api/queue/<id>` (new `dashboard/auth.ts`). **Token REQUIRED** — `SDLC_DASHBOARD_TOKEN`, fail-fast at startup, **no auto-gen** (operator decision). Stale CLI "no auth" warnings corrected.
- **#54 MERGED** — GH#30: cost-estimate fallback now reachable (`parseDispatchPayload` leaves cost `undefined` when the CLI omits it → `base.ts` uses `estimateCost`, no silent $0). Accuracy prereq for the guard. (#30 stays open: error-diagnostics + JSON-tolerance follow-ups.)
- **#55 MERGED** — IMP-14 budget guard **LIVE** (⏰ beat June-15): `orchestrator/budget.ts` pauses NEW dispatch at ≥85% of the month's spend (global pool, summed across all repos' `.audit/`) + ntfy push; in-flight finishes. Cap = `SDLC_MONTHLY_BUDGET_USD` (default $100). Fail-open on aggregation error. Gated at both `dispatch.ts` chokepoints.
- **#43 MERGED** (earlier) — GH#36 phantom-fixture docs fixed; **#36 CLOSED.**

**Up next — finish Phase 0:** **PR-D** = zod envelope validation (IMP-02, under #31) — `agents/base.ts` + `types/` (Red-zone Tier 1 → needs `manager-approved`). **PR-E** = protected-files commit gate (IMP-03) — **read #34 + #9 first** (overlap). Then Phase 0 DONE.

**Decisions locked:**
- **Dashboard auth phasing:** CSRF/token for laptop-only now; "Sign in with Google" (OIDC — free, single-email, 2FA via Google) = Phase 2, **trigger = cross-device use OR sharing with another person** (filed **#51**, P3). Needs a public URL/tunnel — same prereq as **#48** (P2, ntfy action buttons).
- **Token self-lockout:** `~/.claude/settings.json` `permissions.deny` + `PreToolUse` hook (`~/.claude/hooks/block-dashboard-token.sh`) block the AGENT from reading `SDLC_DASHBOARD_TOKEN` / keychain `sdlc-dashboard-token` — even if explicitly asked (harness-enforced). Token lives in the macOS keychain, injected only at dashboard launch (a separate terminal, never via the agent).
- **Logging model:** `CONTINUATION.md` = the running log (THIS is the primary build session); strong checkpoints → `docs/checkpoints/`; `journey/` devlog RETIRED. Multi-session lesson: don't bundle a CONTINUATION entry into a feature branch (top-of-file conflict vs #44) — update it as its own `docs(continuation)` PR after the feature PRs (this entry IS that PR).
- **Worktree-per-session:** each PR built in its own `git worktree` (PR-A..C).

**Env / facts:** Node 22 (`/opt/homebrew/opt/node@22/bin`), pnpm 10; full gate = typecheck + lint + `check` (biome) + test. GitHub had an API-auth incident 2026-06-10 (~15:20 UTC) — `gh pr create` (GraphQL) 401'd; REST `gh api -X POST .../pulls` was the workaround. Red-zone (`router/`, `orchestrator/index.ts`, `types/`, `CLAUDE.md`, audit-log/file-ops/rollback, workflows) → `manager-approved` label gate; non-Red-zone → MANAGER merge only.

**Reference:** personal-v1 plan `meta/plans/2026-06-05-aisdlc-personal-v1-PLAN.md` (vault) · `docs/checkpoints/2026-06-05-stage1-shipped-stage2-go.md`.

### 2026-06-10 — Phase 0: #43 merged (GH#36) · journey→CONTINUATION logging set · PR-B dashboard auth open · #48 filed

**State (disk/GitHub):** `main` @ `856205e`. Phase-0 underway (personal-v1 plan: 6 safety items).
- **#43 MERGED** → GH#36 fixed: 6 phantom `tools/sdlc/fixtures/regressions/` claims in `CONTEXT.md`/`CLAUDE.md` rewritten as "planned, not built" (Option B). **#36 CLOSED.**
- **PR-B OPEN** (`feat/dashboard-auth-and-clickurl`) — IMP-36 dashboard auth: CSRF + same-Origin + bearer/`csrfToken` (timing-safe) + 409 idempotency on `POST /api/queue/<id>`. New `dashboard/auth.ts` + 18 unit tests; **requires** `SDLC_DASHBOARD_TOKEN` (fail-fast at startup; no auto-gen). Live HTTP matrix 6/6 green (token set). Tier 2, non-Red-zone; awaiting MANAGER review.
- **#48 FILED (P2)** — IMP-32 ntfy Approve/Reject buttons + reachable URL; deferred (needs a public URL = Phase 2 + the IMP-36 token).

**Decisions locked (2026-06-08..10):**
- **Logging model:** `CONTINUATION.md` = the running log; only STRONG checkpoints get a `docs/checkpoints/` file. The `journey/` devlog idea is RETIRED (one system too many). Routine PRs fold here.
- **Dashboard auth phasing:** IMP-36 (CSRF/Origin/token) for laptop-only now; "Sign in with Google" (OIDC — free, single email, 2FA via Google) is the Phase-2 strong-auth layer when the dashboard is exposed publicly (needs a tunnel; relates to #48).
- **Worktree-per-session:** concurrent sessions each get their own `git worktree` (this session ran alongside a live `TripPlan_AISDLC_Part1` session working in `ai-sdlc-doctor`).

**Up next:** land PR-B → PR-C IMP-14 budget guard (⏰ before 2026-06-15) → PR-D zod (IMP-02) → PR-E protected-files (IMP-03; read #34/#9 first). IMP-32/#48 + Google-auth = Phase 2.

**Reference:** plan `meta/plans/2026-06-05-aisdlc-personal-v1-PLAN.md` (vault) · `docs/checkpoints/2026-06-05-stage1-shipped-stage2-go.md`.

### 2026-06-08 — Stage-2 dogfood + learnings-review CLOSED · 3 PRs merged

**State:** all 3 PRs merged to main:
- career-automation #62 (dogfood output: Map refactor + `.audit` gitignore)
- ai-sdlc #40 (onboard: seed artifact gitignores + drop develop-default)
- ai-sdlc #42 (canonical CLAUDE.md output + testbed-duty rules)

**Learnings-review applied:** 3 global hard rules in `~/.claude/CLAUDE.md` (lead-with-decision · fix-isn't-done-until-siblings-checked · origin-check); ai-sdlc canonical rules (#42); weekly log at ai-workspace `self/reviews/weekly/2026-06-08.md`.

**Principle locked with MANAGER:** automate only machine-verifiable checks; judgment rules → hard rules in CLAUDE.md, **force-propagated by onboarding**, presence-verified (adherence stays human review). A half-enforced rule is worse than none (false confidence).

**Up next (queued):** **#41** (P1 — build `sdlc doctor` + onboarding force-propagation of canonical rules/automations + drift verify) · **#26** (P1 — PR-template propagation + CI completeness gate + REPORTER voice) · **#38** (BUILDER/TESTER use `validationCommands`, not hardcoded pnpm) · **#39** (REQUIREMENTS/ARCH/ROADMAP/PLAN develop→main doc cleanup) · mind-palace **#14** (vault re-sync after #39). Then resume the parallelism "movie" (worktree #19 + TEAM-LEAD).

### 2026-06-06 — STAGE 2 dogfood CLOSED OUT · 2 PRs open for MANAGER merge · 3 platform issues filed

**Outcome: dogfood validated the cross-repo flow end-to-end + drove its own fixes.** Two PRs await MANAGER merge:
- **career-automation #62** (https://github.com/piyushgupta27/career-automation/pull/62) — the pipeline's output: BUILDER (Sonnet 4.6) perf refactor of `summariseCategories` (O(1) Map) + unit test, **+** `.gitignore` for `.audit/`/`.sdlc-queue/` (fixes the false-alarm locally). feature/gh-46, 2 commits, lint clean.
- **ai-sdlc #40** (https://github.com/piyushgupta27/ai-sdlc/pull/40) — `fix(onboard)`: seed `.audit/`+`.sdlc-queue/` into target `.gitignore` (#37) + drop the `develop`-branch default from onboarding output (#39). Gate green (typecheck/check/53 tests). Closes #37.

**Platform issues filed (manager+dev style per user feedback):** ai-sdlc **#37** (`.audit` lint pollution — class: gates measure ambient repo state not the delta; ties to hermetic worktree #19), **#38** (BUILDER/TESTER self-validation hardcodes pnpm instead of `validationCommands` — Node-split fragility), **#39** (retire develop-default; REQUIREMENTS/ARCH/ROADMAP/PLAN doc-text cleanup still open). mind-palace **#14** (re-sync vault doc copies after #39).

**Decisions locked with MANAGER:** Option A dogfood (observe the break) → it surfaced the `.audit` bug; keep the #46 change (land via #62); fix #37+#39 now (#40); #38 next session. User feedback saved to memory `[[feedback_writeup_manager_dev_balance]]` — issues/PRs lead with plain What + Why-it-matters, then dev detail.

**State:** career-automation back on `main` (my continuation edit restored); ai-sdlc on branch `fix/onboard-seed-artifact-ignores-and-main-target`. This CONTINUATION edit is uncommitted (rides next commit).

**Up next (if "keep going"):** MANAGER merges #62 + #40. Then: #39 doc-text cleanup (REQUIREMENTS R-AISDLC-103/Q-AI-24 → mark superseded, main is default) + mind-palace #14 sync; #38 (thread validationCommands into BUILDER/TESTER self-check); then resume the "movie" (parallelism: worktree #19 + TEAM-LEAD) or drain the career-automation research queue.

### 2026-06-05 — STAGE 2 dogfood RAN END-TO-END · CHECKER fired (ESCALATE) · platform bug found (.audit lint pollution)

**Outcome: SUCCESS as a validation run.** Dispatched #46 (`--task-spec`, Option A) on career-automation. The full pipeline executed: **BUILD✓ → TEST✓ → REVIEW✓ → CHECK=escalated**. Result HITL-PENDING. **Cost $1.91**, 271s, 4 hash-chained audit rows in `career-automation/.audit/2026-06-05/audit.jsonl`.

**What worked:**
- Cross-repo dispatch + orchestrator + CHECKER gate all fired. CHECK row has a populated `validations` matrix `{tsc:pass, lint:fail, tests:pass}` + `CHECKER ESCALATE (conf 0.85)` + real per-stage cost.
- **Node-20 pin WORKED**: H1 re-run `tests=pass` (dodged the 73 Node-22 better-sqlite3 failures). The Option-A risk didn't bite — the BUILDER judged the Node-22 failures pre-existing and committed anyway.
- Commit `f2d233b` on `feature/gh-46` is **correctly scoped** — only `src/agents/sourcing/rejection-categories.ts` (+6/-1) + `tests/unit/sourcing-rejection-categories.test.ts` (+26). **No Stripe/data sweep** — explicit staging held. The refactor is correct (`CATEGORY_LABEL_MAP` Map, `map.get(k) ?? k`).

**PLATFORM BUG (caused the escalation):** `.audit/` is not in career-automation's `.gitignore` or `biome.json` ignore, and onboarding never adds it. So the H1 `biome check .` lints the orchestrator's OWN output (`.audit/.chain-tip.json`, `audit.jsonl` — missing trailing newline) → false `lint=fail` → false CHECKER ESCALATE. **Proof the code is clean: `biome check src tests` passes (157 files, 0 errors).**

**Platform issues to file (deliverable):** (1) P1 onboarding must exclude `.audit/` from target lint/VCS ignores [+ orchestrator should write biome-clean audit files]; (2) P2 BUILDER/TESTER self-validation hardcodes `pnpm run` instead of project `validationCommands` (Node-split fragility); (3) P3 onboard suggests `develop` but dispatch PRs against `main`.

**State / cleanup pending:** career-automation is on `feature/gh-46` with commit `f2d233b`; my `tasks/continuation.md` edit is STASHED (`stash@{0}`); `.audit/` untracked artifacts present. MANAGER decision pending: (a) land the change — add `.audit/` to ignores so lint passes, push + `gh pr create --base main`, MANAGER merges; or (b) validation-only — checkout main, restore stash, keep/delete branch. Either way: file the 3 platform issues.

### 2026-06-05 — STAGE 2 dogfood IN PROGRESS · onboarded career-automation · BLOCKED on Node-split decision (pre-dispatch)

**State:** Driving from ai-sdlc (Node 22, pnpm 10). career-automation onboarded; NOT yet dispatched (paused at a real decision gate).

**Done this session:**
- Prereqs verified: PRs #32/#33 merged (HEAD even with main); platform green (typecheck clean · check 1 known warning · 53/53 tests). Branch-protection resolved per kickoff doc = skip + compensating controls; `career-automation/.git/hooks/pre-push` (blocks direct main push) VERIFIED present.
- Onboarded: `projects/career-automation/config.json` written; added `validationCommands` (typecheck/lint/test) pinned to **Node 20 via `/usr/local/bin`** — NOT `/opt/homebrew/opt/node@20` (that path doesn't exist; real Node 20 = `/usr/local/bin/node` v20.13.1). Baseline typecheck+lint green under the pin.
- Task chosen by MANAGER: **#46** (refactor `summariseCategories` → Map lookup in `src/agents/sourcing/rejection-categories.ts`; pure-logic, non-dashboard). Plan = `--task-spec` path (manual; does NOT auto-push — PR opened by hand after review), PR base=main.

**BLOCKER (why paused):** the BUILDER prompt (`prompts/builder/v1.md` L18,38) runs its own pre-commit `pnpm run typecheck && lint && test`, inheriting the CLI's **Node 22** PATH. Verified: career-automation suite under Node 22 = **73 failed / 443 passed** (better-sqlite3 NODE_MODULE_VERSION). So the builder would fail/escalate on unrelated DB tests BEFORE the CHECKER fires. Orchestrator H1 re-run IS Node-20-pinned (correct); the builder/tester self-check is the gap. **Platform issue to file regardless:** BUILDER/TESTER self-validation must use `validationCommands`, not hardcoded `pnpm run`.

**Decision pending with MANAGER (3 options):** (A) dispatch as-is, observe the break, file issue — won't see CHECKER; (B) **converge career-automation to Node 22 for the run** (`npm rebuild better-sqlite3` under 22 + switch validationCommands to plain npm) → suite green → reach CHECK→COMMIT → see CHECKER verdict + validations matrix + cost; reversible / aligned with issue #53; (C) patch the platform first (ai-sdlc PR). Recommended: B.

**Also note (RISK B, mitigated):** career-automation tree is dirty — another session's untracked Stripe data (`data/applications/stripe/`, `data/resume/tailored/2026-05-stripe/`, `state/*`) + my modified `tasks/continuation.md`. Builder commits via its own Bash; mitigation = `--task-spec` path doesn't push (I review the commit diff before pushing) + project CLAUDE.md enforces explicit staging + I'll `git stash push tasks/continuation.md` (pathspec, mine only) before dispatch. Do NOT touch the Stripe untracked files (not mine).

**Up next (after MANAGER picks):** write `/tmp/ca-task.json` (full Task JSON, tier 4) → `pnpm sdlc dispatch --project career-automation --task-spec /tmp/ca-task.json` → read `career-automation/.audit/<date>/audit.jsonl` (confirm CHECK row: populated `validations` + CHECKER verdict + cost >$0) → review commit → manual push + `gh pr create --base main` → MANAGER merges.

### 2026-06-05 — STAGE 1 DONE (CHECKER gate shipped + live-proven) · Stage 2 GO · compact checkpoint

> **Full detail:** `docs/checkpoints/2026-06-05-stage1-shipped-stage2-go.md`. This entry is the resumable TL;DR.

**State:** On `main` @ `b3fd5fc`, Node 22, clean tree (untracked: `.audit/`, `.gstack/`, the new checkpoint doc + `docs/plans/stage-2-career-automation-kickoff.md` — both ride the next PR). **Stage 1 (CHECKER quality gate + selective-feedback refire) is COMPLETE.**

**Shipped + merged this session:** #27 (F5: real token/cost via `--output-format json`) · #28 (CHECKER contracts/agent/prompt, inert) · #29 (MANAGER-grade PR template) · #32 (**orchestrator wiring** — `runCheckGate`: Node deterministic re-verify [H1, closes F1] → CHECKER semantic audit → `shouldRefire` bounded refire `MAX=2` / G2 escalate; new `validations.ts`) · #33 (Slice 2: REVIEWER findings unified to shared **P0–P3** rubric + `evidenceRef`; retired old Severity).

**Live proof:** real dispatch on a throwaway `/tmp` repo → MERGED, the `CHECK·checker` audit row appeared with a populated `validations` matrix (F1 proven) + CHECKER PASS 0.95 + real $1.30 cost. The **REFIRE path is unit-tested but not yet filmed live** (agents did the task right first try); an engineered "take two" would show REFIRE→converge.

**Safety (no branch protection on private-free repos → SKIP it, decided):** a `pre-push` hook blocking direct push/force-push to `main` is installed on all 5 managed repos (ai-sdlc, career-automation, piyush-portfolio, trip-research, ai-finance-tracker). Per-clone + bypassable with `--no-verify` → durable version = **#34** (onboarding auto-installs). Enforces governance §7 (PR-only) locally.

**Stage 2 (career-automation) is GO** for a SUPERVISED dogfood (agent opens PRs; MANAGER merges). Kickoff: `docs/plans/stage-2-career-automation-kickoff.md`. Hybrid model — chores through the pipeline, complex work manual. Can run in a separate session.

**Up next (RESUME HERE):** the MANAGER said *"we will keep building the platform, but before we start let me share something"* → **WAIT for that context first.** Then build toward the parallel "movie": planned next = **#19 (worktree isolation → parallel tasks)**, then **TEAM-LEAD** (auto-merge Tier 2–3). **#34** (onboarding hard-gating) is also high-value + small.

**Open issues (on project board):** #19 #24 #25 #26 #30 #31 #34 #21 (+ TEAM-LEAD unbuilt). **Facts:** full CI gate = typecheck+lint+check+test+coverage; agent never merges Red-zone (MANAGER labels `manager-approved` + merges, auto-merge off); post-2026-06-15 $100/mo Agent-SDK budget → soft-budget guard before fan-out (~$1.30/Tier-4 dispatch).

### 2026-06-04 — PR1 (F5) MERGED · CHECKER contracts (#28) + PR template (#29) open & reviewed · PR3 next

**State:** On `main` @ `689535e` (PR #27 squash-merged). Node 22. Stage-1 Slice-1 in progress.
- **MERGED — PR #27 (F5):** transport now parses real token usage + cost via `claude --print --output-format json` (was logging $0). The Red-zone gate worked end-to-end — branch protection BLOCKED the agent merge, required the MANAGER's `manager-approved` label, then merged clean. (Auto-merge is NOT enabled on the repo → label-then-manual-merge for now; Settings→General→Allow auto-merge would smooth this.)
- **OPEN — PR #28 (CHECKER contracts, inert):** types/agent/prompt/route, additive, nothing dispatches it. `/code-review` done → applied 2 fixes (tightened `Deficiency.ownerRole` → new `DeficiencyOwner` = builder|tester|reviewer; fixed stale router header). CI green. Tier 1 → needs MANAGER label + merge.
- **OPEN — PR #29 (MANAGER PR template, Tier 3, not Red-zone):** canonical `meta/templates/pull-request.md` + `.github/pull_request_template.md`. Iterated with MANAGER this session (clean style; §6 Audit clarified; §9 renamed to "Backlog"; Breaking/Rollback split). Green. Per delegation I can merge Tier-3 myself on MANAGER's go.

**Decisions / process locked (full detail: `docs/checkpoints/2026-06-03-autonomous-sdlc-vision-and-milestone.md`):**
- H1 deterministic re-verify runs in Node (orchestrator); CHECKER does the semantic audit only.
- 3-tier gate ordering: completeness (Node, free) → deterministic re-run (Node) → semantic (CHECKER LLM) + SHA-cache.
- MANAGER-grade PR template is the standard → propagate to all repos + enforce via a CI completeness gate (#26).
- **LESSON:** run the FULL CI gate locally (`pnpm run check` = biome format + `test:coverage`), not just typecheck/lint/test — the format step failed #27/#28 in CI on first push. (Saved to memory.)

**Up next (if "keep going"):** MANAGER applies `manager-approved` label to #28 → merge. Then **build PR3** — orchestrator wiring: 3-tier gate + bounded refire (`MAX_CHECKER_REFIRES=2`, reuse retry-policy) + F1 (populate `AuditRow.validations`/`decisions`) + live REFIRE→converge proof on a throwaway repo. PR3 must extend `writeStageAudit`/`nextStageAfter` to handle the new `'CHECK'` stage (the #28 review flagged they're hardcoded to the old stage set — PR3's job).

**Open follow-ups (GH issues filed this session):** #24 tier-calibrated skip · #25 trusted evidence artifacts/sandbox · #26 PR-template propagation + CI completeness gate · #30 transport hardening (cost fallback, error diagnostics, JSON tolerance, cache_creation tokens) · #31 runtime-validate agent envelopes (zod, incl. CheckerOutput G3 version). Slice 2 = align `ReviewerOutput.findings` to the `Deficiency`/P0–P3 schema (the dual-rubric the #28 review flagged).

**Uncommitted on disk (ride PR3):** this CONTINUATION entry + `docs/checkpoints/2026-06-03-autonomous-sdlc-vision-and-milestone.md` (vision/decision/roadmap checkpoint — untracked).

**The "movie" the MANAGER wants:** full pipeline, many agents, parallel tasks, a CHECKER REFIRE→converge, an ESCALATE, a deterministic-gate catch. Needs PR3 + worktree isolation (#19) + TEAM-LEAD runtime + a seeded backlog (~4–5 PRs, ~2–4 sessions). Decided: build toward it (no teaser run).

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

---

## Snapshot · 2026-06-05T16:48:10Z · manual compact

| Field | Value |
|---|---|
| Project root | `/Users/piyush/Workspace/ai-sdlc` |
| Branch | `main` |
| CWD | `/Users/piyush/Workspace/ai-sdlc` |
| Session | `16db1b3c-0d54-44b3-8527-10de0b944688` |
| Transcript | `/Users/piyush/.claude/projects/-Users-piyush-Workspace-ai-workspace/16db1b3c-0d54-44b3-8527-10de0b944688.jsonl` |

### Git log (last 10)

```
b3fd5fc feat(reviewer): align findings to the shared P0-P3 rubric + Deficiency schema (Stage 1, Slice 2) (#33)
644cd4b feat(orchestrator): CHECKER quality gate + selective-feedback refire (Stage 1) (#32)
7323daa chore(template): MANAGER-grade PR template v1 (clean style) (#29)
fcdec3b feat(checker): CHECKER contracts, agent, prompt + model route (Stage 1, inert) (#28)
689535e fix(transport): parse real token usage + cost via --output-format json (F5) (#27)
9cb58f1 docs(continuation): record portfolio polish session — PRs #21 + #22 merged
2ce09b2 Merge pull request #18 from piyushgupta27/chore/merge-strategy-team-lead
13adf77 docs(governance): standardize squash-merge + merge queue + TEAM-LEAD merge role
2dfbcd5 Merge pull request #8 from piyushgupta27/chore/approval-authorship-must
3da988e docs(continuation): correct URL — site live at piyush-portfolio-topaz.vercel.app
```

### Uncommitted changes

```
M CONTINUATION.md
?? .audit/
?? .gstack/
?? docs/checkpoints/2026-06-05-stage1-shipped-stage2-go.md
?? docs/plans/stage-2-career-automation-kickoff.md
```

### Task docs touched in last 7 days

```
(none in last 7 days)
```

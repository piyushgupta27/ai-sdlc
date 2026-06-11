---
title: "TRD: Per-run sandbox isolation (issue #19)"
status: in-progress
created: 2026-06-11
issue: 19
tier: 1
tags: [trd, design, autonomy, isolation, concurrency]
---

# TRD — Per-run sandbox isolation

> Written to the canonical TRD template (see #75). First reference example.

## Goals / Objectives
- Give every dispatch an **isolated, ephemeral workspace** so concurrent agents never share a checkout.
- Do it behind a **swappable `Sandbox` provider interface**, so the deterministic/scalable end-state (remote microVM, #71) drops in later with **no dispatch/orchestrator rework**.
- Ship the immediate, supervised-loop payoff (#19) without weeks of infra.

## Context
- The platform dispatches agents (BUILDER/TESTER/…) by spawning the `claude` CLI with `cwd = targetRepo`; the agent edits + commits there.
- Today **all agents share one checkout**. This session alone, that caused foreign commits on the wrong branch / blocked branch switches 3–4×.
- #19 is `autonomy 1/5` — the gate for concurrent dispatch (#73), the autonomous board path (#47), and safe parallel testbed runs.
- Current dispatch is **single-threaded** (`dispatchFromBoard` processes Ready sequentially).
- `ARCHITECTURE.md` is advisory (per MANAGER), but the sandbox-dir convention is corroborated in `.gitignore` + `CONTEXT.md`.

## Problem Statement
Concurrent agents on one checkout corrupt each other (wrong-branch commits, dirty-tree blocks). We need per-run isolation that (a) fixes this now, (b) is a foundation for parallelism + determinism, and (c) doesn't become throwaway when we later move to a remote/deterministic execution model.

## Success Criteria
- **Two agents run concurrently on one repo with zero working-tree/branch cross-contamination, proven by test** (the "Done" bar).
- The **orchestrator (`index.ts`, Tier-1) is unchanged** → **zero red-zone**, no `manager-approved` label.
- Audit log + HITL queue **survive workspace teardown** (durable).
- git-crypt repos (testbeds) + Node-pinned native deps work inside the sandbox.
- Crash/SIGTERM never leaves an orphaned worktree.

## Approaches (PROs / CONs)

| Approach | Enables parallel team? | Scales / no dir sprawl? | Deterministic? | Build cost |
|---|---|---|---|---|
| **git worktree** (this PR) | ✅ now | ⚠️ full working-tree copy per run (fine ~2–8) | ❌ host toolchain | ~a day |
| Full `clone` per run | ✅ | ❌ heavier; hardlink CVE-2024-32020 if naive | ❌ | ~1–2 days |
| **APFS CoW clone** (#72) | ✅ | ✅ near-zero disk, Mac-only | ❌ | ~2 days |
| Docker container on the Mac | ✅ | ⚠️ slow VM, capped | partial | weeks — **rejected** |
| **microVM/gVisor on remote Linux** (#71) | ✅ | ✅✅ one base, N overlays, same path | ✅ | weeks — end-state |

**Why "Docker on the Mac" is rejected (worse-middle):** a shared-kernel container is not a trust boundary for prompt-injectable agents (Cognition moved Devin off containers → microVMs); a Mac is a Linux VM with 3.5–10× slower bind mounts + capped RAM. It carries container cost without the trust boundary or the scale.

## Recommendation (with trade-offs)
**`Sandbox` interface + `WorktreeSandbox` now.** Trade-off accepted: worktree duplicates the working tree (not the object store) and inherits the host toolchain (no determinism) — acceptable for the supervised loop; #72 (CoW) removes the duplication, #71 (microVM) adds determinism + remote scale. The interface makes the worktree work a **de-risking harness, not throwaway**.

`Sandbox`: `{ workspacePath, branch, cleanup() }`; `provisionWorktreeSandbox(req) → Result<Sandbox>`. dispatch.ts provisions → passes `workspacePath` as `targetRepo` → `cleanup()` in `finally`.

**WorktreeSandbox specifics:** `<repoPath>/.sdlc-sandboxes/<taskId>/` (gitignored); `git worktree add --no-checkout -b <branch>` (atomic); git-crypt key seeded into the worktree git-dir before checkout; `node_modules` symlinked (preserves Node-pinned bindings); `.audit/` + `.sdlc-queue/` **symlinked to the repo root** so durable state survives teardown (keeps the orchestrator untouched); idempotent provision (self-cleans crash orphans); crash-lifecycle cleanup on SIGINT/SIGTERM. Branch is **not** deleted on cleanup (it carries the PR).

## Execution plan (checkpoints / milestones / phases)
1. **#19 (this PR):** `Sandbox` interface + `WorktreeSandbox` + tests + dispatch wiring + this TRD. Zero red-zone.
2. **#70 — audit-chain concurrency-safety:** per-task sub-chains; prerequisite for parallel dispatch (the shared per-repo hash chain races under concurrency).
3. **#73 — concurrent dispatch:** bounded pool over Ready, each in a sandbox (depends on #70).
4. **#72 — ApfsCloneSandbox:** CoW provisioning (cheap scale on the Mac).
5. **#71 — MicroVmSandbox:** remote, deterministic end-state (extends #10 hardening).

## Observability — Monitoring & Alerting
- Log every provision/teardown (taskId, workspacePath, branch, outcome) into the dispatch run output.
- Teardown failures → surface as a warning + the manual `git worktree remove` command (already in `cleanup()` error `fix`).
- Health signal: `git worktree list` should show no `.sdlc-sandboxes/*` entries after a clean run; orphans indicate a crash-cleanup miss.
- Future (#73): metric for in-flight sandboxes + disk used under `.sdlc-sandboxes/`; alert on orphan accumulation / disk bound.

## Testing — Unit / Integration / Dev / QA
- **Unit:** `sanitizeTaskId`, path construction, branch-exists detection.
- **Integration (real git, temp repos):** provision → isolated branch+tree + populated files; **two concurrent provisions, edits don't leak (the Done bar)**; cleanup removes the worktree + leaves durable `.audit` intact; idempotent cleanup (double-call); idempotent provision over a stale orphan; node_modules + `.audit`/`.sdlc-queue` symlinks present; checkout-failure path tears down (no orphan).
- **Dev:** smoke a real dispatch on a testbed in a sandbox.
- **QA:** N/A (platform-internal); covered by the testbed dogfood loop.
- Gate: run the EXACT CI steps (typecheck + lint + `biome check` + test) under Node 22 before push.

## Cost
- **Build:** ~a day (this PR).
- **Runtime:** ~0 — worktree shares the object store; `node_modules` symlinked (no install); provision/teardown are local git ops.
- **Disk:** one working-tree copy per concurrent run (removed by #72 CoW).

## Unknowns / Risks / Contingencies
- **git-crypt** only exercised on testbeds (ai-sdlc has none) — `--no-checkout` + key-seed + `checkout` path; contingency: clear error on smudge failure.
- **Audit chain contention** under future concurrency → #70 (out of scope here; today's single-threaded dispatch is safe).
- **Symlinked `.audit`/`.sdlc-queue` × whole-repo gate** (#37): biome honors `.gitignore` (`.audit/`,`.sdlc-queue/` ignored) so no re-trigger; verify in #37.
- **Nested worktree** inside the repo working tree — safe because gitignored; contingency: prune + idempotent re-provision.
- Minor: `CONTEXT.md` (`.audit/raw/`) vs `.gitignore` (`.audit/`) wording inconsistency — cosmetic, noted.

## External Research
- Cognition — containers→microVM rationale: https://cognition.ai/blog/what-we-learned-building-cloud-agents
- Anthropic — Claude Code sandboxing (Seatbelt/bubblewrap + egress proxy): https://www.anthropic.com/engineering/claude-code-sandboxing
- git worktree: https://git-scm.com/docs/git-worktree ; local-clone hardlink CVE-2024-32020: https://github.com/git/git/security/advisories/GHSA-mvxm-9j2h-qjx7
- APFS copy-on-write (`clonefile`): https://eclecticlight.co/2020/04/14/copy-move-and-clone-files-in-apfs-a-primer/
- macOS Docker bind-mount perf: https://www.cncf.io/blog/2023/02/02/docker-on-macos-is-slow-and-how-to-fix-it/
- e2b / Firecracker microVMs: https://e2b.dev/ ; Modal gVisor: https://modal.com/resources/best-code-execution-sandboxes-ai-agents

---
title: "Milestone — first autonomous self-hosted dispatch (ai-sdlc builds on ai-sdlc)"
date: 2026-06-12
type: checkpoint
tags: [milestone, autonomy, self-hosting, dogfood]
---

# Milestone — first autonomous self-hosted dispatch

**What happened:** for the first time, ai-sdlc was pointed at **its own repo** to take a ticket from spec → built, reviewed, checked, committed → PR, with the human signing off and the loop running on its own. The platform onboarded itself as a tenant (`projects/ai-sdlc/`) and ran the full BUILDER→TESTER→REVIEWER→CHECKER pipeline against `ai-sdlc` itself.

**The task (deliberately safe):** a tier-4 docs change — add an "Autonomy roadmap" pointer + the north star to `README.md`. **Not** the top Ready item (#86, the gate-evidence bundle): a *first* autonomous self-hosted run should prove the loop on something low-blast-radius, not flail on the hardest governance-adjacent ticket. First prove the loop, then aim it higher.

**How it was run (honest framing):** *supervised-now*, not *unattended-overnight*.
- `--task-spec` single bounded task (opts out of the COMMIT HITL gate per #62; the human is the gate at merge).
- `caffeinate` to keep the Mac awake (it sleeps on idle → a true overnight run would stall — exactly why the remote runner #88 exists).
- Launched + watched to completion in-session; the resulting PR waits for human review/merge.

**Why this is the milestone:** it's the proof-of-life of the whole thesis — *one human as a merge authority; the agents own ticket→PR*. It also surfaced, concretely, what's still needed for **true hands-off overnight** autonomy (the Phase-0 floor, now the top of the Ready lane):
- **#87** — session-quota/rate-limit brake (the plan is a rate-limited subscription; pace to 60–80% in the owner's active window, higher off-hours).
- **#88** — unattended scheduled/remote runner (the laptop sleeps; can't fire-and-forget on it).
- **#86** — signed gate-evidence bundle (so merge-time gating is safe to lean on).
- **#78** — dispatch outcome correctness (so unattended runs don't lie).

**Context — how we got here (this session):**
- Shipped **#19** (per-dispatch worktree isolation) + **#62** (trustState×tier COMMIT HITL gate), both via independent-review-hardened PRs; set **branch protection** on `main`.
- Two independent senior reviews (architect + eng-leader) reframed the north star: **merged-PRs per review-hour** (ITP→0 is a sub-metric, not the goal); the gate belongs at **merge** behind a **signed evidence bundle**; **buy-don't-build** the commodity layer; self-host with the platform **core permanently human-merge red-zone**.
- Produced the master **autonomy roadmap TRD** (`docs/plans/autonomy-roadmap.md`) + reconciled the backlog into a phased, prioritized board (13 new issues #86–#98, Phase-0 in Ready/P0).

**The PR this produced:** **#99** — the first PR authored end-to-end by ai-sdlc, on ai-sdlc (MERGED outcome, 0 retries, $3.11, 5.8 min). Supervisor-curated before opening.

**Live finding (the real prize):** the run based its sandbox off a **stale local `main`** (pre-#85-merge), so the agent couldn't see the already-merged roadmap and **recreated it divergently**. Caught + dropped at the supervisor step; filed as **#100** (dispatch must `git fetch` + base off `origin/main`, not local `main`). This is the #19 reviewer's original `origin/main` recommendation, re-derived by the owner the moment he saw the behavior — and exactly the kind of gap a first dogfood run exists to surface.

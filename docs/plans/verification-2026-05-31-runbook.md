# Stage 0b — ai-sdlc platform verification runbook (2026-05-31)

Run from the **ai-sdlc repo root on the local machine**. Capture every command's stdout + exit code into
`verification-2026-05-31.md` — that file is the Stage-0 exit artifact.

> **Note on paths/verbs:** the paths below are taken from the maturity plan's references to the ai-sdlc
> tree. **Step A0 confirms them against the live repo.** If a path or verb differs, correct it inline and
> note the drift — do not assume the plan is authoritative over the actual repo. Do not fabricate outputs;
> paste real output.
>
> **Tier A is non-mutating and runs unconditionally. Tier B needs explicit MANAGER go + a sacrificial task.**

---

## Tier A — non-mutating

### A0 · Orient (confirm the map)
```bash
cd ~/Workspace/ai-sdlc && git rev-parse HEAD && git status --porcelain
ls package.json pnpm-lock.yaml
grep -A20 '"scripts"' package.json
# Confirm these exist (plan references); record actual paths:
ls tools/sdlc/orchestrator/index.ts tools/sdlc/agents/base.ts 2>&1
ls prompts/ 2>&1 && ls .audit/ 2>&1
```
**Expected:** clean (or known-dirty) tree; a `scripts` block exposing `typecheck`, `lint`, `test`, `sdlc`;
orchestrator + base-agent files present. **Record the real script names** — the rest of the runbook uses
whatever `package.json` actually defines.

### A1 · Build / lint / test green
```bash
pnpm install --frozen-lockfile
pnpm run typecheck && pnpm run lint && pnpm test
```
**Expected:** typecheck + lint exit 0; test summary `N passed, 0 failed`. The plan claims **31/31** —
record the **actual** count. Any non-green is a Stage-0 breakage (write it up; do not paper over it).

### A2 · CLI loads + reads state (read-only verbs)
```bash
gh auth status                      # board verbs need this green
pnpm sdlc --help
pnpm sdlc status --project ai-sdlc --json | jq .   # assert valid JSON ProjectState
pnpm sdlc board --project ai-sdlc
```
**Expected:** `--help` lists `status`/`board`/`dispatch`/`onboard`; `status --json` is well-formed JSON;
`board` reaches the GitHub board. A 401/403 on `board` is an **env-setup** finding (gh auth), not a
platform bug — note it as such.

### A3 · Read the dispatch path (no execution)
Read `tools/sdlc/orchestrator/index.ts` + `agents/base.ts`. Write a short **"what a live dispatch needs
and mutates"** list:
- **Needs:** (a) a task in the **Ready** column, (b) `gh` auth, (c) Claude Code subagent transport + model routing.
- **Mutates:** `.audit/<date>/runs/*.jsonl` (`AuditRow`), board column moves, branch/commit/PR.

This list is the **Tier-B pre-flight checklist** and the blast-radius input.

**Tier A exit:** either "green + read-only CLI works, here's the output" or a concrete breakage list.
**Do not proceed to Tier B until Tier A is green.**

---

## Tier B — guarded live dispatch (needs explicit MANAGER go + sacrificial task)

### B0 · Define the sacrificial task
- Smallest possible, **Tier 0/1**, throwaway scope: e.g. "add a one-line doc comment to a leaf util + its
  trivial test." Must **not** touch auth / schema / secrets / external surface.
- Place it in the **Ready** column of a **throwaway project/scope** so a bad run can't pollute real state.
- Pre-flight: `gh auth status` green; A3 checklist satisfied; record the branch + HEAD to reset to.

### B1 · One real cycle
```bash
pnpm sdlc dispatch --project <throwaway-slug>
```
**Observe and record:**
- a real **BUILD→TEST→REVIEW→…** cycle;
- a written `AuditRow`:
  ```bash
  cat .audit/$(date +%Y-%m-%d)/runs/*.jsonl | jq .
  ```
  assert it has **commit SHA, config/prompt version, model, tokens/cost/time** and a populated
  **`validations`** matrix;
- the **board column move**.

Confirm orchestrator, agent transport, validations matrix, and board update **all actually fire**.

### B2 · Reset
Delete the throwaway branch / reset the board column so the testbed is clean for Stage 1.

---

## Stage 0 exit gate
Write `verification-2026-05-31.md` ending in exactly one of:

- ✅ **"Phase A works"** — paste: the A1 test summary, the A2 CLI output, and **one real `AuditRow`** from
  B1 + the board move. → **unlock Stage 1.**
- ❌ **"Concrete breakages"** — itemized (command, expected, actual, exit code). → **loop back**; Stage 1
  does not start until these are resolved or explicitly waived by MANAGER.

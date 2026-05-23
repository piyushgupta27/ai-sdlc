---
name: ai-sdlc
purpose: Autonomous SDLC platform — multi-agent pipeline with HITL gates calibrated to blast radius
status: in-flux
tier: 0
updated: 2026-05-23
updated_by: piyushgupta27
---

# ai-sdlc — repo-root CONTEXT

## Service overview

ai-sdlc is a multi-agent autonomous SDLC pipeline that builds, tests, reviews, and ships code across a portfolio of consumer projects (testbeds). The pipeline assumes agents will do the routine work; humans intervene at calibrated HITL gates. Trust expands based on measured defect data, not intuition.

Currently in Phase A foundation. The platform is not yet runnable; the orchestrator + 4 agents + multi-tenant infra are being built (~weeks 1-3 of the roadmap).

## Blast radius

- **Tier:** 0 (Red zone)
- **Why this tier:** ai-sdlc IS the safety harness for other projects. A bug in the orchestrator or audit log propagates into every consumer testbed. Red zone forever.
- **Red zone files:** declared in [CLAUDE.md](./CLAUDE.md) — Layer 1 source of truth.
- **Downstream blast:** every consumer project (trip-research, piyush-portfolio, career-automation, ai-finance-tracker, ai-health-agent) depends on ai-sdlc working correctly. The platform itself MUST not introduce regressions.

## Architecture

- **Pattern:** event-driven orchestrator + stateless agents + append-only audit log
- **Key types:** `Project`, `Task`, `Tier`, `AuditRow`, `HITLGate`, `ReviewerVerdict` (defined in `tools/sdlc/types/`)
- **Module boundaries:**
  - `tools/sdlc/orchestrator/` — the only stateful component
  - `tools/sdlc/agents/<name>/` — stateless functions taking briefs, returning results
  - `tools/sdlc/router/` — model selection logic
  - `tools/sdlc/hooks/` — pre/post-write hooks (Layer 2 of blast-radius enforcement)
  - `tools/sdlc/cli/` — CLI entry; thin wrapper over orchestrator
  - `tools/sdlc/dashboard/` — Next.js sub-app at `:3001` (Phase A late)
  - `tools/sdlc/fixtures/` — regression suite for reviewer fleet
  - `tools/sdlc/types/` — shared types
  - `projects/<slug>/` — per-tenant config + state

See [ARCHITECTURE.md](./ARCHITECTURE.md) §14 for the canonical file organization.

## Code conventions (this repo)

See [CLAUDE.md](./CLAUDE.md) §"Code conventions" — TypeScript strict mode, ESM only, `Result<T,E>` for fallible ops, Zod at every data boundary, Biome for lint+format.

## Error handling

Module-boundary returns `Result<T,E>`. Top-level catches + formats per DESIGN.md §6 (problem + cause + fix + docs link). Audit log write is mandatory before any error propagates.

## Logging

Structured JSON only. Required fields: `ts`, `project`, `level`, `component`, `message`. Never log secrets / cookies / private/ file contents.

## Database / persistence

- Audit log: JSONL in target repo (90d) + SQLite archive (`~/.gstack/audit/<slug>/`)
- Project state: `projects/<slug>/state.json`, atomic writes
- No SQL DB for v1

## API contracts

- No HTTP API except dashboard at `:3001` (read-only of audit log + HITL queue)
- Inter-agent communication: structured JSON messages via audit log
- Agent prompts versioned at `tools/sdlc/prompts/<agent>/v<N>.md`; cohort-tracked

## Testing

- Coverage targets: ≥70% (general), ≥85% (Tier 0/1)
- Unit: `*.test.ts` co-located
- Integration: `*.integration.test.ts`, run separately
- Regression fixtures: `tools/sdlc/fixtures/regressions/`
- E2E (dashboard): Playwright (Phase A late)
- `pnpm run ci` is the gate

## Local dev

```bash
pnpm install
pnpm run typecheck && pnpm run lint && pnpm run test
pnpm run sdlc --help          # CLI surface (Phase A early)
pnpm run dev                  # TS watch mode
```

## Dependencies

- Runtime: minimal (Node 22+ stdlib + zod when needed + better-sqlite3 when archive lands)
- Dev: TypeScript, Biome, Vitest, tsx
- Runtime deps pinned exact; devDeps allow ranges

## Known quirks

- **Meta-recursive bootstrap:** ai-sdlc agents will eventually manage ai-sdlc's own code. Initial code is human-authored; first agent-authored PR is a Tier 4 typo fix.
- **Audit log first, agents second:** the audit log writer is one of the first things built. Without it, no agent action can be safely recorded.
- **Blast-radius hook protects itself:** `tools/check-blast-radius.sh` is in its own Red zone declaration. Self-modification requires HITL.
- **Regression fixtures are load-bearing:** `tools/sdlc/fixtures/regressions/*` are git-tracked and exercised by CI on every reviewer fleet change.

## Public API

Not yet (Phase A in progress). Will be the `sdlc` CLI per [DESIGN.md](./DESIGN.md) §1.

## Do's

- Update CONTEXT.md per the bubble-up rule when public API surface changes
- Run `pnpm run ci` before every push
- Use `Result<T,E>` at module boundaries
- Log structured JSON; never raw `console.error`
- Validate input from agents / files / network with Zod

## Don'ts

- Don't write to Red zone files without HITL approval token
- Don't use `any` / `as unknown as` / non-null assertions
- Don't throw across module boundaries
- Don't `console.log` from library modules; structured logger only
- Don't commit `private/`, `.audit/raw/`, `.sdlc-sandboxes/` — gitignored for a reason

## Nuances

- The CONTEXT tree is cached per agent run (~95% input cache hit). Don't put agent-specific state in CONTEXT.md or CLAUDE.md.
- Prompt cache key = sha256(file paths + last-commit SHAs). Any edit invalidates the cache for affected agents.
- Module-level CONTEXT.md files arrive as the codebase grows; each gets its own when public API surface emerges.

## How to extend

1. New module under `tools/sdlc/<name>/`:
   - Add directory + initial files
   - Add `<name>/CONTEXT.md` with the template from ARCHITECTURE.md §9.2
   - Update repo-root CONTEXT.md (this file) to reference the module under "Architecture > Module boundaries"
   - If module crosses into Red zone: declare in CLAUDE.md AND raise an ADR via G1.5

2. New agent under `tools/sdlc/agents/<role>/`:
   - Define agent's brief schema (Zod)
   - Define agent's output schema (Zod)
   - Write the prompt at `tools/sdlc/prompts/<role>/v1.md`
   - Add a regression fixture under `tools/sdlc/fixtures/regressions/<role>/`
   - Register in `tools/sdlc/router/registry.ts`
   - Add the agent to ARCHITECTURE.md §4

## Recent changes

Auto-populated by SCOUT once it runs. For now: this is commit feea230 + 3322db1 + the Phase A foundation commit (pending).

## Open questions

- (none open at the repo-root level; per-module CONTEXT.md files will track theirs)

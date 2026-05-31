# CLAUDE.md — ai-sdlc (the platform itself)

> Project-level rules + Red zone declaration. ai-sdlc agents working on this repo MUST honor this file. Three-layer enforcement reads from here.

This is the meta-recursive case: the platform that builds other projects' code also manages its own code through the same pipeline. ai-sdlc onboards itself as a tenant.

## Project overview

**ai-sdlc** is an autonomous SDLC platform. Multi-agent pipeline (PLANNER, BUILDER, TESTER, REVIEWER FLEET, DEMO, COMMIT, REPORTER + DEBUGGER + SCOUT) that ships code with human-in-the-loop gates calibrated to blast radius. Multi-tenant from day 1 across 4-5 testbed projects.

## Owner

@piyushgupta27

## Blast Radius — Red Zone files (Tier 0 and Tier 1)

The following paths require human sign-off at COMMIT (G3). Agents MUST refuse to write to these files outside a planned Tier 0/1 task with explicit HITL approval recorded in `.audit/<date>/hitl/`.

### Tier 0 (extreme caution; never autonomous; Red zone NEVER reclassifies downward)

- LICENSE                                    # legal foundation
- CLAUDE.md                                  # this file
- tools/check-blast-radius.sh                # the hook itself
- tools/sdlc/orchestrator/audit-log.ts       # audit chain — tampering breaks replay
- tools/sdlc/orchestrator/file-ops.ts        # write wrapper that invokes the hook
- tools/sdlc/orchestrator/rollback.ts        # rollback machinery
- .github/workflows/blast-radius.yml         # Layer 3 CI check
- .github/workflows/release.yml              # release automation (when added)

### Tier 1 (high blast radius)

- tools/sdlc/orchestrator/index.ts           # main orchestrator entry
- tools/sdlc/types/                          # core types used everywhere
- tools/sdlc/router/                         # model routing logic
- tools/sdlc/hooks/                          # pre/post-write hooks
- tools/sdlc/agents/aggregator/              # reviewer aggregator + AI filter
- tools/sdlc/agents/reviewer-fleet/security/ # security reviewer prompts + tools
- projects/                                  # per-tenant config + state
- SECURITY.md                                # security policy

Tier 2-4 are everything else by default. Tier classification for new files is set at PR creation via the `tier:N` label.

## Approval & authorship (MUST — human control)

Hard rules. Mechanized enforcement (separate bot identity + branch protection) is
deferred and tracked in `AGENT-GOVERNANCE.md §9`; until then these are enforced by
convention — and they are non-negotiable.

- **The agent NEVER self-approves.** Approval of any MANAGER-gated change (Red-zone / Tier 0–1, and **any** change to this `CLAUDE.md`) is a **human action only**. The agent **posts the PR link and waits** for Piyush's PR review / "Approved" comment; it must **not** apply an approval label, submit an approving review, or otherwise manufacture approval. **Verify the human review exists before merge; never merge a Red-zone PR on the agent's own authority.**
- **Commit authorship = the user.** Always author commits as Piyush (his GitHub-linked email) so contributions land on his graph. A separate bot identity, once set up, is for **PR-opening only** — never for commit authorship.
- Full model + the deferred mechanization: `AGENT-GOVERNANCE.md §4.1`.

## Architecture

- **Pattern:** event-driven orchestrator + stateless agents + append-only audit log
- **Key types:** `Project`, `Task`, `Tier`, `AuditRow`, `HITLGate`, `ReviewerVerdict` (defined in `tools/sdlc/types/`)
- **Boundary:** orchestrator never directly modifies target-repo files; only agents do, via the file-ops wrapper that invokes the blast-radius hook
- **Multi-tenancy:** every operation requires `--project <slug>` arg; no cross-project access without explicit override flag

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full design.

## Code conventions (this repo)

- TypeScript strict mode (see tsconfig.json); no `any`, no `as unknown as`, no non-null assertions
- ESM only (`"type": "module"`); no CommonJS
- Top-level await is fine in entry files; library modules export async functions
- All public functions in `tools/sdlc/` are typed with explicit return types
- Zod for runtime validation on every data boundary (input from agent, input from file, input from network)
- `Result<T, E>` pattern for fallible operations; never throw across module boundaries
- Tests live in `**/*.test.ts` co-located with the file under test
- Biome handles lint + format; conventions match `biome.json`

## Error handling

- Module boundary: every public function returns `Result<T, E>` or `Promise<Result<T, E>>` for fallible ops
- Top-level (CLI entry, orchestrator main): catches Result errors + reports per DESIGN.md §6 error format (problem + cause + fix + docs link)
- Audit log writes are mandatory before any error propagates; if the audit write itself fails, that's a hard stop (the pipeline cannot lose its memory)
- Never `console.error` raw — always go through the structured logger

## Logging

- Structured logs only (JSON); no free-form text
- Required fields: `ts`, `project`, `level`, `component`, `message`
- Optional: `task_id`, `agent`, `audit_run_id`, `error_code`
- **NEVER log:** API keys, cookies, full agent prompts (audit log captures these in a separate audit-only file with stricter access), file contents from `private/`
- Log levels: `debug` (dev-only) / `info` (default) / `warn` (recoverable issue) / `error` (operation failed)

## Database / persistence

- Audit log: append-only JSONL in target repo's `.audit/<date>/runs/*.jsonl` (last 90d) + SQLite archive at `~/.gstack/audit/<slug>/` (older)
- Project state: JSON at `projects/<slug>/state.json`; atomic writes (tmp file + rename)
- No SQL database for v1; if we need one in Phase D+, raise an ADR

## API contracts

- No HTTP API in v1 except the dashboard at :3001 (Next.js sub-app)
- Inter-agent communication: structured JSON messages via the audit log (orchestrator is the only writer; agents read on retry/replay)
- Agent prompts are versioned at `tools/sdlc/prompts/<agent>/v<N>.md`; cohort tracking ties output PRs to prompt versions

## Testing

- Coverage target: ≥70% on changed files for general code, ≥85% on Tier 0/1 zones
- Unit tests: vitest, co-located `*.test.ts`
- Integration tests: separate `*.integration.test.ts`; run only in `pnpm run test:integration`
- E2E tests for the dashboard: Playwright (added in Phase A late)
- Fixtures live at `tools/sdlc/fixtures/` (regression suite for reviewer fleet)
- `pnpm run ci` is the gate; CI workflow runs the same command

## Local dev

```bash
# One-time setup
pnpm install

# Type-check + lint
pnpm run typecheck
pnpm run lint

# Run tests
pnpm run test

# Run the CLI locally (development mode via tsx)
pnpm run sdlc <verb> [args]

# Build for distribution
pnpm run build

# Run dashboard (Phase A late)
pnpm --filter @ai-sdlc/dashboard dev
```

## Dependencies

- Runtime: minimal; Node 22+ stdlib + zod (when needed) + better-sqlite3 (when audit archive lands)
- Dev: TypeScript, Biome, Vitest, tsx
- No frontend deps yet; Next.js + Tailwind + shadcn arrive when dashboard does
- Pinning policy: exact versions in package.json (no `^`) for any runtime dep; ranges OK for devDeps

## Known quirks

- This repo is meta-recursive: ai-sdlc agents will eventually manage ai-sdlc's own code. Bootstrapping order matters — initial code is human-authored; first agent-authored PR is a Tier 4 typo fix to validate the pipeline works on itself.
- The audit log writer (Tier 0) is one of the FIRST things written manually; once it exists, every subsequent agent action lands in it. Don't write agent code before audit log code.
- The blast-radius hook protects itself: `tools/check-blast-radius.sh` is in its own Red zone declaration. Self-modification requires explicit HITL approval.
- Test fixtures for the reviewer fleet (`tools/sdlc/fixtures/regressions/`) are git-tracked + part of CI. They're how we know reviewers haven't regressed.

## Skill routing (gstack)

When the user invokes a skill, route as follows for ai-sdlc work:
- Product ideas / brainstorming → `/office-hours`
- Strategy / scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- Design system / plan review → `/plan-design-review`
- Bugs / errors → `/investigate`
- QA / testing site behavior → `/qa`
- Code review / diff check → `/review`
- Visual polish → `/design-review`
- Ship / deploy / PR → `/ship`

## What ai-sdlc reads from this repo on every agent run

The CONTEXT tree is cached per agent run (~95% input token cache hit when unchanged):

1. `CLAUDE.md` (this file) — global rules + Red zone
2. `CONTEXT.md` — repo overview
3. `**/CONTEXT.md` — per-module living docs
4. `tasks/lessons.md` (when present) — accumulated anti-patterns
5. Relevant ADRs from `docs/adr/`

Anything else is loaded per-task.

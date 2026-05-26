/**
 * `pnpm sdlc lint --project <slug>` — pre-dispatch ticket clarification.
 *
 * Q-AI-22 / R-AISDLC-101: adopted from Eric Tech's Superboard /lint UX.
 * Surfaces vague tickets in the Ready column + proposes AC fixes; user
 * approves or edits before orchestrator dispatches headless agents.
 *
 * v1 stub: this command reads tickets via gh CLI, runs them through a
 * lint Claude subagent (small Haiku call) that flags vagueness, and
 * prints the proposed fixes for user approval.
 *
 * Full implementation requires the github-projects integration from
 * Step 6. For now this command emits a clear TBD + manual workaround.
 */

import { hasFlag, parseArgs } from '../args.js'

const HELP = `pnpm sdlc lint — pre-dispatch ticket clarification

Usage:
  pnpm sdlc lint --project <slug> [options]

Options:
  --auto-approve     Apply suggested AC fixes without prompting (use with care)
  --json             Output JSON

Scans the Ready column on the project's GitHub Project board. For each ticket:
  - Checks acceptance criteria are present + measurable
  - Flags vague language ("fix X", "improve Y")
  - Proposes structured AC additions for your approval

Why lint before dispatch: headless agents can't ask clarifying questions.
Vague tickets stall in the Block column. Linting forces clarification
while the human is still in the loop.

(v1: full implementation in Step 6 — integrates with github-projects.ts)
`

export async function runLint(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help')) {
    process.stdout.write(HELP)
    return 0
  }

  const slug = args.flags.project
  if (typeof slug !== 'string') {
    process.stderr.write(`❌ Missing --project <slug>\n${HELP}`)
    return 2
  }

  process.stdout.write(`
${slug} · pnpm sdlc lint

Full lint implementation lands in Step 6 (tools/sdlc/integrations/github-projects.ts
+ the lint Haiku call). Until then, lint your tickets manually:

  1. Open your GitHub Project: gh project list --owner piyushgupta27
  2. For each ticket in Ready, verify:
     - Title is imperative ("Add X" / "Refactor Y", not "Should we...")
     - Description includes 2+ acceptance criteria
     - Each AC is measurable (not "make it better")
     - Tier classification is set via label (tier:0..4)
  3. Tickets without these get stuck in Block during dispatch

After Step 6, this command will iterate tickets, surface vague AC,
and apply proposed fixes via gh issue edit on your approval.
`)

  return 0
}

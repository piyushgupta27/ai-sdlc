#!/usr/bin/env node
/**
 * ai-sdlc CLI — entry point for `pnpm sdlc <verb>`.
 *
 * Verbs in v1 (per DESIGN.md §1.1):
 *   onboard      Add a new project as a testbed
 *   lint         Pre-dispatch ticket clarification
 *   dispatch     Headless orchestrator run
 *   status       Project/pipeline state
 *   board        GitHub Project board state
 *
 * Verbs in v1.5+ (not yet implemented):
 *   deboard, start, tick, audit, replay, readiness, next, vacation,
 *   force-exempt, config
 *
 * Arg parsing is hand-rolled (no commander/yargs). Each verb owns its
 * own flag parsing under cli/commands/<verb>.ts.
 */

import { runBoard } from './commands/board.js'
import { runDashboard } from './commands/dashboard.js'
import { runDispatch } from './commands/dispatch.js'
import { runDoctor } from './commands/doctor.js'
import { runLint } from './commands/lint.js'
import { runOnboard } from './commands/onboard.js'
import { runStatus } from './commands/status.js'

const HELP = `ai-sdlc · autonomous SDLC platform

Usage: pnpm sdlc <command> [options]

Project lifecycle
  onboard            Add a new project as a testbed
  doctor             Verify projects satisfy the platform contract
  status             Show project state and pipeline health

Pipeline operations
  lint               Pre-dispatch ticket clarification
  dispatch           Run the orchestrator (CLI or webhook entry)
  board              View / sync GitHub Project board state
  dashboard          Start local dashboard at localhost:3001

Common flags
  --project <slug>   Target project (required for most commands)
  --json             Output JSON instead of human-readable

For help on a specific command:
  pnpm sdlc <command> --help

Documentation: https://github.com/piyushgupta27/ai-sdlc
`

type CommandHandler = (argv: readonly string[]) => Promise<number>

const COMMANDS: Record<string, CommandHandler> = {
  onboard: runOnboard,
  doctor: runDoctor,
  lint: runLint,
  dispatch: runDispatch,
  status: runStatus,
  board: runBoard,
  dashboard: runDashboard,
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP)
    return 0
  }

  const [verb, ...rest] = argv
  if (verb === undefined || !(verb in COMMANDS)) {
    process.stderr.write(`Unknown command: ${verb ?? '(none)'}\n\n`)
    process.stderr.write(HELP)
    return 2
  }

  const handler = COMMANDS[verb]
  if (!handler) {
    process.stderr.write(`Internal: handler missing for ${verb}\n`)
    return 2
  }

  try {
    return await handler(rest)
  } catch (cause) {
    process.stderr.write(
      `💥 Unhandled error in '${verb}': ${cause instanceof Error ? cause.message : String(cause)}\n`,
    )
    if (cause instanceof Error && cause.stack) {
      process.stderr.write(`${cause.stack}\n`)
    }
    return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((cause) => {
    process.stderr.write(`Fatal: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exit(1)
  })

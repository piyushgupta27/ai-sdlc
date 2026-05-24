/**
 * `pnpm sdlc board --project <slug>` — show GitHub Project board state.
 *
 * v1 stub: shells out to `gh project item-list` and groups by column.
 * Full GitHub Projects integration (the orchestrator-side reader/writer)
 * lands as a separate module in Step 6 — this CLI command is a thin
 * display wrapper over it.
 *
 * Until Step 6 is complete, this command prints an informative TBD and
 * suggests using `gh project` directly.
 */

import { spawn } from 'node:child_process'
import { hasFlag, parseArgs } from '../args.js'

const HELP = `pnpm sdlc board — show GitHub Project board state

Usage:
  pnpm sdlc board --project <slug>

Options:
  --json             Output JSON

(v1: thin wrapper over gh CLI. Full integration in Step 6.)
`

export async function runBoard(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help')) {
    process.stdout.write(HELP)
    return 0
  }

  const slug = args.flags['project']
  if (typeof slug !== 'string') {
    process.stderr.write(`❌ Missing --project <slug>\n${HELP}`)
    return 2
  }

  // Check gh is available
  const ghCheck = await spawnAndWait('gh', ['--version'])
  if (ghCheck.exitCode !== 0) {
    process.stderr.write(
      `❌ gh CLI not found. Install: https://cli.github.com\n   ai-sdlc reads GitHub Project boards via gh; required for this command.\n`,
    )
    return 1
  }

  // v1: print informative TBD + show how to inspect the board manually
  process.stdout.write(`
${slug} · GitHub Project board

Full integration ships in Step 6 (tools/sdlc/integrations/github-projects.ts).
Until then, inspect the board directly:

  # List all your project boards
  gh project list --owner piyushgupta27

  # View one project's items (replace N with the project number)
  gh project item-list N --owner piyushgupta27

After Step 6, this command will render the kanban directly:

  Ready (3):           Building (1):       QA (1):           Review (1):
    #142 ...             #143 ...            #140 ...          #139 ...
  Done (today, 4):                          Blocked (1):
    #136 ...                                  #135 (cap-exhausted)
`)

  return 0
}

interface SpawnResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

function spawnAndWait(cmd: string, args: readonly string[]): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', () => {
      resolve({ stdout, stderr, exitCode: 127 })
    })
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
  })
}

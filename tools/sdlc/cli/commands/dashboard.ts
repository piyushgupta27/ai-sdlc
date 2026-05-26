/**
 * `pnpm sdlc dashboard` — start the local dashboard at localhost:3001.
 *
 * Blocks until SIGINT (Ctrl-C). The dashboard is local-only (binds to
 * 127.0.0.1), no auth, no TLS — relies on local-only access.
 */

import { startServer } from '../../dashboard/server.js'
import { getFlag, hasFlag, parseArgs } from '../args.js'

const HELP = `pnpm sdlc dashboard — start the local dashboard

Usage:
  pnpm sdlc dashboard [options]

Options:
  --port <n>    Bind to a different port (default 3001)
  --host <ip>   Bind to a different host (default 127.0.0.1; do NOT use 0.0.0.0 unless you've added auth)

The dashboard surfaces:
  - Project list + state (mirror of \`pnpm sdlc status\`)
  - HITL queue across all onboarded projects
  - Gate detail + response form (Submit triggers retry on orchestrator)

Stop with Ctrl-C.
`

export async function runDashboard(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help')) {
    process.stdout.write(HELP)
    return 0
  }

  const port = Number.parseInt(getFlag(args, 'port') ?? '3001', 10)
  const host = getFlag(args, 'host') ?? '127.0.0.1'

  if (host !== '127.0.0.1' && host !== 'localhost') {
    process.stderr.write(
      `⚠️ Binding to ${host} — the dashboard has no auth. Use only on trusted networks.\n`,
    )
  }

  const server = startServer({ port, host })
  process.stdout.write(`
ai-sdlc dashboard running at ${server.url}

  Home    ${server.url}/
  Queue   ${server.url}/queue

Press Ctrl-C to stop.
`)

  // Block until SIGINT
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      process.stdout.write('\nShutting down...\n')
      server.stop().finally(() => resolve())
    })
  })

  return 0
}

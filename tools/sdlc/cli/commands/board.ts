/**
 * `pnpm sdlc board --project <slug>` — render the GitHub Project board state.
 *
 * Reads the project's board via the github-projects integration; groups items
 * by column; prints a compact kanban.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CANONICAL_COLUMNS, findProject, listItems } from '../../integrations/github-projects.js'
import { projectDir } from '../../orchestrator/state.js'
import { asProjectSlug } from '../../types/index.js'
import { hasFlag, parseArgs } from '../args.js'

const HELP = `pnpm sdlc board — render the GitHub Project board

Usage:
  pnpm sdlc board --project <slug>

Options:
  --owner <handle>   GitHub owner (defaults to project config)
  --json             Output JSON
`

export async function runBoard(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help')) {
    process.stdout.write(HELP)
    return 0
  }

  const slugRaw = args.flags.project
  if (typeof slugRaw !== 'string') {
    process.stderr.write(`❌ Missing --project <slug>\n${HELP}`)
    return 2
  }
  const slug = asProjectSlug(slugRaw)

  // Resolve owner from project config (or --owner override)
  let owner = typeof args.flags.owner === 'string' ? args.flags.owner : undefined
  if (!owner) {
    const cfgPath = join(projectDir(slug), 'config.json')
    if (existsSync(cfgPath)) {
      try {
        const raw = await readFile(cfgPath, 'utf8')
        const cfg = JSON.parse(raw) as { owner?: string }
        owner = cfg.owner
      } catch {
        // fall through
      }
    }
  }
  if (!owner) {
    process.stderr.write(
      '❌ Cannot determine GitHub owner.\n   Either onboard the project (which sets owner) or pass --owner <handle>.\n',
    )
    return 1
  }

  const project = await findProject(owner, slug)
  if (!project.ok) {
    process.stderr.write(`❌ ${project.error.message}\n`)
    if (project.error.fix) {
      process.stderr.write(`   ${project.error.fix}\n`)
    }
    return 1
  }

  const items = await listItems(project.value)
  if (!items.ok) {
    process.stderr.write(`❌ ${items.error.message}\n`)
    return 1
  }

  // Group items by column
  const byColumn = new Map<string, typeof items.value>()
  for (const col of CANONICAL_COLUMNS) {
    byColumn.set(col, [])
  }
  for (const item of items.value) {
    const col = item.column ?? 'Ready'
    const bucket = byColumn.get(col) ?? []
    byColumn.set(col, [...bucket, item])
  }

  if (hasFlag(args, 'json')) {
    process.stdout.write(`${JSON.stringify(Object.fromEntries(byColumn), null, 2)}\n`)
    return 0
  }

  // Human-readable kanban
  process.stdout.write(`\n${slug} · GitHub Project board (#${project.value.number})\n\n`)

  for (const col of CANONICAL_COLUMNS) {
    const bucket = byColumn.get(col) ?? []
    if (bucket.length === 0 && col !== 'Ready' && col !== 'Blocked') continue
    process.stdout.write(`${col} (${bucket.length})\n`)
    for (const item of bucket.slice(0, 10)) {
      const labelTier = item.content.labels?.find((l) => l.startsWith('tier:')) ?? ''
      const tierTag = labelTier ? ` [${labelTier}]` : ''
      process.stdout.write(`  #${item.content.number}  ${item.title}${tierTag}\n`)
    }
    if (bucket.length > 10) {
      process.stdout.write(`  ... and ${bucket.length - 10} more\n`)
    }
    process.stdout.write('\n')
  }

  return 0
}

/**
 * `pnpm sdlc status --project <slug>` — project state.
 *
 * Prints a human-readable snapshot. With --json, dumps state.json directly.
 */

import { asProjectSlug, isErr } from '../../types/index.js'
import { listProjects, readState } from '../../orchestrator/state.js'
import { listPending } from '../../orchestrator/hitl-queue.js'
import { readState as readProjectConfig } from '../../orchestrator/state.js'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { hasFlag, parseArgs, requireFlag } from '../args.js'

const HELP = `pnpm sdlc status — show project state

Usage:
  pnpm sdlc status [options]

Options:
  --project <slug>   Show one project (omit to list all)
  --json             Output JSON instead of human-readable
`

export async function runStatus(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help')) {
    process.stdout.write(HELP)
    return 0
  }

  const json = hasFlag(args, 'json')
  const slugFlag = args.flags['project']

  if (typeof slugFlag !== 'string') {
    // List all projects
    const projects = await listProjects()
    if (isErr(projects)) {
      process.stderr.write(`❌ ${projects.error.message}\n`)
      return 1
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(projects.value, null, 2)}\n`)
      return 0
    }
    process.stdout.write(`\nProjects onboarded: ${projects.value.length}\n`)
    for (const slug of projects.value) {
      const state = await readState(slug)
      if (state.ok && state.value) {
        process.stdout.write(
          `  ${slug}  ${state.value.trustState}  readiness=${state.value.readinessScore}%  in-flight=${state.value.inFlightTaskIds.length}\n`,
        )
      }
    }
    process.stdout.write(`\nFor detail: pnpm sdlc status --project <slug>\n`)
    return 0
  }

  // Single project
  const slug = asProjectSlug(slugFlag)
  const state = await readState(slug)
  if (isErr(state)) {
    process.stderr.write(`❌ ${state.error.message}\n`)
    return 1
  }
  if (state.value === null) {
    process.stderr.write(`❌ Project ${slug} is not onboarded.\n   Run: pnpm sdlc onboard --slug ${slug} --repo <path>\n`)
    return 1
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(state.value, null, 2)}\n`)
    return 0
  }

  // Load config for repoPath (needed to read HITL queue)
  const cfgPath = join(process.cwd(), 'projects', slug, 'config.json')
  if (!existsSync(cfgPath)) {
    process.stderr.write(`(No config.json — onboarding may be incomplete)\n`)
  }
  let repoPath: string | undefined
  try {
    const cfgRaw = await readFile(cfgPath, 'utf8')
    const cfg = JSON.parse(cfgRaw) as { repoPath?: string }
    repoPath = cfg.repoPath
  } catch {
    // ignore — best-effort
  }

  // Human-readable output
  const s = state.value
  process.stdout.write(`
Project: ${slug}
  Repo:          ${repoPath ?? '(unknown)'}
  Trust state:   ${s.trustState}
  Readiness:     ${s.readinessScore}/100  (context=${s.readinessBreakdown.context} testing=${s.readinessBreakdown.testing} cicd=${s.readinessBreakdown.cicd})
  In-flight:     ${s.inFlightTaskIds.length} ${s.inFlightTaskIds.length > 0 ? `(${s.inFlightTaskIds.join(', ')})` : ''}
  Defect rate 7d: ${(s.defectRate7d * 100).toFixed(1)}%
  Last readiness: ${s.lastReadinessCheck === new Date(0).toISOString() ? 'never' : s.lastReadinessCheck}
`)

  // HITL queue
  if (repoPath && existsSync(repoPath)) {
    const pending = await listPending(repoPath)
    if (pending.ok) {
      process.stdout.write(`  HITL queue:    ${pending.value.length} pending\n`)
      for (const req of pending.value.slice(0, 5)) {
        process.stdout.write(`    ${req.gate} · ${req.summary} (${req.id})\n`)
      }
    }
  }

  process.stdout.write('\n')
  return 0
}

// Re-export to silence unused-export warning
void readProjectConfig

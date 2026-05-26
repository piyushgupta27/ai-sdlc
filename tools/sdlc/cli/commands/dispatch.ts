/**
 * `pnpm sdlc dispatch --project <slug>` — orchestrator headless run.
 *
 * Q-AI-25 / R-AISDLC-104: also accepts webhook trigger via ntfy.sh.
 *
 * v1 flow:
 *   1. Read project state
 *   2. (Step 6) Read GitHub Project Ready column for next ticket
 *   3. Run orchestrator.runTask() on that ticket
 *   4. Update column based on result (Building → QA → Review → Done/Blocked)
 *   5. Loop until queue empty OR HITL gate fires
 *
 * v1 stub: GitHub Projects integration is Step 6. This command currently
 * accepts a --task-spec JSON flag for manual testing of the orchestrator
 * loop without needing a real GitHub Project board.
 */

import { readFile } from 'node:fs/promises'
import { runTask } from '../../orchestrator/index.js'
import { readState } from '../../orchestrator/state.js'
import { type Task, asProjectSlug } from '../../types/index.js'
import { getFlag, hasFlag, parseArgs, requireFlag } from '../args.js'

const HELP = `pnpm sdlc dispatch — run the orchestrator on a project

Usage:
  pnpm sdlc dispatch --project <slug> [options]

Options:
  --task-spec <file>   Path to a JSON file with a Task spec (manual testing
                       fallback until GH Projects integration ships in Step 6)
  --max-tasks <n>      Stop after processing N tasks (default 5)
  --webhook            Read trigger from stdin (ntfy.sh integration; Step 6)
  --json               JSON output

Examples:
  # Run on next ticket from the project board (Step 6+)
  pnpm sdlc dispatch --project trip-research

  # Test orchestrator with a hand-crafted task spec
  pnpm sdlc dispatch --project trip-research --task-spec ./tmp/task.json
`

export async function runDispatch(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help')) {
    process.stdout.write(HELP)
    return 0
  }

  let slugRaw: string
  try {
    slugRaw = requireFlag(args, 'project', 'Pass the project slug')
  } catch (e) {
    process.stderr.write(`❌ ${(e as Error).message}\n${HELP}`)
    return 2
  }

  const slug = asProjectSlug(slugRaw)
  const taskSpec = getFlag(args, 'task-spec')
  // const maxTasks = Number.parseInt(getFlag(args, 'max-tasks') ?? '5', 10)

  // Verify project is onboarded
  const state = await readState(slug)
  if (!state.ok) {
    process.stderr.write(`❌ ${state.error.message}\n`)
    return 1
  }
  if (state.value === null) {
    process.stderr.write(
      `❌ Project ${slug} not onboarded. Run: pnpm sdlc onboard --slug ${slug} --repo <path>\n`,
    )
    return 1
  }

  // v1 manual path: --task-spec
  if (taskSpec) {
    return await dispatchManualSpec(slug, taskSpec)
  }

  // v1.5+ / Step 6 path: read from GH Project board
  process.stdout.write(`
${slug} · dispatch

GitHub Projects integration (reading the Ready column) ships in Step 6.
Until then, run a single task by passing --task-spec:

  cat > /tmp/task.json <<EOF
  {
    "project": "${slug}",
    "id": "test.1.1",
    "storyId": "test.1",
    "epicId": "test",
    "title": "Toy test task",
    "description": "Describe the work for BUILDER here",
    "tier": 3,
    "dod": {
      "acceptanceCriteria": ["AC1", "AC2"],
      "nfr": [],
      "testsRequired": ["unit"],
      "coverageFloor": 70,
      "contextUpdates": [],
      "requiresAdr": false
    },
    "estimatedCostUsd": 0.50,
    "dependsOn": [],
    "blocks": [],
    "expectedFiles": [],
    "stage": "PLAN",
    "status": "planned",
    "createdAt": "${new Date().toISOString()}",
    "updatedAt": "${new Date().toISOString()}"
  }
  EOF

  pnpm sdlc dispatch --project ${slug} --task-spec /tmp/task.json
`)

  return 0
}

async function dispatchManualSpec(
  slug: import('../../types/index.js').ProjectSlug,
  taskSpecPath: string,
): Promise<number> {
  let task: Task
  try {
    const raw = await readFile(taskSpecPath, 'utf8')
    task = JSON.parse(raw) as Task
  } catch (cause) {
    process.stderr.write(`❌ Cannot read --task-spec file: ${(cause as Error).message}\n`)
    return 1
  }

  // Read repo path from project config
  const { join } = await import('node:path')
  const cfgPath = join(process.cwd(), 'projects', slug, 'config.json')
  const cfgRaw = await readFile(cfgPath, 'utf8')
  const cfg = JSON.parse(cfgRaw) as { repoPath: string }

  process.stdout.write(
    `\nDispatching ${task.id} on ${slug} (tier ${task.tier}, target=${cfg.repoPath})...\n\n`,
  )

  const result = await runTask({
    project: slug,
    task,
    targetRepo: cfg.repoPath,
    branch: `feature/${task.id}`,
  })

  if (!result.ok) {
    process.stderr.write(`❌ Dispatch failed: ${result.error.code} — ${result.error.message}\n`)
    if (result.error.fix) {
      process.stderr.write(`   Fix: ${result.error.fix}\n`)
    }
    return 1
  }

  const outcome = result.value
  process.stdout.write(`
✓ Task ${outcome.taskId} ${outcome.result.toUpperCase()}
  Final stage:    ${outcome.stage}
  Retries used:   ${outcome.retriesUsed}
  Audit run IDs:  ${outcome.auditRunIds.join(', ') || '(none)'}
  Total cost:     $${outcome.costUsd.toFixed(4)}
  Wall time:      ${(outcome.durationMs / 1000).toFixed(1)}s
  ${outcome.notes ? `Notes:          ${outcome.notes}` : ''}

`)

  return outcome.result === 'failed' ? 1 : 0
}

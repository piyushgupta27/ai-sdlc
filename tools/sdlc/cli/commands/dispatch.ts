/**
 * `pnpm sdlc dispatch --project <slug>` — orchestrator headless run.
 *
 * Two paths:
 *   (a) --task-spec <file>  — manual test path; runs orchestrator on a single
 *       hand-crafted Task JSON spec. Useful for debugging.
 *   (b) (default)            — reads the Ready column on the GitHub Project
 *       board, takes the first ticket, runs the orchestrator, and moves the
 *       card based on outcome (Done / Blocked).
 *
 * Webhook mode (--webhook --topic <ntfy>) subscribes to ntfy.sh and dispatches
 * on every received `dispatch <slug>` message.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ProjectItem,
  findProject,
  listItems,
  moveItem,
} from '../../integrations/github-projects.js'
import { parseDispatchTrigger, subscribe } from '../../integrations/ntfy.js'
import { type BudgetDecision, PAUSE_THRESHOLD, budgetGate } from '../../orchestrator/budget.js'
import { runTask } from '../../orchestrator/index.js'
import { projectDir, readState } from '../../orchestrator/state.js'
import { provisionWorktreeSandbox } from '../../sandbox/index.js'
import { type ProjectSlug, type Task, type Tier, asProjectSlug } from '../../types/index.js'
import { getFlag, hasFlag, parseArgs, requireFlag } from '../args.js'

const HELP = `pnpm sdlc dispatch — run the orchestrator on a project

Usage:
  pnpm sdlc dispatch --project <slug> [options]

Options:
  --task-spec <file>   Hand-crafted Task JSON (manual testing path)
  --max-tasks <n>      Stop after N tasks (default 5)
  --webhook            Subscribe to ntfy.sh and dispatch on each trigger
  --topic <name>       ntfy.sh topic to subscribe to (required if --webhook)
  --owner <handle>     GitHub owner (defaults to project config)
  --json               JSON output

Examples:
  # Take next ticket from Ready column
  pnpm sdlc dispatch --project trip-research

  # Manual test with a hand-crafted Task
  pnpm sdlc dispatch --project trip-research --task-spec /tmp/task.json

  # Mobile dispatch — subscribe to ntfy; trigger from phone
  pnpm sdlc dispatch --project trip-research --webhook --topic <ntfy-slug>
`

/** Format the budget-pause notice (shared by both dispatch paths). */
function formatBudgetPause(gate: BudgetDecision, processed?: number): string {
  const pct = Math.round(gate.pct * 100)
  const thr = Math.round(PAUSE_THRESHOLD * 100)
  const tail = processed === undefined ? '' : ` Processed ${processed} task(s).`
  return `\n⏸  Budget guard: $${gate.spentUsd.toFixed(2)} / $${gate.budgetUsd} this month (${pct}%) ≥ ${thr}% — new dispatch paused.${tail} Raise SDLC_MONTHLY_BUDGET_USD to override.\n`
}

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

  const taskSpec = getFlag(args, 'task-spec')
  const isWebhook = hasFlag(args, 'webhook')
  const topic = getFlag(args, 'topic')
  const maxTasks = Number.parseInt(getFlag(args, 'max-tasks') ?? '5', 10)

  if (taskSpec) return dispatchManualSpec(slug, taskSpec)
  if (isWebhook) {
    if (!topic) {
      process.stderr.write('❌ --webhook requires --topic <ntfy-topic>\n')
      return 2
    }
    return dispatchWebhookLoop(slug, topic, maxTasks)
  }

  return dispatchFromBoard(slug, args, maxTasks)
}

// ─── manual: --task-spec ─────────────────────────────────────────────────

async function dispatchManualSpec(slug: ProjectSlug, taskSpecPath: string): Promise<number> {
  let task: Task
  try {
    const raw = await readFile(taskSpecPath, 'utf8')
    task = JSON.parse(raw) as Task
  } catch (cause) {
    process.stderr.write(`❌ Cannot read --task-spec file: ${(cause as Error).message}\n`)
    return 1
  }

  const cfg = await readConfig(slug)
  if (!cfg) {
    process.stderr.write(`❌ Cannot read project config for ${slug}\n`)
    return 1
  }

  process.stdout.write(
    `\nDispatching ${task.id} on ${slug} (tier ${task.tier}, target=${cfg.repoPath})...\n\n`,
  )

  const gate = await budgetGate(new Date(), (cfg as { webhookTopic?: string }).webhookTopic)
  if (gate.action === 'pause') {
    process.stderr.write(formatBudgetPause(gate))
    return 0
  }

  const branch = `feature/${task.id}`
  const sandbox = await provisionWorktreeSandbox({
    repoPath: cfg.repoPath,
    taskId: task.id,
    branch,
  })
  if (!sandbox.ok) {
    process.stderr.write(`❌ ${sandbox.error.code} — ${sandbox.error.message}\n`)
    if (sandbox.error.fix) process.stderr.write(`   Fix: ${sandbox.error.fix}\n`)
    return 1
  }

  try {
    const result = await runTask({
      project: slug,
      task,
      targetRepo: sandbox.value.workspacePath,
      branch,
    })

    if (!result.ok) {
      process.stderr.write(`❌ ${result.error.code} — ${result.error.message}\n`)
      if (result.error.fix) process.stderr.write(`   Fix: ${result.error.fix}\n`)
      return 1
    }
    return printOutcome(result.value)
  } finally {
    const cleaned = await sandbox.value.cleanup()
    if (!cleaned.ok) process.stderr.write(`   ⚠️  ${cleaned.error.message}\n`)
  }
}

// ─── default: read Ready column on GH Project board ──────────────────────

async function dispatchFromBoard(
  slug: ProjectSlug,
  args: ReturnType<typeof parseArgs>,
  maxTasks: number,
): Promise<number> {
  const cfg = await readConfig(slug)
  if (!cfg) {
    process.stderr.write('❌ Cannot read project config\n')
    return 1
  }

  const owner = typeof args.flags.owner === 'string' ? args.flags.owner : cfg.owner
  const project = await findProject(owner, slug)
  if (!project.ok) {
    process.stderr.write(`❌ ${project.error.message}\n`)
    if (project.error.fix) process.stderr.write(`   ${project.error.fix}\n`)
    return 1
  }

  let processed = 0
  while (processed < maxTasks) {
    const gate = await budgetGate(new Date(), (cfg as { webhookTopic?: string }).webhookTopic)
    if (gate.action === 'pause') {
      process.stdout.write(formatBudgetPause(gate, processed))
      return 0
    }
    const ready = await listItems(project.value, 'Ready')
    if (!ready.ok) {
      process.stderr.write(`❌ ${ready.error.message}\n`)
      return 1
    }
    const next = ready.value[0]
    if (!next) {
      process.stdout.write(`\nReady column empty. Processed ${processed} task(s).\n`)
      return 0
    }

    // Convert ProjectItem → Task (heuristic; PLANNER would do this more thoroughly)
    const task = projectItemToTask(slug, next)

    // Move to Building
    const moveResult = await moveItem(project.value, next.id, 'Building')
    if (!moveResult.ok) {
      process.stderr.write(`❌ Failed to move card to Building: ${moveResult.error.message}\n`)
      return 1
    }

    process.stdout.write(
      `\n→ ${task.id} (#${next.content.number}) "${task.title}" [tier:${task.tier}]\n`,
    )

    // Each task runs in its own isolated worktree (#19). The orchestrator is
    // unchanged — it just receives the sandbox path as targetRepo. The audit
    // log + HITL queue are symlinked to the repo root, so they survive teardown.
    const branch = `feature/${task.id}`
    const sandbox = await provisionWorktreeSandbox({
      repoPath: cfg.repoPath,
      taskId: task.id,
      branch,
    })
    if (!sandbox.ok) {
      process.stderr.write(`  ❌ ${sandbox.error.message}\n`)
      await moveItem(project.value, next.id, 'Blocked')
      return 1
    }

    try {
      const result = await runTask({
        project: slug,
        task,
        targetRepo: sandbox.value.workspacePath,
        branch,
      })

      if (!result.ok) {
        process.stderr.write(`  ❌ ${result.error.message}\n`)
        await moveItem(project.value, next.id, 'Blocked')
        return 1
      }

      // Move card based on outcome
      const outcome = result.value
      const nextCol = outcome.result === 'merged' ? 'Done' : 'Blocked'
      await moveItem(project.value, next.id, nextCol)
      printOutcome(outcome)

      // PR-creation step (the orchestrator hands off here per its design note).
      // Pushes from the sandbox worktree, where BUILDER committed. Only when
      // there's an actual commit — no-op tasks get the card → Done without a PR.
      if (outcome.result === 'merged' && outcome.commitSha && outcome.branch) {
        await maybeCreatePr({
          repoPath: sandbox.value.workspacePath,
          slug,
          task,
          issueNumber: next.content.number,
          branch: outcome.branch,
          commitSha: outcome.commitSha,
        })
      }

      processed++

      // v1 prior behavior: break the loop on first HITL/failure. This made
      // overnight autonomous runs impossible — one stuck ticket blocked the
      // rest. Now: the card is already moved to Blocked above; just log and
      // continue. The user reviews the Blocked queue in the morning. The
      // exit code reflects "any failure" so CI can detect partial runs.
      if (outcome.result === 'hitl-pending' || outcome.result === 'failed') {
        process.stdout.write(`  (${task.id} blocked — continuing to next Ready item)\n`)
      }
    } finally {
      // Tear down the worktree. The branch ref + committed work persist in the
      // shared object store; audit + HITL records persist via the symlinks.
      const cleaned = await sandbox.value.cleanup()
      if (!cleaned.ok) process.stderr.write(`     ⚠️  ${cleaned.error.message}\n`)
    }
  }

  process.stdout.write(`\nReached --max-tasks (${maxTasks}). Stopping.\n`)
  return 0
}

// ─── webhook: subscribe to ntfy.sh ───────────────────────────────────────

async function dispatchWebhookLoop(
  slug: ProjectSlug,
  topic: string,
  maxTasks: number,
): Promise<number> {
  process.stdout.write(
    `\n🔔 Subscribed to ntfy.sh/${topic}\n   Send "dispatch ${slug}" from anywhere to trigger.\n   Ctrl-C to stop.\n\n`,
  )

  let dispatched = 0
  for await (const msg of subscribe({ topic })) {
    const trigger = parseDispatchTrigger(msg)
    if (!trigger) continue
    if (trigger.slug !== slug) {
      process.stdout.write(
        `(received trigger for ${trigger.slug}; this dispatcher is bound to ${slug} — skipping)\n`,
      )
      continue
    }

    process.stdout.write(`\n📥 Trigger received: ${msg.message}\n`)
    // Synthesize argv for dispatchFromBoard
    const fakeArgs = { _: [], flags: { project: slug } } as ReturnType<typeof parseArgs>
    await dispatchFromBoard(slug, fakeArgs, maxTasks)
    dispatched++

    if (dispatched >= 1000) {
      // Safety cap; webhook listener shouldn't run forever in practice
      process.stdout.write('Hit 1000-dispatch cap; restart the listener if you want more.\n')
      return 0
    }
  }

  return 0
}

// ─── helpers ─────────────────────────────────────────────────────────────

interface MinimalConfig {
  readonly repoPath: string
  readonly owner: string
}

async function readConfig(slug: ProjectSlug): Promise<MinimalConfig | null> {
  const cfgPath = join(projectDir(slug), 'config.json')
  if (!existsSync(cfgPath)) return null
  const raw = await readFile(cfgPath, 'utf8')
  const cfg = JSON.parse(raw) as { repoPath?: string; owner?: string }
  if (!cfg.repoPath || !cfg.owner) return null
  return { repoPath: cfg.repoPath, owner: cfg.owner }
}

function projectItemToTask(slug: ProjectSlug, item: ProjectItem): Task {
  const tierLabel = item.content.labels?.find((l) => l.startsWith('tier:'))
  const tier: Tier =
    tierLabel === 'tier:0'
      ? 0
      : tierLabel === 'tier:1'
        ? 1
        : tierLabel === 'tier:2'
          ? 2
          : tierLabel === 'tier:3'
            ? 3
            : tierLabel === 'tier:4'
              ? 4
              : 2

  const body = item.content.body ?? ''
  const acMatch = body.match(/##?\s*acceptance criteria\s*\n((?:.|\n)*?)(?:\n##|\n$|$)/i)
  const acs: string[] = acMatch
    ? (acMatch[1]?.match(/^\s*[-*]\s+(.+)$/gm) ?? []).map((line) => line.replace(/^\s*[-*]\s+/, ''))
    : []

  const taskId = `gh-${item.content.number}`
  const now = new Date().toISOString()

  return {
    project: slug,
    id: taskId,
    storyId: taskId,
    epicId: taskId,
    title: item.title,
    description: body,
    tier,
    dod: {
      acceptanceCriteria: acs,
      nfr: [],
      testsRequired: ['unit'],
      coverageFloor: tier <= 1 ? 85 : 70,
      contextUpdates: [],
      requiresAdr: false,
    },
    estimatedCostUsd: 0.5,
    dependsOn: [],
    blocks: [],
    expectedFiles: [],
    stage: 'PLAN',
    status: 'planned',
    createdAt: now,
    updatedAt: now,
  }
}

function printOutcome(outcome: {
  readonly taskId: string
  readonly result: string
  readonly stage: string
  readonly retriesUsed: number
  readonly auditRunIds: readonly string[]
  readonly costUsd: number
  readonly durationMs: number
  readonly notes?: string
}): number {
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

// ─── PR creation + branch reset ──────────────────────────────────────────

interface RunShellResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function runShell(cmd: string, args: readonly string[], cwd: string): Promise<RunShellResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.on('error', () => resolve({ code: 1, stdout, stderr: 'spawn failed' }))
  })
}

/**
 * After a task completes, push the feature branch + open a PR. Best-effort:
 * if push or gh fail, log + continue (the branch + commit are still local,
 * the user can finish manually).
 *
 * Permissions note: `git push` and `gh pr create` aren't in the project's
 * .claude/settings.json — first run will prompt the user. Once they grant
 * "always", subsequent dispatches push + open PRs without interruption.
 */
async function maybeCreatePr(args: {
  readonly repoPath: string
  readonly slug: ProjectSlug
  readonly task: Task
  readonly issueNumber: number
  readonly branch: string
  readonly commitSha: string
}): Promise<void> {
  process.stdout.write(`  ▸ Pushing ${args.branch}...\n`)
  const push = await runShell('git', ['push', '-u', 'origin', args.branch], args.repoPath)
  if (push.code !== 0) {
    process.stderr.write(
      `  ⚠️  Push failed (exit ${push.code}). Branch is local at ${args.commitSha}.\n`,
    )
    if (push.stderr)
      process.stderr.write(`     ${push.stderr.trim().split('\n').slice(0, 3).join('\n     ')}\n`)
    process.stderr.write(
      `     Manual: cd ${args.repoPath} && git push -u origin ${args.branch} && gh pr create\n`,
    )
    return
  }

  const title = args.task.title
  const body = [
    `Closes #${args.issueNumber}`,
    '',
    '## Summary',
    args.task.description.slice(0, 500),
    '',
    '## Acceptance criteria',
    ...args.task.dod.acceptanceCriteria.map((ac) => `- [x] ${ac}`),
    '',
    `_Generated by ai-sdlc · BUILDER on ${args.branch} · commit ${args.commitSha.slice(0, 8)}_`,
  ].join('\n')

  process.stdout.write(`  ▸ Opening PR for #${args.issueNumber}...\n`)
  const prResult = await runShell(
    'gh',
    ['pr', 'create', '--base', 'main', '--head', args.branch, '--title', title, '--body', body],
    args.repoPath,
  )
  if (prResult.code !== 0) {
    process.stderr.write(`  ⚠️  PR create failed (exit ${prResult.code}).\n`)
    if (prResult.stderr)
      process.stderr.write(
        `     ${prResult.stderr.trim().split('\n').slice(0, 3).join('\n     ')}\n`,
      )
    return
  }
  process.stdout.write(`  ✓ PR opened: ${prResult.stdout.trim()}\n`)
}

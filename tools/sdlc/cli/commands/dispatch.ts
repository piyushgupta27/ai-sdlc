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
 * Webhook mode (--webhook --topic <ntfy>) subscribes to a token-protected ntfy
 * topic and dispatches on every received `dispatch <slug>` message. It requires
 * SDLC_NTFY_TOKEN (a public topic is unsafe — anyone who knows it could trigger
 * the pipeline); the dispatcher only acts on triggers for its own onboarded slug.
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
import { parseDispatchTrigger, requireWebhookToken, subscribe } from '../../integrations/ntfy.js'
import { type BudgetDecision, PAUSE_THRESHOLD, budgetGate } from '../../orchestrator/budget.js'
import { runTask } from '../../orchestrator/index.js'
import {
  type PacingDecision,
  type RevertDecision,
  WINDOW_HOURS,
  pacingGate,
  reworkRateGate,
} from '../../orchestrator/pacing.js'
import { projectDir, readState } from '../../orchestrator/state.js'
import {
  type ValidationCommands,
  type ValidationDetail,
  asWorktreeCommands,
  hasDeterministicFailure,
  runValidations,
} from '../../orchestrator/validations.js'
import { detectLockfileDrift, provisionWorktreeSandbox } from '../../sandbox/index.js'
import { type ProjectSlug, type Task, type Tier, asProjectSlug } from '../../types/index.js'
import { getFlag, hasFlag, parseArgs, requireFlag } from '../args.js'

const HELP = `pnpm sdlc dispatch — run the orchestrator on a project

Usage:
  pnpm sdlc dispatch --project <slug> [options]

Options:
  --task-spec <file>   Hand-crafted Task JSON (manual testing path)
  --max-tasks <n>      Stop after N tasks (default 5)
  --webhook            Subscribe to a protected ntfy topic and dispatch on each trigger
                       (requires SDLC_NTFY_TOKEN; a public topic is unsafe)
  --topic <name>       ntfy.sh topic to subscribe to (required if --webhook)
  --owner <handle>     GitHub owner (defaults to project config)
  --json               JSON output

Examples:
  # Take next ticket from Ready column
  pnpm sdlc dispatch --project trip-research

  # Manual test with a hand-crafted Task
  pnpm sdlc dispatch --project trip-research --task-spec /tmp/task.json

  # Mobile dispatch — subscribe to a protected ntfy topic; trigger from phone
  #   (set SDLC_NTFY_TOKEN to the topic's access token first)
  SDLC_NTFY_TOKEN=<tok> pnpm sdlc dispatch --project trip-research --webhook --topic <ntfy-slug>
`

/** Format the budget-pause notice (shared by both dispatch paths). */
function formatBudgetPause(gate: BudgetDecision, processed?: number): string {
  const pct = Math.round(gate.pct * 100)
  const thr = Math.round(PAUSE_THRESHOLD * 100)
  const tail = processed === undefined ? '' : ` Processed ${processed} task(s).`
  return `\n⏸  Budget guard: $${gate.spentUsd.toFixed(2)} / $${gate.budgetUsd} this month (${pct}%) ≥ ${thr}% — new dispatch paused.${tail} Raise SDLC_MONTHLY_BUDGET_USD to override.\n`
}

/** Format the usage-window pacing-pause notice (gh-87). */
function formatPacingPause(gate: PacingDecision, processed?: number): string {
  const window = gate.inActiveWindow ? 'active' : 'off'
  const tail = processed === undefined ? '' : ` Processed ${processed} task(s).`
  return `\n⏸  Pacing guard: ~${gate.windowSpentTokens.toLocaleString()} tok spent + ~${gate.estimatedTaskTokens.toLocaleString()} est for next task would exceed the ${window}-window cap (~${Math.round(gate.capTokens).toLocaleString()} tok / ${WINDOW_HOURS}h).${tail} Raise SDLC_WINDOW_TOKEN_BUDGET / SDLC_PACING_CAP_* to override, or set sdlc_window_token_budget in the project's config.json.\n`
}

/** Format the approaching-cap warning (fired at 70% of the effective cap, before pause). */
function formatPacingWarning(gate: PacingDecision): string {
  const windowLabel = gate.inActiveWindow ? 'active' : 'off'
  const pct = gate.capTokens > 0 ? Math.round((gate.windowSpentTokens / gate.capTokens) * 100) : 0
  return `\n⚠️  Pacing warning: ~${gate.windowSpentTokens.toLocaleString()} tok spent (${pct}% of ${windowLabel}-window cap ~${Math.round(gate.capTokens).toLocaleString()} tok). Approaching the dispatch limit — next task may trigger a pause. Raise SDLC_WINDOW_TOKEN_BUDGET or set sdlc_window_token_budget in config.json to prevent this.\n`
}

/** Format the rework/revert-rate trip notice (gh-87). */
function formatReworkPause(gate: RevertDecision, processed?: number): string {
  const pct = Math.round(gate.rate * 100)
  const thr = Math.round(gate.threshold * 100)
  const tail = processed === undefined ? '' : ` Processed ${processed} task(s).`
  return `\n⏸  Rework guard: ${gate.reworked}/${gate.total} tasks reworked (${pct}%) > ${thr}% over the last ${WINDOW_HOURS}h — new dispatch paused.${tail} Review the Blocked queue, then raise SDLC_REVERT_RATE_THRESHOLD to resume.\n`
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
    // Fail closed: an inbound `dispatch <slug>` can launch the full pipeline, so
    // the subscription must authenticate against a token-protected topic. Refuse
    // to listen on an unauthenticated topic (gh-12).
    const token = requireWebhookToken()
    if (!token.ok) {
      process.stderr.write(`❌ ${token.error.message}\n`)
      if (token.error.fix) process.stderr.write(`   Fix: ${token.error.fix}\n`)
      return 2
    }
    return dispatchWebhookLoop(slug, topic, token.value, maxTasks)
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

  const webhookTopic = (cfg as { webhookTopic?: string }).webhookTopic
  const gate = await budgetGate(new Date(), webhookTopic)
  if (gate.action === 'pause') {
    process.stderr.write(formatBudgetPause(gate))
    return 0
  }
  const pacing = await pacingGate(new Date(), task.tier, webhookTopic, cfg.sdlcWindowTokenBudget)
  if (pacing.action === 'pause') {
    process.stderr.write(formatPacingPause(pacing))
    return 0
  }
  if (pacing.warningSoon) {
    process.stderr.write(formatPacingWarning(pacing))
  }

  const branch = `feature/${task.id}`
  const sandbox = await provisionWorktreeSandbox({
    repoPath: cfg.repoPath,
    taskId: task.id,
    branch,
    baseRef: 'main',
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
      // Manual path: the human who launched it is the gate, and it stops before
      // merge (no maybeCreatePr here) — skip the trustState HITL gate (#62). The
      // board path enforces it. CAUTION: this opt-out is only safe while the
      // manual path never auto-pushes/merges; if it ever gains PR/push, the trust
      // gate would be silently bypassed for autonomous use — re-gate it then.
      enforceTrustGate: false,
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

  const webhookTopic = (cfg as { webhookTopic?: string }).webhookTopic
  let processed = 0
  let sawFailure = false
  while (processed < maxTasks) {
    const gate = await budgetGate(new Date(), webhookTopic)
    if (gate.action === 'pause') {
      process.stdout.write(formatBudgetPause(gate, processed))
      return sawFailure ? 1 : 0
    }
    // Rework/revert-rate trip (gh-87): halt the fleet for human review once recent
    // rework exceeds the threshold — quality brake, independent of the next task.
    const rework = await reworkRateGate(new Date(), webhookTopic)
    if (rework.action === 'pause') {
      process.stdout.write(formatReworkPause(rework, processed))
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
      return sawFailure ? 1 : 0
    }

    // Convert ProjectItem → Task (heuristic; PLANNER would do this more thoroughly)
    const task = projectItemToTask(slug, next)

    // Usage-window pacing (gh-87): would STARTING this task overrun the time-aware
    // 5h-window cap? Pause before starting → never rate-limited mid-task. The card
    // stays in Ready for the next window.
    const pacing = await pacingGate(new Date(), task.tier, webhookTopic, cfg.sdlcWindowTokenBudget)
    if (pacing.action === 'pause') {
      process.stdout.write(formatPacingPause(pacing, processed))
      return 0
    }
    if (pacing.warningSoon) {
      process.stderr.write(formatPacingWarning(pacing))
    }

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
      baseRef: 'main',
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
        // Autonomous board path: enforce the trustState×tier HITL gate (#62) —
        // no human is watching, so the trust ladder decides COMMIT vs. pause.
        enforceTrustGate: true,
      })

      if (!result.ok) {
        process.stderr.write(`  ❌ ${result.error.message}\n`)
        await moveItem(project.value, next.id, 'Blocked')
        return 1
      }

      const outcome = result.value
      printOutcome(outcome)

      if (outcome.result === 'merged') {
        if (outcome.commitSha && outcome.branch) {
          // PR-creation step (the orchestrator hands off here per its design note).
          // Pushes from the sandbox worktree, where BUILDER committed. Card moves
          // to Done only after the PR is actually open; failure → Blocked so the
          // board never lies about state (Bug 2 fix).
          const prOk = await maybeCreatePr({
            repoPath: sandbox.value.workspacePath,
            slug,
            task,
            issueNumber: next.content.number,
            branch: outcome.branch,
            commitSha: outcome.commitSha,
            auditRunIds: outcome.auditRunIds,
            costUsd: outcome.costUsd,
            retriesUsed: outcome.retriesUsed,
            ...(cfg.validationCommands ? { validationCommands: cfg.validationCommands } : {}),
            baseRepoPath: cfg.repoPath,
            ...(webhookTopic ? { webhookTopic } : {}),
          })
          if (prOk) {
            await moveItem(project.value, next.id, 'Done')
          } else {
            await moveItem(project.value, next.id, 'Blocked')
            sawFailure = true
          }
        } else {
          // No-op task (no commit): card → Done without a PR.
          await moveItem(project.value, next.id, 'Done')
        }
      } else {
        // failed or hitl-pending: card → Blocked; track for non-zero exit so
        // CI / overnight monitoring can detect partial runs (Bug 1 fix).
        await moveItem(project.value, next.id, 'Blocked')
        sawFailure = true
        process.stdout.write(`  (${task.id} blocked — continuing to next Ready item)\n`)
      }

      processed++
    } finally {
      // Tear down the worktree. The branch ref + committed work persist in the
      // shared object store; audit + HITL records persist via the symlinks.
      const cleaned = await sandbox.value.cleanup()
      if (!cleaned.ok) process.stderr.write(`     ⚠️  ${cleaned.error.message}\n`)
    }
  }

  process.stdout.write(`\nReached --max-tasks (${maxTasks}). Stopping.\n`)
  return sawFailure ? 1 : 0
}

// ─── webhook: subscribe to ntfy.sh ───────────────────────────────────────

async function dispatchWebhookLoop(
  slug: ProjectSlug,
  topic: string,
  token: string,
  maxTasks: number,
): Promise<number> {
  process.stdout.write(
    `\n🔔 Subscribed to protected ntfy topic ${topic}\n   Publish "dispatch ${slug}" (authenticated) to trigger.\n   Ctrl-C to stop.\n\n`,
  )

  let dispatched = 0
  for await (const msg of subscribe({ topic, token })) {
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
  readonly validationCommands?: ValidationCommands
  /** Per-project window token budget override (sdlc_window_token_budget in config.json). */
  readonly sdlcWindowTokenBudget?: number
}

async function readConfig(slug: ProjectSlug): Promise<MinimalConfig | null> {
  const cfgPath = join(projectDir(slug), 'config.json')
  if (!existsSync(cfgPath)) return null
  const raw = await readFile(cfgPath, 'utf8')
  const cfg = JSON.parse(raw) as {
    repoPath?: string
    owner?: string
    validationCommands?: ValidationCommands
    sdlc_window_token_budget?: number
  }
  if (!cfg.repoPath || !cfg.owner) return null
  return {
    repoPath: cfg.repoPath,
    owner: cfg.owner,
    ...(cfg.validationCommands ? { validationCommands: cfg.validationCommands } : {}),
    ...(typeof cfg.sdlc_window_token_budget === 'number' && cfg.sdlc_window_token_budget > 0
      ? { sdlcWindowTokenBudget: cfg.sdlc_window_token_budget }
      : {}),
  }
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
 * Push the feature branch and open a PR. Returns true on success, false on
 * push or PR-creation failure (the branch + commit are still local; the caller
 * moves the card to Blocked so the board reflects the real state).
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
  readonly auditRunIds: readonly string[]
  readonly costUsd: number
  readonly retriesUsed: number
  readonly validationCommands?: ValidationCommands
  readonly baseRepoPath?: string
  readonly webhookTopic?: string
}): Promise<boolean> {
  // Pre-PR gate (#112): re-run the project's own checks in the worktree before
  // pushing. This is a hard block regardless of tier or trust — a PR with red CI
  // defeats the purpose of autonomous dispatch. Projects without validationCommands
  // configured skip this gate (no commands → no assertions).
  let gateDetails: readonly ValidationDetail[] = []
  if (args.validationCommands) {
    process.stdout.write('  ▸ Pre-PR validation (typecheck/lint/test)...\n')
    const { validations, details } = await runValidations(
      args.repoPath,
      asWorktreeCommands(args.validationCommands, args.repoPath),
    )
    gateDetails = details
    if (hasDeterministicFailure(validations)) {
      const failing = Object.entries(validations)
        .filter(([, v]) => v === 'fail')
        .map(([k]) => k)
        .join(', ')
      process.stderr.write(
        `  ❌ Pre-PR gate: ${failing} failed in worktree — not pushing. Fix the failures and redispatch.\n`,
      )
      return false
    }
    process.stdout.write('  ✓ Pre-PR validations green\n')
  }

  // Lockfile drift guard (#15): if this commit touched package.json or
  // pnpm-lock.yaml, verify they're still in sync before pushing. Catches the
  // `--theirs` failure mode where package.json gets reverted to an older specifier
  // but pnpm-lock.yaml keeps the newer one, breaking `pnpm install --frozen-lockfile`.
  const driftChangedFiles = await runShell(
    'git',
    ['diff', 'origin/main..HEAD', '--name-only'],
    args.repoPath,
  )
  const touchedPackageFiles =
    driftChangedFiles.code === 0 &&
    driftChangedFiles.stdout
      .split('\n')
      .some((f) => /^(package\.json|pnpm-lock\.yaml)$/.test(f.trim()))
  if (touchedPackageFiles) {
    process.stdout.write('  ▸ Lockfile drift check (package.json touched)...\n')
    const driftResult = await detectLockfileDrift(args.repoPath)
    if (!driftResult.ok) {
      process.stderr.write(
        `  ⚠️  Lockfile drift check could not run: ${driftResult.error.message}\n`,
      )
    } else if (driftResult.value.drifted) {
      process.stderr.write(
        '  ❌ Lockfile drift: package.json and pnpm-lock.yaml are out of sync.\n' +
          '     package.json may have been reverted via --theirs. Not pushing.\n',
      )
      if (driftResult.value.reason) {
        process.stderr.write(
          `     ${driftResult.value.reason.split('\n').slice(0, 3).join('\n     ')}\n`,
        )
      }
      return false
    } else {
      process.stdout.write('  ✓ Lockfile consistent\n')
    }
  }

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
    return false
  }

  const templatePath = join(args.repoPath, '.github', 'pull_request_template.md')
  const templateContent = existsSync(templatePath) ? await readFile(templatePath, 'utf8') : null
  const body = buildPrBody({
    task: args.task,
    issueNumber: args.issueNumber,
    branch: args.branch,
    commitSha: args.commitSha,
    auditRunIds: args.auditRunIds,
    costUsd: args.costUsd,
    retriesUsed: args.retriesUsed,
    gateDetails,
    templateContent,
  })

  process.stdout.write(`  ▸ Opening PR for #${args.issueNumber}...\n`)
  const prResult = await runShell(
    'gh',
    [
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      args.branch,
      '--title',
      args.task.title,
      '--body',
      body,
    ],
    args.repoPath,
  )
  if (prResult.code !== 0) {
    process.stderr.write(`  ⚠️  PR create failed (exit ${prResult.code}).\n`)
    if (prResult.stderr)
      process.stderr.write(
        `     ${prResult.stderr.trim().split('\n').slice(0, 3).join('\n     ')}\n`,
      )
    return false
  }
  process.stdout.write(`  ✓ PR opened: ${prResult.stdout.trim()}\n`)

  // Apply tier label, assignee, and type labels via gh api (best-effort; non-fatal).
  // Parse owner/repo/number from the PR URL using URL parser — robust against query strings
  // and path-prefix variations (split('/')[N] is position-sensitive and breaks on GHE paths).
  let prOwner: string | undefined
  let prRepo: string | undefined
  let prNumber: string | undefined
  try {
    const parsed = new URL(prResult.stdout.trim())
    const parts = parsed.pathname.split('/').filter(Boolean)
    // pathname for https://github.com/owner/repo/pull/N → ['owner','repo','pull','N']
    if (parts.length >= 4 && parts[2] === 'pull') {
      prOwner = parts[0]
      prRepo = parts[1]
      prNumber = parts[3]
    }
  } catch {
    // non-URL gh output — skip decoration silently
  }

  if (prOwner && prRepo && prNumber) {
    // Spawn detached CI monitor — non-blocking (issue #180). Dispatch returns
    // immediately; the background process polls check-runs, auto-fixes biome
    // violations, and opens GitHub issues for other failures.
    if (args.baseRepoPath && process.argv[1]) {
      const monitorArgv = [
        '--owner',
        prOwner,
        '--repo',
        prRepo,
        '--sha',
        args.commitSha,
        '--pr-number',
        prNumber,
        '--slug',
        String(args.slug),
        '--pr-url',
        prResult.stdout.trim(),
        '--base-repo-path',
        args.baseRepoPath,
        '--branch',
        args.branch,
        '--tier',
        String(args.task.tier),
        ...(args.webhookTopic ? ['--webhook-topic', args.webhookTopic] : []),
      ]
      const monitor = spawn(
        process.execPath,
        [...process.execArgv, process.argv[1], 'ci-monitor', ...monitorArgv],
        { detached: true, stdio: 'ignore' },
      )
      monitor.unref()
    }

    const issueRef = `repos/${prOwner}/${prRepo}/issues/${prNumber}`

    const tierLabelRes = await runShell(
      'gh',
      ['api', '--method', 'POST', `${issueRef}/labels`, '-f', `labels[]=tier:${args.task.tier}`],
      args.repoPath,
    )
    if (tierLabelRes.code !== 0) {
      process.stderr.write(
        `  ⚠️  tier:${args.task.tier} label failed: ${tierLabelRes.stderr.trim()}\n`,
      )
    }

    // Assignee = the project owner from ProjectConfig (AC2), NOT the owner segment
    // of the PR URL (which can differ when the repo lives under an org). maybeCreatePr
    // can't take a new arg (AC6: signature frozen), so re-read config from disk here.
    const cfg = await readConfig(args.slug)
    if (cfg) {
      const assigneeRes = await runShell(
        'gh',
        ['api', '--method', 'POST', `${issueRef}/assignees`, '-f', `assignees[]=${cfg.owner}`],
        args.repoPath,
      )
      if (assigneeRes.code !== 0) {
        process.stderr.write(`  ⚠️  Assignee set failed: ${assigneeRes.stderr.trim()}\n`)
      }
    }

    // Only keywords that correspond to seeded CANONICAL_LABELS — omit 'bug'/'enhancement'
    // which are not seeded by `sdlc onboard` and would 422 on every onboarded repo.
    const TYPE_KEYWORDS = ['security', 'adhoc', 'dogfood']
    const searchText = `${args.task.title} ${args.task.description}`
    const typeLabels = TYPE_KEYWORDS.filter((kw) => new RegExp(`\\[${kw}\\]`, 'i').test(searchText))
    for (const label of typeLabels) {
      const typeLabelRes = await runShell(
        'gh',
        ['api', '--method', 'POST', `${issueRef}/labels`, '-f', `labels[]=${label}`],
        args.repoPath,
      )
      if (typeLabelRes.code !== 0) {
        process.stderr.write(`  ⚠️  Type label "${label}" failed: ${typeLabelRes.stderr.trim()}\n`)
      }
    }
  } else {
    process.stderr.write(
      `  ⚠️  Could not parse PR URL for label decoration: ${prResult.stdout.trim()}\n`,
    )
  }

  return true
}

// ─── CI-fix re-dispatch (issue #180 B1) ──────────────────────────────────────

/**
 * Provision a worktree on the EXISTING PR branch, run BUILDER to fix CI
 * failures, push the fix to origin, and return the new HEAD SHA.
 *
 * Called in-process by the detached ci-monitor background process.
 * Returns null if any step fails (budget/pacing gate, sandbox error,
 * BUILDER failure, trust-gate pause, push failure).
 */
export async function dispatchCiFixTask(args: {
  readonly slug: ProjectSlug
  readonly branch: string
  readonly prNumber: number
  readonly taskTier: Tier
  readonly failures: ReadonlyArray<{
    readonly name: string
    readonly conclusion: string | null
    readonly summary: string | null
  }>
}): Promise<string | null> {
  const cfg = await readConfig(args.slug)
  if (!cfg) return null

  const gate = await budgetGate(new Date(), undefined)
  if (gate.action === 'pause') return null

  const pacing = await pacingGate(new Date(), args.taskTier, undefined, cfg.sdlcWindowTokenBudget)
  if (pacing.action === 'pause') return null

  const taskId = `ci-fix-${args.prNumber}`
  const failureList = args.failures
    .map((f) => `### ${f.name} (${f.conclusion ?? 'failed'})\n${f.summary ?? '(no output)'}`)
    .join('\n\n')
  const now = new Date().toISOString()

  const task: Task = {
    project: args.slug,
    id: taskId,
    storyId: taskId,
    epicId: taskId,
    title: `[ci-fix] Fix CI failures on PR branch ${args.branch}`,
    description: [
      '## CI Fix Required',
      '',
      `PR #${args.prNumber} has failing CI checks on branch \`${args.branch}\`. Fix the code so all CI checks pass.`,
      '',
      failureList,
      '',
      '## Constraints',
      '- Commit to the EXISTING branch — do not create a new branch',
      '- Fix only what the CI checks require — no unrelated changes',
    ].join('\n'),
    tier: args.taskTier,
    dod: {
      acceptanceCriteria: args.failures.map((f) => `${f.name} CI check passes`),
      nfr: [],
      testsRequired: ['unit'],
      coverageFloor: args.taskTier <= 1 ? 85 : 70,
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

  const sandbox = await provisionWorktreeSandbox({
    repoPath: cfg.repoPath,
    taskId,
    branch: args.branch,
    existingBranch: true,
  })
  if (!sandbox.ok) return null

  let newSha: string | null = null
  try {
    const result = await runTask({
      project: args.slug,
      task,
      targetRepo: sandbox.value.workspacePath,
      branch: args.branch,
      // Autonomous CI-fix path: enforce the trust gate — this is unsupervised push
      // onto an open PR branch. The trust ladder decides COMMIT vs. HITL pause.
      // CAUTION: never set this to false here; see the comment on dispatchManualSpec.
      enforceTrustGate: true,
    })
    if (!result.ok) return null
    if (result.value.result !== 'merged') return null
    // Guard: if BUILDER made no new commit (vacuous success), commitSha is absent.
    // git rev-parse HEAD would return the pre-existing SHA and push would be a no-op,
    // causing ci-monitor to re-poll the unchanged SHA and falsely log a phantom fix.
    if (!result.value.commitSha) return null

    // Capture SHA before cleanup tears down the worktree
    const shaR = await runShell('git', ['rev-parse', 'HEAD'], sandbox.value.workspacePath)
    if (shaR.code !== 0) return null
    const sha = shaR.stdout.trim()

    const push = await runShell('git', ['push', 'origin', args.branch], sandbox.value.workspacePath)
    if (push.code !== 0) return null

    newSha = sha
    return newSha
  } finally {
    await sandbox.value.cleanup()
  }
}

// ─── PR body builder ─────────────────────────────────────────────────────────

function fmtGate(gateDetails: readonly ValidationDetail[]): string {
  return gateDetails.length
    ? gateDetails.map((d) => `${d.check} ${d.result}`).join(' · ')
    : 'no configured checks run'
}

function fmtAudit(auditRunIds: readonly string[]): string {
  return auditRunIds.length ? auditRunIds.join(', ') : 'none'
}

type PrBodyArgs = {
  readonly task: Task
  readonly issueNumber: number
  readonly branch: string
  readonly commitSha: string
  readonly auditRunIds: readonly string[]
  readonly costUsd: number
  readonly retriesUsed: number
  readonly gateDetails: readonly ValidationDetail[]
  readonly templateContent: string | null
}

// Sections the platform can fill keyed by number/code from the template header
// (e.g. "## 4 · Evidence" → key "4", "## 3b · Security" → key "3b").
// Unknown sections are preserved verbatim from the template file — so new
// sections added to the template automatically appear in platform PRs without
// any code change.
type FillFn = (a: PrBodyArgs) => string[]
const PLATFORM_FILLS: Record<string, FillFn> = {
  '1': (a) => [
    a.task.description.length > 280 ? `${a.task.description.slice(0, 277)}...` : a.task.description,
    '',
    `Tier ${a.task.tier} · closes #${a.issueNumber} · ${a.task.id}`,
  ],
  '2': (a) => [a.task.description, '', '**Alternatives rejected** — n/a (platform-generated).'],
  '4': (a) => [
    `- **Gates** — ${fmtGate(a.gateDetails)}.`,
    '- **Acceptance criteria** —',
    ...a.task.dod.acceptanceCriteria.map((ac) => `  - [x] ${ac}`),
    '- **Tests** — per BUILDER/TESTER output; see audit log.',
    `- **CHECKER** — audit run IDs: ${fmtAudit(a.auditRunIds)}.`,
    '- **Manual** — n/a (platform-generated).',
  ],
  '6': (a) => [
    `_ai-sdlc platform-generated._ Audit run IDs: ${fmtAudit(a.auditRunIds)} · branch: \`${a.branch}\` · commit: \`${a.commitSha.slice(0, 8)}\` · retries: ${a.retriesUsed} · cost: $${a.costUsd.toFixed(4)}.`,
  ],
  '7': () => [
    '- [ ] PR-only, squash, no direct main push; agent did not self-approve',
    '- [ ] No open P0/P1; CLAUDE.md unchanged (else flagged — always MANAGER-gated)',
    '- [ ] Docs / continuation updated; affected `CONTEXT.md` bubbled up (or n/a)',
    '- [ ] ADR written if required (G1.5), else "no ADR required"',
    '- [ ] Secret-scan / dep-audit / SAST (or n/a)',
  ],
}

/**
 * Build the PR body for a platform-generated PR.
 *
 * Pass `templateContent` (the raw file content of `.github/pull_request_template.md`)
 * to get a body that mirrors the template's exact section structure. The platform
 * fills sections it can assert (1, 2, 4, 6, 7); all other sections are preserved
 * verbatim from the template — so new sections added to the template appear
 * automatically without any code change. Pass `null` for a minimal fallback body.
 *
 * Exported for unit-testing without touching the filesystem.
 */
export function buildPrBody(args: PrBodyArgs): string {
  if (!args.templateContent) {
    const sha = args.commitSha.slice(0, 8)
    return [
      `Closes #${args.issueNumber}`,
      '',
      '## Summary',
      args.task.description.slice(0, 500),
      '',
      '## Acceptance criteria',
      ...args.task.dod.acceptanceCriteria.map((ac) => `- [x] ${ac}`),
      '',
      `_ai-sdlc · BUILDER · \`${args.branch}\` · commit \`${sha}\` · $${args.costUsd.toFixed(4)}_`,
    ].join('\n')
  }

  // Split template into chunks starting at each ## header. For numbered sections
  // we know how to fill, replace the content; for all others, keep the template's
  // own stub text so the human sees exactly what the template author intended.
  const chunks = args.templateContent.split(/(?=^## )/m)
  return chunks
    .map((chunk) => {
      const header = chunk.match(/^(## [^\n]+)/)?.[1]
      if (!header) return chunk // preamble before first ##
      const num = header.match(/^## (\d+[a-z]?)\b/)?.[1]
      if (!num) return chunk // unnumbered section — preserve
      const filler = PLATFORM_FILLS[num]
      if (!filler) return chunk // human section — keep template stub text
      return [header, '', ...filler(args), '', ''].join('\n')
    })
    .join('')
}

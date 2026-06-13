/**
 * Orchestrator main loop — Tier 1 zone.
 *
 * Owns the cross-stage state for a task as it flows through
 *   BUILD → TEST → REVIEW → (retry or COMMIT) → REPORT
 *
 * For v1:
 *   - Sequential dispatch (one task at a time)
 *   - Single G2 HITL gate on REVIEWER CHANGES_REQUESTED past retry cap
 *   - Plain JSONL audit log (hash chain is bonus but we use it since
 *     it's already shipped)
 *   - No DEMO stage; integration validation is part of TEST + REVIEW
 *
 * Multi-tenant infrastructure (per-project state, namespaced audit) IS
 * in v1 because it's structurally required for "manage 4-5 testbeds";
 * tier-aware retry caps + full HITL gate suite are v1.5+.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { runBuilder } from '../agents/builder/index.js'
import { runChecker } from '../agents/checker/index.js'
import { runReporter } from '../agents/reporter/index.js'
import { runReviewer } from '../agents/reviewer/index.js'
import { runTester } from '../agents/tester/index.js'
import { notify } from '../integrations/ntfy.js'
import { isSubagentTimeoutCause } from '../router/claude-code-subagent.js'
import { estimateCost } from '../router/select-model.js'
import {
  type AppError,
  type AuditDecision,
  type AuditRow,
  type AuditValidations,
  type BuilderOutput,
  type CheckerOutput,
  type Deficiency,
  type DeficiencyOwner,
  type ProjectSlug,
  type Result,
  type ReviewerOutput,
  type Stage,
  type Task,
  type TesterOutput,
  type Tier,
  type TrustState,
  asProjectSlug,
  err,
  isErr,
  makeError,
  ok,
} from '../types/index.js'
import { writeAuditRow } from './audit-log.js'
import { buildG2Request, buildG4Request, enqueue } from './hitl-queue.js'
import { shouldRefire, shouldRetry } from './retry-policy.js'
import { projectDir } from './state.js'
import { readState, updateState } from './state.js'
import { requiresCommitHitl, trustGateReason } from './trust-gate.js'
import { type ValidationCommands, hasDeterministicFailure, runValidations } from './validations.js'

/**
 * Outcome of running ONE task end-to-end through the pipeline.
 */
export interface TaskRunOutcome {
  readonly taskId: string
  readonly result: 'merged' | 'hitl-pending' | 'failed'
  readonly stage: Stage | 'DONE' | 'BLOCKED'
  readonly retriesUsed: number
  readonly auditRunIds: readonly string[]
  readonly costUsd: number
  readonly durationMs: number
  readonly notes?: string
  /**
   * BUILDER's commit SHA on the feature branch (empty when no commit was
   * produced — e.g. AC vacuously satisfied). Surface so dispatch can decide
   * whether to run `gh pr create` post-orchestrator.
   */
  readonly commitSha?: string
  /** Feature branch name BUILDER worked on (e.g. `feature/gh-2`) */
  readonly branch?: string
}

/**
 * Process a single task end-to-end. Returns when the task either merges,
 * hits an HITL gate, or fails after retries.
 *
 * Caller (the CLI dispatch verb) loops this against tasks from the
 * Ready column of the GitHub Project board.
 */
export async function runTask(opts: {
  readonly project: ProjectSlug
  readonly task: Task
  readonly targetRepo: string
  /** The branch BUILDER works on (orchestrator creates feature/<task-id>) */
  readonly branch: string
  /**
   * Enforce the trustState×tier HITL gate at COMMIT (#62). Defaults to `true`
   * (fail-safe). The manual `--task-spec` path passes `false` — the human who
   * launched it is already the gate and the run stops before merge.
   */
  readonly enforceTrustGate?: boolean
}): Promise<Result<TaskRunOutcome, AppError>> {
  const start = performance.now()
  const auditRunIds: string[] = []
  let totalCost = 0
  let retriesUsed = 0
  const tier: Tier = opts.task.tier

  // Verify project is onboarded
  const stateCheck = await readState(opts.project)
  if (!stateCheck.ok) return stateCheck
  if (stateCheck.value === null) {
    return err(
      makeError('orchestrator.not-onboarded', `Project ${opts.project} has no state`, {
        fix: `Run \`pnpm sdlc onboard --slug ${opts.project} ...\` first`,
      }),
    )
  }
  const trustState = stateCheck.value.trustState
  const enforceTrustGate = opts.enforceTrustGate ?? true

  // Mark task as in-flight
  await updateState(opts.project, (s) => ({
    ...s,
    inFlightTaskIds: [...s.inFlightTaskIds, opts.task.id],
  }))

  // Per-project deterministic commands (#38): the BUILDER/TESTER run THESE for
  // their pre-commit self-check, not a hardcoded `pnpm run` under the CLI's
  // runtime. Loaded once; threaded into every BUILD/TEST payload below.
  const validationCommands = await loadValidationCommands(opts.project)

  // ─── Iteration loop ──────────────────────────────────────────────────────
  while (retriesUsed <= 3) {
    const isRetry = retriesUsed > 0

    // 1) BUILD
    const buildResult = await runBuilder(
      {
        project: opts.project,
        taskId: opts.task.id,
        targetRepo: opts.targetRepo,
        payload: {
          taskId: opts.task.id,
          taskDescription: opts.task.description,
          acceptanceCriteria: opts.task.dod.acceptanceCriteria,
          tier,
          branch: opts.branch,
          ...(validationCommands ? { validationCommands } : {}),
          ...(isRetry ? { reviewerFeedback: 'See previous REVIEWER comments' } : {}),
        },
      },
      { isRetry },
    )

    if (!buildResult.ok) {
      return await finalizeFailure(
        opts,
        buildResult.error,
        auditRunIds,
        totalCost,
        start,
        retriesUsed,
      )
    }

    totalCost += buildResult.value.costUsd
    const buildAuditId = await writeStageAudit(opts, 'BUILD', buildResult.value, tier, retriesUsed)
    if (buildAuditId) auditRunIds.push(buildAuditId)

    if (buildResult.value.outcome === 'escalated') {
      // BUILDER hit Red zone or needs ADR — escalate via G2
      return await escalate(
        opts,
        buildResult.value,
        'BUILD escalated',
        auditRunIds,
        totalCost,
        start,
        retriesUsed,
      )
    }

    if (buildResult.value.outcome !== 'success') {
      // BUILDER failed validations after its own retry budget — bump retry counter
      retriesUsed++
      continue
    }

    // 2) TEST
    const buildOutput = buildResult.value.output as {
      commitSha: string
      diffPath: string
      linesAdded: number
      linesRemoved: number
    }

    const testResult = await runTester(
      {
        project: opts.project,
        taskId: opts.task.id,
        targetRepo: opts.targetRepo,
        payload: {
          taskId: opts.task.id,
          commitSha: buildOutput.commitSha,
          acceptanceCriteria: opts.task.dod.acceptanceCriteria,
          coverageFloor: opts.task.dod.coverageFloor,
          ...(validationCommands ? { validationCommands } : {}),
        },
      },
      { tier, isRetry },
    )

    if (!testResult.ok) {
      return await finalizeFailure(
        opts,
        testResult.error,
        auditRunIds,
        totalCost,
        start,
        retriesUsed,
      )
    }

    totalCost += testResult.value.costUsd
    const testAuditId = await writeStageAudit(opts, 'TEST', testResult.value, tier, retriesUsed)
    if (testAuditId) auditRunIds.push(testAuditId)

    if (testResult.value.outcome === 'failure') {
      // Tests can't pass without code changes — back to BUILDER
      retriesUsed++
      continue
    }

    // 3) REVIEW
    const testOutput = testResult.value.output as { testCommitSha: string }

    const reviewResult = await runReviewer({
      project: opts.project,
      taskId: opts.task.id,
      targetRepo: opts.targetRepo,
      payload: {
        taskId: opts.task.id,
        commitShas: [buildOutput.commitSha, testOutput.testCommitSha],
        acceptanceCriteria: opts.task.dod.acceptanceCriteria,
        tier,
      },
    })

    if (!reviewResult.ok) {
      return await finalizeFailure(
        opts,
        reviewResult.error,
        auditRunIds,
        totalCost,
        start,
        retriesUsed,
      )
    }

    totalCost += reviewResult.value.costUsd
    const reviewAuditId = await writeStageAudit(
      opts,
      'REVIEW',
      reviewResult.value,
      tier,
      retriesUsed,
    )
    if (reviewAuditId) auditRunIds.push(reviewAuditId)

    const reviewOutput = reviewResult.value.output as {
      verdict: 'PASS' | 'CHANGES_REQUESTED' | 'FAIL' | 'BLOCK'
      confidence: number
    }

    // 4) Retry policy decision
    const decision = shouldRetry(reviewOutput.verdict, retriesUsed, tier)

    if (decision.action === 'pass') {
      // REVIEW passed the OUTCOME-based loop. Now the QUALITY gate (CHECKER +
      // deterministic re-run) decides COMMIT vs a bounded, selective refire.
      return await runCheckGate({
        project: opts.project,
        task: opts.task,
        targetRepo: opts.targetRepo,
        branch: opts.branch,
        tier,
        trustState,
        enforceTrustGate,
        buildOutput,
        testOutput: testResult.value.output as TesterOutput,
        reviewOutput: reviewResult.value.output as ReviewerOutput,
        auditRunIds,
        totalCost,
        start,
        retriesUsed,
      })
    }

    if (decision.action === 'retry') {
      retriesUsed++
      continue
    }

    // action === 'block' — write G2 HITL request, return hitl-pending
    return await escalateToG2(
      opts,
      reviewOutput,
      decision,
      auditRunIds,
      totalCost,
      start,
      retriesUsed,
    )
  }

  // Defensive — shouldn't reach here since the loop exits via return
  return err(makeError('orchestrator.unreachable', 'Iteration loop exited without verdict', {}))
}

// ─── CHECKER quality gate (Stage 1) ──────────────────────────────────────

/**
 * Mutable context threaded through the CHECK gate. `*Output` + `totalCost`
 * change across refire iterations; the rest is fixed for the task.
 */
interface CheckGateCtx {
  readonly project: ProjectSlug
  readonly task: Task
  readonly targetRepo: string
  readonly branch: string
  readonly tier: Tier
  readonly trustState: TrustState
  readonly enforceTrustGate: boolean
  buildOutput: BuilderOutput
  testOutput: TesterOutput
  reviewOutput: ReviewerOutput
  readonly auditRunIds: string[]
  totalCost: number
  readonly start: number
  readonly retriesUsed: number
}

/**
 * The quality gate, run after REVIEW passes the outcome loop. Bounded loop (H5):
 *   1. deterministic re-verify in Node (H1, [D]) — never trust the producer's word
 *   2. CHECKER semantic audit ([C])
 *   3. shouldRefire → PASS=COMMIT · REFIRE=selective refire of the owning producer ·
 *      ESCALATE / non-convergence = HITL (G2)
 * Each iteration writes a CHECK AuditRow with the deterministic matrix (closes F1)
 * and the {feedback-in, what-changed} decision log.
 */
async function runCheckGate(ctx: CheckGateCtx): Promise<Result<TaskRunOutcome, AppError>> {
  const opts = {
    project: ctx.project,
    task: ctx.task,
    targetRepo: ctx.targetRepo,
    branch: ctx.branch,
  }
  const commands = await loadValidationCommands(ctx.project)
  const refireHistory: AuditDecision[] = []
  let priorDeficiencies: Deficiency[] = []
  let refiresUsed = 0

  for (;;) {
    // (1) deterministic re-verify — H1 [D]
    const { validations, details } = await runValidations(ctx.targetRepo, commands)
    const detFailed = hasDeterministicFailure(validations)

    // (2) CHECKER semantic audit — [C]
    const checkerResult = await runChecker({
      project: ctx.project,
      taskId: ctx.task.id,
      targetRepo: ctx.targetRepo,
      payload: {
        taskId: ctx.task.id,
        tier: ctx.tier,
        acceptanceCriteria: ctx.task.dod.acceptanceCriteria,
        commitShas: [ctx.buildOutput.commitSha, ctx.testOutput.testCommitSha].filter((s) => !!s),
        ...(ctx.buildOutput.diffPath ? { diffPath: ctx.buildOutput.diffPath } : {}),
        validations,
        producerSummary: buildProducerSummary(
          ctx.buildOutput,
          ctx.testOutput,
          ctx.reviewOutput,
          details,
        ),
        ...(priorDeficiencies.length ? { priorDeficiencies } : {}),
      },
    })
    if (!checkerResult.ok) {
      // The gate itself couldn't run — fail loudly, never silently pass.
      return await finalizeFailure(
        opts,
        checkerResult.error,
        ctx.auditRunIds,
        ctx.totalCost,
        ctx.start,
        ctx.retriesUsed,
      )
    }
    ctx.totalCost += checkerResult.value.costUsd
    const checkerOut = checkerResult.value.output as CheckerOutput
    const deficiencies = checkerOut.deficiencies ?? []
    const decision = shouldRefire(checkerOut.verdict, detFailed, refiresUsed)

    // audit this CHECK iteration (F1: validations + decision log)
    const checkAuditId = await writeStageAudit(
      opts,
      'CHECK',
      {
        outcome:
          decision.action === 'pass'
            ? 'success'
            : decision.action === 'escalate'
              ? 'escalated'
              : 'partial',
        tokens: checkerResult.value.tokens,
        durationMs: checkerResult.value.durationMs,
        costUsd: checkerResult.value.costUsd,
        model: checkerResult.value.model,
        transport: checkerResult.value.transport,
        filesRead: checkerResult.value.filesRead,
        notes: `CHECKER ${checkerOut.verdict} (conf ${checkerOut.confidence}) — ${decision.reason}; deterministic: ${summarizeValidations(validations)}`,
      },
      ctx.tier,
      ctx.retriesUsed,
      {
        validations,
        decisions: [
          {
            what: `CHECKER ${checkerOut.verdict} → ${decision.action}`,
            why: decision.reason,
          },
          ...refireHistory,
        ],
      },
    )
    if (checkAuditId) ctx.auditRunIds.push(checkAuditId)

    if (decision.action === 'pass') {
      // Quality gates passed. Trust gate (#62): per trustState × tier, a human
      // may need to approve at COMMIT before we hand off for PR. Enforced on the
      // autonomous path; the manual --task-spec path opts out (human in loop).
      if (ctx.enforceTrustGate && requiresCommitHitl(ctx.trustState, ctx.tier)) {
        return await escalateTrustGate(opts, ctx)
      }
      return await finalizeSuccess(
        opts,
        ctx.buildOutput,
        ctx.auditRunIds,
        ctx.totalCost,
        ctx.start,
        ctx.retriesUsed,
      )
    }

    if (decision.action === 'escalate') {
      return await escalateCheckGate(opts, deficiencies, decision.reason, ctx)
    }

    // action === 'refire'. If the CHECKER didn't pin an owner but a deterministic
    // check failed, default the fix to BUILDER. No actionable owner → escalate.
    const actionable = deficiencies.length
      ? deficiencies
      : detFailed
        ? [syntheticBuildDeficiency(validations)]
        : []
    if (!actionable.length) {
      return await escalateCheckGate(
        opts,
        deficiencies,
        'REFIRE with no actionable deficiency',
        ctx,
      )
    }

    const refire = await refireOwningProducers(ctx, opts, actionable, commands)
    if (!refire.ok) {
      return await finalizeFailure(
        opts,
        refire.error,
        ctx.auditRunIds,
        ctx.totalCost,
        ctx.start,
        ctx.retriesUsed,
      )
    }
    // {feedback-in, what-changed} for the NEXT iteration's audit row (H5)
    refireHistory.unshift({
      what: `refire #${refiresUsed + 1} in: ${actionable.map((d) => `${d.ownerRole}/${d.severity}: ${d.what}`).join(' | ')}`,
      why: `what changed: ${refire.value.whatChanged}`,
    })
    priorDeficiencies = [...actionable]
    refiresUsed++
  }
}

/** Re-dispatch the owning producer(s) with ONLY their deficiencies, in pipeline order. */
async function refireOwningProducers(
  ctx: CheckGateCtx,
  opts: { project: ProjectSlug; task: Task; targetRepo: string; branch: string },
  deficiencies: readonly Deficiency[],
  commands: ValidationCommands | undefined,
): Promise<Result<{ whatChanged: string }, AppError>> {
  const byOwner = new Map<DeficiencyOwner, Deficiency[]>()
  for (const d of deficiencies) {
    const list = byOwner.get(d.ownerRole) ?? []
    list.push(d)
    byOwner.set(d.ownerRole, list)
  }
  const changes: string[] = []
  const order: DeficiencyOwner[] = ['builder', 'tester', 'reviewer']

  for (const role of order) {
    const defs = byOwner.get(role)
    if (!defs?.length) continue

    if (role === 'builder') {
      const r = await runBuilder(
        {
          project: ctx.project,
          taskId: ctx.task.id,
          targetRepo: ctx.targetRepo,
          payload: {
            taskId: ctx.task.id,
            taskDescription: ctx.task.description,
            acceptanceCriteria: ctx.task.dod.acceptanceCriteria,
            tier: ctx.tier,
            branch: ctx.branch,
            ...(commands ? { validationCommands: commands } : {}),
            deficiencies: defs,
          },
        },
        { isRetry: true },
      )
      if (!r.ok) return r
      ctx.totalCost += r.value.costUsd
      const id = await writeStageAudit(opts, 'BUILD', r.value, ctx.tier, ctx.retriesUsed)
      if (id) ctx.auditRunIds.push(id)
      if (r.value.outcome === 'success') {
        ctx.buildOutput = r.value.output as BuilderOutput
        changes.push(`BUILDER → ${ctx.buildOutput.commitSha || '(no commit)'}`)
      } else {
        changes.push(`BUILDER outcome=${r.value.outcome}`)
      }
    } else if (role === 'tester') {
      const r = await runTester(
        {
          project: ctx.project,
          taskId: ctx.task.id,
          targetRepo: ctx.targetRepo,
          payload: {
            taskId: ctx.task.id,
            commitSha: ctx.buildOutput.commitSha,
            acceptanceCriteria: ctx.task.dod.acceptanceCriteria,
            coverageFloor: ctx.task.dod.coverageFloor,
            ...(commands ? { validationCommands: commands } : {}),
            deficiencies: defs,
          },
        },
        { tier: ctx.tier, isRetry: true },
      )
      if (!r.ok) return r
      ctx.totalCost += r.value.costUsd
      const id = await writeStageAudit(opts, 'TEST', r.value, ctx.tier, ctx.retriesUsed)
      if (id) ctx.auditRunIds.push(id)
      if (r.value.outcome === 'success' || r.value.outcome === 'partial') {
        ctx.testOutput = r.value.output as TesterOutput
        changes.push(`TESTER → ${ctx.testOutput.testCommitSha || '(no commit)'}`)
      } else {
        changes.push(`TESTER outcome=${r.value.outcome}`)
      }
    } else {
      const r = await runReviewer({
        project: ctx.project,
        taskId: ctx.task.id,
        targetRepo: ctx.targetRepo,
        payload: {
          taskId: ctx.task.id,
          commitShas: [ctx.buildOutput.commitSha, ctx.testOutput.testCommitSha].filter((s) => !!s),
          acceptanceCriteria: ctx.task.dod.acceptanceCriteria,
          tier: ctx.tier,
          deficiencies: defs,
        },
      })
      if (!r.ok) return r
      ctx.totalCost += r.value.costUsd
      const id = await writeStageAudit(opts, 'REVIEW', r.value, ctx.tier, ctx.retriesUsed)
      if (id) ctx.auditRunIds.push(id)
      ctx.reviewOutput = r.value.output as ReviewerOutput
      changes.push(`REVIEWER → ${ctx.reviewOutput.verdict}`)
    }
  }

  return ok({ whatChanged: changes.join('; ') || 'no producer change reported' })
}

/** G2 escalation from the CHECK gate — carries the deficiency history for the MANAGER. */
async function escalateCheckGate(
  opts: { project: ProjectSlug; task: Task; targetRepo: string },
  deficiencies: readonly Deficiency[],
  reason: string,
  ctx: CheckGateCtx,
): Promise<Result<TaskRunOutcome, AppError>> {
  const defSummary = deficiencies.length
    ? deficiencies
        .map((d) => `[${d.severity} ${d.ownerRole}] ${d.what} (${d.evidenceRef})`)
        .join('\n')
    : '(no deficiencies pinned)'
  const request = buildG2Request({
    project: opts.project,
    taskId: opts.task.id,
    epicId: opts.task.epicId,
    tier: opts.task.tier,
    summary: `${opts.task.title} — CHECKER gate escalation`,
    reason: `${reason}\n\nDeficiencies:\n${defSummary}`,
    diffPath: `.audit/${todayUtc()}/diffs/${opts.task.id}.diff`,
    reviewReportPath: `.audit/${todayUtc()}/review/${opts.task.id}.json`,
    auditRunPath: `.audit/${todayUtc()}/runs`,
    blockingTaskIds: opts.task.blocks,
  })
  const enqueueResult = await enqueue(opts.targetRepo, request)
  if (!enqueueResult.ok) return enqueueResult

  await updateState(opts.project, (s) => ({
    ...s,
    inFlightTaskIds: s.inFlightTaskIds.filter((id) => id !== opts.task.id),
    hitlQueueDepth: s.hitlQueueDepth + 1,
  }))

  return ok({
    taskId: opts.task.id,
    result: 'hitl-pending',
    stage: 'BLOCKED',
    retriesUsed: ctx.retriesUsed,
    auditRunIds: ctx.auditRunIds,
    costUsd: ctx.totalCost,
    durationMs: performance.now() - ctx.start,
    notes: `CHECKER gate escalated: ${reason}`,
  })
}

/**
 * Trust gate (#62): the work passed all quality gates, but trustState × tier
 * requires a human to approve at COMMIT. Route through the same HITL queue as
 * G2, return hitl-pending. Distinct from G2 (a quality-failure escalation) —
 * this fires on clean work that the trust ladder won't auto-commit.
 */
async function escalateTrustGate(
  opts: { project: ProjectSlug; task: Task; targetRepo: string },
  ctx: CheckGateCtx,
): Promise<Result<TaskRunOutcome, AppError>> {
  const reason = trustGateReason(ctx.trustState, ctx.tier)
  const request = buildG4Request({
    project: opts.project,
    taskId: opts.task.id,
    epicId: opts.task.epicId,
    tier: opts.task.tier,
    summary: `${opts.task.title} — COMMIT gate (G4, trust approval)`,
    reason: `${reason}\n\nWork passed BUILD/TEST/REVIEW/CHECK; awaiting human approval to COMMIT.`,
    diffPath: `.audit/${todayUtc()}/diffs/${opts.task.id}.diff`,
    reviewReportPath: `.audit/${todayUtc()}/review/${opts.task.id}.json`,
    auditRunPath: `.audit/${todayUtc()}/runs`,
    blockingTaskIds: opts.task.blocks,
  })
  const enqueueResult = await enqueue(opts.targetRepo, request)
  if (!enqueueResult.ok) return enqueueResult

  await updateState(opts.project, (s) => ({
    ...s,
    inFlightTaskIds: s.inFlightTaskIds.filter((id) => id !== opts.task.id),
    hitlQueueDepth: s.hitlQueueDepth + 1,
  }))

  return ok({
    taskId: opts.task.id,
    result: 'hitl-pending',
    // 'BLOCKED' for consistency with the other two hitl-pending paths
    // (escalateCheckGate / escalateToG2); the gate identity lives on the G4 record.
    stage: 'BLOCKED',
    retriesUsed: ctx.retriesUsed,
    auditRunIds: ctx.auditRunIds,
    costUsd: ctx.totalCost,
    durationMs: performance.now() - ctx.start,
    notes: reason,
  })
}

/** Load the per-project deterministic commands the gate re-runs (H1). */
async function loadValidationCommands(
  project: ProjectSlug,
): Promise<ValidationCommands | undefined> {
  try {
    const cfgPath = join(projectDir(project), 'config.json')
    if (!existsSync(cfgPath)) return undefined
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as {
      validationCommands?: ValidationCommands
    }
    return cfg.validationCommands
  } catch {
    return undefined
  }
}

function buildProducerSummary(
  build: BuilderOutput,
  test: TesterOutput,
  review: ReviewerOutput,
  details: readonly { check: string; result: string }[],
): string {
  const det = details.length
    ? details.map((d) => `${d.check}=${d.result}`).join(', ')
    : '(no deterministic commands configured)'
  return [
    `BUILDER: commit ${build.commitSha || '(none)'}, +${build.linesAdded}/-${build.linesRemoved}`,
    `TESTER: testCommit ${test.testCommitSha || '(none)'}, coverage ${test.coveragePercent}%, +${test.testsAdded} tests, passing=${test.testsPassing}`,
    `REVIEWER: ${review.verdict} (conf ${review.confidence}), ${review.findings.length} finding(s)`,
    `DETERMINISTIC (orchestrator re-run): ${det}`,
  ].join('\n')
}

function summarizeValidations(v: AuditValidations): string {
  const entries = Object.entries(v)
  return entries.length ? entries.map(([k, val]) => `${k}=${val}`).join(', ') : 'none configured'
}

function syntheticBuildDeficiency(v: AuditValidations): Deficiency {
  return {
    ownerRole: 'builder',
    severity: 'P1',
    what: `Deterministic re-run failed: ${summarizeValidations(v)}`,
    whyItMatters: 'A producer reported success but the orchestrator re-run disagrees (H1).',
    evidenceRef: 'orchestrator deterministic re-run',
    suggestedFix: 'Fix the failing check(s) so typecheck/lint/test pass.',
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

type StageName = 'BUILD' | 'TEST' | 'REVIEW' | 'CHECK' | 'COMMIT' | 'REPORT'

async function writeStageAudit(
  opts: { project: ProjectSlug; task: Task; targetRepo: string },
  stage: StageName,
  result: {
    outcome: 'success' | 'failure' | 'partial' | 'escalated'
    tokens: { input: number; output: number; cacheRead?: number }
    durationMs: number
    costUsd: number
    model: string
    transport: 'claude-code-subagent' | 'anthropic-api' | 'openai-api' | 'codex-cli'
    filesRead: readonly string[]
    notes?: string
  },
  tier: Tier,
  retriesUsed: number,
  // F1: the CHECK gate populates the deterministic matrix + the refire decision
  // log; other stages leave them empty (their producer doesn't gate itself).
  extra?: { validations?: AuditValidations; decisions?: readonly AuditDecision[] },
): Promise<string | null> {
  const agent: AuditRow['agent'] =
    stage === 'BUILD'
      ? 'builder'
      : stage === 'TEST'
        ? 'tester'
        : stage === 'REVIEW'
          ? 'reviewer'
          : stage === 'CHECK'
            ? 'checker'
            : stage === 'COMMIT'
              ? 'commit'
              : 'reporter'

  const row = await writeAuditRow(opts.targetRepo, {
    ts: new Date().toISOString(),
    project: opts.project,
    agent,
    model: result.model,
    modelTransport: result.transport,
    taskId: opts.task.id,
    stage,
    tier,
    durationMs: result.durationMs,
    tokens: {
      promptInput: result.tokens.input,
      promptOutput: result.tokens.output,
      ...(result.tokens.cacheRead ? { cacheRead: result.tokens.cacheRead } : {}),
    },
    costUsd: result.costUsd,
    inputFiles: result.filesRead,
    decisions: extra?.decisions ?? [],
    validations: extra?.validations ?? {},
    outcome: result.outcome,
    nextStage: nextStageAfter(stage, result.outcome, retriesUsed),
    ...(result.notes ? { notes: result.notes } : {}),
  })

  return row.ok ? row.value.rowHash.slice(0, 12) : null
}

function nextStageAfter(
  stage: StageName,
  outcome: string,
  retriesUsed: number,
): Stage | 'DONE' | 'BLOCKED' {
  // 'partial' falls through to the success path on purpose. TESTER marks
  // partial when some ACs can only be human-verified (word counts, "no
  // other files changed", etc.) — REVIEWER then validates them by
  // inspection. This was an intentional design choice surfaced by the
  // smoke test on gh-2; do not change to BLOCKED.
  if (outcome === 'escalated' || outcome === 'failure') return 'BLOCKED'
  switch (stage) {
    case 'BUILD':
      return 'TEST'
    case 'TEST':
      return 'REVIEW'
    case 'REVIEW':
      return retriesUsed >= 3 ? 'BLOCKED' : 'CHECK'
    case 'CHECK':
      return 'COMMIT'
    case 'COMMIT':
      return 'REPORT'
    case 'REPORT':
      return 'DONE'
    default:
      return 'DONE'
  }
}

async function finalizeSuccess(
  opts: { project: ProjectSlug; task: Task; targetRepo: string; branch?: string },
  buildOutput: { commitSha: string },
  auditRunIds: string[],
  totalCost: number,
  startTime: number,
  retriesUsed: number,
): Promise<Result<TaskRunOutcome, AppError>> {
  // For v1 we don't run COMMIT/REPORTER inline yet — that's wired into
  // the CLI dispatch verb in Step 5. Orchestrator returns "merged" once
  // REVIEW passes; CLI takes over for the actual gh pr create / merge.

  await updateState(opts.project, (s) => ({
    ...s,
    inFlightTaskIds: s.inFlightTaskIds.filter((id) => id !== opts.task.id),
  }))

  const sha = buildOutput.commitSha?.trim() ?? ''
  const notes = sha
    ? `Build commit: ${sha}; PR creation handed off to CLI dispatch verb`
    : 'No commit produced — BUILDER reported no changes required (AC may be vacuously satisfied). Verify in audit log.'

  return ok({
    taskId: opts.task.id,
    result: 'merged',
    stage: 'COMMIT',
    retriesUsed,
    auditRunIds,
    costUsd: totalCost,
    durationMs: performance.now() - startTime,
    notes,
    ...(sha ? { commitSha: sha } : {}),
    branch: opts.branch ?? `feature/${opts.task.id}`,
  })
}

async function escalateToG2(
  opts: { project: ProjectSlug; task: Task; targetRepo: string },
  reviewOutput: { verdict: string; confidence: number },
  decision: { reason: string },
  auditRunIds: string[],
  totalCost: number,
  startTime: number,
  retriesUsed: number,
): Promise<Result<TaskRunOutcome, AppError>> {
  const request = buildG2Request({
    project: opts.project,
    taskId: opts.task.id,
    epicId: opts.task.epicId,
    tier: opts.task.tier,
    summary: `${opts.task.title} — REVIEW verdict ${reviewOutput.verdict} after ${retriesUsed} retries`,
    reason: decision.reason,
    diffPath: `.audit/${todayUtc()}/diffs/${opts.task.id}.diff`,
    reviewReportPath: `.audit/${todayUtc()}/review/${opts.task.id}.json`,
    auditRunPath: `.audit/${todayUtc()}/runs`,
    blockingTaskIds: opts.task.blocks,
  })

  const enqueueResult = await enqueue(opts.targetRepo, request)
  if (!enqueueResult.ok) return enqueueResult

  await updateState(opts.project, (s) => ({
    ...s,
    inFlightTaskIds: s.inFlightTaskIds.filter((id) => id !== opts.task.id),
    hitlQueueDepth: s.hitlQueueDepth + 1,
  }))

  // Fire ntfy notification if a topic is configured (best-effort; non-blocking)
  await maybeNotifyG2(opts.project, opts.task, request.id, reviewOutput.verdict)

  return ok({
    taskId: opts.task.id,
    result: 'hitl-pending',
    stage: 'BLOCKED',
    retriesUsed,
    auditRunIds,
    costUsd: totalCost,
    durationMs: performance.now() - startTime,
    notes: `G2 gate enqueued: ${request.id}`,
  })
}

/**
 * Send a ntfy notification when a G2 gate fires, IF the project config has
 * a `webhookTopic` set. Best-effort: any failure (no config, no network,
 * non-2xx) is swallowed and logged to stderr.
 */
async function maybeNotifyG2(
  project: ProjectSlug,
  task: { readonly id: string; readonly title: string; readonly tier: Tier },
  gateId: string,
  verdict: string,
): Promise<void> {
  try {
    const cfgPath = join(projectDir(project), 'config.json')
    if (!existsSync(cfgPath)) return
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as { webhookTopic?: string }
    if (!cfg.webhookTopic) return

    await notify(
      { topic: cfg.webhookTopic },
      {
        title: `ai-sdlc · G2 ${verdict} on ${project}`,
        message: `${task.id} — ${task.title} (tier:${task.tier})\nGate: ${gateId}\nOpen the dashboard to approve / request changes / reject.`,
        priority: task.tier <= 1 ? 5 : 3,
        clickUrl: `http://localhost:3001/queue/${gateId}`,
        tags: ['robot', 'mag'],
      },
    )
  } catch (cause) {
    process.stderr.write(
      `(ntfy notify failed; non-blocking): ${cause instanceof Error ? cause.message : String(cause)}\n`,
    )
  }
}

async function escalate(
  opts: { project: ProjectSlug; task: Task; targetRepo: string },
  result: { outcome: string; notes?: string },
  reason: string,
  auditRunIds: string[],
  totalCost: number,
  startTime: number,
  retriesUsed: number,
): Promise<Result<TaskRunOutcome, AppError>> {
  // Same path as G2 escalation but with a different reason string.
  const request = buildG2Request({
    project: opts.project,
    taskId: opts.task.id,
    epicId: opts.task.epicId,
    tier: opts.task.tier,
    summary: `${opts.task.title} — agent escalated`,
    reason: result.notes ?? reason,
    diffPath: `.audit/${todayUtc()}/diffs/${opts.task.id}.diff`,
    reviewReportPath: `.audit/${todayUtc()}/review/${opts.task.id}.json`,
    auditRunPath: `.audit/${todayUtc()}/runs`,
    blockingTaskIds: opts.task.blocks,
  })

  const enqueueResult = await enqueue(opts.targetRepo, request)
  if (!enqueueResult.ok) return enqueueResult

  await updateState(opts.project, (s) => ({
    ...s,
    inFlightTaskIds: s.inFlightTaskIds.filter((id) => id !== opts.task.id),
    hitlQueueDepth: s.hitlQueueDepth + 1,
  }))

  return ok({
    taskId: opts.task.id,
    result: 'hitl-pending',
    stage: 'BLOCKED',
    retriesUsed,
    auditRunIds,
    costUsd: totalCost,
    durationMs: performance.now() - startTime,
    notes: `Escalated: ${reason}`,
  })
}

async function finalizeFailure(
  opts: { project: ProjectSlug; task: Task; targetRepo: string },
  error: AppError,
  auditRunIds: string[],
  totalCost: number,
  startTime: number,
  retriesUsed: number,
): Promise<Result<TaskRunOutcome, AppError>> {
  await updateState(opts.project, (s) => ({
    ...s,
    inFlightTaskIds: s.inFlightTaskIds.filter((id) => id !== opts.task.id),
  }))

  // #45: a subagent killed on idle/ceiling spent real tokens before SIGTERM, but
  // its final cost envelope never arrived. The transport recovers that spend from
  // the partial stream — bill it here so a timed-out run isn't logged as $0.
  const timeoutCause = isSubagentTimeoutCause(error.cause) ? error.cause : null
  const costUsd = totalCost + (timeoutCause ? timeoutCause.recoveredCostUsd : 0)

  // #107: a subagent killed on idle/ceiling leaves uncommitted edits in its
  // isolated worktree; teardown discards them. Best-effort rescue commit so
  // partial work lands on the feature branch and is recoverable. Never throws.
  if (timeoutCause) {
    await rescueCommit(opts.targetRepo, opts.task.id)
  }

  // Return as a successful TaskRunOutcome with result='failed' — caller
  // still wants the metadata for audit + reporting; the underlying error
  // is captured in `notes`.
  return ok({
    taskId: opts.task.id,
    result: 'failed',
    stage: 'BLOCKED',
    retriesUsed,
    auditRunIds,
    costUsd,
    durationMs: performance.now() - startTime,
    notes: `Agent error: ${error.code} — ${error.message}${
      timeoutCause ? '; rescue commit attempted in worktree' : ''
    }`,
  })
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Best-effort rescue commit on subagent timeout (#107).
 *
 * When BUILDER/TESTER is SIGTERM'd on idle/ceiling, the isolated worktree may
 * hold uncommitted partial work that vanishes on teardown. We try to land it
 * on the feature branch under a `wip:` marker so the next run (or a human)
 * can recover. Hooks are bypassed with `--no-verify` because partial state is
 * the whole reason we're here. Any failure is swallowed and logged — this
 * MUST NOT mask the original timeout error or change orchestrator control flow.
 *
 * Stays on `node:child_process` (no new userland deps for an orchestrator-tier file).
 */
export async function rescueCommit(targetRepo: string, taskId: string): Promise<void> {
  try {
    const status = spawnSync('git', ['-C', targetRepo, 'status', '--porcelain'], {
      encoding: 'utf8',
    })
    if (status.status !== 0) {
      process.stderr.write(
        `(rescue commit: git status failed in ${targetRepo}, skipping): ${status.stderr ?? ''}\n`,
      )
      return
    }
    if (!status.stdout.trim()) return

    const add = spawnSync('git', ['-C', targetRepo, 'add', '-A'], { encoding: 'utf8' })
    if (add.status !== 0) {
      process.stderr.write(
        `(rescue commit: git add failed in ${targetRepo}, skipping): ${add.stderr ?? ''}\n`,
      )
      return
    }

    const commit = spawnSync(
      'git',
      [
        '-C',
        targetRepo,
        'commit',
        '--no-verify',
        '-m',
        `wip: partial work rescued from timed-out task ${taskId}`,
      ],
      { encoding: 'utf8' },
    )
    if (commit.status !== 0) {
      process.stderr.write(
        `(rescue commit: git commit failed in ${targetRepo}, skipping): ${commit.stderr ?? ''}\n`,
      )
      return
    }
  } catch (cause) {
    process.stderr.write(
      `(rescue commit failed; non-blocking): ${
        cause instanceof Error ? cause.message : String(cause)
      }\n`,
    )
  }
}

// Re-exports for convenience
export { runReporter, runReviewer, runTester, runBuilder, estimateCost, isErr, asProjectSlug }

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

import { performance } from 'node:perf_hooks'
import { runBuilder } from '../agents/builder/index.js'
import { runReporter } from '../agents/reporter/index.js'
import { runReviewer } from '../agents/reviewer/index.js'
import { runTester } from '../agents/tester/index.js'
import { estimateCost } from '../router/select-model.js'
import {
  type AppError,
  type AuditRow,
  type ProjectSlug,
  type Result,
  type Stage,
  type Task,
  type Tier,
  asProjectSlug,
  err,
  isErr,
  makeError,
  ok,
} from '../types/index.js'
import { writeAuditRow } from './audit-log.js'
import { buildG2Request, enqueue } from './hitl-queue.js'
import { shouldRetry } from './retry-policy.js'
import { readState, updateState } from './state.js'

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

  // Mark task as in-flight
  await updateState(opts.project, (s) => ({
    ...s,
    inFlightTaskIds: [...s.inFlightTaskIds, opts.task.id],
  }))

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
      // REVIEW passed — proceed to COMMIT + REPORT
      return await finalizeSuccess(opts, buildOutput, auditRunIds, totalCost, start, retriesUsed)
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

// ─── helpers ─────────────────────────────────────────────────────────────

async function writeStageAudit(
  opts: { project: ProjectSlug; task: Task; targetRepo: string },
  stage: 'BUILD' | 'TEST' | 'REVIEW' | 'COMMIT' | 'REPORT',
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
): Promise<string | null> {
  const agent: AuditRow['agent'] =
    stage === 'BUILD'
      ? 'builder'
      : stage === 'TEST'
        ? 'tester'
        : stage === 'REVIEW'
          ? 'reviewer'
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
    decisions: [],
    validations: {},
    outcome: result.outcome,
    nextStage: nextStageAfter(stage, result.outcome, retriesUsed),
    ...(result.notes ? { notes: result.notes } : {}),
  })

  return row.ok ? row.value.rowHash.slice(0, 12) : null
}

function nextStageAfter(
  stage: 'BUILD' | 'TEST' | 'REVIEW' | 'COMMIT' | 'REPORT',
  outcome: string,
  retriesUsed: number,
): Stage | 'DONE' | 'BLOCKED' {
  if (outcome === 'escalated' || outcome === 'failure') return 'BLOCKED'
  switch (stage) {
    case 'BUILD':
      return 'TEST'
    case 'TEST':
      return 'REVIEW'
    case 'REVIEW':
      return retriesUsed >= 3 ? 'BLOCKED' : 'COMMIT'
    case 'COMMIT':
      return 'REPORT'
    case 'REPORT':
      return 'DONE'
    default:
      return 'DONE'
  }
}

async function finalizeSuccess(
  opts: { project: ProjectSlug; task: Task; targetRepo: string },
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

  return ok({
    taskId: opts.task.id,
    result: 'merged',
    stage: 'COMMIT',
    retriesUsed,
    auditRunIds,
    costUsd: totalCost,
    durationMs: performance.now() - startTime,
    notes: `Build commit: ${buildOutput.commitSha}; ready for COMMIT stage in CLI`,
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

  // Return as a successful TaskRunOutcome with result='failed' — caller
  // still wants the metadata for audit + reporting; the underlying error
  // is captured in `notes`.
  return ok({
    taskId: opts.task.id,
    result: 'failed',
    stage: 'BLOCKED',
    retriesUsed,
    auditRunIds,
    costUsd: totalCost,
    durationMs: performance.now() - startTime,
    notes: `Agent error: ${error.code} — ${error.message}`,
  })
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

// Re-exports for convenience
export { runReporter, runReviewer, runTester, runBuilder, estimateCost, isErr, asProjectSlug }

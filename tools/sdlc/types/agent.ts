/**
 * Agent interface + dispatch types.
 *
 * Every agent in ai-sdlc implements `Agent<TBrief, TResult>` — takes a
 * structured brief, returns a structured result. Agents are stateless;
 * orchestrator owns state.
 */

import type { AgentRole, ModelId, ModelTransport } from './audit.js'
import type { CheckerOutput, CheckerPayload, Deficiency } from './checker.js'
import type { ProjectSlug } from './project.js'
import type { Result } from './result.js'
import type { Priority } from './task.js'

/**
 * Brief = the input contract for an agent run.
 *
 * Every brief carries enough metadata for the orchestrator to write a
 * complete audit row even if the agent crashes.
 */
export interface AgentBrief<TPayload = unknown> {
  /** Which project this run is for */
  readonly project: ProjectSlug
  /** Task id (or 'orchestrator' for cross-task work like PLANNER) */
  readonly taskId: string
  /** Agent-specific payload — typed per-agent below */
  readonly payload: TPayload
  /** Path to target repo (where the agent will read/write) */
  readonly targetRepo: string
  /** Optional: BLAST_RADIUS_APPROVED token for Red zone work */
  readonly blastRadiusApproved?: string
}

/**
 * Result = the output contract for an agent run.
 */
export interface AgentResult<TOutput = unknown> {
  readonly outcome: 'success' | 'failure' | 'partial' | 'escalated'
  readonly output: TOutput
  /** Files the agent read (for audit) */
  readonly filesRead: readonly string[]
  /** Files the agent wrote (for audit + chain-of-custody) */
  readonly filesWritten: readonly string[]
  /** Notes for the audit log */
  readonly notes?: string
  /** Token usage (best-effort; reported by the model transport) */
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly cacheRead?: number
  }
  /** Wall-time duration */
  readonly durationMs: number
  /** Cost estimate USD */
  readonly costUsd: number
  /** Which model + transport were used */
  readonly model: ModelId
  readonly transport: ModelTransport
}

/**
 * Agent = a function that takes a brief and returns a result.
 *
 * Implementations are stateless modules under `tools/sdlc/agents/<role>/`.
 * Each one exports a `run()` function with this signature.
 */
export type Agent<TPayload = unknown, TOutput = unknown> = (
  brief: AgentBrief<TPayload>,
) => Promise<Result<AgentResult<TOutput>>>

/**
 * Per-agent payload + output types (typed per role at use site).
 * These are the canonical types each agent expects.
 */

export interface PlannerPayload {
  readonly epicId: string
  readonly epicTitle: string
  readonly epicDescription: string
  readonly tierHint?: number
}

export interface PlannerOutput {
  readonly stories: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly description: string
    readonly taskIds: readonly string[]
  }>
  readonly tasks: ReadonlyArray<{
    readonly id: string
    readonly storyId: string
    readonly title: string
    readonly description: string
    readonly tier: number
    readonly estimatedCostUsd: number
    readonly acceptanceCriteria: readonly string[]
    readonly dependsOn: readonly string[]
  }>
  readonly openQuestions: readonly string[]
}

export interface BuilderPayload {
  readonly taskId: string
  readonly taskDescription: string
  readonly acceptanceCriteria: readonly string[]
  readonly tier: number
  /** Branch to work on; orchestrator creates `feature/<task-id>` */
  readonly branch: string
  /** Optional: feedback from previous review iteration */
  readonly reviewerFeedback?: string
  /** Set on a CHECKER refire — the sole new input; address ONLY these (H3/H5). */
  readonly deficiencies?: readonly Deficiency[]
}

export interface BuilderOutput {
  readonly commitSha: string
  readonly diffPath: string // path to .diff file in audit
  readonly linesAdded: number
  readonly linesRemoved: number
}

export interface TesterPayload {
  readonly taskId: string
  readonly commitSha: string
  readonly acceptanceCriteria: readonly string[]
  readonly coverageFloor: number
  /** Set on a CHECKER refire — the sole new input; address ONLY these (H3/H5). */
  readonly deficiencies?: readonly Deficiency[]
}

export interface TesterOutput {
  readonly testCommitSha: string
  readonly coveragePercent: number
  readonly testsAdded: number
  readonly testsPassing: boolean
}

export interface ReviewerPayload {
  readonly taskId: string
  readonly commitShas: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly tier: number
  /** Set on a CHECKER refire — the sole new input; address ONLY these (H3/H5). */
  readonly deficiencies?: readonly Deficiency[]
}

/**
 * A single REVIEWER finding (Slice 2: aligned to the `Deficiency` schema).
 * Severity uses the single shared **P0–P3** rubric (was low|med|high|critical) so
 * the CHECKER and any downstream merge/threshold logic consume REVIEWER findings
 * and CHECKER deficiencies uniformly. `evidenceRef` mirrors `Deficiency.evidenceRef`.
 */
export interface ReviewFinding {
  /** Shared P0–P3 rubric (AGENT-GOVERNANCE.md §6). */
  readonly severity: Priority
  readonly file: string
  readonly line: number
  /** One-line summary (dashboard). */
  readonly summary: string
  /** 2-liner with context. */
  readonly detail: string
  /** Resolvable evidence: `file:line`, `command (exit N)`, or a repro — like a Deficiency. */
  readonly evidenceRef: string
  readonly suggestedFix?: string
  /** Lifecycle across refire iterations. */
  readonly status?: 'open' | 'resolved'
}

export interface ReviewerOutput {
  readonly verdict: 'PASS' | 'CHANGES_REQUESTED' | 'FAIL' | 'BLOCK'
  readonly confidence: number
  readonly findings: readonly ReviewFinding[]
}

export interface ReporterPayload {
  readonly taskId: string
  readonly prUrl: string
  readonly mergeSha: string
}

export interface ReporterOutput {
  readonly summary: string // ≤200 words
  readonly risks: readonly string[]
  readonly followUps: readonly string[]
}

/**
 * Maps agent roles to their payload + output types.
 * Used by the orchestrator to dispatch with correct typing.
 */
export interface AgentTypeMap {
  planner: { payload: PlannerPayload; output: PlannerOutput }
  builder: { payload: BuilderPayload; output: BuilderOutput }
  tester: { payload: TesterPayload; output: TesterOutput }
  reviewer: { payload: ReviewerPayload; output: ReviewerOutput }
  checker: { payload: CheckerPayload; output: CheckerOutput }
  reporter: { payload: ReporterPayload; output: ReporterOutput }
}

/**
 * v1 agent roles — subset of the full AgentRole list.
 * v1.5+ adds the specialized reviewer fleet (security, code-quality, bug-detector, etc.).
 */
export type V1AgentRole = keyof AgentTypeMap

export function isV1AgentRole(role: AgentRole): role is V1AgentRole {
  return ['planner', 'builder', 'tester', 'reviewer', 'checker', 'reporter'].includes(role)
}

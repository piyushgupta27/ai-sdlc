/**
 * Audit log types — see ARCHITECTURE.md §8.
 *
 * Every agent action lands as one AuditRow in `.audit/<date>/runs/*.jsonl`
 * inside the TARGET project's repo. Hash-chained; append-only at storage layer.
 */

import type { ProjectSlug } from './project.js'
import type { Stage, Tier } from './task.js'

/**
 * Models we route to. Strings, not an enum, because Anthropic / OpenAI ship new
 * model IDs frequently and we want forward-compat.
 *
 * Examples:
 *   'claude-sonnet-4-6' | 'claude-opus-4-7' | 'claude-haiku-4-5-20251001'
 */
export type ModelId = string

/**
 * Transport — how the agent call was actually dispatched.
 * Q-AI-2 amendment: only Claude Code Subagent in v1.
 */
export type ModelTransport = 'claude-code-subagent' | 'anthropic-api' | 'openai-api' | 'codex-cli'

/**
 * Agent roles — see ARCHITECTURE.md §4.
 */
export type AgentRole =
  | 'planner'
  | 'builder'
  | 'tester'
  | 'reviewer' // v1 single generalist; v1.5+ adds the specialized roles below
  | 'checker' // L2 meta-checker (Stage 1) — independent handoff quality audit
  | 'security-reviewer'
  | 'code-quality-reviewer'
  | 'bug-detector'
  | 'design-reviewer'
  | 'perf-reviewer'
  | 'i18n-reviewer'
  | 'aggregator'
  | 'demo'
  | 'commit'
  | 'reporter'
  | 'debugger'
  | 'scout'

/**
 * Outcome of an agent run.
 */
export type AuditOutcome = 'success' | 'failure' | 'partial' | 'timeout' | 'blocked' | 'escalated'

/**
 * Validation results for a build step. Each tool either passes or fails.
 */
export interface AuditValidations {
  readonly tsc?: 'pass' | 'fail'
  readonly lint?: 'pass' | 'fail'
  readonly tests?: 'pass' | 'fail'
  readonly secrets?: 'pass' | 'fail'
  readonly security?: 'pass' | 'fail'
  readonly archRules?: 'pass' | 'fail'
  readonly coverage?: 'pass' | 'fail'
  readonly blastRadius?: 'pass' | 'fail'
}

/**
 * Decision recorded by the agent during the run. Optional but encouraged
 * for any non-obvious choice (helps later debugging + cohort analysis).
 */
export interface AuditDecision {
  readonly what: string
  readonly why: string
  readonly alternativesConsidered?: readonly string[]
}

/**
 * One row in the audit log. Append-only; never modify after write.
 *
 * Field order matters for readability when grepping the JSONL file; keep
 * `ts` + `project` + `agent` first so `grep` queries hit them.
 */
export interface AuditRow {
  /** ISO 8601 timestamp; must be monotonic per project */
  readonly ts: string
  /** Project slug; enables cross-project query */
  readonly project: ProjectSlug
  /** Agent that produced this row */
  readonly agent: AgentRole
  /** Model used for this run */
  readonly model: ModelId
  /** Transport (Q-AI-2: claude-code-subagent in v1) */
  readonly modelTransport: ModelTransport
  /** Task ID this row relates to (or 'orchestrator' for orchestrator events) */
  readonly taskId: string
  /** Pipeline stage */
  readonly stage: Stage
  /** Tier of the task being acted on */
  readonly tier: Tier
  /** Wall-time duration in milliseconds */
  readonly durationMs: number
  /** Tokens consumed */
  readonly tokens: {
    readonly promptInput: number
    readonly promptOutput: number
    readonly cacheRead?: number
    readonly cacheWrite?: number
  }
  /** Cost in USD; per-call best-effort estimate */
  readonly costUsd: number
  /** Files read during this run (relative to target repo) */
  readonly inputFiles: readonly string[]
  /** Path to the diff this row produced, if any */
  readonly outputDiffPath?: string
  /** Decisions the agent made */
  readonly decisions: readonly AuditDecision[]
  /** Validations run before / during / after this step */
  readonly validations: AuditValidations
  /** Outcome */
  readonly outcome: AuditOutcome
  /** Next stage (or 'DONE' if final, 'BLOCKED' if escalated) */
  readonly nextStage: Stage | 'DONE' | 'BLOCKED'
  /** Hash chain: sha256 of the previous row in the same project's audit log */
  readonly prevRowHash: string
  /** Hash chain: sha256 of THIS row (computed at write time) */
  readonly rowHash: string
  /** Free-form notes; agent can add anything useful for replay */
  readonly notes?: string
}

/**
 * Genesis row prevRowHash sentinel — used as the previous hash for the
 * very first audit row in a new project's audit log.
 */
export const GENESIS_PREV_HASH = 'genesis' as const

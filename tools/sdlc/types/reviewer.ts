/**
 * Reviewer fleet types — see ARCHITECTURE.md §4.4.
 *
 * Each reviewer agent returns a structured verdict + findings. AGGREGATOR
 * merges verdicts + applies the AI filter layer (§5.1) before HITL ping.
 */

import type { AgentRole } from './audit.js'
import type { Priority } from './task.js'

/**
 * Per-reviewer verdict.
 */
export type ReviewerVerdict = 'PASS' | 'CHANGES_REQUESTED' | 'FAIL' | 'BLOCK'

/**
 * A single finding from a reviewer (deferred fleet variant — richer than the v1
 * `ReviewFinding` in `agent.ts`, adding range/references/cohort for AGGREGATOR).
 * Severity uses the single shared **P0–P3** rubric (Slice 2 unified this; the old
 * `Severity = low|med|high|critical` type is retired — see `Priority` in task.ts).
 */
export interface ReviewerFinding {
  /** File path relative to target repo */
  readonly file: string
  /** Line number (1-indexed) */
  readonly line: number
  /** Optional end line (for range findings) */
  readonly endLine?: number
  /** Severity on the shared P0–P3 rubric */
  readonly severity: Priority
  /** One-line summary shown in dashboard */
  readonly summary: string
  /** Longer description with context + suggested fix */
  readonly description: string
  /** Specific suggested fix (code or prose) */
  readonly suggestedFix?: string
  /** CWE / OWASP / other taxonomy references */
  readonly references?: readonly string[]
  /** Cohort-tracking: which reviewer prompt version produced this */
  readonly cohortVersion: string
}

/**
 * Report from a single reviewer agent.
 */
export interface ReviewerReport {
  readonly reviewer: AgentRole
  readonly verdict: ReviewerVerdict
  /** 0.0-1.0 — reviewer's confidence in its verdict */
  readonly confidence: number
  readonly findings: readonly ReviewerFinding[]
  /** Wall-time the reviewer took */
  readonly durationMs: number
  /** Cost in USD for this reviewer's run */
  readonly costUsd: number
}

/**
 * AI filter decision — Haiku-class call that decides whether a finding
 * is real or a false positive. Per ARCHITECTURE.md §5.1.
 */
export interface AIFilterDecision {
  /** Index into the original findings array */
  readonly findingIndex: number
  /** True = real issue (keep); false = drop */
  readonly real: boolean
  /** 0.0-1.0 — filter's confidence */
  readonly confidence: number
  /** One-line reason the filter gave this verdict */
  readonly reason: string
}

/**
 * Aggregated report across the whole reviewer fleet for one task.
 * Produced by AGGREGATOR after all reviewers return + AI filter applied.
 */
export interface AggregatedReport {
  /** Task this aggregate covers */
  readonly taskId: string
  /** Final verdict computed via BLOCK > FAIL > CHANGES_REQUESTED > PASS */
  readonly verdict: ReviewerVerdict
  /** Aggregated confidence (lowest across reviewers, weighted) */
  readonly confidence: number
  /** Per-reviewer reports */
  readonly reports: readonly ReviewerReport[]
  /** Findings kept after AI filter */
  readonly findings: readonly ReviewerFinding[]
  /** Findings dropped by AI filter (logged for replay + cohort analysis) */
  readonly droppedFindings: ReadonlyArray<{
    readonly finding: ReviewerFinding
    readonly decision: AIFilterDecision
  }>
  /** Wall-time of the whole fleet + aggregation */
  readonly durationMs: number
  /** Total cost across reviewers + filter */
  readonly costUsd: number
}

/**
 * Confidence threshold above which a Tier 2 review auto-passes G2.
 * Below threshold → HITL fires. Per HITL.md tier matrix.
 */
export const TIER_2_AUTO_PASS_CONFIDENCE = 0.85 as const

/**
 * Confidence threshold raised during a trust contraction event (per ARCHITECTURE.md §10.2).
 * When raised, Tier 2 auto-pass requires confidence ≥ 0.95.
 */
export const TIER_2_CONTRACTED_CONFIDENCE = 0.95 as const

/**
 * AI filter drop threshold — drop a finding if real=false AND confidence > this.
 * Per ARCHITECTURE.md §5.1.
 */
export const AI_FILTER_DROP_CONFIDENCE = 0.7 as const

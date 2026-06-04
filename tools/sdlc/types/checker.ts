/**
 * CHECKER contracts — the L2 meta-checker (Stage 1).
 *
 * The CHECKER is an independent, read-only quality gate (H-phase, AGENT-GOVERNANCE.md
 * §3 H1–H5). After a producer hands off, it audits whether the *output quality*
 * meets the bar (e.g. did TESTER's matrix cover the sad/edge paths the diff
 * implies?) and either passes it forward or returns pointed deficiencies so the
 * orchestrator can refire the OWNING agent with only those deficiencies.
 *
 * Division of labour (locked design decision): the DETERMINISTIC re-verify
 * (tsc/lint/test/coverage — H1, enforcement [D]) is run by the ORCHESTRATOR in
 * Node, not by this LLM — an agent's word is never the gate for machine-checkable
 * facts. The CHECKER consumes that already-run `validations` matrix as ground
 * truth and performs the SEMANTIC audit ([C]) on top.
 *
 * Versioned per G3 (`CHECKER_CONTRACT_VERSION`); severity uses the single shared
 * P0–P3 rubric (`Priority`, AGENT-GOVERNANCE.md §6).
 */

import type { AuditValidations } from './audit.js'
import type { Priority } from './task.js'

/** Contract version — bump on any breaking change to CheckerOutput (G3). */
export const CHECKER_CONTRACT_VERSION = 'checker/v1' as const

/**
 * Roles a deficiency can be assigned to — the producers in the BUILD→TEST→REVIEW
 * loop that a refire can target. Narrower than `AgentRole` on purpose: a gap that
 * no single producer can own (e.g. ambiguous AC) is an ESCALATE, not a REFIRE.
 * Widen (it's versioned) only when a new refireable producer is added.
 */
export type DeficiencyOwner = 'builder' | 'tester' | 'reviewer'

/**
 * CHECKER verdict on a handoff:
 * - PASS     — quality bar met; proceed to COMMIT.
 * - REFIRE   — actionable deficiencies; orchestrator refires the owning agent(s).
 * - ESCALATE — needs MANAGER judgment (ambiguous AC, conflicting signals, or a
 *              deficiency no single agent can own).
 */
export type CheckerVerdict = 'PASS' | 'REFIRE' | 'ESCALATE'

/**
 * One quality deficiency the CHECKER found in a producer's handoff. Pointed and
 * actionable — the orchestrator routes it back to `ownerRole` as the sole input
 * of a refire. Keep these minimal; nitpick refires hurt throughput.
 */
export interface Deficiency {
  /** Which producer must fix it (drives selective refire). */
  readonly ownerRole: DeficiencyOwner
  /** Severity on the single shared P0–P3 rubric. */
  readonly severity: Priority
  /** The gap, concretely. */
  readonly what: string
  /** Impact if left unaddressed. */
  readonly whyItMatters: string
  /** Resolvable evidence: `file:line`, `command (exit N)`, or an AC id. */
  readonly evidenceRef: string
  /** Optional concrete fix suggestion. */
  readonly suggestedFix?: string
}

/**
 * CHECKER output contract (versioned, G3).
 */
export interface CheckerOutput {
  readonly version: typeof CHECKER_CONTRACT_VERSION
  readonly verdict: CheckerVerdict
  /** 0.0–1.0 confidence in the verdict (O4). */
  readonly confidence: number
  /** Empty on PASS; populated on REFIRE/ESCALATE. */
  readonly deficiencies: readonly Deficiency[]
}

/**
 * What the orchestrator hands the CHECKER. (Populated by the orchestrator wiring
 * in a later PR; defined here so the contract is stable.)
 */
export interface CheckerPayload {
  readonly taskId: string
  readonly tier: number
  readonly acceptanceCriteria: readonly string[]
  /** Commits under audit (BUILDER's + TESTER's). */
  readonly commitShas: readonly string[]
  /** Path to the diff artifact, if written. */
  readonly diffPath?: string
  /**
   * Deterministic matrix ALREADY re-run by the orchestrator (H1, [D]). The
   * CHECKER does NOT re-run these; it treats them as ground truth and never
   * trusts a producer's prose over this matrix.
   */
  readonly validations: AuditValidations
  /** Compact summary of the producer outputs (build/test/review) under audit. */
  readonly producerSummary: string
  /** Deficiencies from earlier refire iterations, so the CHECKER can judge convergence. */
  readonly priorDeficiencies?: readonly Deficiency[]
}

// ─── Shared severity-rubric helpers (used by REVIEWER findings + CHECKER deficiencies) ───

/**
 * P0/P1 are release-blockers — the push gate (AGENT-GOVERNANCE.md §6) requires
 * no open P0/P1 at merge; P2/P3 may ship as filed follow-ups.
 */
export function isBlockingPriority(p: Priority): boolean {
  return p === 'P0' || p === 'P1'
}

/** Numeric rank for ordering, most-severe first (P0 → 0 … P3 → 3). */
export function priorityRank(p: Priority): number {
  const rank: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
  return rank[p]
}

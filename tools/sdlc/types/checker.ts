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

import type { AgentRole, AuditValidations } from './audit.js'
import type { Priority } from './task.js'

/** Contract version — bump on any breaking change to CheckerOutput (G3). */
export const CHECKER_CONTRACT_VERSION = 'checker/v1' as const

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
  /** Which agent must fix it (drives selective refire). */
  readonly ownerRole: AgentRole
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

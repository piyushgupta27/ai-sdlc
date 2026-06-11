/**
 * Trust-ladder → HITL gate at COMMIT (issue #62).
 *
 * `trustState` is the per-project safety ladder. This maps it (× the task's
 * tier) to a single question: must a human approve at COMMIT? Pure + total — no
 * I/O — so the orchestrator's wiring stays a thin call and the ladder is
 * exhaustively testable in isolation.
 *
 * Tier numbers are INVERSE-risk (0 = highest blast radius / Red zone, 4 =
 * cosmetic). A task is gated when `tier <= threshold`; as trust rises the
 * threshold falls, so only the riskiest (lowest-number) tiers stay gated.
 * Thresholds are derived from the `TrustState` doc comments in types/project.ts.
 */

import type { Tier, TrustState } from '../types/index.js'

/** Highest tier that still requires a human gate at COMMIT, per trust state. */
const HITL_COMMIT_THRESHOLD: Record<TrustState, number> = {
  MANUAL: 4, // everything HITL
  SUPERVISED: 3, // Tier 4 auto; Tier ≤3 HITL
  TRUSTED_LOW: 2, // Tier 3-4 auto; Tier ≤2 HITL
  TRUSTED_MID: 1, // Tier 2-4 auto; Tier ≤1 HITL
  STEADY_STATE: 1, // Tier 2-4 auto; Tier 0/1 forever HITL
}

/** Does this trust state require a human gate at COMMIT for a task of this tier? */
export function requiresCommitHitl(trustState: TrustState, tier: Tier): boolean {
  return tier <= HITL_COMMIT_THRESHOLD[trustState]
}

/** Human-readable reason for the HITL queue record when the gate holds. */
export function trustGateReason(trustState: TrustState, tier: Tier): string {
  return `Trust gate: trustState=${trustState} requires human approval at COMMIT for Tier ${tier} (rule: tier ≤ ${HITL_COMMIT_THRESHOLD[trustState]}).`
}

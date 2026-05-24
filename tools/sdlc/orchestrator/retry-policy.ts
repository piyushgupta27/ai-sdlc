/**
 * Retry policy — v1 ships global max-3.
 *
 * Tier-aware retry caps (Q-AI-26, R-AISDLC-105) are pre-spec'd but
 * graduate to v1.5+ per ROADMAP.md.
 *
 * Decision logic:
 *   - Each task tracks a retry counter (per build/review cycle pair)
 *   - On REVIEWER CHANGES_REQUESTED: increment retry counter
 *   - On retry counter > MAX_RETRIES: fire G2 HITL, move to Block column
 *   - On REVIEWER PASS: reset counter, proceed to COMMIT
 */

import type { Tier } from '../types/index.js'

/**
 * v1 — single global cap.
 */
export const MAX_RETRIES_V1 = 3 as const

/**
 * v1.5+ — tier-aware caps (Q-AI-26 / R-AISDLC-105). Not active in v1; here
 * for forward compatibility + so the policy is one config flip away.
 */
export const TIER_RETRY_CAPS_V1_5: Readonly<Record<Tier, number>> = {
  0: 0, // HITL on first build failure
  1: 1,
  2: 3,
  3: 5,
  4: Number.POSITIVE_INFINITY,
}

/**
 * Decision returned by `shouldRetry()`.
 */
export interface RetryDecision {
  readonly action: 'retry' | 'block' | 'pass'
  readonly retriesUsed: number
  readonly retriesRemaining: number
  readonly reason: string
}

/**
 * Decide whether a task should retry after a REVIEWER verdict.
 *
 * @param verdict The reviewer's verdict on this iteration
 * @param retriesUsed How many retries have happened so far (0 for first attempt)
 * @param tier Task tier (used in v1.5+; ignored in v1)
 */
export function shouldRetry(
  verdict: 'PASS' | 'CHANGES_REQUESTED' | 'FAIL' | 'BLOCK',
  retriesUsed: number,
  _tier: Tier,
): RetryDecision {
  if (verdict === 'PASS') {
    return {
      action: 'pass',
      retriesUsed,
      retriesRemaining: MAX_RETRIES_V1 - retriesUsed,
      reason: 'REVIEWER returned PASS — proceed to COMMIT',
    }
  }

  if (verdict === 'BLOCK') {
    return {
      action: 'block',
      retriesUsed,
      retriesRemaining: 0,
      reason: 'REVIEWER returned BLOCK (security override) — escalate to HITL regardless of tier',
    }
  }

  if (verdict === 'FAIL') {
    return {
      action: 'block',
      retriesUsed,
      retriesRemaining: 0,
      reason: 'REVIEWER returned FAIL — fundamental issue; escalate to HITL',
    }
  }

  // CHANGES_REQUESTED
  if (retriesUsed >= MAX_RETRIES_V1) {
    return {
      action: 'block',
      retriesUsed,
      retriesRemaining: 0,
      reason: `cap-exhausted:revision-${retriesUsed}:CHANGES_REQUESTED`,
    }
  }

  return {
    action: 'retry',
    retriesUsed,
    retriesRemaining: MAX_RETRIES_V1 - retriesUsed - 1,
    reason: `CHANGES_REQUESTED — retry attempt ${retriesUsed + 1} of ${MAX_RETRIES_V1}`,
  }
}

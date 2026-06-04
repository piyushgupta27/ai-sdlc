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
 * Bound on the CHECKER quality-refire loop (H5). Deliberately small: refires are
 * reserved for substantive gaps, not nitpicks — a high cap would let the gate
 * churn and hurt throughput. Distinct from `MAX_RETRIES_V1` (the outcome-based
 * build/review retry); this is the quality-based loop layered on top.
 */
export const MAX_CHECKER_REFIRES_V1 = 2 as const

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

  // CHANGES_REQUESTED — v1: treat as pass-with-feedback.
  //
  // Smoke tests against piyush-portfolio showed REVIEWER returning
  // CHANGES_REQUESTED for non-blocking commit-hygiene nits (e.g., "split
  // your commits"), which then triggered BUILDER retries that hit
  // permission walls (git reset) or timeouts. The feedback wasn't
  // important enough to block merge; the loop wasted budget.
  //
  // v1 behavior: CHANGES_REQUESTED → proceed to COMMIT, feedback surfaces
  // in the PR description for human review.
  //
  // v1.5+: REVIEWER should return a separate `severity: blocking |
  // non-blocking` field; retry only when blocking. Until then, REVIEWER
  // should use FAIL (escalates) for genuinely-must-fix issues and
  // CHANGES_REQUESTED for advisory feedback.
  return {
    action: 'pass',
    retriesUsed,
    retriesRemaining: MAX_RETRIES_V1 - retriesUsed,
    reason: 'CHANGES_REQUESTED — advisory feedback, proceed to COMMIT (v1)',
  }
}

/**
 * Decision returned by `shouldRefire()` — the CHECKER quality gate's loop control.
 */
export interface RefireDecision {
  readonly action: 'pass' | 'refire' | 'escalate'
  readonly refiresUsed: number
  readonly refiresRemaining: number
  readonly reason: string
}

/**
 * Decide what to do after the CHECKER gate. This is the QUALITY-based loop (H5),
 * distinct from `shouldRetry`'s outcome-based loop:
 *   - A deterministic re-run failure (H1) OR a CHECKER `REFIRE` → bounded refire
 *     of the owning producer (≤ `MAX_CHECKER_REFIRES_V1`).
 *   - CHECKER `ESCALATE`, or refires exhausted (non-convergence) → HITL.
 *   - CHECKER `PASS` with the deterministic matrix green → proceed to COMMIT.
 *
 * Deterministic failure overrides a (too-lenient) CHECKER PASS: machine-checkable
 * facts are never waved through by an LLM verdict.
 */
export function shouldRefire(
  verdict: 'PASS' | 'REFIRE' | 'ESCALATE',
  hasDeterministicFailure: boolean,
  refiresUsed: number,
): RefireDecision {
  const refiresRemaining = MAX_CHECKER_REFIRES_V1 - refiresUsed

  if (verdict === 'PASS' && !hasDeterministicFailure) {
    return {
      action: 'pass',
      refiresUsed,
      refiresRemaining,
      reason: 'CHECKER PASS + deterministic re-run green — proceed to COMMIT',
    }
  }

  if (verdict === 'ESCALATE') {
    return {
      action: 'escalate',
      refiresUsed,
      refiresRemaining,
      reason: 'CHECKER ESCALATE — needs MANAGER judgment',
    }
  }

  // REFIRE, or PASS-but-deterministic-failure (H1 overrides the lenient verdict).
  if (refiresRemaining <= 0) {
    return {
      action: 'escalate',
      refiresUsed,
      refiresRemaining: 0,
      reason: `Non-convergence after ${refiresUsed} refire(s) — escalate to MANAGER (H5)`,
    }
  }

  return {
    action: 'refire',
    refiresUsed,
    refiresRemaining,
    reason: hasDeterministicFailure
      ? 'Deterministic re-run found a failure (H1) — refire the owning producer'
      : 'CHECKER REFIRE — refire the owning producer with the deficiencies',
  }
}

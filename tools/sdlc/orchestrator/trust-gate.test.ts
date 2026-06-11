/**
 * Tests for the trust-ladder → COMMIT HITL gate (issue #62).
 *
 * Exhaustive: every TrustState × every Tier, asserted against the documented
 * ladder. The mapping is the safety contract, so it's pinned in full.
 */

import { describe, expect, it } from 'vitest'
import type { Tier, TrustState } from '../types/index.js'
import { requiresCommitHitl, trustGateReason } from './trust-gate.js'

// Expected: which tiers (0-4) require a COMMIT HITL gate, per trust state.
const EXPECTED: Record<TrustState, readonly Tier[]> = {
  MANUAL: [0, 1, 2, 3, 4], // everything HITL
  SUPERVISED: [0, 1, 2, 3], // Tier 4 auto
  TRUSTED_LOW: [0, 1, 2], // Tier 3-4 auto
  TRUSTED_MID: [0, 1], // Tier 2-4 auto
  STEADY_STATE: [0, 1], // Tier 2-4 auto; Tier 0/1 forever
}

const ALL_TIERS: readonly Tier[] = [0, 1, 2, 3, 4]

describe('requiresCommitHitl', () => {
  for (const [state, gatedTiers] of Object.entries(EXPECTED) as [TrustState, Tier[]][]) {
    for (const tier of ALL_TIERS) {
      const shouldGate = gatedTiers.includes(tier)
      it(`${state} × Tier ${tier} → ${shouldGate ? 'HITL' : 'auto'}`, () => {
        expect(requiresCommitHitl(state, tier)).toBe(shouldGate)
      })
    }
  }

  it('MANUAL gates every tier (the onboarding default = everything HITL)', () => {
    expect(ALL_TIERS.every((t) => requiresCommitHitl('MANUAL', t))).toBe(true)
  })

  it('trust rises monotonically — more trust never gates a tier a lower-trust state allowed', () => {
    const order: TrustState[] = [
      'MANUAL',
      'SUPERVISED',
      'TRUSTED_LOW',
      'TRUSTED_MID',
      'STEADY_STATE',
    ]
    for (let i = 1; i < order.length; i++) {
      for (const t of ALL_TIERS) {
        const prev = requiresCommitHitl(order[i - 1] as TrustState, t)
        const curr = requiresCommitHitl(order[i] as TrustState, t)
        // curr may relax (true→false) but must never tighten (false→true).
        expect(prev || !curr).toBe(true)
      }
    }
  })
})

describe('trustGateReason', () => {
  it('names the state, tier, and the rule', () => {
    const reason = trustGateReason('SUPERVISED', 2)
    expect(reason).toContain('SUPERVISED')
    expect(reason).toContain('Tier 2')
    expect(reason).toContain('tier ≤ 3')
  })
})

/**
 * Tests for the CHECKER quality-refire policy (H5).
 */

import { describe, expect, it } from 'vitest'
import { MAX_CHECKER_REFIRES_V1, shouldRefire } from './retry-policy.js'

describe('shouldRefire', () => {
  it('PASS with the deterministic matrix green → proceed to COMMIT', () => {
    expect(shouldRefire('PASS', false, 0).action).toBe('pass')
  })

  it('PASS but a deterministic check failed → refire (H1 overrides a lenient verdict)', () => {
    expect(shouldRefire('PASS', true, 0).action).toBe('refire')
  })

  it('ESCALATE → escalate regardless of refires used', () => {
    expect(shouldRefire('ESCALATE', false, 0).action).toBe('escalate')
    expect(shouldRefire('ESCALATE', true, 0).action).toBe('escalate')
  })

  it('REFIRE within budget → refire', () => {
    expect(shouldRefire('REFIRE', false, 0).action).toBe('refire')
    expect(shouldRefire('REFIRE', false, MAX_CHECKER_REFIRES_V1 - 1).action).toBe('refire')
  })

  it('REFIRE at the cap → escalate (non-convergence, H5)', () => {
    const d = shouldRefire('REFIRE', false, MAX_CHECKER_REFIRES_V1)
    expect(d.action).toBe('escalate')
    expect(d.reason).toContain('Non-convergence')
  })

  it('deterministic failure at the cap → escalate', () => {
    expect(shouldRefire('PASS', true, MAX_CHECKER_REFIRES_V1).action).toBe('escalate')
  })

  it('reports remaining refires', () => {
    expect(shouldRefire('REFIRE', false, 0).refiresRemaining).toBe(MAX_CHECKER_REFIRES_V1)
  })
})

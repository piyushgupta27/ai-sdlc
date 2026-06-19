/**
 * Tests for the CHECKER quality-refire policy (H5) and subagent timeout retry (#148).
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_CHECKER_REFIRES_V1,
  MAX_TIMEOUT_RETRIES_V1,
  shouldRefire,
  shouldRetryOnTimeout,
} from './retry-policy.js'

describe('shouldRetryOnTimeout (#148)', () => {
  it('idle kill within budget → retry', () => {
    const d = shouldRetryOnTimeout('idle', 0)
    expect(d.action).toBe('retry')
    expect(d.reason).toContain('Process freeze')
  })

  it('stalled kill within budget → retry with nudge hint', () => {
    const d = shouldRetryOnTimeout('stalled', 0)
    expect(d.action).toBe('retry')
    expect(d.reason).toContain('stall nudge')
  })

  it('ceiling kill → block (task overran budget; retry would hit same ceiling)', () => {
    expect(shouldRetryOnTimeout('ceiling', 0).action).toBe('block')
  })

  it('idle at cap → block (retries exhausted)', () => {
    const d = shouldRetryOnTimeout('idle', MAX_TIMEOUT_RETRIES_V1)
    expect(d.action).toBe('block')
    expect(d.reason).toContain('exhausted')
  })

  it('stalled at cap → block', () => {
    expect(shouldRetryOnTimeout('stalled', MAX_TIMEOUT_RETRIES_V1).action).toBe('block')
  })
})

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

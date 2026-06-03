/**
 * Tests for the model router.
 *
 * Routing is deterministic; tests assert the model + transport + reason
 * for each (role, tier, isRetry, isComplex) combination.
 */

import { describe, expect, it } from 'vitest'
import { MODEL_COST_PER_M_TOKENS, estimateCost, selectModel } from './select-model.js'

describe('selectModel', () => {
  it('PLANNER always picks Opus regardless of tier', () => {
    for (const tier of [0, 1, 2, 3, 4] as const) {
      const r = selectModel({ role: 'planner', tier })
      expect(r.model).toBe('claude-opus-4-7')
      expect(r.transport).toBe('claude-code-subagent')
    }
  })

  it('BUILDER picks Sonnet for Tier 2-4 default', () => {
    for (const tier of [2, 3, 4] as const) {
      const r = selectModel({ role: 'builder', tier })
      expect(r.model).toBe('claude-sonnet-4-6')
    }
  })

  it('BUILDER escalates to Opus on Tier 0/1', () => {
    for (const tier of [0, 1] as const) {
      const r = selectModel({ role: 'builder', tier })
      expect(r.model).toBe('claude-opus-4-7')
      expect(r.reason).toContain('tier=')
    }
  })

  it('BUILDER escalates to Opus on retry', () => {
    const r = selectModel({ role: 'builder', tier: 3, isRetry: true })
    expect(r.model).toBe('claude-opus-4-7')
    expect(r.reason).toContain('retry=true')
  })

  it('BUILDER escalates to Opus on complex tickets', () => {
    const r = selectModel({ role: 'builder', tier: 3, isComplex: true })
    expect(r.model).toBe('claude-opus-4-7')
    expect(r.reason).toContain('complex=true')
  })

  it('TESTER picks Sonnet by default, Opus on retry', () => {
    expect(selectModel({ role: 'tester', tier: 3 }).model).toBe('claude-sonnet-4-6')
    expect(selectModel({ role: 'tester', tier: 3, isRetry: true }).model).toBe('claude-opus-4-7')
  })

  it('REVIEWER uses Opus + temp 0.7 for hostile-eye review', () => {
    const r = selectModel({ role: 'reviewer', tier: 2 })
    expect(r.model).toBe('claude-opus-4-7')
    expect(r.temperature).toBe(0.7)
    expect(r.reason).toContain('hostile-eye')
  })

  it('REPORTER picks Haiku', () => {
    const r = selectModel({ role: 'reporter', tier: 2 })
    expect(r.model).toBe('claude-haiku-4-5-20251001')
  })

  it('CHECKER uses Opus + temp 0.4 (independent semantic auditor)', () => {
    const r = selectModel({ role: 'checker', tier: 2 })
    expect(r.model).toBe('claude-opus-4-7')
    expect(r.temperature).toBe(0.4)
    expect(r.transport).toBe('claude-code-subagent')
  })

  it('all routes use claude-code-subagent transport (Q-AI-2 amendment)', () => {
    const roles = ['planner', 'builder', 'tester', 'reviewer', 'checker', 'reporter'] as const
    for (const role of roles) {
      const r = selectModel({ role, tier: 2 })
      expect(r.transport).toBe('claude-code-subagent')
    }
  })
})

describe('estimateCost', () => {
  it('returns 0 for unknown model', () => {
    expect(estimateCost('unknown-model-id', { input: 1000, output: 500 })).toBe(0)
  })

  it('charges full input rate when no cache read', () => {
    const sonnet = 'claude-sonnet-4-6'
    const pricing = MODEL_COST_PER_M_TOKENS[sonnet] as {
      input: number
      output: number
      cache: number
    }
    expect(estimateCost(sonnet, { input: 1_000_000, output: 0 })).toBeCloseTo(pricing.input, 5)
  })

  it('charges cache rate for cached portion of input', () => {
    const sonnet = 'claude-sonnet-4-6'
    const cost = estimateCost(sonnet, {
      input: 1_000_000,
      output: 0,
      cacheRead: 1_000_000, // 100% cache hit
    })
    const pricing = MODEL_COST_PER_M_TOKENS[sonnet] as {
      input: number
      output: number
      cache: number
    }
    expect(cost).toBeCloseTo(pricing.cache, 5)
  })

  it('Opus is more expensive than Sonnet for same tokens', () => {
    const tokens = { input: 100_000, output: 10_000 }
    const sonnetCost = estimateCost('claude-sonnet-4-6', tokens)
    const opusCost = estimateCost('claude-opus-4-7', tokens)
    expect(opusCost).toBeGreaterThan(sonnetCost)
  })

  it('Haiku is cheaper than Sonnet for same tokens', () => {
    const tokens = { input: 100_000, output: 10_000 }
    const sonnetCost = estimateCost('claude-sonnet-4-6', tokens)
    const haikuCost = estimateCost('claude-haiku-4-5-20251001', tokens)
    expect(haikuCost).toBeLessThan(sonnetCost)
  })
})

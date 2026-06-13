/**
 * Tests for the model router.
 *
 * Routing is deterministic; tests assert the model + transport + reason
 * for each (role, tier, isRetry, isComplex) combination.
 */

import { describe, expect, it } from 'vitest'
import { MODEL_COST_PER_M_TOKENS, estimateCost, selectModel } from './select-model.js'

describe('selectModel', () => {
  it('PLANNER always picks Opus regardless of tier (GUARDIAN)', () => {
    for (const tier of [0, 1, 2, 3, 4] as const) {
      const r = selectModel({ role: 'planner', tier })
      expect(r.model).toBe('claude-opus-4-8')
      expect(r.transport).toBe('claude-code-subagent')
    }
  })

  it('BUILDER picks Haiku for Tier 4 default (non-retry, non-complex)', () => {
    const r = selectModel({ role: 'builder', tier: 4 })
    expect(r.model).toBe('claude-haiku-4-5-20251001')
    expect(r.reason).toContain('tier=4')
  })

  it('BUILDER picks Sonnet for Tier 2-3 default (non-retry, non-complex)', () => {
    for (const tier of [2, 3] as const) {
      const r = selectModel({ role: 'builder', tier })
      expect(r.model).toBe('claude-sonnet-4-6')
      expect(r.reason).toContain(`tier=${tier}`)
    }
  })

  it('BUILDER escalates to Opus on Tier 0/1', () => {
    for (const tier of [0, 1] as const) {
      const r = selectModel({ role: 'builder', tier })
      expect(r.model).toBe('claude-opus-4-8')
      expect(r.reason).toContain(`tier=${tier}`)
    }
  })

  it('BUILDER escalates to Opus on retry (even on Tier 4)', () => {
    const r = selectModel({ role: 'builder', tier: 3, isRetry: true })
    expect(r.model).toBe('claude-opus-4-8')
    expect(r.reason).toContain('retry=true')

    const r4 = selectModel({ role: 'builder', tier: 4, isRetry: true })
    expect(r4.model).toBe('claude-opus-4-8')
  })

  it('BUILDER escalates to Opus on complex tickets (even on Tier 4)', () => {
    const r = selectModel({ role: 'builder', tier: 3, isComplex: true })
    expect(r.model).toBe('claude-opus-4-8')
    expect(r.reason).toContain('complex=true')

    const r4 = selectModel({ role: 'builder', tier: 4, isComplex: true })
    expect(r4.model).toBe('claude-opus-4-8')
  })

  it('TESTER picks Haiku on Tier 4 default', () => {
    const r = selectModel({ role: 'tester', tier: 4 })
    expect(r.model).toBe('claude-haiku-4-5-20251001')
    expect(r.reason).toContain('tier=4')
  })

  it('TESTER picks Sonnet on Tier 2-3 default', () => {
    for (const tier of [2, 3] as const) {
      const r = selectModel({ role: 'tester', tier })
      expect(r.model).toBe('claude-sonnet-4-6')
    }
  })

  it('TESTER escalates to Opus on retry (any tier)', () => {
    for (const tier of [0, 1, 2, 3, 4] as const) {
      const r = selectModel({ role: 'tester', tier, isRetry: true })
      expect(r.model).toBe('claude-opus-4-8')
      expect(r.reason).toContain('retry')
    }
  })

  it('REVIEWER uses Opus + temp 0.7 for hostile-eye review (GUARDIAN, any tier)', () => {
    for (const tier of [0, 1, 2, 3, 4] as const) {
      const r = selectModel({ role: 'reviewer', tier })
      expect(r.model).toBe('claude-opus-4-8')
      expect(r.temperature).toBe(0.7)
    }
  })

  it('CHECKER uses Opus + temp 0.4 (GUARDIAN; independent semantic auditor, any tier)', () => {
    for (const tier of [0, 1, 2, 3, 4] as const) {
      const r = selectModel({ role: 'checker', tier })
      expect(r.model).toBe('claude-opus-4-8')
      expect(r.temperature).toBe(0.4)
      expect(r.transport).toBe('claude-code-subagent')
    }
  })

  it('REPORTER picks Haiku', () => {
    const r = selectModel({ role: 'reporter', tier: 2 })
    expect(r.model).toBe('claude-haiku-4-5-20251001')
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

  it('prices input at input rate and cacheRead at cache rate independently', () => {
    const sonnet = 'claude-sonnet-4-6'
    const pricing = MODEL_COST_PER_M_TOKENS[sonnet] as {
      input: number
      output: number
      cache: number
    }
    const cost = estimateCost(sonnet, {
      input: 1_000_000,
      output: 0,
      cacheRead: 1_000_000,
    })
    // Both input and cacheRead are priced independently — no subtraction
    expect(cost).toBeCloseTo(pricing.input + pricing.cache, 5)
  })

  it('cacheRead > input: prices both independently without subtraction', () => {
    const sonnet = 'claude-sonnet-4-6'
    const pricing = MODEL_COST_PER_M_TOKENS[sonnet] as {
      input: number
      output: number
      cache: number
    }
    const input = 100_000
    const cacheRead = 900_000
    const output = 50_000
    const cost = estimateCost(sonnet, { input, output, cacheRead })
    const expected =
      (input * pricing.input) / 1_000_000 +
      (cacheRead * pricing.cache) / 1_000_000 +
      (output * pricing.output) / 1_000_000
    expect(cost).toBeCloseTo(expected, 10)
  })

  it('input > cacheRead: prices both independently without subtraction', () => {
    const sonnet = 'claude-sonnet-4-6'
    const pricing = MODEL_COST_PER_M_TOKENS[sonnet] as {
      input: number
      output: number
      cache: number
    }
    const input = 800_000
    const cacheRead = 200_000
    const output = 100_000
    const cost = estimateCost(sonnet, { input, output, cacheRead })
    const expected =
      (input * pricing.input) / 1_000_000 +
      (cacheRead * pricing.cache) / 1_000_000 +
      (output * pricing.output) / 1_000_000
    expect(cost).toBeCloseTo(expected, 10)
  })

  it('no cacheRead: defaults to 0, costs input + output only', () => {
    const sonnet = 'claude-sonnet-4-6'
    const pricing = MODEL_COST_PER_M_TOKENS[sonnet] as {
      input: number
      output: number
      cache: number
    }
    const input = 500_000
    const output = 200_000
    const cost = estimateCost(sonnet, { input, output })
    const expected = (input * pricing.input) / 1_000_000 + (output * pricing.output) / 1_000_000
    expect(cost).toBeCloseTo(expected, 10)
  })

  it('Opus is more expensive than Sonnet for same tokens', () => {
    const tokens = { input: 100_000, output: 10_000 }
    const sonnetCost = estimateCost('claude-sonnet-4-6', tokens)
    const opusCost = estimateCost('claude-opus-4-8', tokens)
    expect(opusCost).toBeGreaterThan(sonnetCost)
  })

  it('Haiku is cheaper than Sonnet for same tokens', () => {
    const tokens = { input: 100_000, output: 10_000 }
    const sonnetCost = estimateCost('claude-sonnet-4-6', tokens)
    const haikuCost = estimateCost('claude-haiku-4-5-20251001', tokens)
    expect(haikuCost).toBeLessThan(sonnetCost)
  })

  it('Opus 4.8 pricing matches the previous Opus 4.7 schedule', () => {
    const pricing = MODEL_COST_PER_M_TOKENS['claude-opus-4-8'] as {
      input: number
      output: number
      cache: number
    }
    expect(pricing).toEqual({ input: 15.0, output: 75.0, cache: 1.5 })
  })
})

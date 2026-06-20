/**
 * Tests for runAgent's ceiling-sizing and progress-watchdog routing (#107 / #125).
 *
 * `ceilingSecForTier` and the noProgressSec wiring are private; we verify them
 * indirectly by injecting a mock transport and asserting what the transport receives.
 */

import { describe, expect, it, vi } from 'vitest'
import type { DispatchOpts, SubagentTransport } from '../router/claude-code-subagent.js'
import { runAgent } from './base.js'

/** Minimal successful agent envelope. */
const SUCCESS_ENVELOPE = JSON.stringify({
  outcome: 'success',
  output: {},
  filesRead: [],
  filesWritten: [],
})

function makeTransport(spy: (opts: DispatchOpts) => void): SubagentTransport {
  return {
    dispatch: vi.fn(async (opts) => {
      spy(opts)
      return {
        ok: true as const,
        value: {
          rawText: SUCCESS_ENVELOPE,
          tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
          durationMs: 100,
          costUsd: 0.001,
        },
      }
    }),
  }
}

const BASE_BRIEF = {
  project: 'test',
  taskId: 'gh-test',
  targetRepo: '/tmp',
  payload: { taskId: 'gh-test', tier: 2 },
}

describe('ceilingSecForTier', () => {
  it('tier 4 → 600s', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 4, transport: t })
    expect(captured[0]?.ceilingSec).toBe(600)
  })

  it('tier 3 → 2400s', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 3, transport: t })
    expect(captured[0]?.ceilingSec).toBe(2400)
  })

  it('tier 2 → 2400s', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 2, transport: t })
    expect(captured[0]?.ceilingSec).toBe(2400)
  })

  it('tier 1 → 3600s', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 1, transport: t })
    expect(captured[0]?.ceilingSec).toBe(3600)
  })

  it('tier 0 → 3600s', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 0, transport: t })
    expect(captured[0]?.ceilingSec).toBe(3600)
  })

  it('isComplex adds +600s on top of tier baseline', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 2, isComplex: true, transport: t })
    expect(captured[0]?.ceilingSec).toBe(3000) // 2400 + 600
  })

  it('isComplex on tier 0/1 adds +600s', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 1, isComplex: true, transport: t })
    expect(captured[0]?.ceilingSec).toBe(4200) // 3600 + 600
  })
})

describe('noProgressSec routing (#125)', () => {
  it('builder tier 2 receives noProgressSec=300 (standard)', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 2, transport: t })
    expect(captured[0]?.noProgressSec).toBe(300)
  })

  it('tester tier 2 receives noProgressSec=300 (standard)', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'tester', brief: BASE_BRIEF, tier: 2, transport: t })
    expect(captured[0]?.noProgressSec).toBe(300)
  })

  it('builder tier 4 receives noProgressSec=180 (trivial — fast write expected)', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 4, transport: t })
    expect(captured[0]?.noProgressSec).toBe(180)
  })

  it('builder tier 1 receives noProgressSec=500 (exploratory reads expected)', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 1, transport: t })
    expect(captured[0]?.noProgressSec).toBe(500)
  })

  it('reviewer does NOT receive noProgressSec (watchdog disabled)', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'reviewer', brief: BASE_BRIEF, tier: 2, transport: t })
    expect(captured[0]?.noProgressSec).toBeUndefined()
  })

  it('checker does NOT receive noProgressSec (watchdog disabled)', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'checker', brief: BASE_BRIEF, tier: 2, transport: t })
    expect(captured[0]?.noProgressSec).toBeUndefined()
  })
})

describe('#77 — one-shot re-prompt on agent.invalid-response', () => {
  const PROSE_RESPONSE = 'The task looks good. All ACs are met. I recommend passing.'

  it('succeeds on re-prompt when first response is prose and second is valid JSON', async () => {
    let callCount = 0
    const transport: SubagentTransport = {
      dispatch: vi.fn(async () => {
        callCount++
        const rawText = callCount === 1 ? PROSE_RESPONSE : SUCCESS_ENVELOPE
        return {
          ok: true as const,
          value: { rawText, tokens: { input: 10, output: 20 }, durationMs: 100, costUsd: 0.001 },
        }
      }),
    }
    const result = await runAgent({ role: 'reviewer', brief: BASE_BRIEF, tier: 2, transport })
    expect(result.ok).toBe(true)
    expect(callCount).toBe(2)
  })

  it('re-prompt dispatch uses ceilingSec 600', async () => {
    const captured: DispatchOpts[] = []
    let callCount = 0
    const transport: SubagentTransport = {
      dispatch: vi.fn(async (opts) => {
        callCount++
        captured.push(opts)
        const rawText = callCount === 1 ? PROSE_RESPONSE : SUCCESS_ENVELOPE
        return {
          ok: true as const,
          value: { rawText, tokens: { input: 10, output: 20 }, durationMs: 100, costUsd: 0.001 },
        }
      }),
    }
    await runAgent({ role: 'reviewer', brief: BASE_BRIEF, tier: 2, transport })
    expect(captured[1]?.ceilingSec).toBe(600)
  })

  it('merges costs from both dispatches', async () => {
    let callCount = 0
    const transport: SubagentTransport = {
      dispatch: vi.fn(async () => {
        callCount++
        const rawText = callCount === 1 ? PROSE_RESPONSE : SUCCESS_ENVELOPE
        return {
          ok: true as const,
          value: { rawText, tokens: { input: 10, output: 20 }, durationMs: 100, costUsd: 0.002 },
        }
      }),
    }
    const result = await runAgent({ role: 'reviewer', brief: BASE_BRIEF, tier: 2, transport })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.costUsd).toBeCloseTo(0.004)
  })

  it('returns agent.invalid-response if both dispatches return prose', async () => {
    const transport: SubagentTransport = {
      dispatch: vi.fn(async () => ({
        ok: true as const,
        value: {
          rawText: PROSE_RESPONSE,
          tokens: { input: 10, output: 20 },
          durationMs: 100,
          costUsd: 0.001,
        },
      })),
    }
    const result = await runAgent({ role: 'reviewer', brief: BASE_BRIEF, tier: 2, transport })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('agent.invalid-response')
  })

  it('re-prompt includes CORRECTION marker in userMessage', async () => {
    const captured: DispatchOpts[] = []
    let callCount = 0
    const transport: SubagentTransport = {
      dispatch: vi.fn(async (opts) => {
        callCount++
        captured.push(opts)
        const rawText = callCount === 1 ? PROSE_RESPONSE : SUCCESS_ENVELOPE
        return {
          ok: true as const,
          value: { rawText, tokens: { input: 10, output: 20 }, durationMs: 100, costUsd: 0.001 },
        }
      }),
    }
    await runAgent({ role: 'reviewer', brief: BASE_BRIEF, tier: 2, transport })
    expect(captured[1]?.userMessage).toContain('CORRECTION')
  })
})

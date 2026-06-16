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
  it('builder receives noProgressSec (progress watchdog enabled)', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'builder', brief: BASE_BRIEF, tier: 2, transport: t })
    expect(captured[0]?.noProgressSec).toBe(300)
  })

  it('tester receives noProgressSec (progress watchdog enabled)', async () => {
    const captured: DispatchOpts[] = []
    const t = makeTransport((o) => captured.push(o))
    await runAgent({ role: 'tester', brief: BASE_BRIEF, tier: 2, transport: t })
    expect(captured[0]?.noProgressSec).toBe(300)
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

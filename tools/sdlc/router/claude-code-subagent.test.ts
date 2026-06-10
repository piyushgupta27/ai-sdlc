/**
 * Tests for the subagent transport's stream-json parsing (findings F5 + #45).
 *
 * The pure cores are tested directly so we don't spawn a process:
 *   - parseDispatchPayload — pulls the terminal `result` event out of the
 *     newline-delimited stream-json stdout (and still parses a bare single
 *     envelope, the legacy shape).
 *   - recoverUsageFromStream — recovers tokens from a partial stream after an
 *     idle/ceiling kill (#45), so a timed-out run isn't billed $0.
 *   - countToolTransitions / isSubagentTimeoutCause — tool-balance + typed-cause helpers.
 * Plus behavioral tests of the transport's timers (#45) over a mocked `spawn` +
 * fake timers — idle kill, idle reset on activity, ceiling, tool-aware suspension,
 * and SIGTERM→SIGKILL escalation. Fixtures match the live CLI output from the probe.
 */

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClaudeCodeCliTransport,
  countToolTransitions,
  isSubagentTimeoutCause,
  parseDispatchPayload,
  recoverUsageFromStream,
} from './claude-code-subagent.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
import { spawn } from 'node:child_process'

/** A realistic stream-json stdout: system init → partial deltas → assistant → result. */
const streamJsonStdout = [
  JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-haiku-4-5' }),
  JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }),
  JSON.stringify({
    type: 'assistant',
    message: { usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 1000 } },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'pong',
    total_cost_usd: 0.0156666,
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 9870,
      cache_read_input_tokens: 30941,
      output_tokens: 45,
    },
  }),
].join('\n')

const successEnvelope = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'pong',
  total_cost_usd: 0.0156666,
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 9870,
    cache_read_input_tokens: 30941,
    output_tokens: 45,
  },
})

describe('parseDispatchPayload', () => {
  it('extracts rawText, tokens, and real cost from a success envelope', () => {
    const r = parseDispatchPayload(successEnvelope)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('pong')
    expect(r.value.tokens.input).toBe(10)
    expect(r.value.tokens.output).toBe(45)
    expect(r.value.tokens.cacheRead).toBe(30941)
    expect(r.value.costUsd).toBeCloseTo(0.0156666, 7)
  })

  it('returns an error when the CLI reports is_error=true', () => {
    const env = JSON.stringify({ is_error: true, result: 'rate limited', total_cost_usd: 0 })
    const r = parseDispatchPayload(env)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.cli-error')
  })

  it('returns an error for non-JSON stdout', () => {
    const r = parseDispatchPayload('not json at all')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.invalid-json')
  })

  it('returns an error when the JSON envelope has no string result', () => {
    const r = parseDispatchPayload(JSON.stringify({ is_error: false, usage: {} }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.invalid-json')
  })

  it('defaults tokens to 0 and leaves cost undefined when usage/cost are absent (no throw)', () => {
    const r = parseDispatchPayload(JSON.stringify({ is_error: false, result: 'hi' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('hi')
    expect(r.value.tokens.input).toBe(0)
    expect(r.value.tokens.output).toBe(0)
    expect(r.value.tokens.cacheRead).toBeUndefined()
    // GH#30: undefined (not 0) so the caller falls back to estimateCost rather than logging $0.
    expect(r.value.costUsd).toBeUndefined()
  })

  it('keeps the real cost when the CLI reports total_cost_usd', () => {
    const r = parseDispatchPayload(
      JSON.stringify({ is_error: false, result: 'hi', total_cost_usd: 1.34 }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.costUsd).toBe(1.34)
  })

  it('picks the terminal result event out of a multi-line stream (#45)', () => {
    const r = parseDispatchPayload(streamJsonStdout)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('pong')
    expect(r.value.tokens.input).toBe(10)
    expect(r.value.tokens.output).toBe(45)
    expect(r.value.tokens.cacheRead).toBe(30941)
    expect(r.value.costUsd).toBeCloseTo(0.0156666, 7)
  })

  it('ignores non-JSON lines interleaved in the stream', () => {
    const r = parseDispatchPayload(`progress chatter not json\n${streamJsonStdout}\n`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('pong')
  })

  it('errors when the stream has no result event and no string result', () => {
    const noResult = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'stream_event', event: { type: 'message_stop' } }),
    ].join('\n')
    const r = parseDispatchPayload(noResult)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.invalid-json')
  })
})

describe('recoverUsageFromStream (#45 — cost recovery on kill)', () => {
  it('recovers tokens from the last usage-bearing event when no result arrived', () => {
    // Simulate a SIGTERM'd stream: assistant usage present, but no terminal result.
    const partial = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({
        type: 'assistant',
        message: { usage: { input_tokens: 12, output_tokens: 80, cache_read_input_tokens: 500 } },
      }),
    ].join('\n')
    const tokens = recoverUsageFromStream(partial)
    expect(tokens.input).toBe(12)
    expect(tokens.output).toBe(80)
    expect(tokens.cacheRead).toBe(500)
  })

  it('also reads usage off a top-level result event', () => {
    const tokens = recoverUsageFromStream(streamJsonStdout)
    expect(tokens.input).toBe(10)
    expect(tokens.output).toBe(45)
    expect(tokens.cacheRead).toBe(30941)
  })

  it('returns zeros when nothing usable was streamed', () => {
    const tokens = recoverUsageFromStream('garbage\n{"type":"system"}\n')
    expect(tokens.input).toBe(0)
    expect(tokens.output).toBe(0)
    expect(tokens.cacheRead).toBeUndefined()
  })

  it('SUMS output across multi-turn assistant events when no result arrived (#45)', () => {
    // Per-turn assistant usage is NOT cumulative — summing avoids under-billing a
    // long, killed tool loop.
    const multiTurn = [
      JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: 80 } } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      JSON.stringify({
        type: 'assistant',
        message: { usage: { input_tokens: 5, output_tokens: 120, cache_read_input_tokens: 200 } },
      }),
    ].join('\n')
    const tokens = recoverUsageFromStream(multiTurn)
    expect(tokens.output).toBe(200) // 80 + 120
    expect(tokens.input).toBe(5)
    expect(tokens.cacheRead).toBe(200)
  })
})

describe('countToolTransitions', () => {
  it('opens on assistant tool_use blocks', () => {
    const obj = {
      type: 'assistant',
      message: { content: [{ type: 'text' }, { type: 'tool_use' }, { type: 'tool_use' }] },
    }
    expect(countToolTransitions(obj)).toEqual({ opened: 2, closed: 0 })
  })
  it('closes on user tool_result blocks', () => {
    const obj = { type: 'user', message: { content: [{ type: 'tool_result' }] } }
    expect(countToolTransitions(obj)).toEqual({ opened: 0, closed: 1 })
  })
  it('is neutral for events without tool blocks', () => {
    expect(countToolTransitions({ type: 'result', result: 'ok' })).toEqual({ opened: 0, closed: 0 })
  })
})

// ─── Transport timer behavior (#45) ──────────────────────────────────────────
// A fake child (EventEmitter) + fake timers let us assert the kill logic without
// spawning `claude`. pid is left undefined so signalGroup falls back to child.kill
// (never touching a real process group from a test).
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number | undefined
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = undefined
  child.kill = vi.fn()
  return child
}

const DISPATCH = {
  userMessage: 'u',
  systemPrompt: 's',
  model: 'claude-haiku-4-5-20251001',
  temperature: 0,
  cwd: '/tmp',
  idleTimeoutSec: 10,
  ceilingSec: 100,
}

describe('ClaudeCodeCliTransport timers (#45)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('idle-kills after silence and reports reason=idle with recovered cost', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    // an assistant turn (tokens to recover), then the tool COMPLETED (no open tool)
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: 30 } } })}\n`,
      ),
    )
    await vi.advanceTimersByTimeAsync(10_000) // idle window with no further output
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.timeout')
    expect(isSubagentTimeoutCause(r.error.cause)).toBe(true)
    if (!isSubagentTimeoutCause(r.error.cause)) return
    expect(r.error.cause.reason).toBe('idle')
    expect(r.error.cause.recoveredTokens.output).toBe(30)
  })

  it('does NOT idle-kill while a tool call is outstanding (tool-aware)', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    // assistant opens a tool call but no tool_result yet → agent is blocked on a tool
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } })}\n`,
      ),
    )
    await vi.advanceTimersByTimeAsync(50_000) // 5× the idle window, silent
    expect(child.kill).not.toHaveBeenCalled() // tool in flight → not idle-killed
    await vi.advanceTimersByTimeAsync(60_000) // now past the 100s ceiling
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok || !isSubagentTimeoutCause(r.error.cause)) return
    expect(r.error.cause.reason).toBe('ceiling')
  })

  it('escalates to SIGKILL if the child ignores SIGTERM', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    await vi.advanceTimersByTimeAsync(10_000) // idle fires
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(10_000) // SIGKILL grace elapses, no close
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null)
    await p
  })

  it('activity resets the idle timer; a clean result resolves success', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    // ping output every 6s for 30s — never idle (window is 10s), never killed
    for (let i = 0; i < 5; i++) {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'system' })}\n`))
      await vi.advanceTimersByTimeAsync(6_000)
    }
    expect(child.kill).not.toHaveBeenCalled()
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'result', is_error: false, result: 'done', total_cost_usd: 0.02, usage: { input_tokens: 3, output_tokens: 7 } })}\n`,
      ),
    )
    child.emit('close', 0)
    const r = await p
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('done')
    expect(r.value.costUsd).toBe(0.02)
  })
})

describe('isSubagentTimeoutCause', () => {
  it('accepts a well-formed timeout cause', () => {
    expect(
      isSubagentTimeoutCause({
        reason: 'idle',
        idleSec: 120,
        ceilingSec: 600,
        recoveredTokens: { input: 1, output: 2 },
        recoveredCostUsd: 0.01,
        toolCalls: 3,
        lastActivityAgoMs: 121000,
        stdout: '',
        stderr: '',
      }),
    ).toBe(true)
  })

  it('rejects arbitrary causes', () => {
    expect(isSubagentTimeoutCause({ stdout: 'x', stderr: 'y' })).toBe(false)
    expect(isSubagentTimeoutCause(null)).toBe(false)
    expect(isSubagentTimeoutCause('nope')).toBe(false)
    expect(isSubagentTimeoutCause({ reason: 'idle', recoveredCostUsd: 'not-a-number' })).toBe(false)
  })
})

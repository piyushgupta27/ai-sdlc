/**
 * Tests for the subagent transport's stream-json parsing (findings F5 + #45).
 *
 * The pure cores are tested directly so we don't spawn a process:
 *   - parseDispatchPayload — pulls the terminal `result` event out of the
 *     newline-delimited stream-json stdout (and still parses a bare single
 *     envelope, the legacy shape).
 *   - recoverUsageFromStream — recovers tokens from a partial stream after an
 *     idle/ceiling kill (#45), so a timed-out run isn't billed $0.
 *   - countToolUses / isSubagentTimeoutCause — progress + typed-cause helpers.
 * Fixtures match the live CLI output captured during the #45 probe.
 */

import { describe, expect, it } from 'vitest'
import {
  countToolUses,
  isSubagentTimeoutCause,
  parseDispatchPayload,
  recoverUsageFromStream,
} from './claude-code-subagent.js'

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
})

describe('countToolUses', () => {
  it('counts tool_use occurrences in a chunk', () => {
    expect(countToolUses('"type":"tool_use" ... "type": "tool_use"')).toBe(2)
    expect(countToolUses('no tools here')).toBe(0)
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

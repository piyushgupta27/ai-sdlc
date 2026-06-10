/**
 * Tests for the subagent transport's JSON-envelope parser (finding F5).
 *
 * parseDispatchPayload is the pure core of the transport: it turns the
 * `claude --print --output-format json` stdout envelope into rawText + real
 * token usage + real cost. We test it directly so we don't have to spawn a
 * process. The verified envelope sample matches the live CLI output captured
 * during the F5 investigation.
 */

import { describe, expect, it } from 'vitest'
import { parseDispatchPayload } from './claude-code-subagent.js'

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
})

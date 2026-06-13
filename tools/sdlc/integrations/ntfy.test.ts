import { describe, expect, it } from 'vitest'
import type { NtfyMessage } from './ntfy.js'
import { parseDispatchTrigger, requireWebhookToken } from './ntfy.js'

describe('requireWebhookToken (gh-12 — fail closed)', () => {
  it('refuses when SDLC_NTFY_TOKEN is unset', () => {
    const result = requireWebhookToken({})
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected err')
    expect(result.error.code).toBe('ntfy.webhook-token-missing')
    expect(result.error.fix).toContain('SDLC_NTFY_TOKEN')
  })

  it('refuses when SDLC_NTFY_TOKEN is empty', () => {
    const result = requireWebhookToken({ SDLC_NTFY_TOKEN: '' })
    expect(result.ok).toBe(false)
  })

  it('returns the token when set', () => {
    const result = requireWebhookToken({ SDLC_NTFY_TOKEN: 'tk_abc123' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.value).toBe('tk_abc123')
  })
})

describe('parseDispatchTrigger', () => {
  const base: Omit<NtfyMessage, 'message'> = {
    id: '1',
    time: 0,
    event: 'message',
    topic: 't',
  }

  it('parses a bare dispatch trigger', () => {
    expect(parseDispatchTrigger({ ...base, message: 'dispatch trip-research' })).toEqual({
      slug: 'trip-research',
    })
  })

  it('parses a dispatch trigger with --task', () => {
    expect(
      parseDispatchTrigger({ ...base, message: 'dispatch trip-research --task 3.2.2' }),
    ).toEqual({ slug: 'trip-research', taskId: '3.2.2' })
  })

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(parseDispatchTrigger({ ...base, message: '  DISPATCH foo  ' })).toEqual({ slug: 'foo' })
  })

  it('returns null for a non-dispatch message', () => {
    expect(parseDispatchTrigger({ ...base, message: 'hello world' })).toBeNull()
  })

  it('returns null when there is no message body', () => {
    expect(parseDispatchTrigger(base)).toBeNull()
  })
})

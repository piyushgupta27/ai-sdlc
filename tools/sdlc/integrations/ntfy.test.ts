import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NtfyMessage } from './ntfy.js'
import { notify, parseDispatchTrigger, requireWebhookToken, subscribe } from './ntfy.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

// ─── notify ──────────────────────────────────────────────────────────────────

describe('notify', () => {
  it('returns ok when server responds 2xx', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
    const result = await notify({ topic: 'my-topic' }, { title: 'T', message: 'Hello' })
    expect(result.ok).toBe(true)
  })

  it('returns err(ntfy.non-2xx) on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
    )
    const result = await notify({ topic: 'my-topic' }, { title: 'T', message: 'Hello' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected err')
    expect(result.error.code).toBe('ntfy.non-2xx')
  })

  it('returns err(ntfy.fetch-failed) when fetch throws', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    const result = await notify({ topic: 'my-topic' }, { title: 'T', message: 'Hello' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected err')
    expect(result.error.code).toBe('ntfy.fetch-failed')
  })

  it('sets Authorization: Bearer when token is provided', async () => {
    let capturedAuth: string | undefined
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedAuth = (init.headers as Record<string, string>).Authorization
      return new Response('{}', { status: 200 })
    })
    await notify({ topic: 'my-topic', token: 'secret' }, { title: 'T', message: 'Hello' })
    expect(capturedAuth).toBe('Bearer secret')
  })

  it('does not set Authorization header without a token', async () => {
    let capturedAuth: string | undefined
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedAuth = (init.headers as Record<string, string>).Authorization
      return new Response('{}', { status: 200 })
    })
    await notify({ topic: 'my-topic' }, { title: 'T', message: 'Hello' })
    expect(capturedAuth).toBeUndefined()
  })

  it('sets Priority, Click, and Tags headers from opts', async () => {
    let captured: Record<string, string> = {}
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = init.headers as Record<string, string>
      return new Response('{}', { status: 200 })
    })
    await notify(
      { topic: 'my-topic' },
      {
        title: 'T',
        message: 'Hello',
        priority: 5,
        clickUrl: 'https://example.com',
        tags: ['robot'],
      },
    )
    expect(captured.Priority).toBe('5')
    expect(captured.Click).toBe('https://example.com')
    expect(captured.Tags).toBe('robot')
  })
})

// ─── subscribe ───────────────────────────────────────────────────────────────

function makeStreamResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

describe('subscribe', () => {
  it('yields message events from the stream', async () => {
    const msg: NtfyMessage = { id: '1', time: 0, event: 'message', topic: 't', message: 'hello' }
    vi.stubGlobal('fetch', async () => makeStreamResponse([`${JSON.stringify(msg)}\n`]))
    const collected: NtfyMessage[] = []
    for await (const m of subscribe({ topic: 't' })) collected.push(m)
    expect(collected).toHaveLength(1)
    expect(collected[0].message).toBe('hello')
  })

  it('skips keepalive and open control events', async () => {
    const keepalive: NtfyMessage = { id: '2', time: 0, event: 'keepalive', topic: 't' }
    const msg: NtfyMessage = { id: '3', time: 0, event: 'message', topic: 't', message: 'hi' }
    vi.stubGlobal('fetch', async () =>
      makeStreamResponse([`${JSON.stringify(keepalive)}\n`, `${JSON.stringify(msg)}\n`]),
    )
    const collected: NtfyMessage[] = []
    for await (const m of subscribe({ topic: 't' })) collected.push(m)
    expect(collected).toHaveLength(1)
    expect(collected[0].id).toBe('3')
  })

  it('skips malformed JSON lines without throwing', async () => {
    const msg: NtfyMessage = { id: '1', time: 0, event: 'message', topic: 't', message: 'ok' }
    vi.stubGlobal('fetch', async () =>
      makeStreamResponse(['not-json\n', `${JSON.stringify(msg)}\n`]),
    )
    const collected: NtfyMessage[] = []
    for await (const m of subscribe({ topic: 't' })) collected.push(m)
    expect(collected).toHaveLength(1)
  })

  it('throws when subscribe response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('', { status: 401, statusText: 'Unauthorized' }),
    )
    const gen = subscribe({ topic: 't' })
    await expect(gen.next()).rejects.toThrow('ntfy.sh subscribe failed: 401')
  })

  it('sets Authorization: Bearer header when token is configured', async () => {
    let capturedAuth: string | undefined
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedAuth = (init.headers as Record<string, string>).Authorization
      return makeStreamResponse([])
    })
    const gen = subscribe({ topic: 't', token: 'tok123' })
    await gen.next()
    expect(capturedAuth).toBe('Bearer tok123')
  })

  it('skips empty lines in the stream', async () => {
    const msg: NtfyMessage = { id: '1', time: 0, event: 'message', topic: 't', message: 'ok' }
    vi.stubGlobal('fetch', async () => makeStreamResponse(['\n', '\n', `${JSON.stringify(msg)}\n`]))
    const collected: NtfyMessage[] = []
    for await (const m of subscribe({ topic: 't' })) collected.push(m)
    expect(collected).toHaveLength(1)
  })

  it('forwards AbortSignal to fetch', async () => {
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined
      return makeStreamResponse([])
    })
    const controller = new AbortController()
    const gen = subscribe({ topic: 't' }, controller.signal)
    await gen.next()
    expect(capturedSignal).toBe(controller.signal)
  })
})

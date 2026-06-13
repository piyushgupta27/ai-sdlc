/**
 * ntfy.sh integration — Q-AI-25 / R-AISDLC-104.
 *
 * Two directions:
 *   - OUTBOUND (notify): send a message to ntfy.sh/<topic> so the user's
 *     phone notification fires
 *   - INBOUND (subscribe): long-poll ntfy.sh/<topic>/json to receive
 *     dispatch triggers from anywhere
 *
 * No SDK; ntfy.sh is just HTTP. We use node fetch (available in Node 22+).
 *
 * Self-hosting note: ntfy.sh has free public hosting. For privacy-sensitive
 * setups, the user can self-host ntfy on their own domain; only the
 * baseUrl changes, no code change.
 */

import { type AppError, type Result, err, makeError, ok } from '../types/index.js'

const DEFAULT_BASE_URL = 'https://ntfy.sh'

export interface NtfyConfig {
  readonly baseUrl?: string
  readonly topic: string
  /** Bearer token if the topic is protected (self-hosted) */
  readonly token?: string
}

/**
 * Send a notification to the configured ntfy topic.
 *
 * Used by REPORTER + orchestrator for HITL gate pings:
 *   - "ai-sdlc · G2 REVIEW awaiting your input on trip-research/3.2.2"
 *   - "ai-sdlc · Merged: MMT search scraper (#47)"
 */
export interface NotifyOpts {
  readonly title: string
  readonly message: string
  /** Priority 1-5; 3 = default, 5 = urgent */
  readonly priority?: 1 | 2 | 3 | 4 | 5
  /** Optional URL to open when user taps the notification */
  readonly clickUrl?: string
  /** Tags rendered as emoji prefix (e.g. ["robot"] → 🤖) */
  readonly tags?: readonly string[]
}

export async function notify(
  config: NtfyConfig,
  opts: NotifyOpts,
): Promise<Result<void, AppError>> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const url = `${baseUrl}/${encodeURIComponent(config.topic)}`

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    Title: opts.title,
  }
  if (opts.priority) headers.Priority = String(opts.priority)
  if (opts.clickUrl) headers.Click = opts.clickUrl
  if (opts.tags && opts.tags.length > 0) headers.Tags = opts.tags.join(',')
  if (config.token) headers.Authorization = `Bearer ${config.token}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: opts.message,
    })
    if (!res.ok) {
      return err(
        makeError('ntfy.non-2xx', `ntfy.sh returned ${res.status} ${res.statusText}`, {
          cause: { url, status: res.status },
          fix: 'Check topic name + (if protected) token',
        }),
      )
    }
    return ok(undefined)
  } catch (cause) {
    return err(
      makeError('ntfy.fetch-failed', `Failed to POST to ntfy.sh: ${(cause as Error).message}`, {
        cause,
        fix: 'Check network connectivity + ntfy.sh availability',
      }),
    )
  }
}

const WEBHOOK_TOKEN_ENV = 'SDLC_NTFY_TOKEN'

/**
 * Resolve the ntfy auth token required for INBOUND webhook dispatch.
 *
 * Webhook mode is **fail-closed**: an inbound `dispatch <slug>` message can
 * launch the full pipeline, so the subscription MUST authenticate against a
 * token-protected (reserved/self-hosted) ntfy topic. A public, unauthenticated
 * topic is unsafe — anyone who learns its name can publish `dispatch <slug>`
 * and remotely trigger us. The Bearer token only buys real protection when the
 * topic's ACL restricts publishing to authenticated parties; on a public topic
 * a token would be theatre, so we don't pretend otherwise.
 *
 * Reads `SDLC_NTFY_TOKEN` (parallel to `SDLC_DASHBOARD_TOKEN`). If it's unset or
 * empty we refuse to subscribe — which also means `--webhook` is effectively
 * off by default until an operator deliberately configures a protected topic.
 * The secret is always explicit and operator-controlled; never auto-generated.
 */
export function requireWebhookToken(
  env: NodeJS.ProcessEnv = process.env,
): Result<string, AppError> {
  const token = env[WEBHOOK_TOKEN_ENV]
  if (!token || token.length === 0) {
    return err(
      makeError(
        'ntfy.webhook-token-missing',
        `${WEBHOOK_TOKEN_ENV} is not set — webhook dispatch is disabled without it.`,
        {
          fix: `Reserve/protect the ntfy topic so only authenticated clients can publish, then set ${WEBHOOK_TOKEN_ENV} to that access token (e.g. \`ntfy token add\`, or \`openssl rand -hex 32\` for a self-hosted topic). Never use a public topic for --webhook: anyone who knows its name could remotely trigger the pipeline.`,
        },
      ),
    )
  }
  return ok(token)
}

/**
 * Subscribe to a ntfy topic via long-polling JSON stream.
 *
 * Returns an async iterator that yields each incoming message.
 * Caller can break to stop subscribing.
 *
 * Used by the dispatch command's `--webhook` mode to listen for remote dispatch
 * triggers. The topic MUST be token-protected (see {@link requireWebhookToken});
 * the configured `token` rides the `Authorization: Bearer` header below so we
 * authenticate to the reserved topic:
 *   ntfy publish --token <tok> <protected-topic> "dispatch trip-research"
 */
export async function* subscribe(
  config: NtfyConfig,
  signal?: AbortSignal,
): AsyncGenerator<NtfyMessage, void, void> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const url = `${baseUrl}/${encodeURIComponent(config.topic)}/json`

  const headers: Record<string, string> = {}
  if (config.token) headers.Authorization = `Bearer ${config.token}`

  const res = await fetch(url, { headers, ...(signal ? { signal } : {}) })
  if (!res.ok || !res.body) {
    throw new Error(`ntfy.sh subscribe failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // ntfy streams newline-delimited JSON
    for (;;) {
      const nlIdx = buffer.indexOf('\n')
      if (nlIdx < 0) break
      const line = buffer.slice(0, nlIdx)
      buffer = buffer.slice(nlIdx + 1)
      if (line.length === 0) continue
      try {
        const msg = JSON.parse(line) as NtfyMessage
        // Only yield "message" events; "keepalive" and "open" are control frames
        if (msg.event === 'message') yield msg
      } catch {
        // Malformed line — skip
      }
    }
  }
}

export interface NtfyMessage {
  readonly id: string
  readonly time: number
  readonly event: 'message' | 'keepalive' | 'open' | 'poll_request'
  readonly topic: string
  readonly message?: string
  readonly title?: string
  readonly tags?: readonly string[]
  readonly priority?: number
}

/**
 * Parse a dispatch trigger from a ntfy message body.
 *
 * Convention: messages of the form `dispatch <slug>` or `dispatch <slug> --task <id>`
 * are interpreted as orchestrator triggers.
 *
 * Returns null if the message isn't a dispatch trigger.
 */
export function parseDispatchTrigger(
  msg: NtfyMessage,
): { readonly slug: string; readonly taskId?: string } | null {
  if (!msg.message) return null
  const match = msg.message.trim().match(/^dispatch\s+(\S+)(?:\s+--task\s+(\S+))?\s*$/i)
  if (!match) return null
  return match[2] ? { slug: match[1] as string, taskId: match[2] } : { slug: match[1] as string }
}

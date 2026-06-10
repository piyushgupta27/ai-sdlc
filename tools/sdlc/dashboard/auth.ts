/**
 * Dashboard auth — CSRF + bearer-token protection for state-changing requests.
 *
 * Threat model (v1, localhost-only): the dashboard binds to 127.0.0.1, but the
 * gate-response endpoint (`POST /api/queue/<id>`) is still reachable from the
 * user's own browser — so any malicious page open in another tab could forge an
 * approval via a cross-site POST (the OpenClaw CVE-2026-25253 class). Two
 * independent defenses close it:
 *
 *   1. Origin check — reject a POST whose `Origin` doesn't match the dashboard's
 *      own host. Kills the classic cross-site form/fetch attack outright.
 *   2. Token check — the request must carry a secret the attacker can't read.
 *      Browsers can't set headers on a plain form POST, so the token rides a
 *      hidden form field (`csrfToken`) the server injects into pages it renders;
 *      a cross-origin attacker can't read that page (same-origin policy), so it
 *      can't include the token. Programmatic callers (future ntfy actions) send
 *      it as `Authorization: Bearer <token>` instead.
 *
 * The token is required: `SDLC_DASHBOARD_TOKEN` must be set (generate it once
 * with `openssl rand -hex 32`). The server refuses to start without it — the
 * secret is always explicit and stable, never auto-generated or committed.
 *
 * Phase 2 (when the dashboard is exposed beyond localhost): layer "Sign in with
 * Google" (OIDC) on top for real authentication; this module stays as the CSRF
 * defense underneath.
 */

import { timingSafeEqual } from 'node:crypto'

let cachedToken: string | undefined

/**
 * The dashboard's CSRF/auth token (memoized). Reads `SDLC_DASHBOARD_TOKEN` and
 * throws if it's unset — the token is required and never auto-generated, so the
 * secret is always an explicit, stable value the operator controls.
 */
export function getDashboardToken(): string {
  if (cachedToken) return cachedToken
  const fromEnv = process.env.SDLC_DASHBOARD_TOKEN
  if (!fromEnv || fromEnv.length === 0) {
    throw new Error(
      'SDLC_DASHBOARD_TOKEN is not set — the dashboard requires it to authenticate gate ' +
        'responses. Generate one with `openssl rand -hex 32` and supply it via the environment ' +
        '(never commit it).',
    )
  }
  cachedToken = fromEnv
  return cachedToken
}

/** Reset the memoized token — test-only seam. */
export function resetDashboardTokenForTest(): void {
  cachedToken = undefined
}

/**
 * Constant-time token comparison. Returns false on missing/length-mismatch
 * without throwing (Node's `timingSafeEqual` throws on unequal lengths).
 */
export function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Same-origin check. An absent `Origin` header is allowed (non-browser clients
 * like curl/ntfy don't send one — they're gated by the token instead); a present
 * `Origin` must match the `Host` the request came in on.
 */
export function isSameOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined,
): boolean {
  if (!originHeader) return true
  if (!hostHeader) return false
  try {
    return new URL(originHeader).host === hostHeader
  } catch {
    return false
  }
}

/** Pull a bearer token from an `Authorization` header, if present. */
export function bearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader?.startsWith('Bearer ')) return undefined
  const t = authHeader.slice('Bearer '.length).trim()
  return t.length > 0 ? t : undefined
}

/** Verdict for a state-changing request. */
export type AuthVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Authorize a state-changing dashboard request: same-origin AND a valid token
 * (from the `Authorization: Bearer` header or the `csrfToken` form field).
 */
export function authorizeMutation(input: {
  readonly originHeader: string | undefined
  readonly hostHeader: string | undefined
  readonly authHeader: string | undefined
  readonly bodyToken: string | undefined
}): AuthVerdict {
  if (!isSameOrigin(input.originHeader, input.hostHeader)) {
    return { ok: false, reason: 'cross-origin request rejected' }
  }
  const provided = bearerToken(input.authHeader) ?? input.bodyToken
  if (!tokensMatch(provided, getDashboardToken())) {
    return { ok: false, reason: 'missing or invalid CSRF/auth token' }
  }
  return { ok: true }
}

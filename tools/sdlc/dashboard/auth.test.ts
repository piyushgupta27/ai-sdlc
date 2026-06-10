import { afterEach, describe, expect, it } from 'vitest'
import {
  authorizeMutation,
  bearerToken,
  getDashboardToken,
  isSameOrigin,
  resetDashboardTokenForTest,
  tokensMatch,
} from './auth.js'

const TOKEN = 'test-token-abcdef0123456789'

function withToken(t: string): void {
  process.env.SDLC_DASHBOARD_TOKEN = t
  resetDashboardTokenForTest()
}

afterEach(() => {
  process.env.SDLC_DASHBOARD_TOKEN = ''
  resetDashboardTokenForTest()
})

describe('tokensMatch', () => {
  it('true for identical tokens', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true)
  })
  it('false for different tokens of equal length', () => {
    expect(tokensMatch('x'.repeat(TOKEN.length), TOKEN)).toBe(false)
  })
  it('false for length mismatch (must not throw)', () => {
    expect(tokensMatch('short', TOKEN)).toBe(false)
  })
  it('false for undefined / empty', () => {
    expect(tokensMatch(undefined, TOKEN)).toBe(false)
    expect(tokensMatch('', TOKEN)).toBe(false)
  })
})

describe('isSameOrigin', () => {
  it('allows an absent Origin (non-browser client like ntfy/curl)', () => {
    expect(isSameOrigin(undefined, '127.0.0.1:3001')).toBe(true)
  })
  it('allows a matching Origin/Host', () => {
    expect(isSameOrigin('http://127.0.0.1:3001', '127.0.0.1:3001')).toBe(true)
  })
  it('rejects a cross-origin request', () => {
    expect(isSameOrigin('https://evil.example', '127.0.0.1:3001')).toBe(false)
  })
  it('rejects when Host is missing but Origin is present', () => {
    expect(isSameOrigin('http://127.0.0.1:3001', undefined)).toBe(false)
  })
  it('rejects a malformed Origin', () => {
    expect(isSameOrigin('not-a-url', '127.0.0.1:3001')).toBe(false)
  })
})

describe('bearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123')
  })
  it('returns undefined for non-Bearer / empty / missing', () => {
    expect(bearerToken('Basic abc')).toBeUndefined()
    expect(bearerToken('Bearer ')).toBeUndefined()
    expect(bearerToken(undefined)).toBeUndefined()
  })
})

describe('getDashboardToken', () => {
  it('returns the env token when set', () => {
    withToken(TOKEN)
    expect(getDashboardToken()).toBe(TOKEN)
  })
  it('throws when the env var is unset (required, never auto-generated)', () => {
    process.env.SDLC_DASHBOARD_TOKEN = ''
    resetDashboardTokenForTest()
    expect(() => getDashboardToken()).toThrow(/SDLC_DASHBOARD_TOKEN/)
  })
})

describe('authorizeMutation', () => {
  it('allows a same-origin form POST with the matching csrfToken field', () => {
    withToken(TOKEN)
    expect(
      authorizeMutation({
        originHeader: 'http://127.0.0.1:3001',
        hostHeader: '127.0.0.1:3001',
        authHeader: undefined,
        bodyToken: TOKEN,
      }).ok,
    ).toBe(true)
  })
  it('allows a programmatic call with the matching Bearer header', () => {
    withToken(TOKEN)
    expect(
      authorizeMutation({
        originHeader: undefined,
        hostHeader: '127.0.0.1:3001',
        authHeader: `Bearer ${TOKEN}`,
        bodyToken: undefined,
      }).ok,
    ).toBe(true)
  })
  it('rejects a cross-origin request even with a valid token', () => {
    withToken(TOKEN)
    expect(
      authorizeMutation({
        originHeader: 'https://evil.example',
        hostHeader: '127.0.0.1:3001',
        authHeader: undefined,
        bodyToken: TOKEN,
      }).ok,
    ).toBe(false)
  })
  it('rejects a missing token', () => {
    withToken(TOKEN)
    expect(
      authorizeMutation({
        originHeader: 'http://127.0.0.1:3001',
        hostHeader: '127.0.0.1:3001',
        authHeader: undefined,
        bodyToken: undefined,
      }).ok,
    ).toBe(false)
  })
  it('rejects a wrong token', () => {
    withToken(TOKEN)
    expect(
      authorizeMutation({
        originHeader: 'http://127.0.0.1:3001',
        hostHeader: '127.0.0.1:3001',
        authHeader: undefined,
        bodyToken: 'wrong'.padEnd(TOKEN.length, 'x'),
      }).ok,
    ).toBe(false)
  })
})

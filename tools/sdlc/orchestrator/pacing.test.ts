import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuditRow } from '../types/index.js'
import {
  DEFAULT_ACTIVE_CAP_FRACTION,
  DEFAULT_OFF_CAP_FRACTION,
  DEFAULT_TIER_TOKEN_ESTIMATE,
  DEFAULT_WINDOW_TOKEN_BUDGET,
  activeCapFraction,
  capFractionNow,
  checkPacing,
  checkRevertRate,
  computeReworkStats,
  estimateTaskTokens,
  inActiveWindow,
  istHour,
  offCapFraction,
  parseRateLimitStatus,
  rateLimitTrips,
  revertRateThreshold,
  rowTokens,
  sumWindowTokensInRepos,
  windowDates,
  windowTokenBudget,
} from './pacing.js'

afterEach(() => {
  for (const k of [
    'SDLC_WINDOW_TOKEN_BUDGET',
    'SDLC_PACING_CAP_ACTIVE',
    'SDLC_PACING_CAP_OFF',
    'SDLC_REVERT_RATE_THRESHOLD',
    'SDLC_TIER_TOKEN_ESTIMATES',
  ]) {
    process.env[k] = ''
  }
})

// ─── config getters ──────────────────────────────────────────────────────────

describe('config getters', () => {
  it('default + override + invalid for the window budget', () => {
    process.env.SDLC_WINDOW_TOKEN_BUDGET = ''
    expect(windowTokenBudget()).toBe(DEFAULT_WINDOW_TOKEN_BUDGET)
    process.env.SDLC_WINDOW_TOKEN_BUDGET = '5000000'
    expect(windowTokenBudget()).toBe(5_000_000)
    process.env.SDLC_WINDOW_TOKEN_BUDGET = 'nope'
    expect(windowTokenBudget()).toBe(DEFAULT_WINDOW_TOKEN_BUDGET)
    process.env.SDLC_WINDOW_TOKEN_BUDGET = '-1'
    expect(windowTokenBudget()).toBe(DEFAULT_WINDOW_TOKEN_BUDGET)
  })

  it('reads cap fractions and revert threshold', () => {
    expect(activeCapFraction()).toBe(DEFAULT_ACTIVE_CAP_FRACTION)
    expect(offCapFraction()).toBe(DEFAULT_OFF_CAP_FRACTION)
    expect(revertRateThreshold()).toBe(0.1)
    process.env.SDLC_PACING_CAP_ACTIVE = '0.6'
    process.env.SDLC_PACING_CAP_OFF = '0.95'
    process.env.SDLC_REVERT_RATE_THRESHOLD = '0.05'
    expect(activeCapFraction()).toBe(0.6)
    expect(offCapFraction()).toBe(0.95)
    expect(revertRateThreshold()).toBe(0.05)
  })

  it('estimateTaskTokens uses the tier table and a JSON override', () => {
    expect(estimateTaskTokens(1)).toBe(DEFAULT_TIER_TOKEN_ESTIMATE[1])
    expect(estimateTaskTokens(4)).toBe(DEFAULT_TIER_TOKEN_ESTIMATE[4])
    // Tiered, not static: a tier-1 Opus task estimates far above a tier-4 Haiku one.
    expect(estimateTaskTokens(1)).toBeGreaterThan(estimateTaskTokens(4))
    process.env.SDLC_TIER_TOKEN_ESTIMATES = JSON.stringify({ 1: 9_000_000 })
    expect(estimateTaskTokens(1)).toBe(9_000_000)
    expect(estimateTaskTokens(4)).toBe(DEFAULT_TIER_TOKEN_ESTIMATE[4]) // unspecified → default
  })

  it('estimateTaskTokens falls back to the table on malformed override JSON', () => {
    process.env.SDLC_TIER_TOKEN_ESTIMATES = '{not json'
    expect(estimateTaskTokens(2)).toBe(DEFAULT_TIER_TOKEN_ESTIMATE[2])
  })
})

// ─── time-aware cap ──────────────────────────────────────────────────────────

describe('time-aware cap (IST 18:00–02:00 active window)', () => {
  it('converts UTC to IST hour (UTC+5:30)', () => {
    expect(istHour(new Date('2026-06-13T00:00:00Z'))).toBeCloseTo(5.5) // 05:30 IST
    expect(istHour(new Date('2026-06-13T12:30:00Z'))).toBeCloseTo(18.0) // 18:00 IST
  })

  it('is active during 18:00–02:00 IST and off otherwise', () => {
    // 12:30Z = 18:00 IST → active (start, inclusive)
    expect(inActiveWindow(new Date('2026-06-13T12:30:00Z'))).toBe(true)
    // 20:00Z = 01:30 IST → active (wraps past midnight)
    expect(inActiveWindow(new Date('2026-06-13T20:00:00Z'))).toBe(true)
    // 21:00Z = 02:30 IST → off
    expect(inActiveWindow(new Date('2026-06-13T21:00:00Z'))).toBe(false)
    // 06:00Z = 11:30 IST → off (owner inactive, daytime)
    expect(inActiveWindow(new Date('2026-06-13T06:00:00Z'))).toBe(false)
  })

  it('caps lower while active, higher while off', () => {
    expect(capFractionNow(new Date('2026-06-13T13:00:00Z'))).toBe(DEFAULT_ACTIVE_CAP_FRACTION) // 18:30 IST
    expect(capFractionNow(new Date('2026-06-13T06:00:00Z'))).toBe(DEFAULT_OFF_CAP_FRACTION) // 11:30 IST
  })
})

// ─── pure pacing decision ────────────────────────────────────────────────────

describe('checkPacing', () => {
  it('allows when projected spend stays under the cap', () => {
    // budget 100, cap 70%, spent 40 + est 20 = 60 ≤ 70
    expect(checkPacing(40, 20, 100, 0.7, true).action).toBe('allow')
  })

  it('pauses BEFORE the overrun (never rate-limited mid-task)', () => {
    // spent 60 + est 20 = 80 > 70 → pause before starting
    const d = checkPacing(60, 20, 100, 0.7, true)
    expect(d.action).toBe('pause')
    expect(d.capTokens).toBe(70)
    expect(d.projectedPct).toBeCloseTo(0.8)
  })

  it('off-window allows closer to the limit', () => {
    // same spend, but off-window cap 92% → 80 ≤ 92 allows
    expect(checkPacing(60, 20, 100, 0.92, false).action).toBe('allow')
  })

  it('never pauses with a non-positive budget (unset/unlimited)', () => {
    expect(checkPacing(9_999, 9_999, 0, 0.7, true).action).toBe('allow')
  })
})

// ─── rolling-window token accounting ─────────────────────────────────────────

describe('rowTokens', () => {
  it('sums input + output + cache I/O, tolerating missing fields', () => {
    expect(rowTokens({ tokens: { promptInput: 10, promptOutput: 5 } } as AuditRow)).toBe(15)
    expect(
      rowTokens({
        tokens: { promptInput: 10, promptOutput: 5, cacheRead: 2, cacheWrite: 3 },
      } as AuditRow),
    ).toBe(20)
  })
})

describe('windowDates', () => {
  it('returns one bucket when the window does not cross UTC midnight', () => {
    expect(windowDates(new Date('2026-06-13T12:00:00Z'))).toEqual(['2026-06-13'])
  })
  it('returns two buckets when it straddles UTC midnight', () => {
    const dates = windowDates(new Date('2026-06-13T02:00:00Z')) // cutoff 2026-06-12T21:00Z
    expect(new Set(dates)).toEqual(new Set(['2026-06-12', '2026-06-13']))
  })
})

describe('sumWindowTokensInRepos', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true })
    dirs.length = 0
  })

  async function seedRepo(
    rows: Array<{ date: string; ts: string; tokens: AuditRow['tokens'] }>,
  ): Promise<string> {
    const repo = await mkdtemp(join(tmpdir(), 'sdlc-pacing-'))
    dirs.push(repo)
    for (const { date, ts, tokens } of rows) {
      const dir = join(repo, '.audit', date)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'audit.jsonl'), `${JSON.stringify({ ts, tokens })}\n`, {
        flag: 'a',
      })
    }
    return repo
  }

  it('sums only rows within the rolling 5h window', async () => {
    const now = new Date('2026-06-13T12:00:00Z')
    const repo = await seedRepo([
      // inside window (within 5h before 12:00Z)
      {
        date: '2026-06-13',
        ts: '2026-06-13T11:00:00Z',
        tokens: { promptInput: 100, promptOutput: 50 },
      },
      {
        date: '2026-06-13',
        ts: '2026-06-13T08:00:00Z',
        tokens: { promptInput: 10, promptOutput: 5 },
      },
      // outside window (>5h old)
      {
        date: '2026-06-13',
        ts: '2026-06-13T06:00:00Z',
        tokens: { promptInput: 999, promptOutput: 999 },
      },
    ])
    const r = await sumWindowTokensInRepos([repo], now)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe(165) // 150 + 15, excluding the 06:00 row
  })

  it('reads across both UTC buckets when the window crosses midnight', async () => {
    const now = new Date('2026-06-13T02:00:00Z') // cutoff 2026-06-12T21:00Z
    const repo = await seedRepo([
      {
        date: '2026-06-12',
        ts: '2026-06-12T23:00:00Z',
        tokens: { promptInput: 100, promptOutput: 0 },
      },
      {
        date: '2026-06-13',
        ts: '2026-06-13T01:00:00Z',
        tokens: { promptInput: 200, promptOutput: 0 },
      },
      {
        date: '2026-06-12',
        ts: '2026-06-12T20:00:00Z',
        tokens: { promptInput: 999, promptOutput: 0 },
      }, // too old
    ])
    const r = await sumWindowTokensInRepos([repo], now)
    expect(r.ok && r.value).toBe(300)
  })

  it('returns 0 when a repo has no .audit dir', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'sdlc-pacing-'))
    dirs.push(empty)
    const r = await sumWindowTokensInRepos([empty], new Date('2026-06-13T12:00:00Z'))
    expect(r.ok && r.value).toBe(0)
  })
})

// ─── rework / revert-rate trip ───────────────────────────────────────────────

describe('checkRevertRate', () => {
  it('allows at/under the threshold', () => {
    expect(checkRevertRate(1, 10, 0.1).action).toBe('allow') // exactly 10%, not > 10%
  })
  it('pauses strictly above the threshold', () => {
    expect(checkRevertRate(2, 10, 0.1).action).toBe('pause') // 20% > 10%
  })
  it('does not trip below the minimum sample (noise guard)', () => {
    expect(checkRevertRate(1, 1, 0.1).action).toBe('allow') // 100% but only 1 task
    expect(checkRevertRate(1, 1, 0.1, 1).action).toBe('pause') // minSample lowered
  })
})

describe('computeReworkStats', () => {
  const row = (taskId: string, outcome: AuditRow['outcome']): AuditRow =>
    ({ taskId, outcome }) as AuditRow

  it('counts distinct tasks reworked via failure or quality-escalation', () => {
    const rows = [
      row('gh-1', 'success'),
      row('gh-2', 'failure'),
      row('gh-2', 'success'), // gh-2 still counts as reworked (had a failure)
      row('gh-3', 'escalated'), // CHECKER quality-failure escalation → rework
      row('orchestrator', 'failure'), // ignored
    ]
    expect(computeReworkStats(rows)).toEqual({ reworked: 2, total: 3 })
  })

  it('does NOT count routine gating (success) or self-healed refires (partial)', () => {
    // A clean Tier-1 task that the trust ladder routes to HITL writes a `success`
    // CHECK row — normal gating must not register as rework.
    const rows = [
      row('gh-1', 'success'), // routine trust-gated clean work
      row('gh-2', 'partial'), // refire that self-healed
      row('gh-3', 'success'),
    ]
    expect(computeReworkStats(rows)).toEqual({ reworked: 0, total: 3 })
  })

  it('is empty when there are no task rows', () => {
    expect(computeReworkStats([row('orchestrator', 'success')])).toEqual({ reworked: 0, total: 0 })
  })
})

// ─── categorical rate-limit signal ───────────────────────────────────────────

describe('parseRateLimitStatus', () => {
  const event = (status: string, type = 'five_hour') =>
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status, rateLimitType: type, resetsAt: 1781351400, isUsingOverage: false },
    })

  it('extracts the last rate_limit_event from a stream-json stdout', () => {
    const stdout = [
      JSON.stringify({ type: 'system' }),
      event('allowed_warning'),
      JSON.stringify({ type: 'assistant', message: {} }),
      event('rejected'), // last one wins
      JSON.stringify({ type: 'result', result: 'ok' }),
    ].join('\n')
    const s = parseRateLimitStatus(stdout)
    expect(s?.status).toBe('rejected')
    expect(s?.rateLimitType).toBe('five_hour')
    expect(s?.resetsAt).toBe(1781351400)
  })

  it('returns null when no rate_limit_event is present', () => {
    expect(parseRateLimitStatus(JSON.stringify({ type: 'result', result: 'ok' }))).toBeNull()
  })

  it('tolerates malformed lines', () => {
    const stdout = `not json\n${event('allowed')}\n{partial`
    expect(parseRateLimitStatus(stdout)?.status).toBe('allowed')
  })

  it('skips lines that mention "rate_limit_event" but are not valid JSON', () => {
    // Passes the includes() guard but JSON.parse throws → catch { continue } (lines 348-350)
    const stdout = `this line has rate_limit_event text but is not json\n${event('allowed')}`
    expect(parseRateLimitStatus(stdout)?.status).toBe('allowed')
  })
})

describe('rateLimitTrips', () => {
  it('only allows continued dispatch when status is exactly "allowed"', () => {
    expect(rateLimitTrips({ status: 'allowed' })).toBe(false)
    expect(rateLimitTrips({ status: 'allowed_warning' })).toBe(true)
    expect(rateLimitTrips({ status: 'rejected' })).toBe(true)
    expect(rateLimitTrips(null)).toBe(false) // no signal → don't block on absence
  })
})

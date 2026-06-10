import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MONTHLY_BUDGET_USD,
  checkBudget,
  monthPrefix,
  monthlyBudgetUsd,
  sumSpendInRepos,
} from './budget.js'

afterEach(() => {
  process.env.SDLC_MONTHLY_BUDGET_USD = ''
})

describe('monthlyBudgetUsd', () => {
  it('defaults to 100 when unset', () => {
    process.env.SDLC_MONTHLY_BUDGET_USD = ''
    expect(monthlyBudgetUsd()).toBe(DEFAULT_MONTHLY_BUDGET_USD)
  })
  it('reads a valid override', () => {
    process.env.SDLC_MONTHLY_BUDGET_USD = '250'
    expect(monthlyBudgetUsd()).toBe(250)
  })
  it('falls back to default on invalid or non-positive values', () => {
    process.env.SDLC_MONTHLY_BUDGET_USD = 'abc'
    expect(monthlyBudgetUsd()).toBe(100)
    process.env.SDLC_MONTHLY_BUDGET_USD = '-5'
    expect(monthlyBudgetUsd()).toBe(100)
  })
})

describe('monthPrefix', () => {
  it('formats YYYY-MM in UTC', () => {
    expect(monthPrefix(new Date('2026-06-10T23:59:00Z'))).toBe('2026-06')
  })
})

describe('checkBudget', () => {
  it('allows below the threshold', () => {
    expect(checkBudget(84, 100, 0.85).action).toBe('allow')
  })
  it('pauses at the threshold', () => {
    expect(checkBudget(85, 100, 0.85).action).toBe('pause')
  })
  it('pauses over the threshold', () => {
    expect(checkBudget(120, 100, 0.85).action).toBe('pause')
  })
  it('never pauses with a non-positive budget (treated as unset)', () => {
    expect(checkBudget(999, 0, 0.85).action).toBe('allow')
  })
  it('reports pct = spent / budget', () => {
    expect(checkBudget(50, 100, 0.85).pct).toBeCloseTo(0.5)
  })
})

describe('sumSpendInRepos', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true })
    dirs.length = 0
  })

  async function seedRepo(rows: Array<{ date: string; costUsd: number }>): Promise<string> {
    const repo = await mkdtemp(join(tmpdir(), 'sdlc-budget-'))
    dirs.push(repo)
    for (const { date, costUsd } of rows) {
      const dir = join(repo, '.audit', date)
      await mkdir(dir, { recursive: true })
      // readDailyRows only needs valid JSON per line; a minimal row suffices.
      await writeFile(join(dir, 'audit.jsonl'), `${JSON.stringify({ costUsd })}\n`, { flag: 'a' })
    }
    return repo
  }

  it('sums costUsd across repos for the target month only', async () => {
    const a = await seedRepo([
      { date: '2026-06-03', costUsd: 1.5 },
      { date: '2026-06-20', costUsd: 2.0 },
      { date: '2026-05-30', costUsd: 9.9 }, // different month — excluded
    ])
    const b = await seedRepo([{ date: '2026-06-10', costUsd: 0.5 }])
    const r = await sumSpendInRepos([a, b], '2026-06')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBeCloseTo(4.0) // 1.5 + 2.0 + 0.5
  })

  it('returns 0 when a repo has no .audit dir', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'sdlc-budget-'))
    dirs.push(empty)
    const r = await sumSpendInRepos([empty], '2026-06')
    expect(r.ok && r.value).toBe(0)
  })
})

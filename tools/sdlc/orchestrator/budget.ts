/**
 * Monthly soft-budget guard (IMP-14).
 *
 * From 2026-06-15, `claude -p` dispatch draws from a fixed ~$100/mo Agent-SDK
 * credit pool shared across ALL projects. A runaway retry loop over a weekend
 * could drain it silently. This guard aggregates the current UTC month's spend
 * from every project's audit log and, at ≥85% of the cap, pauses NEW dispatch
 * (in-flight tasks finish) and fires an ntfy push.
 *
 * Scope is GLOBAL: the pool is shared, and audit rows live per-target-repo
 * (`<repoPath>/.audit/<YYYY-MM-DD>/audit.jsonl`), so we sum across all repos.
 *
 * The cap is operator-set via `SDLC_MONTHLY_BUDGET_USD` (default 100) — a global
 * env var rather than per-project config, matching the shared pool. Accuracy
 * depends on the transport logging real cost (GH#30 fix, PR #54): a CLI that
 * omits cost now falls back to a token estimate instead of logging $0.
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { notify } from '../integrations/ntfy.js'
import { type AppError, type ProjectSlug, type Result, tryAsync } from '../types/index.js'
import { readDailyRows } from './audit-log.js'
import { listProjects, projectDir } from './state.js'

/** Default monthly cap (USD) — the Max-5x Agent-SDK pool. */
export const DEFAULT_MONTHLY_BUDGET_USD = 100

/** Pause new dispatch once spend reaches this fraction of the cap. */
export const PAUSE_THRESHOLD = 0.85

/** Operator-set monthly budget (USD). Override with `SDLC_MONTHLY_BUDGET_USD`. */
export function monthlyBudgetUsd(): number {
  const raw = process.env.SDLC_MONTHLY_BUDGET_USD
  if (raw === undefined || raw === '') return DEFAULT_MONTHLY_BUDGET_USD
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONTHLY_BUDGET_USD
}

/** "YYYY-MM" for a date, UTC — matches the `.audit/<YYYY-MM-DD>` bucket prefix. */
export function monthPrefix(now: Date): string {
  return now.toISOString().slice(0, 7)
}

export interface BudgetDecision {
  readonly action: 'allow' | 'pause'
  readonly spentUsd: number
  readonly budgetUsd: number
  /** spent / budget (0..1+). */
  readonly pct: number
}

/**
 * Pure decision: pause once spend reaches `threshold` × budget. A non-positive
 * budget never pauses (treated as "unset / unlimited").
 */
export function checkBudget(
  spentUsd: number,
  budgetUsd: number,
  threshold: number,
): BudgetDecision {
  const pct = budgetUsd > 0 ? spentUsd / budgetUsd : 0
  return { action: budgetUsd > 0 && pct >= threshold ? 'pause' : 'allow', spentUsd, budgetUsd, pct }
}

/**
 * Sum `costUsd` across the given target repos' audit rows for one UTC month.
 * Testable core (no dependency on the global `projects/` dir). Missing `.audit`
 * dirs and unreadable days are skipped, not fatal.
 */
export async function sumSpendInRepos(
  repoPaths: readonly string[],
  month: string, // "YYYY-MM"
): Promise<Result<number, AppError>> {
  return tryAsync('budget.sum-repos', async () => {
    let total = 0
    for (const repoPath of repoPaths) {
      const auditDir = join(repoPath, '.audit')
      if (!existsSync(auditDir)) continue
      const days = await readdir(auditDir)
      for (const day of days) {
        if (!day.startsWith(month)) continue // YYYY-MM-* day directories
        const rows = await readDailyRows(repoPath, day)
        if (!rows.ok) continue
        for (const row of rows.value) total += row.costUsd
      }
    }
    return total
  })
}

/** Read a project's target repo path from its `config.json`. */
async function repoPathOf(slug: ProjectSlug): Promise<string | null> {
  const cfgPath = join(projectDir(slug), 'config.json')
  if (!existsSync(cfgPath)) return null
  try {
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as { repoPath?: string }
    return cfg.repoPath ?? null
  } catch {
    return null
  }
}

/** Sum spend across ALL onboarded projects for the given month's UTC bucket. */
export async function sumMonthlySpend(now: Date): Promise<Result<number, AppError>> {
  const projects = await listProjects()
  if (!projects.ok) return projects
  const repoPaths: string[] = []
  for (const slug of projects.value) {
    const repoPath = await repoPathOf(slug)
    if (repoPath) repoPaths.push(repoPath)
  }
  return sumSpendInRepos(repoPaths, monthPrefix(now))
}

/**
 * Pre-dispatch budget gate. Aggregates this month's spend; if at/over the pause
 * threshold, fires an ntfy push (when a topic is configured) and returns a
 * `pause` decision so the caller refuses the dispatch. Fail-OPEN: an aggregation
 * error allows dispatch (a transient FS issue must not wedge the pipeline) — the
 * error is surfaced on stderr.
 */
export async function budgetGate(
  now: Date,
  webhookTopic: string | undefined,
): Promise<BudgetDecision> {
  const budget = monthlyBudgetUsd()
  const spend = await sumMonthlySpend(now)
  if (!spend.ok) {
    process.stderr.write(
      `(budget guard: spend aggregation failed, allowing — ${spend.error.message})\n`,
    )
    return { action: 'allow', spentUsd: 0, budgetUsd: budget, pct: 0 }
  }
  const decision = checkBudget(spend.value, budget, PAUSE_THRESHOLD)
  if (decision.action === 'pause' && webhookTopic) {
    await notify(
      { topic: webhookTopic },
      {
        title: 'ai-sdlc · budget guard — dispatch paused',
        message: `Monthly spend $${decision.spentUsd.toFixed(2)} / $${budget} (${Math.round(decision.pct * 100)}%) ≥ ${Math.round(PAUSE_THRESHOLD * 100)}%. New dispatch paused; in-flight finishes. Raise SDLC_MONTHLY_BUDGET_USD or wait for next month.`,
        priority: 5,
        tags: ['money_with_wings', 'no_entry'],
      },
    )
  }
  return decision
}

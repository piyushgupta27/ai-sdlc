/**
 * Usage-window-aware pacing brake (gh-87).
 *
 * The plan backing `claude -p` dispatch is a **rate-limited subscription**
 * (token quota per rolling 5h window + a weekly cap), NOT a dollar pool. So the
 * brake here is *usage-window-aware*, complementing the dollar-metered monthly
 * guard in `budget.ts` (IMP-14). Both gate NEW dispatch; in-flight tasks finish.
 *
 * ## Determination — preferred vs fallback (the task's "first task")
 *
 * The design offered a PREFERRED path (pace to a numeric 5h session-quota %, if
 * that % is deterministically readable from the dispatch context) and a FALLBACK
 * (estimate per-task token cost by tier + a configurable cap). Which applies was
 * decided by direct inspection of the transport:
 *
 *   - The numeric quota % (`rate_limits.five_hour.used_percentage`) is only piped
 *     to the **interactive** status-line command (what ccstatusline renders); the
 *     orchestrator dispatches **headless** (`claude --print --output-format
 *     stream-json`) and never receives that stdin.
 *   - The headless stream DOES emit a `rate_limit_event`, but it carries only a
 *     CATEGORICAL `status` (`allowed` / warning / `rejected`) + `resetsAt` +
 *     `rateLimitType` — NOT a numeric percentage (verified by running the exact
 *     transport command).
 *
 * Therefore the numeric quota % is **not deterministically fetchable from the
 * dispatch context → FALLBACK** drives the cap: a per-tier token estimate against
 * a configurable, time-aware windowed budget. The categorical signal is still
 * deterministic and useful, so `parseRateLimitStatus` makes it consumable as a
 * hard backstop; wiring it into the dispatch loop lives in the Red-zone transport
 * (`router/claude-code-subagent.ts`) and is tracked as follow-up.
 *
 * ## What this module provides
 *
 *   - Time-aware cap: a lower fraction of the window budget during the owner's
 *     active window (18:00–02:00 IST — leaves headroom for personal Claude work),
 *     a higher fraction outside it.
 *   - Rolling 5h windowed token accounting from the audit log.
 *   - Per-tier token estimate (tier-1 Opus ≫ tier-4 Haiku — not a static number).
 *   - Pre-dispatch pacing gate: pause when `windowSpent + estimate > cap`, so a
 *     task is never STARTED into a window it would overrun ("never rate-limited
 *     mid-task").
 *   - Rework/revert-rate trip: auto-pause once the recent rework rate exceeds the
 *     threshold (>10% by default).
 *
 * Every cap is operator-set via env (the "cap is config + easily changed" AC) and
 * the defaults are estimates to be revised per the design's "revise the cap if we
 * hit the rate limit earlier than estimated" rule.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { notify } from '../integrations/ntfy.js'
import {
  type AppError,
  type AuditRow,
  type ProjectSlug,
  type Result,
  type Tier,
  tryAsync,
} from '../types/index.js'
import { readDailyRows } from './audit-log.js'
import { listProjects, projectDir } from './state.js'

// ─── config (all operator-overridable via env) ──────────────────────────────

/**
 * Default rolling-window token budget. This is the platform's ESTIMATE of the
 * usable token allowance in one 5h window — there is no API that returns the real
 * Max-plan quota, so this is a placeholder to be tuned: if dispatch hits the rate
 * limit before the brake pauses, LOWER this (the design's "revise the cap if we
 * hit the rate limit earlier than estimated"). Override: `SDLC_WINDOW_TOKEN_BUDGET`
 * or per-project `sdlc_window_token_budget` in config.json.
 *
 * Raised from 20M to 30M to better serve solo AI testbed projects that run
 * denser per-session token usage than the original team-sized calibration.
 */
export const DEFAULT_WINDOW_TOKEN_BUDGET = 30_000_000

/**
 * Warning threshold: fraction of the effective cap (capTokens) at which dispatch
 * emits an approaching-limit warning. Fires before the hard pause so operators
 * can act (raise the budget or defer lower-priority tasks) before dispatch stops.
 */
export const WARN_CAP_FRACTION = 0.7

/** The owner's active window cap (fraction of the budget). 60–80% per design; mid. */
export const DEFAULT_ACTIVE_CAP_FRACTION = 0.7
/** Outside the active window the owner is inactive — pace closer to the limit. */
export const DEFAULT_OFF_CAP_FRACTION = 0.92

/** Rework/revert-rate trip threshold — pause past this fraction (>10% per design). */
export const DEFAULT_REVERT_RATE_THRESHOLD = 0.1
/** Don't trip the rework brake on a tiny sample (1/1 = 100% would be noise). */
export const DEFAULT_MIN_REVERT_SAMPLE = 5

/** Rolling usage window, in hours (the subscription's 5h quota window). */
export const WINDOW_HOURS = 5

/**
 * Per-tier token estimate for one task end-to-end (all agents). Tiered because a
 * tier-4 Haiku-labor task costs far less than a tier-1 Opus task — a static number
 * would either stall cheap tasks or under-reserve for expensive ones. Override the
 * whole map via `SDLC_TIER_TOKEN_ESTIMATES` (JSON, e.g. `{"1":3000000}`).
 */
export const DEFAULT_TIER_TOKEN_ESTIMATE: Readonly<Record<Tier, number>> = {
  0: 4_000_000,
  1: 3_000_000,
  2: 1_500_000,
  3: 800_000,
  4: 300_000,
}

/** The owner's active window, in IST (UTC+5:30). 18:00–02:00 inclusive of start. */
export const ACTIVE_WINDOW_IST = { startHour: 18, endHour: 2 } as const

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Operator-set rolling-window token budget. Override: `SDLC_WINDOW_TOKEN_BUDGET`. */
export function windowTokenBudget(): number {
  return envNum('SDLC_WINDOW_TOKEN_BUDGET', DEFAULT_WINDOW_TOKEN_BUDGET)
}

/** Active-window cap fraction (0..1). Override: `SDLC_PACING_CAP_ACTIVE`. */
export function activeCapFraction(): number {
  return envNum('SDLC_PACING_CAP_ACTIVE', DEFAULT_ACTIVE_CAP_FRACTION)
}

/** Off-window cap fraction (0..1). Override: `SDLC_PACING_CAP_OFF`. */
export function offCapFraction(): number {
  return envNum('SDLC_PACING_CAP_OFF', DEFAULT_OFF_CAP_FRACTION)
}

/** Rework/revert-rate trip threshold (0..1). Override: `SDLC_REVERT_RATE_THRESHOLD`. */
export function revertRateThreshold(): number {
  return envNum('SDLC_REVERT_RATE_THRESHOLD', DEFAULT_REVERT_RATE_THRESHOLD)
}

/** Per-task token estimate for a tier, with the optional JSON env override merged in. */
export function estimateTaskTokens(tier: Tier): number {
  const raw = process.env.SDLC_TIER_TOKEN_ESTIMATES
  if (raw) {
    try {
      const override = JSON.parse(raw) as Partial<Record<string, number>>
      const v = override[String(tier)]
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
    } catch {
      // Malformed override → fall through to the default table (don't wedge dispatch).
    }
  }
  return DEFAULT_TIER_TOKEN_ESTIMATE[tier]
}

// ─── time-aware cap ──────────────────────────────────────────────────────────

/** Convert a Date to the wall-clock hour (0..23.99) in IST (UTC+5:30, no DST). */
export function istHour(now: Date): number {
  const istMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440
  return istMinutes / 60
}

/** True when `now` falls in the owner's active window (18:00–02:00 IST). */
export function inActiveWindow(now: Date): boolean {
  const h = istHour(now)
  // Window wraps midnight: [18:00, 24:00) ∪ [00:00, 02:00).
  return h >= ACTIVE_WINDOW_IST.startHour || h < ACTIVE_WINDOW_IST.endHour
}

/** The cap fraction that applies right now — lower while the owner is active. */
export function capFractionNow(now: Date): number {
  return inActiveWindow(now) ? activeCapFraction() : offCapFraction()
}

// ─── pure pacing decision ────────────────────────────────────────────────────

export interface PacingDecision {
  readonly action: 'allow' | 'pause'
  readonly windowSpentTokens: number
  readonly estimatedTaskTokens: number
  /** Effective token cap right now (budget × time-aware fraction). */
  readonly capTokens: number
  /** Projected window fill after this task (0..1+ of the full budget). */
  readonly projectedPct: number
  readonly inActiveWindow: boolean
  /** True when current spend has reached WARN_CAP_FRACTION of the cap — approaching limit. */
  readonly warningSoon: boolean
}

/**
 * Pure decision: would STARTING a task estimated at `estimatedTaskTokens` push the
 * rolling-window spend past the time-aware cap? Pause BEFORE the overrun, never
 * during — that is the "never rate-limited mid-task" guarantee. A non-positive
 * budget is treated as unset/unlimited and never pauses.
 */
export function checkPacing(
  windowSpentTokens: number,
  estimatedTaskTokens: number,
  windowBudgetTokens: number,
  capFraction: number,
  isActiveWindow: boolean,
): PacingDecision {
  const capTokens = windowBudgetTokens > 0 ? windowBudgetTokens * capFraction : 0
  const projected = windowSpentTokens + estimatedTaskTokens
  const projectedPct = windowBudgetTokens > 0 ? projected / windowBudgetTokens : 0
  const action = windowBudgetTokens > 0 && projected > capTokens ? 'pause' : 'allow'
  const warningSoon =
    windowBudgetTokens > 0 && capTokens > 0 && windowSpentTokens >= WARN_CAP_FRACTION * capTokens
  return {
    action,
    windowSpentTokens,
    estimatedTaskTokens,
    capTokens,
    projectedPct,
    inActiveWindow: isActiveWindow,
    warningSoon,
  }
}

// ─── rolling-window token accounting (from the audit log) ────────────────────

/** Total tokens charged by one audit row (input + output + cache I/O — conservative). */
export function rowTokens(row: Pick<AuditRow, 'tokens'>): number {
  const t = row.tokens
  if (!t) return 0
  return (t.promptInput ?? 0) + (t.promptOutput ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0)
}

/** UTC `YYYY-MM-DD` for a Date — matches the `.audit/<date>/` bucket name. */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** The 1–2 UTC date buckets a `[now − WINDOW_HOURS, now]` window can straddle. */
export function windowDates(now: Date): string[] {
  const cutoff = new Date(now.getTime() - WINDOW_HOURS * 3_600_000)
  const days = new Set([utcDay(cutoff), utcDay(now)])
  return [...days]
}

/**
 * Sum tokens spent in the rolling `WINDOW_HOURS` window ending at `now`, across the
 * given target repos. Testable core (no dependency on the global `projects/` dir).
 * Missing `.audit` dirs and unreadable days are skipped, not fatal — a transient FS
 * issue must not wedge the pipeline.
 */
export async function sumWindowTokensInRepos(
  repoPaths: readonly string[],
  now: Date,
): Promise<Result<number, AppError>> {
  return tryAsync('pacing.sum-window', async () => {
    const cutoffMs = now.getTime() - WINDOW_HOURS * 3_600_000
    const nowMs = now.getTime()
    const dates = windowDates(now)
    let total = 0
    for (const repoPath of repoPaths) {
      if (!existsSync(join(repoPath, '.audit'))) continue
      for (const date of dates) {
        const rows = await readDailyRows(repoPath, date)
        if (!rows.ok) continue
        for (const row of rows.value) {
          const ms = Date.parse(row.ts)
          if (Number.isNaN(ms) || ms < cutoffMs || ms > nowMs) continue
          total += rowTokens(row)
        }
      }
    }
    return total
  })
}

// ─── rework / revert-rate trip ───────────────────────────────────────────────

export interface RevertDecision {
  readonly action: 'allow' | 'pause'
  readonly rate: number
  readonly reworked: number
  readonly total: number
  readonly threshold: number
}

/**
 * Pure decision: pause once the rework/revert rate exceeds `threshold` (strictly —
 * the design says ">10%"). Below `minSample` distinct tasks the rate is too noisy
 * to act on (1/1 = 100%), so we never trip — this is a guard, not a quality bar.
 */
export function checkRevertRate(
  reworked: number,
  total: number,
  threshold: number,
  minSample: number = DEFAULT_MIN_REVERT_SAMPLE,
): RevertDecision {
  const rate = total > 0 ? reworked / total : 0
  const action = total >= minSample && rate > threshold ? 'pause' : 'allow'
  return { action, rate, reworked, total, threshold }
}

/**
 * Deterministic rework signal from the audit log: a task is "reworked" if ANY of
 * its rows in the window ended `failure` (hard failure / retries exhausted) or
 * `escalated` (CHECKER quality-failure escalation). Counts DISTINCT tasks so a
 * multi-retry task isn't double-weighted.
 *
 * IMPORTANT — outcome semantics (verified against orchestrator/index.ts):
 *   - `escalated` is written ONLY by the CHECKER quality gate (decision=escalate);
 *     it is the genuine "this task needed human fixing" signal.
 *   - Routine trust-gating of clean Tier-0/1 work (escalateTrustGate) writes NO
 *     escalated/blocked row — the CHECK row is `success` — so normal HITL gating
 *     does NOT inflate this rate (the failure mode that would invert the AC).
 *   - `blocked` is never written by the orchestrator today, so it is deliberately
 *     NOT matched here (matching it would be dead code).
 *   - `partial` (a refire that self-healed) is excluded — in-task rework that
 *     recovered is healthy, not the "fleet is struggling" signal we brake on.
 *
 * This is the available, real proxy for the design's "revert/rework-rate". True
 * post-merge *reverts* (a merged PR later `git revert`-ed, or a card moved back
 * from Done) are not tracked anywhere yet; folding those in is follow-up.
 */
export function computeReworkStats(rows: readonly AuditRow[]): { reworked: number; total: number } {
  const tasks = new Map<string, boolean>() // taskId → wasReworked
  for (const row of rows) {
    if (row.taskId === 'orchestrator') continue
    const prior = tasks.get(row.taskId) ?? false
    const reworked = prior || row.outcome === 'failure' || row.outcome === 'escalated'
    tasks.set(row.taskId, reworked)
  }
  let reworked = 0
  for (const wasReworked of tasks.values()) if (wasReworked) reworked++
  return { reworked, total: tasks.size }
}

// ─── categorical rate-limit signal (deterministic, from the dispatch stream) ──

export interface RateLimitStatus {
  /** `allowed` is the only "keep dispatching" value; anything else is a trip. */
  readonly status: string
  /** `five_hour` | `seven_day`. */
  readonly rateLimitType?: string
  /** Epoch seconds when this limit window resets. */
  readonly resetsAt?: number
  readonly isUsingOverage?: boolean
}

/**
 * Extract the LAST `rate_limit_event` from a `claude --output-format stream-json`
 * stdout. This is the deterministic quota signal the headless dispatch context DOES
 * expose (see the module header). Returns null when no such event is present.
 *
 * Pure + exported so it is unit-testable and ready to wire as a hard backstop once
 * the Red-zone transport forwards the raw stream.
 */
export function parseRateLimitStatus(streamStdout: string): RateLimitStatus | null {
  let found: RateLimitStatus | null = null
  for (const line of streamStdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('rate_limit_event')) continue
    let obj: { type?: unknown; rate_limit_info?: Record<string, unknown> }
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (obj.type !== 'rate_limit_event' || !obj.rate_limit_info) continue
    const info = obj.rate_limit_info
    if (typeof info.status !== 'string') continue
    found = {
      status: info.status,
      ...(typeof info.rateLimitType === 'string' ? { rateLimitType: info.rateLimitType } : {}),
      ...(typeof info.resetsAt === 'number' ? { resetsAt: info.resetsAt } : {}),
      ...(typeof info.isUsingOverage === 'boolean' ? { isUsingOverage: info.isUsingOverage } : {}),
    }
  }
  return found
}

/** Hard backstop: dispatching is unsafe unless the categorical status is `allowed`. */
export function rateLimitTrips(status: RateLimitStatus | null): boolean {
  return status !== null && status.status !== 'allowed'
}

// ─── glue: aggregate across all onboarded projects ───────────────────────────

/** Read a project's target repo path from its `config.json` (mirrors budget.ts). */
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

async function allRepoPaths(): Promise<Result<string[], AppError>> {
  const projects = await listProjects()
  if (!projects.ok) return projects
  const repoPaths: string[] = []
  for (const slug of projects.value) {
    const repoPath = await repoPathOf(slug)
    if (repoPath) repoPaths.push(repoPath)
  }
  return { ok: true, value: repoPaths }
}

/**
 * Pre-dispatch pacing gate. Aggregates this rolling window's token spend across all
 * projects (the quota pool is shared) and decides whether STARTING `tier`'s next
 * task would overrun the time-aware cap. Fires an ntfy push on pause when a topic
 * is configured. Fail-OPEN: an aggregation error allows dispatch (a transient FS
 * issue must not wedge the pipeline) — the error is surfaced on stderr.
 *
 * @param projectBudgetOverride - Per-project budget from config.json
 *   (`sdlc_window_token_budget`). Takes precedence over env / global default when set.
 */
export async function pacingGate(
  now: Date,
  tier: Tier,
  webhookTopic: string | undefined,
  projectBudgetOverride?: number,
): Promise<PacingDecision> {
  const budget =
    projectBudgetOverride !== undefined && projectBudgetOverride > 0
      ? projectBudgetOverride
      : windowTokenBudget()
  const estimate = estimateTaskTokens(tier)
  const fraction = capFractionNow(now)
  const active = inActiveWindow(now)

  const repos = await allRepoPaths()
  if (!repos.ok) {
    process.stderr.write(
      `(pacing guard: project enumeration failed, allowing — ${repos.error.message})\n`,
    )
    return checkPacing(0, estimate, budget, fraction, active)
  }
  const spent = await sumWindowTokensInRepos(repos.value, now)
  if (!spent.ok) {
    process.stderr.write(
      `(pacing guard: window aggregation failed, allowing — ${spent.error.message})\n`,
    )
    return checkPacing(0, estimate, budget, fraction, active)
  }

  const decision = checkPacing(spent.value, estimate, budget, fraction, active)
  if (decision.action === 'pause' && webhookTopic) {
    await notify(
      { topic: webhookTopic },
      {
        title: 'ai-sdlc · pacing guard — dispatch paused',
        message: `5h window ~${decision.windowSpentTokens.toLocaleString()} tok spent + ~${estimate.toLocaleString()} est for next tier-${tier} task would exceed cap ${Math.round(decision.capTokens).toLocaleString()} (${active ? 'active' : 'off'}-window, ${Math.round(fraction * 100)}%). New dispatch paused; in-flight finishes.`,
        priority: 4,
        tags: ['hourglass_flowing_sand', 'no_entry'],
      },
    )
  }
  return decision
}

/**
 * Pre-dispatch rework/revert-rate gate. Reads the rolling window's audit rows
 * across all projects and trips if the rework rate exceeds the threshold. Fail-OPEN
 * on any aggregation error.
 */
export async function reworkRateGate(
  now: Date,
  webhookTopic: string | undefined,
): Promise<RevertDecision> {
  const threshold = revertRateThreshold()
  const repos = await allRepoPaths()
  if (!repos.ok) {
    process.stderr.write(
      `(rework guard: project enumeration failed, allowing — ${repos.error.message})\n`,
    )
    return checkRevertRate(0, 0, threshold)
  }

  const cutoffMs = now.getTime() - WINDOW_HOURS * 3_600_000
  const nowMs = now.getTime()
  const dates = windowDates(now)
  const windowRows: AuditRow[] = []
  for (const repoPath of repos.value) {
    if (!existsSync(join(repoPath, '.audit'))) continue
    for (const date of dates) {
      const rows = await readDailyRows(repoPath, date)
      if (!rows.ok) continue
      for (const row of rows.value) {
        const ms = Date.parse(row.ts)
        if (Number.isNaN(ms) || ms < cutoffMs || ms > nowMs) continue
        windowRows.push(row)
      }
    }
  }

  const { reworked, total } = computeReworkStats(windowRows)
  const decision = checkRevertRate(reworked, total, threshold)
  if (decision.action === 'pause' && webhookTopic) {
    await notify(
      { topic: webhookTopic },
      {
        title: 'ai-sdlc · rework guard — dispatch paused',
        message: `Rework rate ${reworked}/${total} (${Math.round(decision.rate * 100)}%) > ${Math.round(threshold * 100)}% over the last ${WINDOW_HOURS}h. New dispatch paused — review the Blocked queue before resuming.`,
        priority: 5,
        tags: ['recycle', 'no_entry'],
      },
    )
  }
  return decision
}

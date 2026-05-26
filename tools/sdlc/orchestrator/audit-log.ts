/**
 * Audit log writer with hash chain — see ARCHITECTURE.md §8.
 *
 * ⚠️ TIER 0 — Red zone file. Changes here require HITL approval (G2 + G3).
 * The audit chain is the pipeline's memory; corruption here breaks replay,
 * tamper-detection, and trust expansion.
 *
 * Storage layout per target repo:
 *
 *   <target>/.audit/<YYYY-MM-DD>/audit.jsonl      ← canonical chain for the day
 *   <target>/.audit/<YYYY-MM-DD>/diffs/<task>.diff
 *   <target>/.audit/<YYYY-MM-DD>/demo/<task>.webm
 *   <target>/.audit/<YYYY-MM-DD>/review/<task>.json
 *   <target>/.audit/<YYYY-MM-DD>/hitl/<id>.json
 *   <target>/.audit/.chain-tip.json               ← latest row hash, per project
 *
 * Chain semantics:
 *   - First row in a project's history has prevRowHash = "genesis"
 *   - Each subsequent row's prevRowHash = sha256(prev row's canonical JSON)
 *   - rowHash on a row = sha256 of (the row with rowHash field omitted)
 *   - Tampering with any row breaks the chain at the next-read verification
 *
 * Concurrency:
 *   - Orchestrator is single-process; we don't fight concurrent writers
 *   - File appends use fs.appendFile (atomic at OS level for small writes)
 *   - Chain tip update writes to tmp + rename for atomicity
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type AppError,
  type AuditRow,
  GENESIS_PREV_HASH,
  type Result,
  err,
  makeError,
  ok,
  tryAsync,
} from '../types/index.js'

const CHAIN_TIP_FILE = '.audit/.chain-tip.json'

/**
 * Chain tip file shape — stores the latest row hash per project. The file
 * lives in the target repo (one project per target repo, so simple).
 */
interface ChainTip {
  /** sha256 of the most recently written row */
  readonly latestHash: string
  /** ISO timestamp of last write — for staleness detection */
  readonly latestTs: string
  /** Path to the JSONL file containing the latest row (for fast tail-read on next write) */
  readonly latestPath: string
  /** Monotonic counter across all rows for this project — for "Nth row" addressing */
  readonly count: number
}

/**
 * Compute the canonical JSON representation of a row for hashing.
 * We sort keys to ensure stability across Node versions / write orderings.
 * The `rowHash` field is excluded from its own computation.
 */
function canonicalize(row: Omit<AuditRow, 'rowHash'>): string {
  return JSON.stringify(row, Object.keys(row).sort())
}

/**
 * Compute sha256 hash of a string. Returns hex digest.
 */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Read the chain tip for a project. Returns "genesis" if no tip exists yet
 * (first row in the project's audit history).
 */
async function readChainTip(targetRepo: string): Promise<Result<ChainTip | null>> {
  const tipPath = join(targetRepo, CHAIN_TIP_FILE)
  if (!existsSync(tipPath)) {
    return ok(null)
  }
  return tryAsync('audit.read-tip', async () => {
    const raw = await readFile(tipPath, 'utf8')
    return JSON.parse(raw) as ChainTip
  })
}

/**
 * Update the chain tip atomically (write to tmp, then rename).
 */
async function writeChainTip(targetRepo: string, tip: ChainTip): Promise<Result<void>> {
  const tipPath = join(targetRepo, CHAIN_TIP_FILE)
  const tmpPath = `${tipPath}.tmp-${process.pid}-${Date.now()}`
  const result = await tryAsync('audit.write-tip', async () => {
    await mkdir(dirname(tipPath), { recursive: true })
    await writeFile(tmpPath, JSON.stringify(tip, null, 2), 'utf8')
    await rename(tmpPath, tipPath)
  })
  return result.ok ? ok(undefined) : result
}

/**
 * Compute today's audit file path for a project.
 * Format: <target>/.audit/<YYYY-MM-DD>/audit.jsonl
 *
 * Date is in UTC to avoid TZ-related chain ordering bugs.
 */
function dailyAuditPath(targetRepo: string, ts: string): string {
  const date = ts.slice(0, 10) // ISO-8601 date prefix (YYYY-MM-DD)
  return join(targetRepo, '.audit', date, 'audit.jsonl')
}

/**
 * Write a new audit row, computing the hash chain links.
 *
 * Input: a row with `prevRowHash` and `rowHash` fields omitted (we compute them).
 * Output: the persisted row, with both hashes populated.
 *
 * Side effects:
 *   - Appends one JSONL line to the daily audit file
 *   - Updates the chain tip atomically
 *
 * Failure modes:
 *   - Chain tip read fails → return error; caller decides whether to retry
 *   - Append fails → return error; chain tip NOT updated (chain integrity preserved)
 *   - Tip update fails AFTER append succeeds → ⚠️ chain is in an inconsistent state;
 *     `verifyChain()` will catch this on next call; recovery is to re-derive tip from file
 */
export async function writeAuditRow(
  targetRepo: string,
  partial: Omit<AuditRow, 'prevRowHash' | 'rowHash'>,
): Promise<Result<AuditRow, AppError>> {
  // 1. Read current tip
  const tipResult = await readChainTip(targetRepo)
  if (!tipResult.ok) return tipResult
  const currentTip = tipResult.value

  // 2. Determine prevRowHash (genesis if no tip; else tip's latestHash)
  const prevRowHash = currentTip?.latestHash ?? GENESIS_PREV_HASH

  // 3. Build the row without rowHash, then compute rowHash over canonical JSON
  const withoutRowHash: Omit<AuditRow, 'rowHash'> = { ...partial, prevRowHash }
  const rowHash = sha256(canonicalize(withoutRowHash))
  const row: AuditRow = { ...withoutRowHash, rowHash }

  // 4. Append to the daily audit file
  const auditPath = dailyAuditPath(targetRepo, row.ts)
  const appendResult = await tryAsync(
    'audit.append',
    async () => {
      await mkdir(dirname(auditPath), { recursive: true })
      // JSONL: one row per line. trailing newline is mandatory.
      await appendFile(auditPath, `${JSON.stringify(row)}\n`, 'utf8')
    },
    {
      message: `Failed to append audit row for task ${row.taskId}`,
      fix: 'Check disk space + write permissions on the target repo',
    },
  )
  if (!appendResult.ok) return appendResult

  // 5. Update chain tip atomically
  const newTip: ChainTip = {
    latestHash: rowHash,
    latestTs: row.ts,
    latestPath: auditPath,
    count: (currentTip?.count ?? 0) + 1,
  }
  const tipUpdateResult = await writeChainTip(targetRepo, newTip)
  if (!tipUpdateResult.ok) {
    // Append succeeded but tip update failed; the next call to writeAuditRow will
    // read a stale tip and the chain will fork. Surface this loudly.
    return err(
      makeError('audit.tip-update-failed', 'Audit row appended but chain tip update failed', {
        cause: tipUpdateResult.error,
        fix: 'Run `pnpm sdlc audit rebuild-tip --project <slug>` to recover the chain tip from the JSONL files',
        docsUrl:
          'https://github.com/piyushgupta27/ai-sdlc/blob/main/ARCHITECTURE.md#8-auditability--observability',
      }),
    )
  }

  return ok(row)
}

/**
 * Read all rows in the daily audit file for a given date.
 * Returns rows in write order (top to bottom of file).
 */
export async function readDailyRows(
  targetRepo: string,
  date: string, // YYYY-MM-DD
): Promise<Result<readonly AuditRow[], AppError>> {
  const path = join(targetRepo, '.audit', date, 'audit.jsonl')
  if (!existsSync(path)) return ok([])

  return tryAsync(
    'audit.read-daily',
    async () => {
      const raw = await readFile(path, 'utf8')
      const lines = raw.split('\n').filter((l) => l.length > 0)
      return lines.map((line, i) => {
        try {
          return JSON.parse(line) as AuditRow
        } catch (cause) {
          throw new Error(
            `Failed to parse audit row at ${path}:${i + 1} as JSON: ${(cause as Error).message}`,
          )
        }
      })
    },
    {
      fix: 'Check that the audit file is not corrupted; restore from git history if needed',
      docsUrl:
        'https://github.com/piyushgupta27/ai-sdlc/blob/main/ARCHITECTURE.md#8-auditability--observability',
    },
  )
}

/**
 * Verify the hash chain integrity for a given day.
 * Returns ok(true) if chain is intact, ok(false) with details if broken.
 *
 * For full multi-day chain verification (the more common case), call this
 * per day and chain the results — the last row of day N's prevRowHash must
 * match the rowHash of day N-1's last row.
 *
 * Tampering modes detected:
 *   - Any row's prevRowHash doesn't match prior row's rowHash → fork detected
 *   - Any row's rowHash doesn't match recomputed sha256(canonicalized) → row modified
 */
export interface ChainVerification {
  readonly intact: boolean
  readonly rowsChecked: number
  readonly firstBrokenIndex?: number
  readonly brokenReason?: string
}

export async function verifyDailyChain(
  targetRepo: string,
  date: string,
  expectedPrevHash: string = GENESIS_PREV_HASH,
): Promise<Result<ChainVerification, AppError>> {
  const rowsResult = await readDailyRows(targetRepo, date)
  if (!rowsResult.ok) return rowsResult
  const rows = rowsResult.value

  let expectedHash = expectedPrevHash
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row === undefined) continue

    // Verify prev hash link
    if (row.prevRowHash !== expectedHash) {
      return ok({
        intact: false,
        rowsChecked: i,
        firstBrokenIndex: i,
        brokenReason: `Row ${i}: prevRowHash=${row.prevRowHash}, expected=${expectedHash}`,
      })
    }

    // Verify row's own hash
    const { rowHash: declaredHash, ...withoutHash } = row
    const computedHash = sha256(canonicalize(withoutHash))
    if (declaredHash !== computedHash) {
      return ok({
        intact: false,
        rowsChecked: i,
        firstBrokenIndex: i,
        brokenReason: `Row ${i}: rowHash=${declaredHash}, computed=${computedHash} — row content was modified after write`,
      })
    }

    expectedHash = row.rowHash
  }

  return ok({ intact: true, rowsChecked: rows.length })
}

/**
 * Rebuild the chain tip from disk by reading the latest daily audit file.
 * Useful when `writeChainTip()` failed after a successful append (see writeAuditRow
 * failure-mode notes).
 *
 * Behavior:
 *   - Find the latest .audit/<date>/audit.jsonl by directory name
 *   - Read last row
 *   - Write a new chain tip pointing at it
 */
export async function rebuildChainTip(
  targetRepo: string,
  fromDate?: string,
): Promise<Result<ChainTip | null, AppError>> {
  // Caller can pass fromDate (YYYY-MM-DD); we recompute tip from that day forward.
  // If not given, scan all dates in .audit/.
  // This is a recovery path; we keep it simple — just read the given day and use its last row.

  if (!fromDate) {
    return err(
      makeError(
        'audit.rebuild-tip.no-date',
        'rebuildChainTip requires a fromDate (YYYY-MM-DD) for v1; multi-day scan TBD in Phase A late',
        {
          fix: 'Call rebuildChainTip(targetRepo, "YYYY-MM-DD") with the date of the corruption',
        },
      ),
    )
  }

  const rowsResult = await readDailyRows(targetRepo, fromDate)
  if (!rowsResult.ok) return rowsResult
  const rows = rowsResult.value

  if (rows.length === 0) {
    return ok(null)
  }

  const lastRow = rows[rows.length - 1]
  if (lastRow === undefined) return ok(null)

  const newTip: ChainTip = {
    latestHash: lastRow.rowHash,
    latestTs: lastRow.ts,
    latestPath: dailyAuditPath(targetRepo, lastRow.ts),
    count: rows.length, // best-effort; cross-day count requires the multi-day scan
  }

  const writeResult = await writeChainTip(targetRepo, newTip)
  if (!writeResult.ok) return writeResult

  return ok(newTip)
}

/**
 * Helper for tests + callers: brand-new chain tip for a fresh project.
 */
export const FRESH_CHAIN_TIP: ChainTip = {
  latestHash: GENESIS_PREV_HASH,
  latestTs: new Date(0).toISOString(),
  latestPath: '',
  count: 0,
}

/**
 * Re-export for callers that want the type without pulling in the path.
 */
export type { ChainTip }

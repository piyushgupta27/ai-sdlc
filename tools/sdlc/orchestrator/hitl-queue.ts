/**
 * HITL queue — structured gate records on disk.
 *
 * In v1 we only implement G2 (REVIEW gate). Records live at
 *   `<target-repo>/.sdlc-queue/pending-hitl/<id>.json`
 *
 * Writes are atomic (tmp + rename). Reads return all pending gates for
 * a project. The dashboard at :3001 reads + the user responds via the
 * UI; that response writes a corresponding `<id>.response.json` next to
 * the request, which the orchestrator polls for on retry.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type AppError,
  type HITLRequest,
  type HITLResponse,
  type Result,
  ok,
  tryAsync,
} from '../types/index.js'

const QUEUE_DIR = '.sdlc-queue/pending-hitl'

function queuePath(targetRepo: string, gateId: string): string {
  return join(targetRepo, QUEUE_DIR, `${gateId}.json`)
}

function responsePath(targetRepo: string, gateId: string): string {
  return join(targetRepo, QUEUE_DIR, `${gateId}.response.json`)
}

/**
 * Write a new gate to the queue. Used by the orchestrator when it needs
 * to pause for human input.
 */
export async function enqueue(
  targetRepo: string,
  request: HITLRequest,
): Promise<Result<void, AppError>> {
  const path = queuePath(targetRepo, request.id)
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`

  return tryAsync(
    'hitl.enqueue',
    async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(tmpPath, JSON.stringify(request, null, 2), 'utf8')
      await rename(tmpPath, path)
    },
    {
      fix: 'Check disk space + write permissions on target repo',
    },
  )
}

/**
 * List all pending gates for a project (anything in the queue without a
 * matching response file).
 */
export async function listPending(
  targetRepo: string,
): Promise<Result<readonly HITLRequest[], AppError>> {
  const dir = join(targetRepo, QUEUE_DIR)
  if (!existsSync(dir)) return ok([])

  return tryAsync('hitl.list-pending', async () => {
    const entries = await readdir(dir)
    const requests: HITLRequest[] = []

    for (const name of entries) {
      // Skip response files + tmp files
      if (name.endsWith('.response.json') || name.includes('.tmp-')) continue
      if (!name.endsWith('.json')) continue

      const raw = await readFile(join(dir, name), 'utf8')
      const req = JSON.parse(raw) as HITLRequest

      // Skip if a response already exists (gate was answered but not cleaned up)
      if (existsSync(responsePath(targetRepo, req.id))) continue

      requests.push(req)
    }

    // Sort by createdAt — oldest first
    return requests.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  })
}

/**
 * Check for a response to a specific gate. Returns null if not yet answered.
 */
export async function checkResponse(
  targetRepo: string,
  gateId: string,
): Promise<Result<HITLResponse | null, AppError>> {
  const path = responsePath(targetRepo, gateId)
  if (!existsSync(path)) return ok(null)

  return tryAsync('hitl.check-response', async () => {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as HITLResponse
  })
}

/**
 * Mark a gate as answered. Called by the dashboard when the user submits
 * their response. Writes the response, leaves the request file (audit trail).
 */
export async function recordResponse(
  targetRepo: string,
  response: HITLResponse,
): Promise<Result<void, AppError>> {
  const path = responsePath(targetRepo, response.gateId)
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`

  return tryAsync(
    'hitl.record-response',
    async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(tmpPath, JSON.stringify(response, null, 2), 'utf8')
      await rename(tmpPath, path)
    },
    {
      fix: 'Check disk space + write permissions on target repo',
    },
  )
}

/**
 * Remove a gate from the queue entirely (after it's been processed +
 * audit-logged). Called by the orchestrator on retry after seeing the
 * user's response.
 */
export async function dequeue(targetRepo: string, gateId: string): Promise<Result<void, AppError>> {
  const reqPath = queuePath(targetRepo, gateId)
  const respPath = responsePath(targetRepo, gateId)

  return tryAsync('hitl.dequeue', async () => {
    if (existsSync(reqPath)) await unlink(reqPath)
    if (existsSync(respPath)) await unlink(respPath)
  })
}

/**
 * Build a HITLRequest for the G2 REVIEW gate.
 * Convenience constructor used by the orchestrator.
 */
export function buildG2Request(opts: {
  readonly project: import('../types/index.js').ProjectSlug
  readonly taskId: string
  readonly epicId: string
  readonly tier: import('../types/index.js').Tier
  readonly summary: string
  readonly reason: string
  readonly diffPath: string
  readonly reviewReportPath: string
  readonly auditRunPath: string
  readonly blockingTaskIds: readonly string[]
}): HITLRequest {
  const id = `hitl-G2-${formatDateStamp(new Date())}-${randomSuffix(3)}`
  return {
    id,
    gate: 'G2',
    tier: opts.tier,
    project: opts.project,
    taskId: opts.taskId,
    epicId: opts.epicId,
    summary: opts.summary,
    reason: opts.reason,
    artifacts: {
      diff: opts.diffPath,
      reviewReport: opts.reviewReportPath,
      auditRun: opts.auditRunPath,
    },
    options: [
      { id: 'approve', label: 'Approve as-is' },
      { id: 'approve_with_followup', label: 'Approve + open follow-up issue' },
      { id: 'request_changes', label: 'Send back with comment', requiresInput: true },
      { id: 'reject', label: 'Discard' },
      { id: 'escalate', label: 'Escalate to deeper review' },
    ],
    blocking: opts.blockingTaskIds,
    createdAt: new Date().toISOString(),
  }
}

function formatDateStamp(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

function randomSuffix(len: number): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len)
    .padEnd(len, '0')
}

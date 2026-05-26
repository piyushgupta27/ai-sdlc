/**
 * Tests for the audit log writer with hash chain.
 *
 * Tier 0 file → coverage target ≥85%. These tests exercise the chain semantics
 * (genesis → next rows), tamper detection (modified row, broken prev hash),
 * and recovery (rebuildChainTip).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asProjectSlug } from '../types/index.js'
import { readDailyRows, rebuildChainTip, verifyDailyChain, writeAuditRow } from './audit-log.js'

function makePartialRow(overrides: Record<string, unknown> = {}) {
  return {
    ts: '2026-05-23T12:00:00.000Z',
    project: asProjectSlug('test-project'),
    agent: 'planner' as const,
    model: 'claude-opus-4-7',
    modelTransport: 'claude-code-subagent' as const,
    taskId: '1.1.1',
    stage: 'PLAN' as const,
    tier: 3 as const,
    durationMs: 1000,
    tokens: { promptInput: 100, promptOutput: 50 },
    costUsd: 0.01,
    inputFiles: [],
    decisions: [],
    validations: {},
    outcome: 'success' as const,
    nextStage: 'BUILD' as const,
    ...overrides,
  }
}

describe('audit-log', () => {
  let tmpRepo: string

  beforeEach(async () => {
    tmpRepo = await mkdtemp(join(tmpdir(), 'audit-log-test-'))
  })

  afterEach(async () => {
    await rm(tmpRepo, { recursive: true, force: true })
  })

  describe('writeAuditRow', () => {
    it('writes the first row with prevRowHash="genesis"', async () => {
      const result = await writeAuditRow(tmpRepo, makePartialRow())
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.prevRowHash).toBe('genesis')
        expect(result.value.rowHash).toMatch(/^[a-f0-9]{64}$/)
      }
    })

    it('chains subsequent rows by referencing previous rowHash', async () => {
      const first = await writeAuditRow(tmpRepo, makePartialRow())
      expect(first.ok).toBe(true)
      if (!first.ok) return

      const second = await writeAuditRow(
        tmpRepo,
        makePartialRow({ taskId: '1.1.2', ts: '2026-05-23T12:01:00.000Z' }),
      )
      expect(second.ok).toBe(true)
      if (!second.ok) return

      expect(second.value.prevRowHash).toBe(first.value.rowHash)
    })

    it('computes rowHash deterministically over canonical JSON', async () => {
      const result1 = await writeAuditRow(tmpRepo, makePartialRow())
      const tmp2 = await mkdtemp(join(tmpdir(), 'audit-log-test-dup-'))
      const result2 = await writeAuditRow(tmp2, makePartialRow())
      await rm(tmp2, { recursive: true, force: true })

      expect(result1.ok).toBe(true)
      expect(result2.ok).toBe(true)
      if (result1.ok && result2.ok) {
        expect(result1.value.rowHash).toBe(result2.value.rowHash)
      }
    })
  })

  describe('readDailyRows', () => {
    it('returns empty array when no rows exist for the date', async () => {
      const result = await readDailyRows(tmpRepo, '2026-05-23')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toEqual([])
    })

    it('returns rows in write order', async () => {
      await writeAuditRow(tmpRepo, makePartialRow({ taskId: '1.1.1' }))
      await writeAuditRow(
        tmpRepo,
        makePartialRow({ taskId: '1.1.2', ts: '2026-05-23T12:01:00.000Z' }),
      )
      await writeAuditRow(
        tmpRepo,
        makePartialRow({ taskId: '1.1.3', ts: '2026-05-23T12:02:00.000Z' }),
      )

      const result = await readDailyRows(tmpRepo, '2026-05-23')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.map((r) => r.taskId)).toEqual(['1.1.1', '1.1.2', '1.1.3'])
      }
    })
  })

  describe('verifyDailyChain', () => {
    it('returns intact=true for a freshly written chain', async () => {
      await writeAuditRow(tmpRepo, makePartialRow({ taskId: '1.1.1' }))
      await writeAuditRow(
        tmpRepo,
        makePartialRow({ taskId: '1.1.2', ts: '2026-05-23T12:01:00.000Z' }),
      )

      const result = await verifyDailyChain(tmpRepo, '2026-05-23')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.intact).toBe(true)
        expect(result.value.rowsChecked).toBe(2)
      }
    })

    it('detects a tampered row by hash mismatch', async () => {
      await writeAuditRow(tmpRepo, makePartialRow({ taskId: '1.1.1' }))
      await writeAuditRow(
        tmpRepo,
        makePartialRow({ taskId: '1.1.2', ts: '2026-05-23T12:01:00.000Z' }),
      )

      // Tamper: overwrite the audit file with modified content
      const { readFile, writeFile } = await import('node:fs/promises')
      const path = join(tmpRepo, '.audit/2026-05-23/audit.jsonl')
      const raw = await readFile(path, 'utf8')
      const tampered = raw.replace('"taskId":"1.1.1"', '"taskId":"1.1.1-EVIL"')
      await writeFile(path, tampered, 'utf8')

      const result = await verifyDailyChain(tmpRepo, '2026-05-23')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.intact).toBe(false)
        expect(result.value.firstBrokenIndex).toBe(0)
        expect(result.value.brokenReason).toContain('rowHash')
      }
    })

    it('detects a broken prev-hash link', async () => {
      const first = await writeAuditRow(tmpRepo, makePartialRow({ taskId: '1.1.1' }))
      expect(first.ok).toBe(true)
      if (!first.ok) return

      // Read, deliberately corrupt the second row's prevRowHash, write back
      const { readFile, writeFile } = await import('node:fs/promises')
      const path = join(tmpRepo, '.audit/2026-05-23/audit.jsonl')

      await writeAuditRow(
        tmpRepo,
        makePartialRow({ taskId: '1.1.2', ts: '2026-05-23T12:01:00.000Z' }),
      )
      const raw = await readFile(path, 'utf8')
      const lines = raw.split('\n').filter((l) => l.length > 0)
      // Surgery on line 2: replace prevRowHash but recompute its own rowHash so only the prev link breaks
      const row = JSON.parse(lines[1] as string)
      row.prevRowHash = 'WRONG_PREV_HASH_DETECTOR_TEST'
      // Recompute rowHash so we only test the prev-hash link detection, not row-hash detection
      const { createHash } = await import('node:crypto')
      const { rowHash: _omit, ...withoutHash } = row
      row.rowHash = createHash('sha256')
        .update(JSON.stringify(withoutHash, Object.keys(withoutHash).sort()))
        .digest('hex')
      lines[1] = JSON.stringify(row)
      await writeFile(path, `${lines.join('\n')}\n`, 'utf8')

      const result = await verifyDailyChain(tmpRepo, '2026-05-23')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.intact).toBe(false)
        expect(result.value.firstBrokenIndex).toBe(1)
        expect(result.value.brokenReason).toContain('prevRowHash')
      }
    })
  })

  describe('rebuildChainTip', () => {
    it('returns null when no rows exist for the given date', async () => {
      const result = await rebuildChainTip(tmpRepo, '2026-05-23')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe(null)
    })

    it('rebuilds the tip from the latest row in the daily file', async () => {
      await writeAuditRow(tmpRepo, makePartialRow({ taskId: '1.1.1' }))
      const last = await writeAuditRow(
        tmpRepo,
        makePartialRow({ taskId: '1.1.2', ts: '2026-05-23T12:01:00.000Z' }),
      )
      expect(last.ok).toBe(true)
      if (!last.ok) return

      // Wipe the tip file
      const { rm: rmFile } = await import('node:fs/promises')
      await rmFile(join(tmpRepo, '.audit/.chain-tip.json'), { force: true })

      const result = await rebuildChainTip(tmpRepo, '2026-05-23')
      expect(result.ok).toBe(true)
      if (result.ok && result.value) {
        expect(result.value.latestHash).toBe(last.value.rowHash)
      }
    })

    it('errors when called without a fromDate', async () => {
      const result = await rebuildChainTip(tmpRepo)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('audit.rebuild-tip.no-date')
      }
    })
  })
})

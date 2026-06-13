/**
 * Tests for the glue layer (pacingGate + reworkRateGate) — lines 371-490 of pacing.ts.
 *
 * These functions aggregate across all onboarded projects via listProjects() /
 * projectDir() (both mocked) and fire notify() on pause (also mocked). Fail-open
 * semantics: an aggregation error must never wedge the pipeline.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asProjectSlug, err, makeError } from '../types/index.js'

// vi.mock calls are hoisted before imports — declare before any module that
// transitively imports the mocked modules.
vi.mock('./state.js', () => ({
  listProjects: vi.fn(),
  projectDir: vi.fn(),
}))

vi.mock('../integrations/ntfy.js', () => ({
  notify: vi.fn(async () => ({ ok: true, value: undefined })),
}))

import { notify } from '../integrations/ntfy.js'
import { pacingGate, reworkRateGate } from './pacing.js'
import { listProjects, projectDir } from './state.js'

// Fixed test clock: 2026-06-13T12:00:00Z = 17:30 IST → off-window (cap 0.92).
// All audit row ts values used in tests are within the 5h window (≥07:00Z).
const NOW = new Date('2026-06-13T12:00:00Z')

const SLUG = asProjectSlug('test-proj')

afterEach(() => {
  vi.clearAllMocks()
  for (const k of [
    'SDLC_WINDOW_TOKEN_BUDGET',
    'SDLC_PACING_CAP_ACTIVE',
    'SDLC_PACING_CAP_OFF',
    'SDLC_REVERT_RATE_THRESHOLD',
  ]) {
    process.env[k] = ''
  }
})

// ─── pacingGate ──────────────────────────────────────────────────────────────

describe('pacingGate', () => {
  it('is fail-open: allows when project enumeration fails', async () => {
    vi.mocked(listProjects).mockResolvedValueOnce(
      err(makeError('state.list-projects', 'disk exploded')),
    )
    // Default 20M budget, off-window cap 0.92 → 0 spent + tier-4 estimate ≪ 18.4M → allow
    const d = await pacingGate(NOW, 4, undefined)
    expect(d.action).toBe('allow')
  })

  it('allows when no projects are registered', async () => {
    vi.mocked(listProjects).mockResolvedValueOnce({ ok: true, value: [] })
    const d = await pacingGate(NOW, 4, undefined)
    expect(d.action).toBe('allow')
  })

  it('pauses when the window budget is too small for the next task', async () => {
    // budget=1, cap=0.92 → 0 spent + tier-4 estimate (300k) > 0.92 → pause
    process.env.SDLC_WINDOW_TOKEN_BUDGET = '1'
    vi.mocked(listProjects).mockResolvedValueOnce({ ok: true, value: [] })
    const d = await pacingGate(NOW, 4, undefined)
    expect(d.action).toBe('pause')
  })

  it('sends an ntfy notification when pausing and a webhookTopic is given', async () => {
    process.env.SDLC_WINDOW_TOKEN_BUDGET = '1'
    vi.mocked(listProjects).mockResolvedValueOnce({ ok: true, value: [] })
    const d = await pacingGate(NOW, 4, 'test-topic')
    expect(d.action).toBe('pause')
    expect(vi.mocked(notify)).toHaveBeenCalledOnce()
    expect(vi.mocked(notify).mock.calls[0][0]).toEqual({ topic: 'test-topic' })
  })
})

// ─── reworkRateGate ──────────────────────────────────────────────────────────

describe('reworkRateGate', () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    for (const d of tmpDirs) await rm(d, { recursive: true, force: true })
    tmpDirs.length = 0
  })

  /** Create a temp project dir + repo with audit rows, wire up the mocks. */
  async function seedProject(
    rows: Array<{ ts: string; taskId: string; outcome: string }>,
  ): Promise<void> {
    const projDir = await mkdtemp(join(tmpdir(), 'sdlc-pacing-proj-'))
    const repoDir = await mkdtemp(join(tmpdir(), 'sdlc-pacing-repo-'))
    tmpDirs.push(projDir, repoDir)

    await writeFile(join(projDir, 'config.json'), JSON.stringify({ repoPath: repoDir }))

    const auditDir = join(repoDir, '.audit', '2026-06-13')
    await mkdir(auditDir, { recursive: true })
    await writeFile(
      join(auditDir, 'audit.jsonl'),
      `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
    )

    vi.mocked(listProjects).mockResolvedValueOnce({ ok: true, value: [SLUG] })
    vi.mocked(projectDir).mockReturnValue(projDir)
  }

  it('is fail-open: allows when project enumeration fails', async () => {
    vi.mocked(listProjects).mockResolvedValueOnce(
      err(makeError('state.list-projects', 'disk exploded')),
    )
    const d = await reworkRateGate(NOW, undefined)
    expect(d.action).toBe('allow')
  })

  it('allows when no projects are registered', async () => {
    vi.mocked(listProjects).mockResolvedValueOnce({ ok: true, value: [] })
    const d = await reworkRateGate(NOW, undefined)
    expect(d.action).toBe('allow')
  })

  it('pauses when the rework rate exceeds the threshold', async () => {
    // 5 tasks, 2 failures → rate = 40% > 10% threshold, clears minSample guard of 5
    await seedProject([
      { ts: '2026-06-13T08:00:00Z', taskId: 'gh-1', outcome: 'success' },
      { ts: '2026-06-13T09:00:00Z', taskId: 'gh-2', outcome: 'failure' },
      { ts: '2026-06-13T09:30:00Z', taskId: 'gh-3', outcome: 'failure' },
      { ts: '2026-06-13T10:00:00Z', taskId: 'gh-4', outcome: 'success' },
      { ts: '2026-06-13T11:00:00Z', taskId: 'gh-5', outcome: 'success' },
    ])
    const d = await reworkRateGate(NOW, undefined)
    expect(d.action).toBe('pause')
    expect(d.reworked).toBe(2)
    expect(d.total).toBe(5)
  })

  it('sends an ntfy notification when pausing and a webhookTopic is given', async () => {
    await seedProject([
      { ts: '2026-06-13T08:00:00Z', taskId: 'gh-1', outcome: 'success' },
      { ts: '2026-06-13T09:00:00Z', taskId: 'gh-2', outcome: 'failure' },
      { ts: '2026-06-13T09:30:00Z', taskId: 'gh-3', outcome: 'failure' },
      { ts: '2026-06-13T10:00:00Z', taskId: 'gh-4', outcome: 'success' },
      { ts: '2026-06-13T11:00:00Z', taskId: 'gh-5', outcome: 'success' },
    ])
    const d = await reworkRateGate(NOW, 'test-topic')
    expect(d.action).toBe('pause')
    expect(vi.mocked(notify)).toHaveBeenCalledOnce()
    expect(vi.mocked(notify).mock.calls[0][0]).toEqual({ topic: 'test-topic' })
  })
})

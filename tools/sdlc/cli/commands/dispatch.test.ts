/**
 * Tests for dispatch.ts — two suites:
 *
 * Suite 1 (gh-78): exit-code tracking + Done/Blocked deferral fixes.
 *   Bug 1: dispatchFromBoard always returned 0; sawFailure now propagates.
 *   Bug 2: card moved to Done before PR opened; deferred until maybeCreatePr
 *          returns true.
 *
 * Suite 2 (gh-12): --webhook fail-closed gate.
 *   SDLC_NTFY_TOKEN must be set before the webhook loop starts.
 */

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asProjectSlug, ok } from '../../types/index.js'

// ─── hoist mock refs so they're available in the vi.mock() factories ─────────

const { spawnMock, readFileMock, existsSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  readFileMock: vi.fn(),
  existsSyncMock: vi.fn(),
}))

// ─── module mocks (evaluated before any import) ───────────────────────────────

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
vi.mock('node:fs/promises', () => ({ readFile: readFileMock }))

vi.mock('../../orchestrator/state.js', () => ({
  readState: vi.fn(),
  projectDir: vi.fn(() => '/fake-sdlc'),
  listProjects: vi.fn(),
}))
vi.mock('../../integrations/github-projects.js', () => ({
  findProject: vi.fn(),
  listItems: vi.fn(),
  moveItem: vi.fn(),
}))
vi.mock('../../orchestrator/budget.js', () => ({
  budgetGate: vi.fn(),
  PAUSE_THRESHOLD: 0.85,
}))
vi.mock('../../orchestrator/index.js', () => ({
  runTask: vi.fn(),
}))
vi.mock('../../sandbox/index.js', () => ({
  provisionWorktreeSandbox: vi.fn(),
}))
vi.mock('../../integrations/ntfy.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    parseDispatchTrigger: vi.fn(),
    subscribe: vi.fn(),
  }
})

// ─── imports (get the mocked versions) ───────────────────────────────────────

import { findProject, listItems, moveItem } from '../../integrations/github-projects.js'
import { budgetGate } from '../../orchestrator/budget.js'
import { runTask } from '../../orchestrator/index.js'
import { listProjects, projectDir, readState } from '../../orchestrator/state.js'
import { provisionWorktreeSandbox } from '../../sandbox/index.js'
import { runDispatch } from './dispatch.js'

// ─── fixtures ─────────────────────────────────────────────────────────────────

const SLUG = 'testproject'
const ARGV = ['--project', SLUG]

const fakeProject = {
  id: 'PVT_proj1',
  number: 1,
  owner: 'fakeowner',
  title: 'Test Project',
  statusField: { id: 'field-1', options: [] as Array<{ id: string; name: string }> },
}

const fakeItem = {
  id: 'item-1',
  title: 'Test task',
  content: {
    type: 'Issue' as const,
    number: 1,
    body: '## Acceptance criteria\n- do the thing\n',
    labels: ['tier:2'],
  },
}

function makeOutcome(
  result: 'merged' | 'hitl-pending' | 'failed',
  commitSha?: string,
  branch?: string,
) {
  return {
    taskId: 'gh-1',
    result,
    stage: (result === 'merged' ? 'DONE' : 'BLOCKED') as 'DONE' | 'BLOCKED',
    retriesUsed: 0,
    auditRunIds: [] as readonly string[],
    costUsd: 0.01,
    durationMs: 100,
    commitSha,
    branch,
    notes: undefined as string | undefined,
  }
}

/** Returns a fake child process that emits close with the given code. */
function makeChildProcess(code: number, stdoutStr = '', stderrStr = '') {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  setImmediate(() => {
    if (stdoutStr) proc.stdout.emit('data', Buffer.from(stdoutStr))
    if (stderrStr) proc.stderr.emit('data', Buffer.from(stderrStr))
    proc.emit('close', code)
  })
  return proc
}

// ─── default setup (reset per test) ──────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()

  vi.mocked(projectDir).mockReturnValue('/fake-sdlc')
  vi.mocked(readState).mockResolvedValue(ok({ slug: asProjectSlug(SLUG) } as never))
  vi.mocked(listProjects).mockResolvedValue(ok([]))
  existsSyncMock.mockReturnValue(true)
  readFileMock.mockResolvedValue(JSON.stringify({ repoPath: '/fake/repo', owner: 'fakeowner' }))

  vi.mocked(findProject).mockResolvedValue(ok(fakeProject as never))
  vi.mocked(moveItem).mockResolvedValue(ok(undefined))

  vi.mocked(budgetGate).mockResolvedValue({ action: 'allow', spentUsd: 0, budgetUsd: 100, pct: 0 })

  vi.mocked(provisionWorktreeSandbox).mockResolvedValue(
    ok({
      workspacePath: '/tmp/fake-sandbox',
      branch: 'feature/gh-1',
      cleanup: vi.fn(async () => ok(undefined)),
    } as never),
  )

  vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('merged', 'abc123', 'feature/gh-1')))

  // Each spawn() call gets a fresh emitter — reusing one EventEmitter across
  // calls means the second call never sees the `close` event.
  spawnMock.mockImplementation(() => makeChildProcess(0, 'https://github.com/org/repo/pull/1\n'))
})

// ─── argument handling ────────────────────────────────────────────────────────

describe('runDispatch — argument handling', () => {
  it('exits 0 on --help', async () => {
    expect(await runDispatch(['--help'])).toBe(0)
  })

  it('exits 2 when --project is missing', async () => {
    expect(await runDispatch([])).toBe(2)
  })
})

// ─── Suite 1 (gh-78): exit codes + Done deferral ─────────────────────────────

describe('dispatchFromBoard — exit codes (Bug 1: sawFailure tracking)', () => {
  it('returns 0 when a task result is "merged"', async () => {
    vi.mocked(listItems)
      .mockResolvedValueOnce(ok([fakeItem]))
      .mockResolvedValue(ok([]))
    expect(await runDispatch(ARGV)).toBe(0)
  })

  it('returns 1 when a task result is "failed"', async () => {
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('failed')))
    vi.mocked(listItems)
      .mockResolvedValueOnce(ok([fakeItem]))
      .mockResolvedValue(ok([]))
    expect(await runDispatch(ARGV)).toBe(1)
  })

  it('returns 1 when a task result is "hitl-pending"', async () => {
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('hitl-pending')))
    vi.mocked(listItems)
      .mockResolvedValueOnce(ok([fakeItem]))
      .mockResolvedValue(ok([]))
    expect(await runDispatch(ARGV)).toBe(1)
  })

  it('continues to next item after a failed task instead of stopping early', async () => {
    vi.mocked(runTask)
      .mockResolvedValueOnce(ok(makeOutcome('failed')))
      .mockResolvedValueOnce(ok(makeOutcome('merged', 'abc123', 'feature/gh-1')))
    vi.mocked(listItems).mockResolvedValue(ok([fakeItem]))

    const code = await runDispatch([...ARGV, '--max-tasks', '2'])

    expect(code).toBe(1)
    expect(vi.mocked(runTask)).toHaveBeenCalledTimes(2)
  })

  it('returns 1 when budget pauses after a task has already failed', async () => {
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('failed')))
    vi.mocked(listItems).mockResolvedValue(ok([fakeItem]))
    vi.mocked(budgetGate)
      .mockResolvedValueOnce({ action: 'allow', spentUsd: 0, budgetUsd: 100, pct: 0 })
      .mockResolvedValue({ action: 'pause', spentUsd: 90, budgetUsd: 100, pct: 0.9 })

    expect(await runDispatch(ARGV)).toBe(1)
  })

  it('returns 0 when budget pauses with no prior failures', async () => {
    vi.mocked(listItems).mockResolvedValue(ok([fakeItem]))
    vi.mocked(budgetGate)
      .mockResolvedValueOnce({ action: 'allow', spentUsd: 0, budgetUsd: 100, pct: 0 })
      .mockResolvedValue({ action: 'pause', spentUsd: 90, budgetUsd: 100, pct: 0.9 })

    expect(await runDispatch(ARGV)).toBe(0)
  })

  it('returns 1 at max-tasks when any task failed', async () => {
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('failed')))
    vi.mocked(listItems).mockResolvedValue(ok([fakeItem]))

    expect(await runDispatch([...ARGV, '--max-tasks', '1'])).toBe(1)
  })

  it('returns 0 at max-tasks when all tasks succeeded', async () => {
    vi.mocked(listItems).mockResolvedValue(ok([fakeItem]))

    expect(await runDispatch([...ARGV, '--max-tasks', '1'])).toBe(0)
  })
})

describe('dispatchFromBoard — Done/Blocked deferral (Bug 2: PR-create gates Done)', () => {
  beforeEach(() => {
    vi.mocked(listItems)
      .mockResolvedValueOnce(ok([fakeItem]))
      .mockResolvedValue(ok([]))
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('merged', 'abc123', 'feature/gh-1')))
  })

  it('moves card to Done after successful push + PR creation', async () => {
    const code = await runDispatch(ARGV)

    expect(code).toBe(0)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
    expect(vi.mocked(moveItem)).not.toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Blocked')
  })

  it('moves card to Blocked and exits 1 when git push fails', async () => {
    spawnMock.mockReturnValueOnce(makeChildProcess(1, '', 'fatal: no upstream branch'))

    const code = await runDispatch(ARGV)

    expect(code).toBe(1)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Blocked')
    expect(vi.mocked(moveItem)).not.toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
  })

  it('moves card to Blocked and exits 1 when gh pr create fails', async () => {
    spawnMock
      .mockReturnValueOnce(makeChildProcess(0))
      .mockReturnValueOnce(makeChildProcess(1, '', 'already exists'))

    const code = await runDispatch(ARGV)

    expect(code).toBe(1)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Blocked')
    expect(vi.mocked(moveItem)).not.toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
  })

  it('moves card to Done without a PR for a no-op task (merged with no commitSha)', async () => {
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('merged')))

    const code = await runDispatch(ARGV)

    expect(code).toBe(0)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('moves card to Blocked (not Done) when a task fails', async () => {
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('failed')))

    const code = await runDispatch(ARGV)

    expect(code).toBe(1)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Blocked')
    expect(vi.mocked(moveItem)).not.toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

// ─── Suite 2 (gh-12): webhook fail-closed token gate ─────────────────────────

describe('runDispatch --webhook fail-closed (gh-12)', () => {
  // vi.stubEnv / unstubAllEnvs avoids `delete` (Biome lint/performance/noDelete)
  // and correctly handles the "var absent" case.
  beforeEach(() => {
    vi.stubEnv('SDLC_NTFY_TOKEN', undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 2 when SDLC_NTFY_TOKEN is absent', async () => {
    const code = await runDispatch(['--project', 'test-proj', '--webhook', '--topic', 'my-topic'])
    expect(code).toBe(2)
  })

  it('returns 2 when SDLC_NTFY_TOKEN is an empty string', async () => {
    vi.stubEnv('SDLC_NTFY_TOKEN', '')
    const code = await runDispatch(['--project', 'test-proj', '--webhook', '--topic', 'my-topic'])
    expect(code).toBe(2)
  })

  it('returns 2 when --webhook is given without --topic', async () => {
    vi.stubEnv('SDLC_NTFY_TOKEN', 'tok')
    const code = await runDispatch(['--project', 'test-proj', '--webhook'])
    expect(code).toBe(2)
  })
})

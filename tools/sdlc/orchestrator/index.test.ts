/**
 * Wiring tests for the trustState×tier COMMIT gate (#62).
 *
 * trust-gate.test.ts pins the pure ladder; THIS proves the gate is actually
 * plugged into runTask: clean work (BUILD/TEST/REVIEW/CHECK all pass) is held
 * for HITL vs. auto-committed per trustState × tier, and the fail-safe default
 * (gate enforced when the flag is omitted) holds. The agent layer + IO are
 * mocked so the test exercises the real orchestrator control flow.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AgentResult,
  type ProjectState,
  type Task,
  type Tier,
  type TrustState,
  asProjectSlug,
  err,
  makeError,
  ok,
} from '../types/index.js'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))

vi.mock('../agents/builder/index.js', () => ({ runBuilder: vi.fn() }))
vi.mock('../agents/tester/index.js', () => ({ runTester: vi.fn() }))
vi.mock('../agents/reviewer/index.js', () => ({ runReviewer: vi.fn() }))
vi.mock('../agents/checker/index.js', () => ({ runChecker: vi.fn() }))
vi.mock('./validations.js', () => ({
  runValidations: vi.fn(async () => ({ validations: {}, details: [] })),
  hasDeterministicFailure: () => false,
}))
vi.mock('./audit-log.js', () => ({
  writeAuditRow: vi.fn(async () => ({ ok: true, value: { rowHash: 'deadbeefcafe00' } })),
}))
vi.mock('./state.js', () => ({
  readState: vi.fn(),
  updateState: vi.fn(async () => ({ ok: true, value: undefined })),
  projectDir: () => '/nonexistent-sdlc-test',
}))
vi.mock('./hitl-queue.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return { ...actual, enqueue: vi.fn(async () => ({ ok: true, value: undefined })) }
})

import { runBuilder } from '../agents/builder/index.js'
import { runChecker } from '../agents/checker/index.js'
import { runReviewer } from '../agents/reviewer/index.js'
import { runTester } from '../agents/tester/index.js'
import { writeAuditRow } from './audit-log.js'
import { rescueCommit, resetWorktreeToHead, runTask } from './index.js'
import { readState } from './state.js'

function agentResult<T>(output: T, outcome: AgentResult<T>['outcome'] = 'success'): AgentResult<T> {
  return {
    outcome,
    output,
    filesRead: [],
    filesWritten: [],
    tokens: { input: 1, output: 1 },
    durationMs: 1,
    costUsd: 0,
    model: 'claude-opus-4-8',
    transport: 'claude-code-subagent',
  }
}

function makeState(trustState: TrustState): ProjectState {
  return {
    slug: asProjectSlug('t'),
    trustState,
    readinessScore: 0,
    readinessBreakdown: { context: 0, testing: 0, cicd: 0 },
    lastReadinessCheck: new Date(0).toISOString(),
    inFlightTaskIds: [],
    activeCohorts: {},
    hitlQueueDepth: 0,
    defectRate7d: 0,
  }
}

function makeTask(tier: Tier): Task {
  const now = new Date(0).toISOString()
  return {
    project: asProjectSlug('t'),
    id: 'gh-1',
    storyId: 'gh-1',
    epicId: 'gh-1',
    title: 'Test task',
    description: 'desc',
    tier,
    dod: {
      acceptanceCriteria: ['ac1'],
      nfr: [],
      testsRequired: ['unit'],
      coverageFloor: 80,
      contextUpdates: [],
      requiresAdr: false,
    },
    estimatedCostUsd: 0.5,
    dependsOn: [],
    blocks: [],
    expectedFiles: [],
    stage: 'PLAN',
    status: 'planned',
    createdAt: now,
    updatedAt: now,
  }
}

// All four producers return a clean PASS — the happy path to the COMMIT gate.
beforeEach(() => {
  vi.mocked(runBuilder).mockResolvedValue(
    ok(agentResult({ commitSha: 'b1', diffPath: '', linesAdded: 1, linesRemoved: 0 })),
  )
  vi.mocked(runTester).mockResolvedValue(
    ok(
      agentResult({ testCommitSha: 't1', coveragePercent: 90, testsAdded: 1, testsPassing: true }),
    ),
  )
  vi.mocked(runReviewer).mockResolvedValue(
    ok(agentResult({ verdict: 'PASS', confidence: 0.9, findings: [] })),
  )
  vi.mocked(runChecker).mockResolvedValue(
    ok(agentResult({ version: 'checker/v1', verdict: 'PASS', confidence: 0.9, deficiencies: [] })),
  )
})

describe('runTask — trustState×tier COMMIT gate wiring (#62)', () => {
  it('holds a MANUAL Tier-0 clean task for HITL (gate fires; default enforce, flag omitted)', async () => {
    vi.mocked(readState).mockResolvedValue(ok(makeState('MANUAL')))
    // enforceTrustGate intentionally OMITTED → must default to enforce.
    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(0),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('hitl-pending')
    expect(r.value.stage).toBe('BLOCKED')
  })

  it('auto-commits a SUPERVISED Tier-4 clean task (ladder allows; merged)', async () => {
    vi.mocked(readState).mockResolvedValue(ok(makeState('SUPERVISED')))
    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('merged')
  })

  it('opts out on the manual path: enforceTrustGate=false → merged even under MANUAL Tier-0', async () => {
    vi.mocked(readState).mockResolvedValue(ok(makeState('MANUAL')))
    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(0),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
      enforceTrustGate: false,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('merged')
  })
})

// ─── rescue commit on subagent timeout (#107) ────────────────────────────

// ceiling timeout — NOT retried; used in finalizeFailure rescue-commit tests
function makeCeilingTimeoutErrorForRescue() {
  return err(
    makeError('subagent.timeout', 'subagent killed — ceiling', {
      cause: {
        reason: 'ceiling',
        idleSec: 120,
        ceilingSec: 600,
        recoveredTokens: { input: 100, output: 50 },
        recoveredCostUsd: 0.0123,
        toolCalls: 4,
        lastActivityAgoMs: 0,
        stdout: '',
        stderr: '',
      },
    }),
  )
}

describe('rescueCommit — best-effort partial work recovery', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
  })

  it('git add + commit fire when worktree is dirty', async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: ' M file.ts\n', stderr: '' }) // status
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // add
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // commit

    await rescueCommit('/tmp/repo', 'gh-107')

    expect(spawnSyncMock).toHaveBeenCalledTimes(3)
    expect(spawnSyncMock.mock.calls[0][1]).toEqual(['-C', '/tmp/repo', 'status', '--porcelain'])
    expect(spawnSyncMock.mock.calls[1][1]).toEqual(['-C', '/tmp/repo', 'add', '-A'])
    expect(spawnSyncMock.mock.calls[2][1]).toEqual([
      '-C',
      '/tmp/repo',
      'commit',
      '--no-verify',
      '-m',
      'wip: partial work rescued from timed-out task gh-107',
    ])
  })

  it('is a no-op (no add, no commit) when worktree is clean', async () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })

    await rescueCommit('/tmp/repo', 'gh-107')

    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
    expect(spawnSyncMock.mock.calls[0][1]).toContain('status')
  })

  it('never throws when git itself fails (e.g. not a repo)', async () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    })

    await expect(rescueCommit('/tmp/repo', 'gh-107')).resolves.toBeUndefined()
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })

  it('swallows thrown errors (best-effort never propagates)', async () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error('spawn ENOENT')
    })

    await expect(rescueCommit('/tmp/repo', 'gh-107')).resolves.toBeUndefined()
  })
})

describe('finalizeFailure — rescue commit wiring (#107)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
    vi.mocked(readState).mockResolvedValue(ok(makeState('SUPERVISED')))
    vi.mocked(writeAuditRow).mockClear()
  })

  it('timeout error with dirty worktree → git add + commit called; notes mention rescue', async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: ' M src/a.ts\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
    // ceiling timeout is not retried (#148) → goes straight to finalizeFailure + rescue commit
    vi.mocked(runBuilder).mockResolvedValueOnce(makeCeilingTimeoutErrorForRescue())

    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('failed')
    expect(r.value.notes).toContain('rescue commit attempted in worktree')

    const gitCalls = spawnSyncMock.mock.calls.filter((c) => c[0] === 'git')
    expect(gitCalls).toHaveLength(3)
    expect(gitCalls[1][1]).toEqual(['-C', '/tmp/sdlc-test-repo', 'add', '-A'])
    expect(gitCalls[2][1][2]).toBe('commit')
  })

  it('timeout error with clean worktree → status checked, but no add/commit', async () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
    vi.mocked(runBuilder).mockResolvedValueOnce(makeCeilingTimeoutErrorForRescue())

    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('failed')
    expect(r.value.notes).toContain('rescue commit attempted in worktree')

    const gitCalls = spawnSyncMock.mock.calls.filter((c) => c[0] === 'git')
    expect(gitCalls).toHaveLength(1)
    expect(gitCalls[0][1]).toContain('status')
  })

  it('non-timeout error → rescueCommit NOT invoked, notes omit rescue language', async () => {
    vi.mocked(runBuilder).mockResolvedValueOnce(
      err(makeError('builder.crash', 'something else went wrong')),
    )

    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('failed')
    expect(r.value.notes).not.toContain('rescue commit')

    const gitCalls = spawnSyncMock.mock.calls.filter((c) => c[0] === 'git')
    expect(gitCalls).toHaveLength(0)
  })

  it('timeout error with stdout/stderr → failure audit row written with lastOutput notes (#16)', async () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // rescue commit: clean worktree
    vi.mocked(runBuilder).mockResolvedValueOnce(
      err(
        makeError('subagent.timeout', 'subagent killed — ceiling', {
          cause: {
            reason: 'ceiling',
            idleSec: 120,
            ceilingSec: 600,
            recoveredTokens: { input: 100, output: 50 },
            recoveredCostUsd: 0.012,
            toolCalls: 4,
            lastActivityAgoMs: 0,
            stdout: 'writing TypeScript code here...',
            stderr: 'WARNING: tool call timed out',
          },
        }),
      ),
    )

    await runTask({
      project: asProjectSlug('t'),
      task: makeTask(2),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    // Find the 'timeout' outcome row among all writeAuditRow calls
    const auditCalls = vi.mocked(writeAuditRow).mock.calls
    const timeoutRow = auditCalls.find(([, row]) => row.outcome === 'timeout')
    expect(timeoutRow).toBeDefined()
    expect(timeoutRow?.[1].agent).toBe('builder')
    expect(timeoutRow?.[1].stage).toBe('BUILD')
    expect(timeoutRow?.[1].tier).toBe(2)
    expect(timeoutRow?.[1].notes).toContain('[lastOutput:stdout]')
    expect(timeoutRow?.[1].notes).toContain('writing TypeScript code here')
    expect(timeoutRow?.[1].notes).toContain('[lastOutput:stderr]')
    expect(timeoutRow?.[1].notes).toContain('WARNING: tool call timed out')
  })
})

// ─── resetWorktreeToHead (#148) ──────────────────────────────────────────────

describe('resetWorktreeToHead — clean worktree before timeout retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
  })

  it('runs reset --hard + clean -fd when repo is reachable', async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // reset
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // clean

    await resetWorktreeToHead('/tmp/repo')

    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
    expect(spawnSyncMock.mock.calls[0][1]).toEqual(['-C', '/tmp/repo', 'reset', '--hard', 'HEAD'])
    expect(spawnSyncMock.mock.calls[1][1]).toEqual(['-C', '/tmp/repo', 'clean', '-fd'])
  })

  it('never throws when reset fails', async () => {
    spawnSyncMock.mockReturnValueOnce({ status: 128, stdout: '', stderr: 'fatal: not a repo' })
    await expect(resetWorktreeToHead('/tmp/repo')).resolves.toBeUndefined()
  })

  it('never throws when spawn itself throws', async () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error('spawn ENOENT')
    })
    await expect(resetWorktreeToHead('/tmp/repo')).resolves.toBeUndefined()
  })
})

// ─── Timeout retry wiring (#148) ─────────────────────────────────────────────

function makeIdleTimeoutError() {
  return err(
    makeError('subagent.timeout', 'subagent killed on idle', {
      cause: {
        reason: 'idle',
        idleSec: 120,
        ceilingSec: 600,
        recoveredTokens: { input: 100, output: 50 },
        recoveredCostUsd: 0.005,
        toolCalls: 4,
        lastActivityAgoMs: 121_000,
        stdout: '',
        stderr: '',
      },
    }),
  )
}

function makeStalledTimeoutError() {
  return err(
    makeError('subagent.timeout', 'subagent killed — stalled', {
      cause: {
        reason: 'stalled',
        idleSec: 120,
        ceilingSec: 600,
        recoveredTokens: { input: 500, output: 20 },
        recoveredCostUsd: 0.012,
        toolCalls: 22,
        lastActivityAgoMs: 5_000,
        stdout: '',
        stderr: '',
      },
    }),
  )
}

function makeCeilingTimeoutError() {
  return err(
    makeError('subagent.timeout', 'subagent killed — ceiling', {
      cause: {
        reason: 'ceiling',
        idleSec: 120,
        ceilingSec: 600,
        recoveredTokens: { input: 1000, output: 200 },
        recoveredCostUsd: 0.03,
        toolCalls: 50,
        lastActivityAgoMs: 1_000,
        stdout: '',
        stderr: '',
      },
    }),
  )
}

describe('timeout retry wiring (#148) — BUILD stage', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset call counts from previous tests in the file
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    vi.mocked(readState).mockResolvedValue(ok(makeState('SUPERVISED')))
    // Re-establish all happy-path defaults (cleared by clearAllMocks)
    vi.mocked(runBuilder).mockResolvedValue(
      ok(agentResult({ commitSha: 'b1', diffPath: '', linesAdded: 1, linesRemoved: 0 })),
    )
    vi.mocked(runTester).mockResolvedValue(
      ok(
        agentResult({
          testCommitSha: 't1',
          coveragePercent: 90,
          testsAdded: 1,
          testsPassing: true,
        }),
      ),
    )
    vi.mocked(runReviewer).mockResolvedValue(
      ok(agentResult({ verdict: 'PASS', confidence: 0.9, findings: [] })),
    )
    vi.mocked(runChecker).mockResolvedValue(
      ok(
        agentResult({ version: 'checker/v1', verdict: 'PASS', confidence: 0.9, deficiencies: [] }),
      ),
    )
  })

  it('BUILD idle timeout → cold retry → success → merged; retriesUsed stays 0', async () => {
    vi.mocked(runBuilder)
      .mockResolvedValueOnce(makeIdleTimeoutError()) // first attempt: idle timeout
      .mockResolvedValueOnce(
        ok(agentResult({ commitSha: 'b1', diffPath: '', linesAdded: 1, linesRemoved: 0 })),
      ) // retry: success

    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('merged')
    expect(r.value.retriesUsed).toBe(0)

    // Verify worktree was reset before retry
    const gitCalls = spawnSyncMock.mock.calls.filter((c) => c[0] === 'git')
    expect(gitCalls.some((c) => (c[1] as string[]).includes('reset'))).toBe(true)
    expect(gitCalls.some((c) => (c[1] as string[]).includes('clean'))).toBe(true)

    // Verify BUILD was called twice
    expect(vi.mocked(runBuilder)).toHaveBeenCalledTimes(2)
  })

  it('BUILD stalled timeout → cold retry with nudge → success → merged', async () => {
    vi.mocked(runBuilder)
      .mockResolvedValueOnce(makeStalledTimeoutError())
      .mockResolvedValueOnce(
        ok(agentResult({ commitSha: 'b1', diffPath: '', linesAdded: 1, linesRemoved: 0 })),
      )

    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('merged')

    // Second call should have timeoutNudge in payload
    const secondCall = vi.mocked(runBuilder).mock.calls[1]
    expect(secondCall[0].payload.timeoutNudge).toContain('read without writing')
  })

  it('BUILD ceiling timeout → BLOCKED immediately (no retry)', async () => {
    vi.mocked(runBuilder).mockResolvedValueOnce(makeCeilingTimeoutError())

    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('failed')
    expect(vi.mocked(runBuilder)).toHaveBeenCalledTimes(1)
  })

  it('BUILD idle timeout twice → BLOCKED after retry cap (1); notes surface timeout count', async () => {
    vi.mocked(runBuilder)
      .mockResolvedValueOnce(makeIdleTimeoutError()) // first attempt: idle timeout
      .mockResolvedValueOnce(makeIdleTimeoutError()) // retry: also times out → cap exhausted

    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('failed')
    expect(r.value.notes).toContain('timeout retries attempted: 1')
    expect(vi.mocked(runBuilder)).toHaveBeenCalledTimes(2)
  })
})

describe('timeout retry wiring (#148) — TEST stage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    vi.mocked(readState).mockResolvedValue(ok(makeState('SUPERVISED')))
    vi.mocked(runBuilder).mockResolvedValue(
      ok(agentResult({ commitSha: 'b1', diffPath: '', linesAdded: 1, linesRemoved: 0 })),
    )
    vi.mocked(runTester).mockResolvedValue(
      ok(
        agentResult({
          testCommitSha: 't1',
          coveragePercent: 90,
          testsAdded: 1,
          testsPassing: true,
        }),
      ),
    )
    vi.mocked(runReviewer).mockResolvedValue(
      ok(agentResult({ verdict: 'PASS', confidence: 0.9, findings: [] })),
    )
    vi.mocked(runChecker).mockResolvedValue(
      ok(
        agentResult({ version: 'checker/v1', verdict: 'PASS', confidence: 0.9, deficiencies: [] }),
      ),
    )
  })

  it('TEST idle timeout → cold retry → success → merged', async () => {
    vi.mocked(runTester)
      .mockResolvedValueOnce(makeIdleTimeoutError())
      .mockResolvedValueOnce(
        ok(
          agentResult({
            testCommitSha: 't1',
            coveragePercent: 90,
            testsAdded: 1,
            testsPassing: true,
          }),
        ),
      )

    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(4),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('merged')
    expect(vi.mocked(runTester)).toHaveBeenCalledTimes(2)
  })
})

describe('#77 — hitl-pending instead of failed when REVIEWER returns agent.invalid-response on converged work', () => {
  it('returns hitl-pending when REVIEWER emits agent.invalid-response and BUILD committed a SHA', async () => {
    vi.mocked(readState).mockResolvedValue(ok(makeState('SUPERVISED')))
    vi.mocked(runReviewer).mockResolvedValue(
      err(makeError('agent.invalid-response', 'Agent response was not valid JSON', {})),
    )
    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(2),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('hitl-pending')
    expect(r.value.notes).toMatch(/agent.invalid-response/)
    expect(r.value.notes).toMatch(/b1/) // commitSha from beforeEach runBuilder mock
  })

  it('returns failed (not hitl-pending) when REVIEWER fails for a non-parse reason', async () => {
    vi.mocked(readState).mockResolvedValue(ok(makeState('SUPERVISED')))
    vi.mocked(runReviewer).mockResolvedValue(err(makeError('agent.timeout', 'Agent timed out', {})))
    const r = await runTask({
      project: asProjectSlug('t'),
      task: makeTask(2),
      targetRepo: '/tmp/sdlc-test-repo',
      branch: 'feature/gh-1',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result).toBe('failed')
  })
})

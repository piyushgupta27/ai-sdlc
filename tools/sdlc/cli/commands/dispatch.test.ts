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
vi.mock('../../orchestrator/validations.js', () => ({
  runValidations: vi.fn(),
  hasDeterministicFailure: vi.fn(),
}))
vi.mock('../../sandbox/index.js', () => ({
  provisionWorktreeSandbox: vi.fn(),
  detectLockfileDrift: vi.fn(),
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
import { hasDeterministicFailure, runValidations } from '../../orchestrator/validations.js'
import { detectLockfileDrift, provisionWorktreeSandbox } from '../../sandbox/index.js'
import { buildPrBody, runDispatch } from './dispatch.js'

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
  // config.json exists; pull_request_template.md does not (integration tests
  // don't assert on PR body content — null templateContent → minimal fallback)
  existsSyncMock.mockImplementation((p: string) => String(p).endsWith('config.json'))
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

  // Pre-PR validation gate (#112): default green (no commands → gate skipped).
  vi.mocked(runValidations).mockResolvedValue({ validations: {}, details: [] })
  vi.mocked(hasDeterministicFailure).mockReturnValue(false)

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
    spawnMock
      .mockReturnValueOnce(makeChildProcess(0, '')) // git diff (lockfile guard #15 — no pkg files)
      .mockReturnValueOnce(makeChildProcess(1, '', 'fatal: no upstream branch')) // git push fails

    const code = await runDispatch(ARGV)

    expect(code).toBe(1)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Blocked')
    expect(vi.mocked(moveItem)).not.toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
  })

  it('moves card to Blocked and exits 1 when gh pr create fails', async () => {
    spawnMock
      .mockReturnValueOnce(makeChildProcess(0, '')) // git diff (lockfile guard #15 — no pkg files)
      .mockReturnValueOnce(makeChildProcess(0)) // git push succeeds
      .mockReturnValueOnce(makeChildProcess(1, '', 'already exists')) // gh pr create fails

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

// ─── Suite 3 (gh-112): pre-PR validation gate ────────────────────────────────

describe('dispatchFromBoard — pre-PR validation gate (#112)', () => {
  // Config with validationCommands declared — activates the gate.
  const CFG_WITH_VALIDATION = JSON.stringify({
    repoPath: '/fake/repo',
    owner: 'fakeowner',
    validationCommands: { typecheck: 'pnpm run typecheck', lint: 'pnpm run lint' },
  })

  beforeEach(() => {
    vi.mocked(listItems)
      .mockResolvedValueOnce(ok([fakeItem]))
      .mockResolvedValue(ok([]))
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('merged', 'abc123', 'feature/gh-1')))
  })

  it('blocks PR and moves card to Blocked when validations are red', async () => {
    readFileMock.mockResolvedValue(CFG_WITH_VALIDATION)
    vi.mocked(runValidations).mockResolvedValue({
      validations: { tsc: 'fail', lint: 'pass' },
      details: [],
    })
    vi.mocked(hasDeterministicFailure).mockReturnValue(true)

    const code = await runDispatch(ARGV)

    expect(code).toBe(1)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Blocked')
    expect(vi.mocked(moveItem)).not.toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
    // Must NOT push to remote when validations are red
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('opens PR normally when validationCommands are configured and all green', async () => {
    readFileMock.mockResolvedValue(CFG_WITH_VALIDATION)
    vi.mocked(runValidations).mockResolvedValue({
      validations: { tsc: 'pass', lint: 'pass' },
      details: [],
    })
    vi.mocked(hasDeterministicFailure).mockReturnValue(false)

    const code = await runDispatch(ARGV)

    expect(code).toBe(0)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
    expect(vi.mocked(runValidations)).toHaveBeenCalledWith(
      '/tmp/fake-sandbox',
      expect.objectContaining({ typecheck: 'pnpm run typecheck' }),
    )
  })

  it('skips the gate and opens PR when no validationCommands are configured', async () => {
    // Default readFileMock returns config without validationCommands
    const code = await runDispatch(ARGV)

    expect(code).toBe(0)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
    expect(vi.mocked(runValidations)).not.toHaveBeenCalled()
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

// ─── Suite 4: buildPrBody unit tests ─────────────────────────────────────────

// Minimal template that mirrors the real .github/pull_request_template.md
// structure. Human sections (3, 3b, 5, 8, 9, 10) keep their stub text so tests
// can assert the platform does NOT overwrite them.
const FAKE_TEMPLATE = [
  '## 1 · TL;DR',
  '',
  '_stub: one-liner_',
  '',
  '## 2 · What & why',
  '',
  '_stub: what changed and why_',
  '',
  '## 3 · Blast radius & risk',
  '',
  '- **Reach** — _stub reach_',
  '- **Rollback** — _stub rollback_',
  '',
  '## 3b · Security review',
  '',
  '- **Ran** — _stub security_',
  '',
  '## 4 · Evidence',
  '',
  '_stub: fill me in_',
  '',
  '## 5 · Diff map',
  '',
  '_stub diff_',
  '',
  '## 6 · Audit & provenance',
  '',
  '_stub audit_',
  '',
  '## 7 · Governance',
  '',
  '_stub governance_',
  '',
  '## 8 · Decision',
  '',
  '_stub decision_',
  '',
  '## 9 · Backlog',
  '',
  '_stub backlog_',
  '',
  '## 10 · Post-merge',
  '',
  '_stub post-merge_',
].join('\n')

function makeTask(
  overrides?: Partial<ReturnType<typeof makeTask>>,
): Parameters<typeof buildPrBody>[0]['task'] {
  const now = new Date().toISOString()
  return {
    project: asProjectSlug('testproject'),
    id: 'gh-99',
    storyId: 'gh-99',
    epicId: 'gh-99',
    title: 'Add feature X',
    description: 'Implements feature X as described in the spec.',
    tier: 2,
    dod: {
      acceptanceCriteria: ['X works', 'Y is covered by tests'],
      nfr: [],
      testsRequired: ['unit'],
      coverageFloor: 70,
      contextUpdates: [],
      requiresAdr: false,
    },
    estimatedCostUsd: 0.5,
    dependsOn: [],
    blocks: [],
    expectedFiles: [],
    stage: 'PLAN' as const,
    status: 'planned' as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('buildPrBody', () => {
  const baseArgs = {
    task: makeTask(),
    issueNumber: 99,
    branch: 'feature/gh-99',
    commitSha: 'abcdef1234567890',
    auditRunIds: ['run-1', 'run-2'],
    costUsd: 0.0123,
    retriesUsed: 1,
    gateDetails: [] as Parameters<typeof buildPrBody>[0]['gateDetails'],
  }

  describe('templateContent: null — minimal fallback', () => {
    it('contains Closes reference and summary', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: null })
      expect(body).toContain('Closes #99')
      expect(body).toContain('## Summary')
      expect(body).toContain('Implements feature X')
    })

    it('lists acceptance criteria as checked items', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: null })
      expect(body).toContain('- [x] X works')
      expect(body).toContain('- [x] Y is covered by tests')
    })

    it('includes audit footer with short SHA and cost', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: null })
      expect(body).toContain('`abcdef12`')
      expect(body).toContain('$0.0123')
    })

    it('does not include template section headers', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: null })
      expect(body).not.toContain('## 1 ·')
      expect(body).not.toContain('## 4 ·')
    })
  })

  describe('templateContent: string — dynamic template parsing', () => {
    it('preserves all section headers from the template', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: FAKE_TEMPLATE })
      for (const sec of [
        '## 1 ·',
        '## 2 ·',
        '## 3 ·',
        '## 3b ·',
        '## 4 ·',
        '## 5 ·',
        '## 6 ·',
        '## 7 ·',
        '## 8 ·',
        '## 9 ·',
        '## 10 ·',
      ]) {
        expect(body).toContain(sec)
      }
    })

    it('section 1 (TL;DR) is filled with issue ref — not template stub', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: FAKE_TEMPLATE })
      expect(body).toContain('closes #99')
      expect(body).toContain('gh-99')
      expect(body).not.toContain('_stub: one-liner_')
    })

    it('human sections preserve the template stub text unchanged', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: FAKE_TEMPLATE })
      expect(body).toContain('- **Reach** — _stub reach_') // §3 preserved
      expect(body).toContain('- **Ran** — _stub security_') // §3b preserved
      expect(body).toContain('_stub diff_') // §5 preserved
      expect(body).toContain('_stub decision_') // §8 preserved
    })

    it('a new section added to the template passes through verbatim', () => {
      const extendedTemplate = `${FAKE_TEMPLATE}\n## 11 · Performance\n\n_stub perf_\n`
      const body = buildPrBody({ ...baseArgs, templateContent: extendedTemplate })
      expect(body).toContain('## 11 · Performance')
      expect(body).toContain('_stub perf_')
    })

    it('section 4 (Evidence) lists audit run IDs and gate status', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: FAKE_TEMPLATE })
      expect(body).toContain('run-1, run-2')
      expect(body).toContain('no configured checks run')
      expect(body).not.toContain('_stub: fill me in_') // stub replaced
    })

    it('section 4 with gateDetails shows check results', () => {
      const body = buildPrBody({
        ...baseArgs,
        gateDetails: [
          { check: 'tsc', command: 'pnpm typecheck', result: 'pass' as const, exitCode: 0 },
          { check: 'lint', command: 'pnpm lint', result: 'pass' as const, exitCode: 0 },
        ],
        templateContent: FAKE_TEMPLATE,
      })
      expect(body).toContain('tsc pass')
      expect(body).toContain('lint pass')
    })

    it('section 4 acceptance criteria are indented checked items', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: FAKE_TEMPLATE })
      expect(body).toContain('  - [x] X works')
      expect(body).toContain('  - [x] Y is covered by tests')
    })

    it('section 6 includes branch, short SHA, retries, and cost', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: FAKE_TEMPLATE })
      expect(body).toContain('`feature/gh-99`')
      expect(body).toContain('`abcdef12`')
      expect(body).toContain('retries: 1')
      expect(body).toContain('$0.0123')
      expect(body).not.toContain('_stub audit_') // stub replaced
    })

    it('section 7 governance checklist replaces stub with unchecked items', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: FAKE_TEMPLATE })
      expect(body).toContain('- [ ] PR-only, squash')
      expect(body).toContain('- [ ] No open P0/P1')
      expect(body).not.toContain('_stub governance_') // stub replaced
    })

    it('truncates TL;DR to 280 chars with ellipsis for long descriptions', () => {
      const body = buildPrBody({
        ...baseArgs,
        task: makeTask({ description: 'A'.repeat(400) }),
        templateContent: FAKE_TEMPLATE,
      })
      expect(body).toContain('...')
    })

    it('does not truncate short descriptions', () => {
      const body = buildPrBody({ ...baseArgs, templateContent: FAKE_TEMPLATE })
      expect(body).not.toContain('...')
    })
  })
})

// ─── Suite 5 (#15 follow-on): lockfile drift guard wiring ────────────────────

describe('dispatchFromBoard — lockfile drift guard wiring (#15)', () => {
  beforeEach(() => {
    vi.mocked(listItems)
      .mockResolvedValueOnce(ok([fakeItem]))
      .mockResolvedValue(ok([]))
    vi.mocked(runTask).mockResolvedValue(ok(makeOutcome('merged', 'abc123', 'feature/gh-1')))
  })

  it('blocks push and moves card to Blocked when package.json specifier was reverted via --theirs', async () => {
    vi.mocked(detectLockfileDrift).mockResolvedValue(
      ok({ drifted: true, reason: 'is-array: package.json has ^1.0.0, lockfile has ^2.0.0' }),
    )
    spawnMock.mockReturnValueOnce(makeChildProcess(0, 'package.json\n')) // git diff → pkg touched

    const code = await runDispatch(ARGV)

    expect(code).toBe(1)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Blocked')
    expect(vi.mocked(moveItem)).not.toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
    // push must never fire — guard returns before reaching it
    expect(spawnMock).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['push']),
      expect.anything(),
    )
  })

  it('proceeds to push when package.json is touched but lockfile is clean', async () => {
    vi.mocked(detectLockfileDrift).mockResolvedValue(ok({ drifted: false }))
    spawnMock
      .mockReturnValueOnce(makeChildProcess(0, 'package.json\n')) // git diff → pkg touched
      .mockReturnValueOnce(makeChildProcess(0)) // git push succeeds
      .mockReturnValueOnce(makeChildProcess(0, 'https://github.com/org/repo/pull/2\n')) // gh pr create

    const code = await runDispatch(ARGV)

    expect(code).toBe(0)
    expect(vi.mocked(moveItem)).toHaveBeenCalledWith(fakeProject, fakeItem.id, 'Done')
    expect(spawnMock).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['push']),
      expect.anything(),
    )
  })
})

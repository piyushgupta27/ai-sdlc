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
  ok,
} from '../types/index.js'

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
import { runTask } from './index.js'
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

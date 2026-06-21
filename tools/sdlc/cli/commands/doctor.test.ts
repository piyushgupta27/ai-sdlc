/**
 * Tests for doctor.ts — covers the 3 ai-sdlc-specific checks added in gh-161:
 *   5. blast-radius workflow present
 *   6. pr-labels workflow present
 *   7. 15 canonical labels present (with gh unavailability fallback)
 *
 * Also verifies that these checks are skipped for non-ai-sdlc slugs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── hoist mock refs ─────────────────────────────────────────────────────────

const { spawnSyncMock, existsSyncMock, readFileMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readFileMock: vi.fn(),
}))

// ─── module mocks ────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))
vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  writeFile: vi.fn(),
}))

vi.mock('../../orchestrator/state.js', () => ({
  listProjects: vi.fn(),
  projectDir: vi.fn(() => '/fake-sdlc/projects/ai-sdlc'),
}))

vi.mock('../project-contract.js', () => ({
  ARTIFACT_DIRS: ['.audit/', '.sdlc-queue/'],
  checkRules: vi.fn(() => 'ok'),
  gitignoreMissing: vi.fn(() => []),
  injectRules: vi.fn((s: string) => s),
  loadCanonicalRules: vi.fn(async () => 'rules content'),
}))

// ─── imports ─────────────────────────────────────────────────────────────────

import { runDoctor } from './doctor.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

const ALL_15_LABELS = JSON.stringify([
  { name: 'tier:0' },
  { name: 'tier:1' },
  { name: 'tier:2' },
  { name: 'tier:3' },
  { name: 'tier:4' },
  { name: 'blocked' },
  { name: 'hitl-pending' },
  { name: 'security' },
  { name: 'adhoc' },
  { name: 'dogfood' },
  { name: 'phase:0-floor' },
  { name: 'phase:1-build' },
  { name: 'phase:2-scale' },
  { name: 'phase:3-ops' },
  { name: 'phase:4-optimize' },
])

const AI_SDLC_CONFIG = JSON.stringify({
  slug: 'ai-sdlc',
  repoPath: '/fake/ai-sdlc-repo',
  owner: 'piyushgupta27',
  runtime: 'node',
  visibility: 'public',
  onboardedAt: '2024-01-01T00:00:00Z',
  validationCommands: {
    typecheck: 'pnpm run typecheck',
    lint: 'pnpm run lint',
    test: 'pnpm run test',
  },
})

const OTHER_PROJECT_CONFIG = JSON.stringify({
  slug: 'other-project',
  repoPath: '/fake/other-repo',
  owner: 'piyushgupta27',
  runtime: 'node',
  visibility: 'public',
  onboardedAt: '2024-01-01T00:00:00Z',
  validationCommands: {
    typecheck: 'pnpm run typecheck',
    lint: 'pnpm run lint',
    test: 'pnpm run test',
  },
})

// ─── default setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()

  // Default: all files present, spawnSync returns all 15 labels
  existsSyncMock.mockReturnValue(true)
  readFileMock.mockResolvedValue(AI_SDLC_CONFIG)
  spawnSyncMock.mockReturnValue({ status: 0, stdout: ALL_15_LABELS, stderr: '' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── blast-radius workflow check (check #5) ──────────────────────────────────

describe('blast-radius workflow check', () => {
  it('passes when .github/workflows/blast-radius.yml exists', async () => {
    existsSyncMock.mockImplementation((_p: string) => true)
    spawnSyncMock.mockReturnValue({ status: 0, stdout: ALL_15_LABELS, stderr: '' })

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    await runDoctor(['--project', 'ai-sdlc', '--json'])

    const json = JSON.parse(output.join(''))
    const check = json[0].checks.find((c: { name: string }) => c.name === 'blast-radius workflow')
    expect(check).toBeDefined()
    expect(check.status).toBe('pass')
    expect(check.detail).toBe('present')
  })

  it('fails when .github/workflows/blast-radius.yml is missing', async () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (String(p).includes('blast-radius.yml')) return false
      return true
    })

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    const code = await runDoctor(['--project', 'ai-sdlc', '--json'])

    const json = JSON.parse(output.join(''))
    const check = json[0].checks.find((c: { name: string }) => c.name === 'blast-radius workflow')
    expect(check).toBeDefined()
    expect(check.status).toBe('fail')
    expect(check.detail).toBe('missing .github/workflows/blast-radius.yml')
    expect(check.fixable).toBe(false)
    expect(code).toBe(1)
  })
})

// ─── pr-labels workflow check (check #6) ─────────────────────────────────────

describe('pr-labels workflow check', () => {
  it('passes when .github/workflows/pr-labels.yml exists', async () => {
    existsSyncMock.mockReturnValue(true)

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    await runDoctor(['--project', 'ai-sdlc', '--json'])

    const json = JSON.parse(output.join(''))
    const check = json[0].checks.find((c: { name: string }) => c.name === 'pr-labels workflow')
    expect(check).toBeDefined()
    expect(check.status).toBe('pass')
    expect(check.detail).toBe('present')
  })

  it('fails when .github/workflows/pr-labels.yml is missing', async () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (String(p).includes('pr-labels.yml')) return false
      return true
    })

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    const code = await runDoctor(['--project', 'ai-sdlc', '--json'])

    const json = JSON.parse(output.join(''))
    const check = json[0].checks.find((c: { name: string }) => c.name === 'pr-labels workflow')
    expect(check).toBeDefined()
    expect(check.status).toBe('fail')
    expect(check.detail).toBe('missing .github/workflows/pr-labels.yml')
    expect(check.fixable).toBe(false)
    expect(code).toBe(1)
  })
})

// ─── canonical labels check (check #7) ───────────────────────────────────────

describe('canonical labels check', () => {
  it('passes when all 15 labels are present', async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: ALL_15_LABELS, stderr: '' })

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    await runDoctor(['--project', 'ai-sdlc', '--json'])

    const json = JSON.parse(output.join(''))
    const check = json[0].checks.find((c: { name: string }) => c.name === 'canonical labels')
    expect(check).toBeDefined()
    expect(check.status).toBe('pass')
    expect(check.detail).toBe('15 canonical labels present')
  })

  it('fails and lists missing labels when some are absent', async () => {
    const partial = JSON.stringify([{ name: 'tier:0' }, { name: 'tier:1' }, { name: 'blocked' }])
    spawnSyncMock.mockReturnValue({ status: 0, stdout: partial, stderr: '' })

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    const code = await runDoctor(['--project', 'ai-sdlc', '--json'])

    const json = JSON.parse(output.join(''))
    const check = json[0].checks.find((c: { name: string }) => c.name === 'canonical labels')
    expect(check).toBeDefined()
    expect(check.status).toBe('fail')
    expect(check.detail).toContain('missing:')
    expect(check.detail).toContain('tier:2')
    expect(check.detail).toContain('phase:0-floor')
    expect(check.fixable).toBe(false)
    expect(code).toBe(1)
  })

  it('warns when gh is unavailable (non-zero exit)', async () => {
    spawnSyncMock.mockReturnValue({
      status: 127,
      stdout: '',
      stderr: 'gh: command not found',
      error: undefined,
    })

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    await runDoctor(['--project', 'ai-sdlc', '--json'])

    const json = JSON.parse(output.join(''))
    const check = json[0].checks.find((c: { name: string }) => c.name === 'canonical labels')
    expect(check).toBeDefined()
    expect(check.status).toBe('warn')
    expect(check.detail).toContain('gh unavailable')
  })
})

// ─── HELP string mentions ai-sdlc-specific checks (AC#5) ─────────────────────

describe('HELP output', () => {
  it('mentions ai-sdlc-specific checks section', async () => {
    let helpOut = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      helpOut += String(s)
      return true
    })

    const code = await runDoctor(['--help'])

    expect(code).toBe(0)
    expect(helpOut).toContain('ai-sdlc-specific checks')
    expect(helpOut).toContain('blast-radius.yml')
    expect(helpOut).toContain('pr-labels.yml')
    expect(helpOut).toContain('15 canonical GitHub labels')
  })
})

// ─── slug guard: ai-sdlc checks skipped for other projects ───────────────────

describe('ai-sdlc checks skipped for other slugs', () => {
  it('does not include blast-radius, pr-labels, or canonical-labels checks for non-ai-sdlc projects', async () => {
    readFileMock.mockResolvedValue(OTHER_PROJECT_CONFIG)

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    await runDoctor(['--project', 'other-project', '--json'])

    const json = JSON.parse(output.join(''))
    const checkNames = json[0].checks.map((c: { name: string }) => c.name)
    expect(checkNames).not.toContain('blast-radius workflow')
    expect(checkNames).not.toContain('pr-labels workflow')
    expect(checkNames).not.toContain('canonical labels')
    // execSync should never be called for non-ai-sdlc projects
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  it('includes exactly 4 checks for non-ai-sdlc projects', async () => {
    readFileMock.mockResolvedValue(OTHER_PROJECT_CONFIG)

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    await runDoctor(['--project', 'other-project', '--json'])

    const json = JSON.parse(output.join(''))
    expect(json[0].checks).toHaveLength(4)
  })

  it('includes 7 checks for ai-sdlc project', async () => {
    spawnSyncMock.mockReturnValue(ALL_15_LABELS)

    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      output.push(String(s))
      return true
    })

    await runDoctor(['--project', 'ai-sdlc', '--json'])

    const json = JSON.parse(output.join(''))
    expect(json[0].checks).toHaveLength(7)
  })
})

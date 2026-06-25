/**
 * Tests for the deterministic validation runner (H1 / F1) and asWorktreeCommands (#152).
 *
 * Uses trivial shell commands (`exit 0` / `exit 1`) so the test is hermetic and
 * fast — we're testing the exit-code → matrix mapping, not a real toolchain.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asWorktreeCommands, hasDeterministicFailure, runValidations } from './validations.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn() }
})

const existsSyncMock = vi.mocked(existsSync)

const REPO = '/tmp/test-repo'

beforeEach(() => {
  existsSyncMock.mockReturnValue(false)
})

describe('runValidations', () => {
  it('returns an empty matrix when no commands are configured', async () => {
    const r = await runValidations(process.cwd(), undefined)
    expect(r.validations).toEqual({})
    expect(r.details).toEqual([])
  })

  it('maps exit 0 → pass and non-zero → fail per configured check', async () => {
    const r = await runValidations(process.cwd(), {
      typecheck: 'exit 0',
      lint: 'exit 1',
      test: 'exit 0',
    })
    expect(r.validations.tsc).toBe('pass')
    expect(r.validations.lint).toBe('fail')
    expect(r.validations.tests).toBe('pass')
    expect(hasDeterministicFailure(r.validations)).toBe(true)
  })

  it('omits unconfigured checks rather than marking them fail', async () => {
    const r = await runValidations(process.cwd(), { test: 'exit 0' })
    expect(r.validations).toEqual({ tests: 'pass' })
    expect(hasDeterministicFailure(r.validations)).toBe(false)
  })

  it('records a non-existent command as fail and never throws', async () => {
    const r = await runValidations(process.cwd(), {
      test: 'this-command-does-not-exist-xyzzy',
    })
    expect(r.validations.tests).toBe('fail')
    expect(hasDeterministicFailure(r.validations)).toBe(true)
  })
})

describe('hasDeterministicFailure', () => {
  it('is false for an empty or all-pass matrix, true if any check failed', () => {
    expect(hasDeterministicFailure({})).toBe(false)
    expect(hasDeterministicFailure({ tsc: 'pass', tests: 'pass' })).toBe(false)
    expect(hasDeterministicFailure({ tsc: 'pass', lint: 'fail' })).toBe(true)
  })
})

describe('asWorktreeCommands', () => {
  describe('no test command', () => {
    it('returns the same object when test is absent', () => {
      existsSyncMock.mockReturnValue(true) // vitest config present — still no-op
      const cmds = { typecheck: 'pnpm run typecheck', lint: 'pnpm run lint' }
      expect(asWorktreeCommands(cmds, REPO)).toBe(cmds)
    })
  })

  describe('no vitest config in repo', () => {
    it('returns the same object when no vitest.config.* exists', () => {
      existsSyncMock.mockReturnValue(false)
      const cmds = { test: 'pnpm run test' }
      expect(asWorktreeCommands(cmds, REPO)).toBe(cmds)
    })

    it('leaves jest-based commands untouched', () => {
      existsSyncMock.mockReturnValue(false)
      const cmds = { test: 'jest --runInBand' }
      expect(asWorktreeCommands(cmds, REPO)).toBe(cmds)
    })
  })

  describe('vitest config detected', () => {
    it('appends -- --reporter=default for vitest.config.ts', () => {
      existsSyncMock.mockImplementation((p) => p === join(REPO, 'vitest.config.ts'))
      const result = asWorktreeCommands({ test: 'pnpm run test' }, REPO)
      expect(result.test).toBe('pnpm run test -- --reporter=default')
    })

    it('appends -- --reporter=default for vitest.config.js', () => {
      existsSyncMock.mockImplementation((p) => p === join(REPO, 'vitest.config.js'))
      const result = asWorktreeCommands({ test: 'pnpm run test' }, REPO)
      expect(result.test).toBe('pnpm run test -- --reporter=default')
    })

    it('appends -- --reporter=default for vitest.config.mts', () => {
      existsSyncMock.mockImplementation((p) => p === join(REPO, 'vitest.config.mts'))
      const result = asWorktreeCommands({ test: 'pnpm run test' }, REPO)
      expect(result.test).toBe('pnpm run test -- --reporter=default')
    })

    it('preserves typecheck and lint unchanged', () => {
      existsSyncMock.mockImplementation((p) => p === join(REPO, 'vitest.config.ts'))
      const cmds = { typecheck: 'pnpm run typecheck', lint: 'pnpm run lint', test: 'pnpm run test' }
      const result = asWorktreeCommands(cmds, REPO)
      expect(result.typecheck).toBe('pnpm run typecheck')
      expect(result.lint).toBe('pnpm run lint')
    })

    it('returns a new object without mutating the input', () => {
      existsSyncMock.mockImplementation((p) => p === join(REPO, 'vitest.config.ts'))
      const cmds = { test: 'pnpm run test' }
      const result = asWorktreeCommands(cmds, REPO)
      expect(result).not.toBe(cmds)
      expect(cmds.test).toBe('pnpm run test')
    })
  })
})

describe('runValidations — secret scan (gitleaks)', () => {
  let fakeBinDir: string
  let fakeGitleaks: string
  let savedPath: string | undefined

  beforeEach(async () => {
    fakeBinDir = await mkdtemp(join(tmpdir(), 'ai-sdlc-test-gitleaks-'))
    fakeGitleaks = join(fakeBinDir, 'gitleaks')
    savedPath = process.env.PATH
    process.env.PATH = `${fakeBinDir}:${process.env.PATH ?? ''}`
  })

  afterEach(async () => {
    process.env.PATH = savedPath
    await rm(fakeBinDir, { recursive: true, force: true })
  })

  it('populates secrets=pass when gitleaks exits 0 (no leaks)', async () => {
    await writeFile(fakeGitleaks, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const result = await runValidations(process.cwd(), {})
    expect(result.validations.secrets).toBe('pass')
    const detail = result.details.find((d) => d.check === 'secrets')
    expect(detail?.result).toBe('pass')
    expect(detail?.command).toContain('gitleaks detect')
  })

  it('populates secrets=fail when gitleaks exits 1 (leak found), hasDeterministicFailure=true', async () => {
    await writeFile(fakeGitleaks, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const result = await runValidations(process.cwd(), {})
    expect(result.validations.secrets).toBe('fail')
    expect(hasDeterministicFailure(result.validations)).toBe(true)
    expect(result.details.find((d) => d.check === 'secrets')?.result).toBe('fail')
  })

  it('omits secrets field when gitleaks is not in PATH', async () => {
    process.env.PATH = savedPath // restore to env without fake bin
    const result = await runValidations(process.cwd(), {})
    expect(result.validations.secrets).toBeUndefined()
    expect(hasDeterministicFailure(result.validations)).toBe(false)
    expect(result.details.find((d) => d.check === 'secrets')).toBeUndefined()
  })
})

/**
 * Tests for the deterministic validation runner (H1 / F1).
 *
 * Uses trivial shell commands (`exit 0` / `exit 1`) so the test is hermetic and
 * fast — we're testing the exit-code → matrix mapping, not a real toolchain.
 */

import { describe, expect, it } from 'vitest'
import { hasDeterministicFailure, runValidations } from './validations.js'

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

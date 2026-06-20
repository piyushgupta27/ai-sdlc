/**
 * Integration test for lockfile drift detection (#15).
 *
 * Simulates the real failure mode: main upgraded a dep (package.json + lockfile
 * both at ^2.0.0), then `--theirs` reverted package.json to ^1.0.0 while the
 * lockfile stayed at the newer specifier. `pnpm install --frozen-lockfile`
 * catches this before push.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectLockfileDrift } from './lockfile-guard.js'

describe('detectLockfileDrift (integration) — #15 --theirs revert scenario', () => {
  it(
    'returns drifted=true when package.json specifier was reverted but lockfile kept the newer version',
    async () => {
      // Scenario: main had `is-array` at ^2.0.0 in both package.json and lockfile.
      // A feature branch still had ^1.0.0 in package.json (pre-upgrade).
      // `git checkout --theirs package.json` reverted it to ^1.0.0.
      // pnpm-lock.yaml was NOT reverted — still says specifier: ^2.0.0.
      // pnpm install --frozen-lockfile detects the specifier mismatch and fails.
      const dir = mkdtempSync(join(tmpdir(), 'sdlc-lockfile-guard-'))

      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'test-pkg',
          version: '1.0.0',
          dependencies: { 'is-array': '^1.0.0' }, // reverted by --theirs
        }),
      )

      // Lockfile still has the newer specifier from main.
      writeFileSync(
        join(dir, 'pnpm-lock.yaml'),
        [
          "lockfileVersion: '9.0'",
          '',
          'settings:',
          '  autoInstallPeers: true',
          '  excludeLinksFromLockfile: false',
          '',
          'importers:',
          '  .:',
          '    dependencies:',
          '      is-array:',
          '        specifier: ^2.0.0', // newer; mismatches package.json's ^1.0.0
          '        version: 2.0.0',
          '',
          'packages:',
          '',
          '  is-array@2.0.0:',
          "    resolution: {integrity: sha512-placeholder}",
        ].join('\n'),
      )

      const result = await detectLockfileDrift(dir)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      expect(result.value.drifted).toBe(true)
    },
    30_000,
  )
})

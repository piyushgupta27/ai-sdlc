/**
 * Lockfile drift guard — detects package.json / pnpm-lock.yaml desync (#15).
 *
 * The canonical failure mode: a feature branch has an older package.json (a dep
 * at ^1.x) while main already upgraded to ^2.x. If conflict resolution uses
 * `git checkout --theirs`, package.json gets the old specifier back but
 * pnpm-lock.yaml (which came from main) still has the newer specifier — and
 * `pnpm install --frozen-lockfile` starts failing in CI with
 * ERR_PNPM_OUTDATED_LOCKFILE.
 *
 * `detectLockfileDrift` runs `pnpm install --frozen-lockfile --lockfile-only`
 * in the worktree and treats a non-zero exit as drift. `--lockfile-only` skips
 * all package resolution and never writes node_modules, so the check is safe
 * in git worktrees where node_modules is symlinked to the main repo.
 *
 * Called from `maybeCreatePr()` in dispatch.ts only when the BUILDER's commit
 * touched `package.json` or `pnpm-lock.yaml`, to avoid adding install latency
 * to every dispatch.
 */

import { spawn } from 'node:child_process'
import type { AppError, Result } from '../types/index.js'
import { err, makeError, ok } from '../types/index.js'

export interface LockfileDriftResult {
  readonly drifted: boolean
  /** First 500 chars of pnpm stderr when drifted is true. */
  readonly reason?: string
}

/**
 * Run `pnpm install --frozen-lockfile --lockfile-only` in repoPath.
 *
 * Returns:
 *  - `ok({ drifted: false })` — lockfile consistent with package.json
 *  - `ok({ drifted: true, reason })` — mismatch detected; reason is pnpm's stderr
 *  - `err(...)` — pnpm could not be launched at all (not on PATH)
 */
export function detectLockfileDrift(
  repoPath: string,
): Promise<Result<LockfileDriftResult, AppError>> {
  return new Promise((resolve) => {
    let stderr = ''
    const proc = spawn('pnpm', ['install', '--frozen-lockfile', '--lockfile-only'], {
      cwd: repoPath,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    proc.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(ok({ drifted: false }))
      } else {
        resolve(ok({ drifted: true, reason: stderr.slice(0, 500) }))
      }
    })
    proc.on('error', (e) => {
      resolve(
        err(
          makeError(
            'lockfile.check-failed',
            `pnpm install --frozen-lockfile --lockfile-only could not be launched: ${e.message}`,
            { cause: e, fix: 'Ensure pnpm is installed and available on PATH.' },
          ),
        ),
      )
    })
  })
}

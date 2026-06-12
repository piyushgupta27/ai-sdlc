/**
 * WorktreeSandbox — per-dispatch isolation via `git worktree` (issue #19).
 *
 * Each dispatch gets its own worktree at `<repoPath>/.sdlc-sandboxes/<taskId>/`
 * on a fresh feature branch, so concurrent runs never share a checkout (git
 * enforces one-branch-per-worktree — the cross-contamination fix). The worktree
 * shares the repo's object store (cheap; no clone), gets `node_modules`
 * symlinked (preserves the project's Node-pinned native bindings), and seeds a
 * git-crypt key when the repo uses one. Its `.audit/` + `.sdlc-queue/` are
 * symlinked to the repo root so the audit chain + HITL gates write to durable
 * storage and survive teardown. See `docs/design/sandbox-isolation.md`.
 */

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type Result, err, makeError, ok } from '../types/index.js'
import type { Sandbox, SandboxRequest } from './types.js'

const SANDBOX_DIRNAME = '.sdlc-sandboxes'
const GIT_CRYPT_KEY_REL = join('git-crypt', 'keys', 'default')
/** Workspace dirs symlinked to the repo root so they survive teardown. */
const DURABLE_DIRS = ['.audit', '.sdlc-queue'] as const

interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run a git command. Never rejects — non-zero exit is reported via `code`.
 * `timeoutMs` bounds the call (e.g. a `git fetch` against an unreachable remote);
 * on timeout execFile kills the child and we report a non-zero code so callers
 * fall back rather than hang.
 */
function runGit(args: readonly string[], cwd?: string, timeoutMs?: number): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 16 * 1024 * 1024, ...(timeoutMs ? { timeout: timeoutMs } : {}) },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : error
              ? 1
              : 0
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() })
      },
    )
  })
}

/** Filesystem-safe workspace name from a task id (e.g. `feature/x` → `feature-x`). */
function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]/g, '-')
}

/**
 * Serialize the git-mutating section of provisioning. `git worktree add` briefly
 * locks the repo's worktree admin; concurrent adds in one process can contend.
 * The lock window is ~ms, so serializing the add costs nothing while the
 * dispatches themselves stay fully parallel. (Cross-process concurrency relies
 * on git's own lock; the interim sole-occupancy rule covers the two-session case.)
 */
let gitMutationChain: Promise<unknown> = Promise.resolve()
function withGitMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = gitMutationChain.then(fn, fn)
  gitMutationChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function gitCryptKeyPath(repoPath: string): string {
  return join(repoPath, '.git', GIT_CRYPT_KEY_REL)
}

/**
 * Ensure the sandbox dir is ignored repo-locally via `.git/info/exclude` (not
 * the committed `.gitignore`), so worktrees never show as untracked noise or
 * get scanned by a whole-repo gate — even in target repos that don't yet ignore
 * it (see #37). Idempotent + permanent (the dir should always be excluded), so
 * no teardown revert is needed. Best-effort: a non-standard `.git` layout just
 * means the dir may show as untracked, which is not fatal.
 */
function ensureSandboxExcluded(repoPath: string): void {
  const excludePath = join(repoPath, '.git', 'info', 'exclude')
  const line = `${SANDBOX_DIRNAME}/`
  try {
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
    if (current.split('\n').some((l) => l.trim() === line)) return
    mkdirSync(dirname(excludePath), { recursive: true })
    const sep = current === '' || current.endsWith('\n') ? '' : '\n'
    writeFileSync(excludePath, `${current}${sep}${line}\n`)
  } catch {
    // best-effort — see doc comment
  }
}

/** True if a local branch with this name exists. */
async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const r = await runGit(
    ['-C', repoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
    undefined,
  )
  return r.code === 0
}

/**
 * Remove a stale worktree (crash orphan / re-dispatch of the same task).
 * Best-effort — errors are swallowed.
 *
 * Branch deletion is deliberately conditional: we delete the branch ONLY when
 * we just removed its orphan worktree (so it was our own incomplete run). A
 * branch that exists WITHOUT a worktree is a completed prior run's branch —
 * possibly backing an open PR — so we leave it untouched and let the subsequent
 * `worktree add -b` fail with a clear error rather than clobber it.
 */
async function precleanStale(
  repoPath: string,
  workspacePath: string,
  branch: string,
): Promise<void> {
  await runGit(['-C', repoPath, 'worktree', 'prune'])
  let worktreeRemoved = false
  if (existsSync(workspacePath)) {
    await runGit(['-C', repoPath, 'worktree', 'remove', '--force', workspacePath])
    worktreeRemoved = true
  }
  if (worktreeRemoved && (await branchExists(repoPath, branch))) {
    await runGit(['-C', repoPath, 'branch', '-D', branch])
  }
  await runGit(['-C', repoPath, 'worktree', 'prune'])
}

// ─── crash-lifecycle cleanup ─────────────────────────────────────────────────
//
// One installed set of signal handlers drains a registry of sync teardown
// thunks (avoids a listener per sandbox). cleanup() unregisters its own thunk.

const crashRegistry = new Map<string, () => void>()
let handlersInstalled = false

function installCrashHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true
  const drain = (signal: NodeJS.Signals) => {
    for (const teardown of crashRegistry.values()) {
      try {
        teardown()
      } catch {
        // best-effort; a crash teardown failure must not mask the signal
      }
    }
    crashRegistry.clear()
    // Re-raise with the default disposition so the process still exits.
    process.removeListener(signal, drain)
    process.kill(process.pid, signal)
  }
  process.once('SIGINT', drain)
  process.once('SIGTERM', drain)
}

/** Synchronous teardown — used by both cleanup() and the crash handlers. */
function teardownSync(repoPath: string, workspacePath: string, seededKey: string | null): void {
  // Secure-remove the copied git-crypt key first (defense-in-depth; the
  // worktree git-dir removal below also takes it).
  if (seededKey && existsSync(seededKey)) {
    rmSync(seededKey, { force: true })
  }
  if (existsSync(workspacePath)) {
    execFileSync('git', ['-C', repoPath, 'worktree', 'remove', '--force', workspacePath], {
      stdio: 'ignore',
    })
  }
  execFileSync('git', ['-C', repoPath, 'worktree', 'prune'], { stdio: 'ignore' })
}

/** Hard ceiling on the base-ref fetch so an unreachable remote can't hang a dispatch. */
const FETCH_TIMEOUT_MS = 20_000

/**
 * Resolve the base ref to the freshest MERGED tip (#100). For a plain branch
 * name (e.g. `main`), fetch it from origin and prefer `origin/<branch>` — so a
 * dispatch is never based off a **stale local branch** (the bug: a local `main`
 * left behind origin after a PR merged on the remote → the agent missed merged
 * work and rebuilt it divergently). Falls back to the given ref when there is no
 * remote / it can't be fetched. Skips `HEAD`, already-`origin/` refs, and a
 * FULL 40-char SHA (an unambiguous commit). Short hex strings are treated as
 * branch names — a hex-like branch (`deadbeef`) must still resolve to its origin
 * tip, not silently fall back to a stale local (caught in review).
 */
async function resolveBaseRef(
  repoPath: string,
  baseRef: string,
): Promise<{ readonly ref: string; readonly note?: string }> {
  if (baseRef === 'HEAD' || baseRef.startsWith('origin/') || /^[0-9a-f]{40}$/.test(baseRef)) {
    return { ref: baseRef }
  }
  // No remote at all → local-only workflow; expected, stay quiet.
  const remotes = await runGit(['-C', repoPath, 'remote'])
  if (!remotes.stdout.split(/\s+/).filter(Boolean).includes('origin')) {
    return { ref: baseRef }
  }
  // Bounded fetch: connect-timeout at the git layer + a hard execFile ceiling,
  // so an unreachable remote (TCP blackhole) falls back instead of hanging.
  const fetched = await runGit(
    ['-C', repoPath, '-c', 'http.connectTimeout=10', 'fetch', 'origin', baseRef],
    undefined,
    FETCH_TIMEOUT_MS,
  )
  if (fetched.code === 0) {
    const remote = await runGit([
      '-C',
      repoPath,
      'rev-parse',
      '--verify',
      '--quiet',
      `origin/${baseRef}`,
    ])
    if (remote.code === 0) return { ref: `origin/${baseRef}` }
    // Fetch ok but no such branch on origin (local-only branch / short SHA) → use as-is, quiet.
    return { ref: baseRef }
  }
  // origin exists but the fetch failed (network / unreachable / timeout) → warn: the local ref may be stale.
  return {
    ref: baseRef,
    note: `Could not fetch origin/${baseRef} (network/timeout) — based off local ${baseRef}, which may be stale.`,
  }
}

/**
 * Provision an isolated git worktree for one dispatch.
 *
 * On any failure after the worktree is created, tears down the partial worktree
 * before returning the error — never leaves an orphan behind.
 */
export async function provisionWorktreeSandbox(req: SandboxRequest): Promise<Result<Sandbox>> {
  const { repoPath, taskId, branch } = req
  const requestedBaseRef = req.baseRef ?? 'HEAD'

  if (!existsSync(repoPath)) {
    return err(
      makeError('sandbox.repo_missing', `Target repo not found: ${repoPath}`, {
        fix: 'Check the project config repoPath.',
      }),
    )
  }

  const workspacePath = join(repoPath, SANDBOX_DIRNAME, sanitizeTaskId(taskId))

  // Base off the freshest MERGED tip (#100): fetch + prefer origin/<branch>, so
  // a stale local branch can't seed a divergent base. Done outside the lock —
  // a fetch updates remote-tracking refs and doesn't contend on worktree admin.
  const base = await resolveBaseRef(repoPath, requestedBaseRef)
  if (base.note) process.stderr.write(`  ⚠️  ${base.note}\n`)

  // Preclean + the worktree add mutate the repo's worktree admin — serialize
  // them so concurrent provisions don't contend on the repo lock. --no-checkout
  // so a git-crypt key can be seeded into the worktree git-dir before the smudge
  // filter runs on checkout.
  const add = await withGitMutationLock(async () => {
    ensureSandboxExcluded(repoPath)
    await precleanStale(repoPath, workspacePath, branch)
    mkdirSync(dirname(workspacePath), { recursive: true })
    return runGit([
      '-C',
      repoPath,
      'worktree',
      'add',
      '--no-checkout',
      '-b',
      branch,
      workspacePath,
      base.ref,
    ])
  })
  if (add.code !== 0) {
    return err(
      makeError('sandbox.worktree_add_failed', `git worktree add failed: ${add.stderr.trim()}`, {
        fix: `The branch '${branch}' may already exist from a prior run (possibly with an open PR), a concurrent run may hold it, or the worktree dir is dirty. Resolve/merge that PR or delete the branch, then retry. Check 'git worktree list' + 'git branch'.`,
      }),
    )
  }

  let seededKey: string | null = null
  const failAndCleanup = (e: ReturnType<typeof makeError>): Result<Sandbox> => {
    teardownSync(repoPath, workspacePath, seededKey)
    return err(e)
  }

  // git-crypt: seed the key into the worktree git-dir before checkout.
  const repoKey = gitCryptKeyPath(repoPath)
  if (existsSync(repoKey)) {
    const gitDir = await runGit(['-C', workspacePath, 'rev-parse', '--absolute-git-dir'])
    if (gitDir.code !== 0) {
      return failAndCleanup(
        makeError(
          'sandbox.gitdir_resolve_failed',
          `Cannot resolve worktree git-dir: ${gitDir.stderr.trim()}`,
        ),
      )
    }
    const dest = join(gitDir.stdout.trim(), GIT_CRYPT_KEY_REL)
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(repoKey, dest)
    seededKey = dest
  }

  // Populate the working tree (runs smudge filters with the seeded key).
  const checkout = await runGit(['-C', workspacePath, 'checkout'])
  if (checkout.code !== 0) {
    return failAndCleanup(
      makeError('sandbox.checkout_failed', `Worktree checkout failed: ${checkout.stderr.trim()}`, {
        fix: 'If the repo uses git-crypt, ensure its key is unlocked in the source repo.',
      }),
    )
  }

  // node_modules: symlink from the source repo (preserves Node-pinned bindings).
  const srcNodeModules = join(repoPath, 'node_modules')
  const wtNodeModules = join(workspacePath, 'node_modules')
  if (existsSync(srcNodeModules) && !existsSync(wtNodeModules)) {
    await symlink(srcNodeModules, wtNodeModules)
  }

  // Durable state: symlink .audit/.sdlc-queue to the repo root so the audit
  // chain + HITL gates write to storage that survives teardown.
  for (const name of DURABLE_DIRS) {
    const durable = join(repoPath, name)
    await mkdir(durable, { recursive: true })
    const link = join(workspacePath, name)
    if (!existsSync(link)) await symlink(durable, link)
  }

  let cleaned = false
  installCrashHandlers()
  crashRegistry.set(workspacePath, () => teardownSync(repoPath, workspacePath, seededKey))

  const cleanup = async (): Promise<Result<void>> => {
    if (cleaned) return ok(undefined)
    cleaned = true
    crashRegistry.delete(workspacePath)
    if (seededKey && existsSync(seededKey)) {
      rmSync(seededKey, { force: true })
    }
    let firstError: ReturnType<typeof makeError> | null = null
    if (existsSync(workspacePath)) {
      const remove = await runGit(['-C', repoPath, 'worktree', 'remove', '--force', workspacePath])
      if (remove.code !== 0) {
        firstError = makeError(
          'sandbox.cleanup_failed',
          `git worktree remove failed: ${remove.stderr.trim()}`,
          { fix: `Manually run: git -C ${repoPath} worktree remove --force ${workspacePath}` },
        )
      }
    }
    await runGit(['-C', repoPath, 'worktree', 'prune'])
    return firstError ? err(firstError) : ok(undefined)
  }

  return ok({ workspacePath, branch, cleanup })
}

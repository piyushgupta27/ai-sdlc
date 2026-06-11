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

/** Run a git command. Never rejects — non-zero exit is reported via `code`. */
function runGit(args: readonly string[], cwd?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code =
        error && typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : error
            ? 1
            : 0
      resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() })
    })
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
 * Remove a worktree + its branch if a stale copy exists (crash orphan or a
 * re-dispatch of the same task). Best-effort — errors are swallowed; a genuine
 * live concurrent run holding the branch will surface later as an `add` failure.
 */
async function precleanStale(
  repoPath: string,
  workspacePath: string,
  branch: string,
): Promise<void> {
  await runGit(['-C', repoPath, 'worktree', 'prune'])
  if (existsSync(workspacePath)) {
    await runGit(['-C', repoPath, 'worktree', 'remove', '--force', workspacePath])
  }
  if (await branchExists(repoPath, branch)) {
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

/**
 * Provision an isolated git worktree for one dispatch.
 *
 * On any failure after the worktree is created, tears down the partial worktree
 * before returning the error — never leaves an orphan behind.
 */
export async function provisionWorktreeSandbox(req: SandboxRequest): Promise<Result<Sandbox>> {
  const { repoPath, taskId, branch } = req
  const baseRef = req.baseRef ?? 'HEAD'

  if (!existsSync(repoPath)) {
    return err(
      makeError('sandbox.repo_missing', `Target repo not found: ${repoPath}`, {
        fix: 'Check the project config repoPath.',
      }),
    )
  }

  const workspacePath = join(repoPath, SANDBOX_DIRNAME, sanitizeTaskId(taskId))

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
      baseRef,
    ])
  })
  if (add.code !== 0) {
    return err(
      makeError('sandbox.worktree_add_failed', `git worktree add failed: ${add.stderr.trim()}`, {
        fix: 'A concurrent run may hold this branch, or the worktree dir is dirty. Check `git worktree list`.',
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

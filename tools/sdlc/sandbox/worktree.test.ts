/**
 * Integration tests for WorktreeSandbox (issue #19).
 *
 * Real `git worktree` against throwaway repos under tmpdir — the isolation
 * guarantees are filesystem/git facts, not mockable. Each test builds a fresh
 * seed repo and removes its temp root afterward.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { provisionWorktreeSandbox } from './worktree.js'

const tempRoots: string[] = []

/** Build a throwaway git repo with one commit + an (untracked) node_modules. */
function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'sdlc-sbx-'))
  tempRoots.push(root)
  const repo = join(root, 'seed')
  mkdirSync(repo)
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  git(['init', '-q'])
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 'Tester'])
  writeFileSync(join(repo, 'README.md'), '# seed\n')
  mkdirSync(join(repo, 'node_modules'))
  writeFileSync(join(repo, 'node_modules', '.marker'), 'dep\n')
  git(['add', 'README.md'])
  git(['commit', '-qm', 'init'])
  return repo
}

/**
 * Build a repo whose local `main` is STALE behind `origin/main` (#100): a second
 * commit (adds NEW.md) is pushed to the bare remote, then local `main` is reset
 * back one. So origin/main has NEW.md; local main does not.
 */
function setupStaleRepo(branch = 'main'): string {
  const root = mkdtempSync(join(tmpdir(), 'sdlc-sbx-'))
  tempRoots.push(root)
  const remote = join(root, 'remote.git')
  const repo = join(root, 'local')
  execFileSync('git', ['init', '--bare', '-q', '-b', branch, remote], { stdio: 'pipe' })
  execFileSync('git', ['clone', '-q', remote, repo], { stdio: 'pipe' })
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 'Tester'])
  git(['checkout', '-q', '-B', branch])
  writeFileSync(join(repo, 'README.md'), 'v1\n')
  git(['add', '-A'])
  git(['commit', '-qm', 'v1'])
  git(['push', '-q', '-u', 'origin', branch])
  writeFileSync(join(repo, 'NEW.md'), 'v2\n') // the "merged-on-remote" change
  git(['add', '-A'])
  git(['commit', '-qm', 'v2'])
  git(['push', '-q', 'origin', branch])
  git(['reset', '--hard', '-q', 'HEAD~1']) // local <branch> now stale (v1, no NEW.md)
  return repo
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('provisionWorktreeSandbox', () => {
  it('provisions an isolated worktree on a new branch with the repo files', async () => {
    const repo = setupRepo()
    const r = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-1',
      branch: 'feature/gh-1',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const sb = r.value
    expect(sb.workspacePath).toBe(join(repo, '.sdlc-sandboxes', 'gh-1'))
    expect(existsSync(sb.workspacePath)).toBe(true)
    expect(sb.branch).toBe('feature/gh-1')
    expect(readFileSync(join(sb.workspacePath, 'README.md'), 'utf8')).toContain('# seed')
    const head = execFileSync(
      'git',
      ['-C', sb.workspacePath, 'rev-parse', '--abbrev-ref', 'HEAD'],
      {
        encoding: 'utf8',
      },
    ).trim()
    expect(head).toBe('feature/gh-1')
    await sb.cleanup()
  })

  it('symlinks node_modules and durable .audit/.sdlc-queue to the repo root', async () => {
    const repo = setupRepo()
    const r = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-2',
      branch: 'feature/gh-2',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const sb = r.value
    expect(lstatSync(join(sb.workspacePath, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(sb.workspacePath, 'node_modules', '.marker'), 'utf8')).toContain('dep')
    for (const d of ['.audit', '.sdlc-queue']) {
      expect(lstatSync(join(sb.workspacePath, d)).isSymbolicLink()).toBe(true)
    }
    // A write inside the worktree's .audit lands in the durable repo root.
    writeFileSync(join(sb.workspacePath, '.audit', 'row.jsonl'), 'x\n')
    expect(existsSync(join(repo, '.audit', 'row.jsonl'))).toBe(true)
    await sb.cleanup()
  })

  it('two concurrent provisions are isolated — edits do not leak (the Done bar)', async () => {
    const repo = setupRepo()
    const [a, b] = await Promise.all([
      provisionWorktreeSandbox({ repoPath: repo, taskId: 'gh-a', branch: 'feature/gh-a' }),
      provisionWorktreeSandbox({ repoPath: repo, taskId: 'gh-b', branch: 'feature/gh-b' }),
    ])
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    writeFileSync(join(a.value.workspacePath, 'only-a.txt'), 'a\n')
    writeFileSync(join(b.value.workspacePath, 'only-b.txt'), 'b\n')
    expect(existsSync(join(a.value.workspacePath, 'only-a.txt'))).toBe(true)
    expect(existsSync(join(a.value.workspacePath, 'only-b.txt'))).toBe(false)
    expect(existsSync(join(b.value.workspacePath, 'only-a.txt'))).toBe(false)
    expect(a.value.branch).not.toBe(b.value.branch)
    expect(a.value.workspacePath).not.toBe(b.value.workspacePath)
    await Promise.all([a.value.cleanup(), b.value.cleanup()])
  })

  it('cleanup removes the worktree but preserves durable audit state', async () => {
    const repo = setupRepo()
    const r = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-3',
      branch: 'feature/gh-3',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const sb = r.value
    writeFileSync(join(sb.workspacePath, '.audit', 'keep.jsonl'), 'keep\n')
    const c = await sb.cleanup()
    expect(c.ok).toBe(true)
    expect(existsSync(sb.workspacePath)).toBe(false)
    expect(readFileSync(join(repo, '.audit', 'keep.jsonl'), 'utf8')).toContain('keep')
  })

  it('cleanup is idempotent', async () => {
    const repo = setupRepo()
    const r = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-4',
      branch: 'feature/gh-4',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((await r.value.cleanup()).ok).toBe(true)
    expect((await r.value.cleanup()).ok).toBe(true)
  })

  it('re-provisioning the same task precleans the stale orphan', async () => {
    const repo = setupRepo()
    const first = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-5',
      branch: 'feature/gh-5',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    writeFileSync(join(first.value.workspacePath, 'dirty.txt'), 'stale\n')
    // Re-provision WITHOUT cleanup — simulates a crash orphan; should preclean.
    const second = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-5',
      branch: 'feature/gh-5',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(existsSync(join(second.value.workspacePath, 'dirty.txt'))).toBe(false)
    await second.value.cleanup()
  })

  it('returns an error when the repo path does not exist', async () => {
    const r = await provisionWorktreeSandbox({
      repoPath: join(tmpdir(), 'sdlc-does-not-exist-xyz'),
      taskId: 'gh-6',
      branch: 'feature/gh-6',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('sandbox.repo_missing')
  })

  it('adds the sandbox dir to .git/info/exclude idempotently', async () => {
    const repo = setupRepo()
    const count = () =>
      readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')
        .split('\n')
        .filter((l) => l.trim() === '.sdlc-sandboxes/').length
    const r1 = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-7',
      branch: 'feature/gh-7',
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(count()).toBe(1)
    await r1.value.cleanup()
    // A second provision must not duplicate the exclude line.
    const r2 = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-8',
      branch: 'feature/gh-8',
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(count()).toBe(1)
    await r2.value.cleanup()
  })

  it('refuses to clobber an existing branch with no worktree (possible open PR)', async () => {
    const repo = setupRepo()
    const first = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-9',
      branch: 'feature/gh-9',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // cleanup removes the worktree but keeps the branch (it backs the PR).
    await first.value.cleanup()
    // Re-dispatching the same branch must NOT force-delete it — surfaces as an
    // add failure instead of clobbering a branch that may have an open PR.
    const second = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-9',
      branch: 'feature/gh-9',
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('sandbox.worktree_add_failed')
  })

  it('honors an explicit baseRef (branches off the integration ref, not HEAD)', async () => {
    const repo = setupRepo()
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
    // Create an integration branch with a marker commit, then move HEAD away.
    git(['branch', 'integration'])
    git(['checkout', '-q', 'integration'])
    writeFileSync(join(repo, 'INTEGRATION.md'), 'integration-only\n')
    git(['add', 'INTEGRATION.md'])
    git(['commit', '-qm', 'integration marker'])
    git(['checkout', '-q', '-'])
    // HEAD is back on the default branch (no INTEGRATION.md). Base off 'integration'.
    const r = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-10',
      branch: 'feature/gh-10',
      baseRef: 'integration',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The worktree must reflect the baseRef, not the source checkout's HEAD.
    expect(existsSync(join(r.value.workspacePath, 'INTEGRATION.md'))).toBe(true)
    await r.value.cleanup()
  })

  it('bases off origin/<branch>, not a STALE local branch (#100)', async () => {
    const repo = setupStaleRepo()
    // baseRef 'main' must resolve to origin/main (v2, has NEW.md), NOT the stale
    // local main (v1, no NEW.md). This is the first-autonomous-run bug.
    const r = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-100',
      branch: 'feature/gh-100',
      baseRef: 'main',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(existsSync(join(r.value.workspacePath, 'NEW.md'))).toBe(true)
    await r.value.cleanup()
  })

  it('a hex-like branch name still resolves to its origin tip, not stale local (#100 P2)', async () => {
    // 'deadbeef' looks like a short SHA but is a real branch — must NOT be skipped
    // (the old /^[0-9a-f]{7,40}$/ guess would silently base off the stale local).
    const repo = setupStaleRepo('deadbeef')
    const r = await provisionWorktreeSandbox({
      repoPath: repo,
      taskId: 'gh-100-hex',
      branch: 'feature/gh-100-hex',
      baseRef: 'deadbeef',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(existsSync(join(r.value.workspacePath, 'NEW.md'))).toBe(true)
    await r.value.cleanup()
  })
})

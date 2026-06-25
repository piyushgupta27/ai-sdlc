/**
 * `pnpm sdlc ci-monitor` — post-PR CI check monitor (issue #180).
 *
 * Internal command. Spawned as a detached background process by `dispatch`
 * immediately after a PR is opened. Dispatch returns to the caller; this
 * process runs to completion in the background.
 *
 * Behaviour:
 *   - Polls GitHub check-runs for the PR's commit SHA every 30s (30-min cap).
 *   - All green  → ntfy success ping.
 *   - Biome/format failure → one auto-fix attempt (clone branch, run
 *     `biome check --write`, commit + push). Re-polls the new SHA.
 *     If the fix itself fails, falls through to issue creation.
 *   - All other failures → one GitHub issue per failing check.
 *   - Any terminal outcome → ntfy ping if webhookTopic is configured.
 *
 * Progress is appended to /tmp/sdlc-ci-<owner>-<repo>-<pr>.log.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { notify } from '../../integrations/ntfy.js'
import type { NtfyConfig } from '../../integrations/ntfy.js'
import { type Tier, asProjectSlug } from '../../types/index.js'
import { dispatchCiFixTask } from './dispatch.js'

const POLL_INTERVAL_MS = 30_000
const TIMEOUT_MS = 30 * 60 * 1000

// ─── types ───────────────────────────────────────────────────────────────────

interface CheckRun {
  readonly id: number
  readonly name: string
  readonly status: 'queued' | 'in_progress' | 'completed'
  readonly conclusion: string | null
  readonly output: {
    readonly title: string | null
    readonly summary: string | null
  }
  readonly html_url: string
}

interface CheckRunsResponse {
  readonly check_runs: readonly CheckRun[]
}

export type FailureClass = 'biome' | 'security' | 'deps' | 'test' | 'other'

// ─── pure helpers ─────────────────────────────────────────────────────────────

/**
 * Classify a GitHub check-run by its name into a failure category.
 * Used to decide whether a failure is auto-fixable (biome) or needs an issue.
 */
export function classifyCheck(name: string): FailureClass {
  const n = name.toLowerCase()
  if (
    n.includes('codeql') ||
    n.includes('sast') ||
    n.includes('gitleaks') ||
    n.includes('secret-scan') ||
    n.includes('security')
  )
    return 'security'
  if (
    n.includes('dep-audit') ||
    n.includes('dep_audit') ||
    n.includes('dependency-audit') ||
    n.includes('npm audit')
  )
    return 'deps'
  if (n.includes('test') || n.includes('vitest') || n.includes('jest') || n.includes('coverage'))
    return 'test'
  if (n.includes('biome') || n.includes('format') || /\bcheck\b/.test(n) || n.includes('lint'))
    return 'biome'
  return 'other'
}

export function parseMonitorArgs(argv: readonly string[]): {
  readonly owner: string
  readonly repo: string
  readonly sha: string
  readonly prNumber: string
  readonly slug: string
  readonly prUrl: string
  readonly baseRepoPath: string
  readonly branch: string
  readonly tier: string | undefined
  readonly webhookTopic: string | undefined
} | null {
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length - 1; i++) {
    const key = argv[i]
    const val = argv[i + 1]
    if (key?.startsWith('--') && val !== undefined && !val.startsWith('--')) {
      flags[key.slice(2)] = val
    }
  }
  const required = [
    'owner',
    'repo',
    'sha',
    'pr-number',
    'slug',
    'pr-url',
    'base-repo-path',
    'branch',
  ] as const
  for (const k of required) {
    if (!flags[k]) return null
  }
  return {
    owner: flags.owner as string,
    repo: flags.repo as string,
    sha: flags.sha as string,
    prNumber: flags['pr-number'] as string,
    slug: flags.slug as string,
    prUrl: flags['pr-url'] as string,
    baseRepoPath: flags['base-repo-path'] as string,
    branch: flags.branch as string,
    tier: flags.tier,
    webhookTopic: flags['webhook-topic'],
  }
}

// ─── I/O helpers ─────────────────────────────────────────────────────────────

function runCmd(
  cmd: string,
  args: readonly string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args as string[], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.on('error', () => resolve({ code: 1, stdout, stderr: 'spawn failed' }))
  })
}

async function fetchCheckRuns(owner: string, repo: string, sha: string): Promise<CheckRun[]> {
  const result = await runCmd(
    'gh',
    ['api', `repos/${owner}/${repo}/commits/${sha}/check-runs`],
    tmpdir(),
  )
  if (result.code !== 0) return []
  try {
    const parsed = JSON.parse(result.stdout) as CheckRunsResponse
    return Array.from(parsed.check_runs)
  } catch {
    return []
  }
}

async function openCiFailureIssue(
  owner: string,
  repo: string,
  prNumber: string,
  sha: string,
  check: CheckRun,
): Promise<void> {
  const body = `## CI Failure: ${check.name}

**PR:** #${prNumber}
**Commit:** \`${sha.slice(0, 8)}\`
**Check:** ${check.name}
**Conclusion:** ${check.conclusion ?? 'unknown'}

### Output
${check.output.summary ?? '(no summary provided by the check run)'}

### Reproduction
\`\`\`
gh run view ${check.id} --repo ${owner}/${repo} --log
\`\`\`

---
*Auto-filed by ai-sdlc CI monitor ([#180](https://github.com/piyushgupta27/ai-sdlc/issues/180))*`

  await runCmd(
    'gh',
    [
      'issue',
      'create',
      '--repo',
      `${owner}/${repo}`,
      '--title',
      `[ci] ${check.name} failed on PR #${prNumber}`,
      '--body',
      body,
      '--label',
      'bug',
    ],
    tmpdir(),
  )
}

/**
 * Clone the PR branch into a temp dir, run `biome check --write`, commit and push.
 * Returns the new commit SHA on success, null if the fix could not be applied.
 * Cleans up the temp clone unconditionally.
 */
async function tryBiomeFix(owner: string, repo: string, branch: string): Promise<string | null> {
  const cloneDir = await mkdtemp(join(tmpdir(), `sdlc-ci-fix-${owner}-${repo}-`))
  try {
    const cloneUrl = `https://github.com/${owner}/${repo}.git`
    const cloneResult = await runCmd(
      'git',
      ['clone', '--depth', '1', '--branch', branch, cloneUrl, cloneDir],
      tmpdir(),
    )
    if (cloneResult.code !== 0) return null

    // Install deps so the biome binary is available in the clone
    const installResult = await runCmd('pnpm', ['install', '--frozen-lockfile'], cloneDir)
    if (installResult.code !== 0) return null

    const biomeBin = join(cloneDir, 'node_modules', '.bin', 'biome')
    if (!existsSync(biomeBin)) return null

    // biome check --write covers both lint + format violations
    await runCmd(biomeBin, ['check', '--write', '.'], cloneDir)

    // Discover what changed
    const diffResult = await runCmd('git', ['diff', '--name-only'], cloneDir)
    if (diffResult.code !== 0) return null
    const changedFiles = diffResult.stdout.trim().split('\n').filter(Boolean)
    if (changedFiles.length === 0) return null

    // Stage explicit paths only (never `git add -A`)
    const addResult = await runCmd('git', ['add', '--', ...changedFiles], cloneDir)
    if (addResult.code !== 0) return null

    const commitMsg =
      'fix(ci): auto-fix biome check violations\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>'
    const commitResult = await runCmd('git', ['commit', '-m', commitMsg], cloneDir, {
      GIT_AUTHOR_NAME: 'Piyush Gupta',
      GIT_AUTHOR_EMAIL: 'piyushguptaece@gmail.com',
      GIT_COMMITTER_NAME: 'Piyush Gupta',
      GIT_COMMITTER_EMAIL: 'piyushguptaece@gmail.com',
    })
    if (commitResult.code !== 0) return null

    const shaResult = await runCmd('git', ['rev-parse', 'HEAD'], cloneDir)
    if (shaResult.code !== 0) return null
    const newSha = shaResult.stdout.trim()

    const pushResult = await runCmd('git', ['push', 'origin', branch], cloneDir)
    if (pushResult.code !== 0) return null

    return newSha
  } finally {
    await rm(cloneDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function runCiMonitor(argv: readonly string[]): Promise<number> {
  const parsed = parseMonitorArgs(argv)
  if (!parsed) {
    process.stderr.write(
      '[ci-monitor] Missing required args. This is an internal command spawned by dispatch.\n',
    )
    return 2
  }

  const { owner, repo, sha, prNumber, prUrl, branch, tier, webhookTopic } = parsed
  const ntfyCfg: NtfyConfig | null = webhookTopic ? { topic: webhookTopic } : null
  const logFile = join(tmpdir(), `sdlc-ci-${owner}-${repo}-${prNumber}.log`)
  const tierNum = Number.parseInt(tier ?? '2', 10)
  const taskTier = (Number.isNaN(tierNum) ? 2 : tierNum) as Tier
  const slug = asProjectSlug(parsed.slug)

  async function log(msg: string): Promise<void> {
    await appendFile(logFile, `[${new Date().toISOString()}] ${msg}\n`).catch(() => {})
  }

  await log(`started: PR #${prNumber} SHA ${sha.slice(0, 8)} branch ${branch} tier ${taskTier}`)

  let currentSha = sha
  let autoFixAttempted = false
  let ciFixAttempted = false
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const checks = await fetchCheckRuns(owner, repo, currentSha)
    if (checks.length === 0) {
      await log(`no check runs yet for ${currentSha.slice(0, 8)}, continuing to poll`)
      continue
    }

    const pending = checks.filter((c) => c.status !== 'completed')
    if (pending.length > 0) {
      await log(`${pending.length}/${checks.length} check(s) still running`)
      continue
    }

    // All completed — partition results
    const failed = checks.filter(
      (c) =>
        c.conclusion === 'failure' ||
        c.conclusion === 'timed_out' ||
        c.conclusion === 'action_required',
    )

    if (failed.length === 0) {
      await log(`all ${checks.length} check(s) passed`)
      if (ntfyCfg) {
        await notify(ntfyCfg, {
          title: 'ai-sdlc · CI passed',
          message: `PR #${prNumber} — all ${checks.length} check(s) green`,
          priority: 3,
          clickUrl: prUrl,
          tags: ['white_check_mark'],
        })
      }
      return 0
    }

    // ── Fix pass 1: biome auto-fix (cheap, no API call) ──────────────────────
    const biomeFailures = failed.filter((c) => classifyCheck(c.name) === 'biome')
    if (biomeFailures.length > 0 && !autoFixAttempted) {
      autoFixAttempted = true
      await log(
        `biome failure on ${biomeFailures.map((c) => c.name).join(', ')} — attempting auto-fix`,
      )
      const newSha = await tryBiomeFix(owner, repo, branch)
      if (newSha) {
        await log(`auto-fix committed and pushed, new SHA: ${newSha.slice(0, 8)}`)
        currentSha = newSha
        continue
      }
      await log('biome auto-fix failed — will pass to BUILDER if no dispatch fix yet')
    }

    // ── Fix pass 2: BUILDER dispatch for all non-security failures ────────────
    // Security failures always go straight to issue creation — human review only.
    const dispatchable = failed.filter((c) => classifyCheck(c.name) !== 'security')
    if (dispatchable.length > 0 && !ciFixAttempted) {
      ciFixAttempted = true
      await log(`attempting CI-fix dispatch for: ${dispatchable.map((c) => c.name).join(', ')}`)
      const newSha = await dispatchCiFixTask({
        slug,
        branch,
        prNumber: Number(prNumber),
        taskTier,
        failures: dispatchable.map((c) => ({
          name: c.name,
          conclusion: c.conclusion,
          summary: c.output.summary,
        })),
      })
      if (newSha) {
        await log(`CI-fix dispatch committed and pushed, new SHA: ${newSha.slice(0, 8)}`)
        currentSha = newSha
        continue
      }
      await log('CI-fix dispatch returned null (trust gate pause, budget, or BUILDER failure)')
    }

    // ── No fix worked — open issues for every failure ────────────────────────
    for (const check of failed) {
      await log(`opening issue for ${check.name} (${classifyCheck(check.name)})`)
      await openCiFailureIssue(owner, repo, prNumber, currentSha, check)
    }

    const failedNames = failed.map((c) => c.name).join(', ')
    await log(`CI failed: ${failedNames}`)

    if (ntfyCfg) {
      await notify(ntfyCfg, {
        title: 'ai-sdlc · CI failed',
        message: `PR #${prNumber} — ${failed.length} check(s) failed: ${failedNames}`,
        priority: 4,
        clickUrl: prUrl,
        tags: ['x'],
      })
    }

    return 1
  }

  // 30-min timeout
  await log(`timeout waiting for CI on PR #${prNumber}`)
  if (ntfyCfg) {
    await notify(ntfyCfg, {
      title: 'ai-sdlc · CI timeout',
      message: `PR #${prNumber} — checks did not complete within 30 min`,
      priority: 3,
      clickUrl: prUrl,
      tags: ['warning'],
    })
  }
  return 1
}

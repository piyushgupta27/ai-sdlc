/**
 * File operations wrapper — Layer 2 enforcement entry point.
 *
 * ⚠️ TIER 0 — Red zone file. Every agent write goes through this module.
 * It invokes `tools/check-blast-radius.sh` before each write, refusing to
 * touch Red zone files unless the agent has a valid HITL approval token.
 *
 * Agents MUST use these wrappers; the orchestrator refuses to dispatch
 * an agent that imports fs directly (verified at typecheck time via the
 * arch rule that bans `node:fs` imports outside this file).
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { type AppError, type Result, err, makeError, ok, tryAsync } from '../types/index.js'

/**
 * Options for an agent file write.
 */
export interface AgentWriteOpts {
  /** Path of the file (relative to target repo, or absolute) */
  readonly path: string
  /** File content to write (full overwrite) */
  readonly content: string
  /** Target repo root (where CLAUDE.md lives) */
  readonly targetRepo: string
  /** Optional HITL approval token for Red zone writes */
  readonly blastRadiusApproved?: string
  /** Agent + task for audit context (passed to hook via env) */
  readonly agent: string
  readonly taskId: string
}

/**
 * Write a file via the blast-radius hook gate.
 *
 * Behavior:
 *   1. Resolve path to absolute (relative paths are joined with targetRepo)
 *   2. Run `check-blast-radius.sh <relative-path>` from targetRepo as CWD
 *   3. If hook exits 0 → write the file (creating parents if needed)
 *   4. If hook exits 1 → return Result.err with `blast-radius-blocked` code
 *
 * The hook itself reads CLAUDE.md from the target repo (Layer 1) and
 * checks BLAST_RADIUS_APPROVED env (Layer 2 trigger).
 */
export async function agentWrite(opts: AgentWriteOpts): Promise<Result<void, AppError>> {
  const absPath = isAbsolute(opts.path) ? opts.path : join(opts.targetRepo, opts.path)
  const relPath = relative(opts.targetRepo, absPath)

  // Disallow writes outside the target repo
  if (relPath.startsWith('..')) {
    return err(
      makeError('file-ops.path-escape', `Refusing to write outside target repo: ${absPath}`, {
        fix: `All paths must be inside ${opts.targetRepo}`,
      }),
    )
  }

  // Invoke the hook
  const hookResult = await runBlastRadiusHook({
    relPath,
    targetRepo: opts.targetRepo,
    ...(opts.blastRadiusApproved ? { blastRadiusApproved: opts.blastRadiusApproved } : {}),
    agent: opts.agent,
    taskId: opts.taskId,
  })

  if (!hookResult.ok) {
    return hookResult
  }

  // Hook passed — write the file
  return tryAsync(
    'file-ops.write',
    async () => {
      await mkdir(dirname(absPath), { recursive: true })
      await writeFile(absPath, opts.content, 'utf8')
    },
    {
      fix: 'Check disk space + write permissions on the target file path',
    },
  )
}

/**
 * Read a file (no enforcement on reads; agents read freely).
 * Kept here for symmetry with agentWrite so agents have one import surface.
 */
export async function agentRead(opts: {
  readonly path: string
  readonly targetRepo: string
}): Promise<Result<string, AppError>> {
  const absPath = isAbsolute(opts.path) ? opts.path : join(opts.targetRepo, opts.path)
  return tryAsync('file-ops.read', async () => readFile(absPath, 'utf8'))
}

/**
 * Internal: invoke check-blast-radius.sh and parse its exit code.
 *
 * Hook script is at <repo>/tools/check-blast-radius.sh (declared as a Red zone
 * file itself in CLAUDE.md). We invoke with the candidate file path as arg.
 */
async function runBlastRadiusHook(opts: {
  readonly relPath: string
  readonly targetRepo: string
  readonly blastRadiusApproved?: string
  readonly agent: string
  readonly taskId: string
}): Promise<Result<void, AppError>> {
  const hookPath = join(opts.targetRepo, 'tools/check-blast-radius.sh')

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      ...(opts.blastRadiusApproved ? { BLAST_RADIUS_APPROVED: opts.blastRadiusApproved } : {}),
    }

    const child = spawn(hookPath, [opts.relPath], {
      cwd: opts.targetRepo,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (cause) => {
      resolve(
        err(
          makeError('file-ops.hook-spawn-failed', `Could not invoke ${hookPath}`, {
            cause,
            fix: 'Verify check-blast-radius.sh exists + is executable in the target repo',
          }),
        ),
      )
    })

    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve(ok(undefined))
        return
      }

      resolve(
        err(
          makeError(
            'file-ops.blast-radius-blocked',
            `Blast-radius hook blocked write to ${opts.relPath} (agent=${opts.agent}, task=${opts.taskId})`,
            {
              cause: { exitCode, stderr },
              fix: 'Either (a) revise to avoid Red zone files, or (b) obtain HITL approval token and pass via blastRadiusApproved',
              docsUrl:
                'https://github.com/piyushgupta27/ai-sdlc/blob/main/ARCHITECTURE.md#7-guardrails--three-layer-enforcement',
            },
          ),
        ),
      )
    })
  })
}

/**
 * Deterministic validation runner — H1 ([D]) for the CHECKER gate.
 *
 * The quality gate re-runs the deterministic checks (typecheck / lint / test)
 * HERE, in Node — never trusting a producer agent's word for machine-checkable
 * facts (AGENT-GOVERNANCE.md H1). The result:
 *   - populates `AuditRow.validations` (closes finding F1), and
 *   - is handed to the CHECKER as ground truth (it audits semantics, not these).
 *
 * Commands are per-project (`ProjectConfig.validationCommands`). A project with
 * no configured commands yields an EMPTY matrix (nothing to assert) rather than
 * a failure — the throwaway smoke repo has no toolchain; real repos do. Never
 * throws: a command that errors/timeouts is recorded as `fail`, not an exception.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditValidations } from '../types/index.js'

/** Per-project deterministic commands, run as shell strings in the target repo. */
export interface ValidationCommands {
  readonly typecheck?: string
  readonly lint?: string
  readonly test?: string
}

/** One check's outcome, for the audit log + the CHECKER payload. */
export interface ValidationDetail {
  readonly check: 'typecheck' | 'lint' | 'test'
  readonly command: string
  readonly result: 'pass' | 'fail'
  readonly exitCode: number
}

export interface ValidationRun {
  readonly validations: AuditValidations
  readonly details: readonly ValidationDetail[]
}

interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

function runShellCommand(command: string, cwd: string, timeoutSec = 300): Promise<CommandResult> {
  return new Promise((resolve) => {
    // shell:true so config strings like "pnpm run test" run verbatim.
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutSec * 1000)
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    child.on('error', (cause) => {
      clearTimeout(timer)
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${String(cause)}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: timedOut ? 124 : (code ?? 1), stdout, stderr })
    })
  })
}

/** check key → AuditValidations field. */
const CHECK_MAP = [
  { key: 'typecheck', field: 'tsc' },
  { key: 'lint', field: 'lint' },
  { key: 'test', field: 'tests' },
] as const

/**
 * Re-run the configured deterministic checks in the target repo. Each command's
 * exit code is the gate: 0 → `pass`, anything else → `fail`. Unconfigured checks
 * are omitted from the matrix (not `fail`). Never throws.
 */
export async function runValidations(
  targetRepo: string,
  commands: ValidationCommands | undefined,
): Promise<ValidationRun> {
  if (!commands) return { validations: {}, details: [] }

  const validations: { -readonly [K in keyof AuditValidations]?: AuditValidations[K] } = {}
  const details: ValidationDetail[] = []

  for (const { key, field } of CHECK_MAP) {
    const command = commands[key]
    if (!command) continue
    const r = await runShellCommand(command, targetRepo)
    const result: 'pass' | 'fail' = r.exitCode === 0 ? 'pass' : 'fail'
    validations[field] = result
    details.push({ check: key, command, result, exitCode: r.exitCode })
  }

  return { validations, details }
}

/** True if any deterministic check in the matrix failed — the H1 hard gate. */
export function hasDeterministicFailure(v: AuditValidations): boolean {
  return Object.values(v).some((status) => status === 'fail')
}

const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'] as const

/**
 * Return a copy of `commands` with the test command safe for worktree execution.
 *
 * Vitest config may include reporters (e.g. tdd-guard-vitest) that require
 * services only present in the main workspace — not in the isolated git worktree
 * dispatch creates per task. Appending `-- --reporter=default` causes vitest to
 * replace the config reporters array with just the built-in default reporter,
 * bypassing any per-repo custom reporters. CLI `--reporter` takes full precedence
 * over the config `reporters` array (verified in vitest source coverage.DfSpMS-b.js
 * line ~3850: `resolved.reporters = cliReporters` replaces, does not append).
 *
 * No-op when the repo does not use vitest (preserves Jest/Mocha/other commands
 * unchanged — those runners have different `--reporter` semantics). (#152)
 */
export function asWorktreeCommands(
  commands: ValidationCommands,
  repoPath: string,
): ValidationCommands {
  if (!commands.test) return commands
  const hasVitest = VITEST_CONFIGS.some((cfg) => existsSync(join(repoPath, cfg)))
  if (!hasVitest) return commands
  return { ...commands, test: `${commands.test} -- --reporter=default` }
}

/**
 * Claude Code Subagent transport — per Q-AI-2 amendment, this is the ONLY
 * model transport in v1. Shells out to the `claude` CLI in non-interactive
 * print mode. No API key required; uses the user's Claude Code Max
 * subscription auth implicitly.
 *
 * For v1.5+: alternate transports (Anthropic SDK, ChatGPT API for Codex
 * reviewer fleet) plug into the same `SubagentTransport` interface.
 */

import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { type AppError, type ModelId, type Result, err, makeError, ok } from '../types/index.js'

/**
 * Inputs to a single subagent dispatch.
 */
export interface DispatchOpts {
  /** Full user-message text. System prompt is set separately. */
  readonly userMessage: string
  /** System prompt for this agent role (loaded from prompts/<role>/v1.md) */
  readonly systemPrompt: string
  /** Which model to use */
  readonly model: ModelId
  /** Temperature (0.0-1.0); higher = more divergent (used by REVIEWER) */
  readonly temperature: number
  /** Working directory for the Claude session (target repo) */
  readonly cwd: string
  /** Max seconds before we kill the process */
  readonly timeoutSec?: number
  /** Optional: BLAST_RADIUS_APPROVED env passthrough for Red zone writes */
  readonly blastRadiusApproved?: string
}

/**
 * Response from a subagent dispatch.
 *
 * `rawText` is the agent's full output text. Token counts and cost are
 * reported by Claude Code's CLI on stdout/stderr (when available); we
 * parse them best-effort.
 */
export interface DispatchResponse {
  readonly rawText: string
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly cacheRead?: number
  }
  readonly durationMs: number
  readonly exitCode: number
  /**
   * Real cost in USD as reported by the CLI (`total_cost_usd`). The base
   * layer prefers this over the local token-based estimate when present.
   * Optional because non-JSON / error paths may not carry it.
   */
  readonly costUsd?: number
}

/**
 * Transport contract — what every model backend implements.
 * v1 ships ClaudeCodeCliTransport; v1.5+ adds AnthropicSdkTransport, etc.
 */
export interface SubagentTransport {
  dispatch(opts: DispatchOpts): Promise<Result<DispatchResponse, AppError>>
}

/**
 * Least-privilege tool allow-list for spawned agents (findings F4 / F4b).
 * Comma-separated (the CLI accepts comma- or space-separated). Scoped to file +
 * shell tools only — deliberately excludes web fetch and MCP. If an agent
 * legitimately needs another tool, widen this list rather than disabling
 * permission checks wholesale.
 */
const ALLOWED_AGENT_TOOLS = 'Read,Glob,Grep,Edit,Write,Bash'

/**
 * Env vars passed through to spawned agents — DENY BY DEFAULT.
 *
 * Agents run with `Bash` (F4), so inheriting the full `process.env` would let a
 * prompt-injected agent read every host secret (API keys, cloud creds, tokens)
 * and exfiltrate it (2026-05-31 security baseline, finding #1). We pass ONLY this
 * minimal set of non-secret operational vars needed for the `claude` CLI + git +
 * build/test to run. Claude Code auth comes from the macOS keychain / ~/.claude
 * (via HOME), not an env var. Widen ONLY with non-secret operational vars — never
 * with `*_KEY`/`*_TOKEN`/`*_SECRET`/cloud-credential vars.
 */
const AGENT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LOGNAME',
  'TERM',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  // Proxy / custom-CA passthrough so dispatch works on corporate-proxied hosts.
  // (Proxy URLs can embed low-value creds; acceptable vs. breaking egress, and
  // far below the API-key/cloud-cred exposure this scoping removes.)
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
] as const

/** Build the scoped agent env from the allow-list (+ the optional approval token). */
function buildAgentEnv(blastRadiusApproved?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of AGENT_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  if (blastRadiusApproved) env.BLAST_RADIUS_APPROVED = blastRadiusApproved
  return env
}

/**
 * The v1 transport — spawns `claude` CLI in print mode.
 *
 * CLI flags used:
 *   --print "<msg>"                Non-interactive; print response + exit
 *   --model <id>                   Model selection
 *   --allowedTools <tools>         Scoped, least-privilege tool grant (F4)
 *   --append-system-prompt <text>  Add agent role to system prompt
 *
 * The cwd of the spawned process is set to the target repo so any
 * file tools the agent uses (Read/Edit/Write/Bash) operate there.
 *
 * Failure modes handled:
 *   - claude not on PATH → ENOENT spawn error → return structured error
 *   - timeout (default 5 min) → SIGTERM the process; return timeout error
 *   - non-zero exit → return error with stderr captured
 */
export class ClaudeCodeCliTransport implements SubagentTransport {
  async dispatch(opts: DispatchOpts): Promise<Result<DispatchResponse, AppError>> {
    const start = performance.now()
    const timeoutSec = opts.timeoutSec ?? 300

    return new Promise((resolve) => {
      const args = [
        '--print',
        // Structured output: stdout is ONE JSON envelope whose `result` field
        // holds the agent's text answer, plus exact token usage + real cost
        // under `usage` / `total_cost_usd`. Replaces the old stderr regex that
        // matched nothing in the current CLI and logged 0 tokens / $0 (F5).
        '--output-format',
        'json',
        '--model',
        opts.model,
        // Agents run non-interactively (--print): there is no human to answer
        // permission prompts, so without an explicit allow-list every
        // Write/Edit/Bash(git) call is denied and BUILDER/TESTER can never
        // produce code (finding F4, see docs/plans/verification-2026-05-31.md).
        // Grant a SCOPED, least-privilege tool set (A8): file read/edit/write +
        // shell (git/build/test) within cwd (the target repo) — NO web, NO MCP.
        // Defense-in-depth is the platform's own guardrails: blast-radius
        // pre-commit hook, Red-zone tiers, HITL gates, and the CHECKER.
        '--allowedTools',
        ALLOWED_AGENT_TOOLS,
        '--append-system-prompt',
        opts.systemPrompt,
        opts.userMessage,
      ]

      // DENY-BY-DEFAULT env (finding #1): agents get only a scoped allow-list,
      // never the full process.env — a prompt-injected agent must not be able to
      // read host secrets from the environment.
      const env = buildAgentEnv(opts.blastRadiusApproved)

      const child = spawn('claude', args, {
        cwd: opts.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutSec * 1000)

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })

      child.on('error', (cause) => {
        clearTimeout(timer)
        const isENoent =
          cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT'
        resolve(
          err(
            makeError(
              isENoent ? 'subagent.claude-not-found' : 'subagent.spawn-failed',
              isENoent
                ? 'The `claude` CLI is not on PATH. Install Claude Code (https://claude.ai/code) and ensure `claude --version` works in your shell.'
                : `Failed to spawn claude CLI: ${(cause as Error).message}`,
              {
                cause,
                fix: isENoent
                  ? 'Run: npm i -g @anthropic-ai/claude-code (or use the installer from claude.ai/code)'
                  : 'Check Claude Code installation and shell PATH',
              },
            ),
          ),
        )
      })

      child.on('close', (exitCode) => {
        clearTimeout(timer)
        const durationMs = performance.now() - start

        if (timedOut) {
          resolve(
            err(
              makeError('subagent.timeout', `Claude subagent exceeded ${timeoutSec}s timeout`, {
                cause: { stdout, stderr },
                fix: 'Increase timeoutSec for complex tasks, or simplify the brief',
              }),
            ),
          )
          return
        }

        if (exitCode !== 0) {
          resolve(
            err(
              makeError('subagent.non-zero-exit', `claude CLI exited with code ${exitCode}`, {
                cause: { exitCode, stderr: stderr.slice(0, 2000) },
                fix: 'Inspect stderr; common causes: rate-limited, invalid model id, auth expired',
              }),
            ),
          )
          return
        }

        // Parse the structured JSON envelope (--output-format json). The agent's
        // text answer is `result`; token usage + real cost come from the same
        // envelope (F5). A malformed/error envelope is a hard failure here — we
        // never silently fall back to 0-token rows.
        const payload = parseDispatchPayload(stdout)
        if (!payload.ok) {
          resolve(payload)
          return
        }

        resolve(
          ok({
            rawText: payload.value.rawText,
            tokens: payload.value.tokens,
            durationMs,
            exitCode: 0,
            ...(payload.value.costUsd !== undefined ? { costUsd: payload.value.costUsd } : {}),
          }),
        )
      })
    })
  }
}

/**
 * Parse the `claude --print --output-format json` stdout envelope.
 *
 * The CLI prints ONE JSON object whose `result` field holds the agent's text
 * answer, with exact token usage under `usage` and real cost under
 * `total_cost_usd`. This replaces the old best-effort stderr regex (finding
 * F5), which matched nothing in the current CLI and logged every run as 0
 * tokens / $0 — breaking the cost audit (G4) and per-agent budgets (G5).
 *
 * Pure + exported so it can be unit-tested without spawning a process.
 */
export interface ParsedDispatch {
  readonly rawText: string
  readonly tokens: { readonly input: number; readonly output: number; readonly cacheRead?: number }
  /** Real cost from the CLI; `undefined` if the CLI omitted it (caller falls back to an estimate). */
  readonly costUsd?: number
}

export function parseDispatchPayload(stdout: string): Result<ParsedDispatch, AppError> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (cause) {
    return err(
      makeError(
        'subagent.invalid-json',
        'claude CLI did not emit valid JSON (expected --output-format json)',
        {
          cause: {
            stdout: stdout.slice(0, 800),
            parseError: cause instanceof Error ? cause.message : String(cause),
          },
          fix: 'Ensure the spawned claude CLI supports `--output-format json`; inspect the captured stdout.',
        },
      ),
    )
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err(
      makeError('subagent.invalid-json', 'claude CLI JSON output was not an object', {
        cause: { stdout: stdout.slice(0, 800) },
      }),
    )
  }

  const env = parsed as {
    is_error?: boolean
    result?: unknown
    total_cost_usd?: unknown
    usage?: {
      input_tokens?: unknown
      output_tokens?: unknown
      cache_read_input_tokens?: unknown
    }
  }

  if (env.is_error === true) {
    return err(
      makeError('subagent.cli-error', 'claude CLI reported is_error=true', {
        cause: {
          result: typeof env.result === 'string' ? env.result.slice(0, 800) : env.result,
        },
        fix: 'Inspect the CLI error; common causes: rate-limited, auth expired, invalid model id.',
      }),
    )
  }

  if (typeof env.result !== 'string') {
    return err(
      makeError('subagent.invalid-json', 'claude CLI JSON envelope missing string `result` field', {
        cause: { stdout: stdout.slice(0, 800) },
      }),
    )
  }

  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const usage = env.usage ?? {}
  const cacheRead = num(usage.cache_read_input_tokens)

  // Cost: keep the CLI's real value; leave it `undefined` if the CLI omitted it, so the
  // caller falls back to a token-based estimate instead of silently logging $0 (GH#30 —
  // the previous `num()` coercion to 0 made base.ts's `?? estimateCost()` dead code).
  const costUsd =
    typeof env.total_cost_usd === 'number' && Number.isFinite(env.total_cost_usd)
      ? env.total_cost_usd
      : undefined

  return ok({
    rawText: env.result,
    tokens: {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      ...(cacheRead > 0 ? { cacheRead } : {}),
    },
    ...(costUsd !== undefined ? { costUsd } : {}),
  })
}

/**
 * Default transport singleton — agents import this. Swap in tests via DI.
 */
export const defaultTransport: SubagentTransport = new ClaudeCodeCliTransport()

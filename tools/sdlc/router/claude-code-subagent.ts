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
import { estimateCost } from './select-model.js'

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
  /**
   * Activity-based idle timeout (#45): kill the agent only after this many
   * seconds of *true silence* (no stream output). Reset on every stream line, so
   * a working agent is never killed. Default 120s; env `SDLC_SUBAGENT_IDLE_SEC`.
   */
  readonly idleTimeoutSec?: number
  /**
   * Absolute wall-clock ceiling (#45): hard backstop on top of the idle timer,
   * sized per task category by the caller. Default 600s; env
   * `SDLC_SUBAGENT_CEILING_SEC`.
   */
  readonly ceilingSec?: number
  /** @deprecated Use `ceilingSec`. Kept for back-compat; treated as the ceiling. */
  readonly timeoutSec?: number
  /**
   * Progress watchdog (#125): kill with reason `'stalled'` if no Write, Edit,
   * or Bash tool is invoked for this many seconds. Omit to disable (default for
   * read-only roles like reviewer and checker). Env `SDLC_SUBAGENT_NO_PROGRESS_SEC`
   * overrides globally.
   */
  readonly noProgressSec?: number
  /** Optional: BLAST_RADIUS_APPROVED env passthrough for Red zone writes */
  readonly blastRadiusApproved?: string
  /**
   * Scoped tool grant for this dispatch. Defaults to ALLOWED_AGENT_TOOLS
   * (Read,Glob,Grep,Edit,Write,Bash). Set by base.ts for read-only roles
   * (reviewer: Read,Glob,Grep; checker: Read,Glob,Grep + git-inspect Bash)
   * so those agents can never Write/Edit regardless of prompt injection.
   */
  readonly allowedTools?: string
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
 * Cause attached to a `subagent.timeout` AppError (#45). When the transport kills
 * an agent (idle or ceiling) the final cost envelope never arrives, so we recover
 * what was spent from the partial stream and surface it here — the orchestrator
 * bills `recoveredCostUsd` against the task instead of logging $0, and `reason` /
 * `toolCalls` explain the kill.
 */
export interface SubagentTimeoutCause {
  readonly reason: 'idle' | 'ceiling' | 'stalled'
  readonly idleSec: number
  readonly ceilingSec: number
  readonly recoveredTokens: {
    readonly input: number
    readonly output: number
    readonly cacheRead?: number
  }
  readonly recoveredCostUsd: number
  readonly toolCalls: number
  readonly lastActivityAgoMs: number
  readonly stdout: string
  readonly stderr: string
}

/** Type guard so callers can read recovered cost from a timeout error without `any`. */
export function isSubagentTimeoutCause(c: unknown): c is SubagentTimeoutCause {
  return (
    typeof c === 'object' &&
    c !== null &&
    'reason' in c &&
    'recoveredCostUsd' in c &&
    typeof (c as { recoveredCostUsd: unknown }).recoveredCostUsd === 'number'
  )
}

/**
 * Transport contract — what every model backend implements.
 * v1 ships ClaudeCodeCliTransport; v1.5+ adds AnthropicSdkTransport, etc.
 */
export interface SubagentTransport {
  dispatch(opts: DispatchOpts): Promise<Result<DispatchResponse, AppError>>
}

/**
 * Idle/ceiling defaults (seconds) for activity-based liveness (#45). A working
 * agent streams continuously → never idle-killed; the ceiling is the absolute
 * backstop. Both overridable per-dispatch (DispatchOpts) or globally via env.
 *
 * The ceiling is intentionally generous — stall detection (no Write/Edit/Bash
 * for `DEFAULT_NO_PROGRESS_SEC`) is the primary early-termination mechanism
 * for builder-class agents that go in circles without producing code.
 */
const DEFAULT_IDLE_SEC = 120
const DEFAULT_CEILING_SEC = 3600
/** How often to emit a live-progress line to stderr while an agent runs. */
const PROGRESS_HEARTBEAT_MS = 15_000
/** Grace period after SIGTERM before escalating to SIGKILL (so a child that
 *  ignores SIGTERM can't hang `dispatch` forever — `close` always fires). */
const SIGKILL_GRACE_MS = 10_000

/** Parse a positive-number env var; undefined if unset/invalid. */
function envSec(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
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
    // Precedence: env (operator's global override) > per-call (tier-sized by the
    // caller) > constant default.
    const idleSec = envSec('SDLC_SUBAGENT_IDLE_SEC') ?? opts.idleTimeoutSec ?? DEFAULT_IDLE_SEC
    const ceilingSec =
      envSec('SDLC_SUBAGENT_CEILING_SEC') ??
      opts.ceilingSec ??
      opts.timeoutSec ??
      DEFAULT_CEILING_SEC
    // Progress watchdog: disabled when noProgressSec is undefined (read-only roles).
    // Env override applies only when the caller has opted the role in (not undefined).
    const noProgressSec =
      opts.noProgressSec !== undefined
        ? (envSec('SDLC_SUBAGENT_NO_PROGRESS_SEC') ?? opts.noProgressSec)
        : undefined

    return new Promise((resolve) => {
      const args = [
        '--print',
        // Activity-based liveness (#45): stream-json emits one JSON event per step
        // (system/stream_event/assistant/result) AS the agent works, replacing the
        // single buffered envelope that arrived only at the very end (zero mid-run
        // signal). Each line resets the idle timer, so a productively-working agent
        // is never killed; a hung one (no output) is killed on the idle threshold —
        // faster than the old blind wall-clock. The terminal `result` event still
        // carries `result` text + `usage` + `total_cost_usd` (F5). `--verbose` is
        // REQUIRED by the CLI for stream-json under --print.
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
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
        opts.allowedTools ?? ALLOWED_AGENT_TOOLS,
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
        // detached → the child leads its own process group, so on timeout we can
        // signal the WHOLE group (reaping any foreground subprocess it spawned,
        // e.g. `pnpm test`) instead of orphaning it.
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // `parseBuf` retains only the events the final parse + cost-recovery need —
      // everything EXCEPT the high-volume `stream_event` partial deltas — so memory
      // stays bounded on long runs while the terminal `result` event and per-turn
      // `usage` are still captured. Liveness (below) still reacts to every byte.
      let parseBuf = ''
      let stderr = ''
      let lineBuf = ''
      let killReason: 'idle' | 'ceiling' | 'stalled' | null = null
      let lastActivity = performance.now()
      let toolCalls = 0
      // Tool calls seen (tool_use) minus completed (tool_result). While > 0 the
      // agent is legitimately BLOCKED on a tool (e.g. a long `pnpm test`) and stream
      // silence is EXPECTED — the idle timer must not fire; only the ceiling bounds
      // it (#45: the CLI does not stream a foreground subprocess's mid-run output).
      let openToolCalls = 0
      // Timestamp of the last Write/Edit/Bash tool_use seen — used in the heartbeat
      // to show stall watchdog state at a glance ("last write 310s ago").
      let lastMutatingTool: number | undefined

      // Terminate the whole process group, escalating SIGTERM → SIGKILL if the child
      // ignores the term signal — otherwise `close` never fires and `dispatch` hangs
      // forever, defeating the timeout exactly when it's needed.
      let sigkillTimer: ReturnType<typeof setTimeout> | undefined
      const signalGroup = (sig: NodeJS.Signals) => {
        // Prefer signalling the whole group (`-pid`) so a foreground grandchild
        // (e.g. `pnpm test`) is reaped, not orphaned.
        if (child.pid === undefined) {
          try {
            child.kill(sig)
          } catch {
            // Not yet spawned / already gone — nothing to signal.
          }
          return
        }
        try {
          process.kill(-child.pid, sig)
        } catch (e) {
          // ESRCH = the group is already gone (leader exited) → nothing to do; a
          // dead-pid `child.kill` would be a no-op anyway. Only fall back for other
          // errors (e.g. the platform rejected the negative-pid group form).
          if ((e as NodeJS.ErrnoException)?.code === 'ESRCH') return
          try {
            child.kill(sig)
          } catch {
            // Gone — nothing to signal.
          }
        }
      }
      const killChild = (reason: 'idle' | 'ceiling' | 'stalled') => {
        if (killReason) return // already terminating — don't overwrite or re-signal
        killReason = reason
        signalGroup('SIGTERM')
        sigkillTimer = setTimeout(() => signalGroup('SIGKILL'), SIGKILL_GRACE_MS)
      }

      // Ceiling: absolute backstop, NEVER reset.
      const ceilingTimer = setTimeout(() => killChild('ceiling'), ceilingSec * 1000)

      // Idle: re-armed on every byte of output. When it fires, kill ONLY if no tool
      // is outstanding — otherwise the agent is blocked on a legitimately-long tool,
      // so re-arm and keep watching.
      //
      // DELIBERATE TRADE-OFF (#45): the CLI does NOT stream a foreground tool's
      // mid-run output, so a silent window during a tool is indistinguishable from a
      // hang INSIDE that tool. We cannot idle-kill it without also killing long-but-
      // healthy tools (e.g. `pnpm test`) — the very bug #45 fixes. So a mid-tool hang
      // is bounded by the CEILING, not the idle timer (slower to detect than an
      // idle-stage hang, but the only safe choice). Idle still catches the common
      // case: the model stalling BETWEEN tool calls (openToolCalls == 0).
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const armIdle = () => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          if (killReason) return
          if (openToolCalls > 0) {
            armIdle() // tool in flight → silence expected; defer to the ceiling
            return
          }
          killChild('idle')
        }, idleSec * 1000)
      }
      armIdle()

      // Progress watchdog (#125): fires if no Write, Edit, or Bash tool is invoked
      // for noProgressSec. Catches the "reading in circles" stall where the model
      // generates prose/thinking but never produces code — a pattern idle doesn't
      // catch because the agent IS producing output (resetting the idle timer).
      // Disabled when noProgressSec is undefined (read-only roles: reviewer, checker).
      let noProgressTimer: ReturnType<typeof setTimeout> | undefined
      const armNoProgress = () => {
        if (!noProgressSec) return
        clearTimeout(noProgressTimer)
        noProgressTimer = setTimeout(() => {
          if (killReason) return
          // Mirror armIdle: a tool currently in flight (e.g. `pnpm test` via Bash)
          // makes the agent legitimately silent — the progress window started BEFORE
          // the tool fired, so it expiring mid-tool is a false alarm. Re-arm and
          // wait; the ceiling bounds a hung tool (#45).
          if (openToolCalls > 0) {
            armNoProgress()
            return
          }
          killChild('stalled')
        }, noProgressSec * 1000)
      }
      armNoProgress() // arm at start; reset each time a mutating tool is seen

      // Live progress to stderr so `dispatch` shows activity, not a silent hang
      // (#45 AC5). Read-only — the ntfy "extend?" HITL is deferred to #48.
      const heartbeat = setInterval(() => {
        const agoSec = Math.round((performance.now() - lastActivity) / 1000)
        const writeLabel =
          noProgressSec !== undefined
            ? lastMutatingTool !== undefined
              ? `; last write ${Math.round((performance.now() - lastMutatingTool) / 1000)}s ago`
              : '; no write yet'
            : ''
        process.stderr.write(
          `[subagent] ${toolCalls} tool call(s), ${openToolCalls} in flight; last activity ${agoSec}s ago${writeLabel}\n`,
        )
      }, PROGRESS_HEARTBEAT_MS)

      const clearTimers = () => {
        clearTimeout(ceilingTimer)
        clearTimeout(idleTimer)
        clearTimeout(noProgressTimer)
        clearTimeout(sigkillTimer)
        clearInterval(heartbeat)
      }

      // Process one COMPLETE stream-json line: track tool-call balance + retain the
      // non-partial events for the final parse.
      const onLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed) return
        let obj: Record<string, unknown>
        try {
          const parsed = JSON.parse(trimmed)
          if (typeof parsed !== 'object' || parsed === null) return
          obj = parsed as Record<string, unknown>
        } catch {
          return // partial/non-JSON line — liveness already reacted to the bytes
        }
        if (obj.type === 'stream_event') return // high-volume delta — not retained
        parseBuf += `${trimmed}\n`
        const { opened, closed } = countToolTransitions(obj)
        toolCalls += opened
        openToolCalls = Math.max(0, openToolCalls + opened - closed)
        // Progress watchdog: a Write/Edit/Bash tool_use signals genuine forward
        // progress — reset the stall timer. Non-mutating tools (Read/Glob/Grep) do
        // not count; an agent that only reads is not making code changes.
        if (noProgressSec && hasMutatingToolUse(obj)) {
          lastMutatingTool = performance.now()
          armNoProgress()
        }
      }

      child.stdout.on('data', (chunk: Buffer) => {
        lastActivity = performance.now()
        armIdle()
        lineBuf += chunk.toString('utf8')
        let nl = lineBuf.indexOf('\n')
        while (nl >= 0) {
          onLine(lineBuf.slice(0, nl))
          lineBuf = lineBuf.slice(nl + 1)
          nl = lineBuf.indexOf('\n')
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        // stderr output is liveness too, but carries no stream events.
        lastActivity = performance.now()
        armIdle()
      })

      child.on('error', (cause) => {
        clearTimers()
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
        clearTimers()
        const durationMs = performance.now() - start
        // Flush any trailing line without a newline (the final `result` event often
        // arrives unterminated) so the parse sees it.
        if (lineBuf.trim()) onLine(lineBuf)

        if (killReason) {
          // The kill pre-empted the terminal envelope, so recover what was spent
          // from the partial stream (else the run logs $0 — the bug #45 calls out).
          // Cost is estimated locally (the CLI's total_cost_usd only lands on the
          // result event we never got).
          const recoveredTokens = recoverUsageFromStream(parseBuf)
          const cause: SubagentTimeoutCause = {
            reason: killReason,
            idleSec,
            ceilingSec,
            recoveredTokens,
            recoveredCostUsd: estimateCost(opts.model, recoveredTokens),
            toolCalls,
            lastActivityAgoMs: Math.round(performance.now() - lastActivity),
            stdout: parseBuf.slice(-2000),
            stderr: stderr.slice(-2000),
          }
          const detail =
            killReason === 'idle'
              ? `no output for ${idleSec}s (idle timeout) — likely hung`
              : killReason === 'stalled'
                ? `no Write/Edit/Bash tool in ${noProgressSec}s — reading without progress`
                : `exceeded the ${ceilingSec}s ceiling while still active`
          resolve(
            err(
              makeError('subagent.timeout', `Claude subagent killed: ${detail}`, {
                cause,
                fix:
                  killReason === 'idle'
                    ? 'Agent produced no output for the idle window; inspect captured stderr/stdout.'
                    : killReason === 'stalled'
                      ? 'Agent read files without making code changes. Check if the task needs decomposition via PLANNER, or if a pnpm/git approval prompt is blocking Bash.'
                      : 'If the task is legitimately long, raise the ceiling for this tier or add a `large` label.',
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

        // Extract the stream's terminal `result` event (--output-format stream-json):
        // it holds the agent's `result` text + `usage` + real cost (F5), same fields
        // the old buffered envelope had. A malformed/error envelope is a hard failure
        // here — we never silently fall back to 0-token rows.
        const payload = parseDispatchPayload(parseBuf)
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

/** Parse newline-delimited JSON (stream-json) stdout into its object events. */
function parseNdjsonObjects(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      if (typeof obj === 'object' && obj !== null) out.push(obj as Record<string, unknown>)
    } catch {
      // Skip any non-JSON line (progress chatter, partial flush) — best-effort.
    }
  }
  return out
}

/**
 * Count tool-call transitions in a single (non-stream_event) stream object:
 * `assistant` events OPEN tool calls (their `message.content` carries `tool_use`
 * blocks); `user` events CLOSE them (`tool_result` blocks). The transport uses the
 * open/close balance to know when the agent is blocked on a tool (#45).
 *
 * Gated by `obj.type` so we only count `tool_use` from `assistant` and
 * `tool_result` from `user` — a misplaced block on the wrong event type can't
 * desync the balance.
 */
export function countToolTransitions(obj: Record<string, unknown>): {
  opened: number
  closed: number
} {
  const type = obj.type
  if (type !== 'assistant' && type !== 'user') return { opened: 0, closed: 0 }
  const content = (obj.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return { opened: 0, closed: 0 }
  let opened = 0
  let closed = 0
  for (const block of content) {
    const t = (block as { type?: unknown } | null)?.type
    if (type === 'assistant' && t === 'tool_use') opened++
    else if (type === 'user' && t === 'tool_result') closed++
  }
  return { opened, closed }
}

/**
 * Tools whose invocation constitutes forward progress for mutating roles (#125).
 * Read/Glob/Grep do not count — an agent that only reads is not producing code.
 */
const MUTATING_TOOLS = new Set(['Write', 'Edit', 'Bash'])

/**
 * Returns true when `obj` is an `assistant` event containing at least one
 * Write, Edit, or Bash tool_use block — signaling that the agent is actually
 * making changes, not just reading files in a loop.
 */
export function hasMutatingToolUse(obj: Record<string, unknown>): boolean {
  if (obj.type !== 'assistant') return false
  const content = (obj.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return false
  return content.some((block) => {
    const b = block as { type?: unknown; name?: unknown } | null
    return b?.type === 'tool_use' && MUTATING_TOOLS.has(b?.name as string)
  })
}

/**
 * Recover token usage from the stream when the terminal `result` event is missing
 * (the transport SIGTERM'd the agent) — so a killed run isn't billed $0.
 * - If a `result` event IS present, its usage is authoritative (cumulative).
 * - Otherwise (killed mid-run) per-turn `assistant` usage is NOT cumulative, so we
 *   SUM `output_tokens` across turns and take the last seen input/cache-read.
 * Zeros if nothing usable was streamed.
 */
const usageNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
function usageOf(
  obj: Record<string, unknown>,
):
  | { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown }
  | undefined {
  const message = obj.message as { usage?: unknown } | undefined
  return (obj.usage ?? message?.usage) as ReturnType<typeof usageOf>
}

export function recoverUsageFromStream(stdout: string): {
  input: number
  output: number
  cacheRead?: number
} {
  const objs = parseNdjsonObjects(stdout)
  const result = objs.find((o) => o.type === 'result')
  if (result) {
    const u = usageOf(result) ?? {}
    const cacheRead = usageNum(u.cache_read_input_tokens)
    return {
      input: usageNum(u.input_tokens),
      output: usageNum(u.output_tokens),
      ...(cacheRead > 0 ? { cacheRead } : {}),
    }
  }
  let output = 0
  let input = 0
  let cacheRead = 0
  for (const obj of objs) {
    const u = usageOf(obj)
    if (!u) continue
    output += usageNum(u.output_tokens) // per-turn → accumulate
    const i = usageNum(u.input_tokens)
    if (i) input = i // last non-zero
    const c = usageNum(u.cache_read_input_tokens)
    if (c) cacheRead = c
  }
  return { input, output, ...(cacheRead > 0 ? { cacheRead } : {}) }
}

/**
 * Parse the `claude --print --output-format stream-json` stdout.
 *
 * stream-json is newline-delimited: one JSON event per line, ending with a
 * terminal `{ "type": "result", ... }` event whose `result` field holds the
 * agent's text answer, with token usage under `usage` and real cost under
 * `total_cost_usd`. We pick that result event (falling back to the sole/last
 * object so a bare single-envelope — e.g. a unit-test fixture — still parses).
 * Replaces the old buffered single-JSON parse + the F5 stderr regex that logged
 * every run as 0 tokens / $0 (broke the cost audit G4 + per-agent budgets G5).
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
  const objs = parseNdjsonObjects(stdout)
  if (objs.length === 0) {
    return err(
      makeError(
        'subagent.invalid-json',
        'claude CLI did not emit valid JSON (expected --output-format stream-json)',
        {
          cause: { stdout: stdout.slice(0, 800) },
          fix: 'Ensure the spawned claude CLI supports `--output-format stream-json --verbose`; inspect the captured stdout.',
        },
      ),
    )
  }

  // The stream's terminal `result` event is authoritative; fall back to the last
  // object so a legacy single-envelope payload still parses.
  const env = (objs.find((o) => o.type === 'result') ?? objs[objs.length - 1]) as {
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

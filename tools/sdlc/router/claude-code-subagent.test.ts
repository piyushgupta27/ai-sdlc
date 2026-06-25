/**
 * Tests for the subagent transport's stream-json parsing (findings F5 + #45).
 *
 * The pure cores are tested directly so we don't spawn a process:
 *   - parseDispatchPayload — pulls the terminal `result` event out of the
 *     newline-delimited stream-json stdout (and still parses a bare single
 *     envelope, the legacy shape).
 *   - recoverUsageFromStream — recovers tokens from a partial stream after an
 *     idle/ceiling kill (#45), so a timed-out run isn't billed $0.
 *   - countToolTransitions / isSubagentTimeoutCause — tool-balance + typed-cause helpers.
 * Plus behavioral tests of the transport's timers (#45) over a mocked `spawn` +
 * fake timers — idle kill, idle reset on activity, ceiling, tool-aware suspension,
 * and SIGTERM→SIGKILL escalation. Fixtures match the live CLI output from the probe.
 */

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClaudeCodeCliTransport,
  countToolTransitions,
  hasMutatingToolUse,
  isSubagentTimeoutCause,
  parseDispatchPayload,
  recoverUsageFromStream,
} from './claude-code-subagent.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
import { spawn } from 'node:child_process'

/** A realistic stream-json stdout: system init → partial deltas → assistant → result. */
const streamJsonStdout = [
  JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-haiku-4-5' }),
  JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }),
  JSON.stringify({
    type: 'assistant',
    message: { usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 1000 } },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'pong',
    total_cost_usd: 0.0156666,
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 9870,
      cache_read_input_tokens: 30941,
      output_tokens: 45,
    },
  }),
].join('\n')

const successEnvelope = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'pong',
  total_cost_usd: 0.0156666,
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 9870,
    cache_read_input_tokens: 30941,
    output_tokens: 45,
  },
})

describe('parseDispatchPayload', () => {
  it('extracts rawText, tokens, and real cost from a success envelope', () => {
    const r = parseDispatchPayload(successEnvelope)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('pong')
    expect(r.value.tokens.input).toBe(10)
    expect(r.value.tokens.output).toBe(45)
    expect(r.value.tokens.cacheRead).toBe(30941)
    expect(r.value.costUsd).toBeCloseTo(0.0156666, 7)
  })

  it('returns an error when the CLI reports is_error=true', () => {
    const env = JSON.stringify({ is_error: true, result: 'rate limited', total_cost_usd: 0 })
    const r = parseDispatchPayload(env)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.cli-error')
  })

  it('returns an error for non-JSON stdout', () => {
    const r = parseDispatchPayload('not json at all')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.invalid-json')
  })

  it('returns an error when the JSON envelope has no string result', () => {
    const r = parseDispatchPayload(JSON.stringify({ is_error: false, usage: {} }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.invalid-json')
  })

  it('defaults tokens to 0 and leaves cost undefined when usage/cost are absent (no throw)', () => {
    const r = parseDispatchPayload(JSON.stringify({ is_error: false, result: 'hi' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('hi')
    expect(r.value.tokens.input).toBe(0)
    expect(r.value.tokens.output).toBe(0)
    expect(r.value.tokens.cacheRead).toBeUndefined()
    // GH#30: undefined (not 0) so the caller falls back to estimateCost rather than logging $0.
    expect(r.value.costUsd).toBeUndefined()
  })

  it('keeps the real cost when the CLI reports total_cost_usd', () => {
    const r = parseDispatchPayload(
      JSON.stringify({ is_error: false, result: 'hi', total_cost_usd: 1.34 }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.costUsd).toBe(1.34)
  })

  it('picks the terminal result event out of a multi-line stream (#45)', () => {
    const r = parseDispatchPayload(streamJsonStdout)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('pong')
    expect(r.value.tokens.input).toBe(10)
    expect(r.value.tokens.output).toBe(45)
    expect(r.value.tokens.cacheRead).toBe(30941)
    expect(r.value.costUsd).toBeCloseTo(0.0156666, 7)
  })

  it('ignores non-JSON lines interleaved in the stream', () => {
    const r = parseDispatchPayload(`progress chatter not json\n${streamJsonStdout}\n`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('pong')
  })

  it('errors when the stream has no result event and no string result', () => {
    const noResult = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'stream_event', event: { type: 'message_stop' } }),
    ].join('\n')
    const r = parseDispatchPayload(noResult)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.invalid-json')
  })
})

describe('recoverUsageFromStream (#45 — cost recovery on kill)', () => {
  it('recovers tokens from the last usage-bearing event when no result arrived', () => {
    // Simulate a SIGTERM'd stream: assistant usage present, but no terminal result.
    const partial = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({
        type: 'assistant',
        message: { usage: { input_tokens: 12, output_tokens: 80, cache_read_input_tokens: 500 } },
      }),
    ].join('\n')
    const tokens = recoverUsageFromStream(partial)
    expect(tokens.input).toBe(12)
    expect(tokens.output).toBe(80)
    expect(tokens.cacheRead).toBe(500)
  })

  it('also reads usage off a top-level result event', () => {
    const tokens = recoverUsageFromStream(streamJsonStdout)
    expect(tokens.input).toBe(10)
    expect(tokens.output).toBe(45)
    expect(tokens.cacheRead).toBe(30941)
  })

  it('returns zeros when nothing usable was streamed', () => {
    const tokens = recoverUsageFromStream('garbage\n{"type":"system"}\n')
    expect(tokens.input).toBe(0)
    expect(tokens.output).toBe(0)
    expect(tokens.cacheRead).toBeUndefined()
  })

  it('SUMS output across multi-turn assistant events when no result arrived (#45)', () => {
    // Per-turn assistant usage is NOT cumulative — summing avoids under-billing a
    // long, killed tool loop.
    const multiTurn = [
      JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: 80 } } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      JSON.stringify({
        type: 'assistant',
        message: { usage: { input_tokens: 5, output_tokens: 120, cache_read_input_tokens: 200 } },
      }),
    ].join('\n')
    const tokens = recoverUsageFromStream(multiTurn)
    expect(tokens.output).toBe(200) // 80 + 120
    expect(tokens.input).toBe(5)
    expect(tokens.cacheRead).toBe(200)
  })
})

describe('countToolTransitions', () => {
  it('opens on assistant tool_use blocks', () => {
    const obj = {
      type: 'assistant',
      message: { content: [{ type: 'text' }, { type: 'tool_use' }, { type: 'tool_use' }] },
    }
    expect(countToolTransitions(obj)).toEqual({ opened: 2, closed: 0 })
  })
  it('closes on user tool_result blocks', () => {
    const obj = { type: 'user', message: { content: [{ type: 'tool_result' }] } }
    expect(countToolTransitions(obj)).toEqual({ opened: 0, closed: 1 })
  })
  it('is neutral for events without tool blocks', () => {
    expect(countToolTransitions({ type: 'result', result: 'ok' })).toEqual({ opened: 0, closed: 0 })
  })
  it('gates by event type — a tool_use on a non-assistant event does not open', () => {
    // a `user` event echoing a tool_use block must NOT desync the balance
    expect(
      countToolTransitions({ type: 'user', message: { content: [{ type: 'tool_use' }] } }),
    ).toEqual({ opened: 0, closed: 0 })
    // a `tool_result` on an assistant event must NOT close
    expect(
      countToolTransitions({ type: 'assistant', message: { content: [{ type: 'tool_result' }] } }),
    ).toEqual({ opened: 0, closed: 0 })
  })
})

describe('hasMutatingToolUse (#125)', () => {
  const asst = (name: string) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name }] },
  })
  it('returns true for Write', () => expect(hasMutatingToolUse(asst('Write'))).toBe(true))
  it('returns true for Edit', () => expect(hasMutatingToolUse(asst('Edit'))).toBe(true))
  it('returns true for Bash', () => expect(hasMutatingToolUse(asst('Bash'))).toBe(true))
  it('returns false for Read', () => expect(hasMutatingToolUse(asst('Read'))).toBe(false))
  it('returns false for Grep', () => expect(hasMutatingToolUse(asst('Grep'))).toBe(false))
  it('returns false for non-assistant event type', () => {
    expect(
      hasMutatingToolUse({
        type: 'user',
        message: { content: [{ type: 'tool_use', name: 'Write' }] },
      }),
    ).toBe(false)
  })
  it('returns false for assistant with no content', () => {
    expect(hasMutatingToolUse({ type: 'assistant', message: {} })).toBe(false)
  })
  it('true when Write appears among other non-mutating tools', () => {
    expect(
      hasMutatingToolUse({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read' },
            { type: 'tool_use', name: 'Write' },
          ],
        },
      }),
    ).toBe(true)
  })
})

// ─── Transport timer behavior (#45) ──────────────────────────────────────────
// A fake child (EventEmitter) + fake timers let us assert the kill logic without
// spawning `claude`. pid is left undefined so signalGroup falls back to child.kill
// (never touching a real process group from a test).
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number | undefined
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = undefined
  child.kill = vi.fn()
  return child
}

const DISPATCH = {
  userMessage: 'u',
  systemPrompt: 's',
  model: 'claude-haiku-4-5-20251001',
  temperature: 0,
  cwd: '/tmp',
  idleTimeoutSec: 10,
  ceilingSec: 100,
}

describe('ClaudeCodeCliTransport timers (#45)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('idle-kills after silence and reports reason=idle with recovered cost', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    // an assistant turn (tokens to recover), then the tool COMPLETED (no open tool)
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: 30 } } })}\n`,
      ),
    )
    await vi.advanceTimersByTimeAsync(10_000) // idle window with no further output
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('subagent.timeout')
    expect(isSubagentTimeoutCause(r.error.cause)).toBe(true)
    if (!isSubagentTimeoutCause(r.error.cause)) return
    expect(r.error.cause.reason).toBe('idle')
    expect(r.error.cause.recoveredTokens.output).toBe(30)
  })

  it('does NOT idle-kill while a tool call is outstanding (tool-aware)', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    // assistant opens a tool call but no tool_result yet → agent is blocked on a tool
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } })}\n`,
      ),
    )
    await vi.advanceTimersByTimeAsync(50_000) // 5× the idle window, silent
    expect(child.kill).not.toHaveBeenCalled() // tool in flight → not idle-killed
    await vi.advanceTimersByTimeAsync(60_000) // now past the 100s ceiling
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok || !isSubagentTimeoutCause(r.error.cause)) return
    expect(r.error.cause.reason).toBe('ceiling')
  })

  it('escalates to SIGKILL if the child ignores SIGTERM', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    await vi.advanceTimersByTimeAsync(10_000) // idle fires
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(10_000) // SIGKILL grace elapses, no close
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null)
    await p
  })

  it('activity resets the idle timer; a clean result resolves success', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    // ping output every 6s for 30s — never idle (window is 10s), never killed
    for (let i = 0; i < 5; i++) {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'system' })}\n`))
      await vi.advanceTimersByTimeAsync(6_000)
    }
    expect(child.kill).not.toHaveBeenCalled()
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'result', is_error: false, result: 'done', total_cost_usd: 0.02, usage: { input_tokens: 3, output_tokens: 7 } })}\n`,
      ),
    )
    child.emit('close', 0)
    const r = await p
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rawText).toBe('done')
    expect(r.value.costUsd).toBe(0.02)
  })

  it('signals the whole process GROUP (-pid) on a real pid, falling back on non-ESRCH errors', async () => {
    const child = makeFakeChild()
    child.pid = 4242
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
      await vi.advanceTimersByTimeAsync(10_000) // idle fires
      expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM') // negative pid = group
      expect(child.kill).not.toHaveBeenCalled() // group signal succeeded → no fallback
      child.emit('close', null)
      await p
    } finally {
      killSpy.mockRestore()
    }
  })

  it('does NOT fall back to child.kill when the group is already gone (ESRCH)', async () => {
    const child = makeFakeChild()
    child.pid = 4243
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const esrch = Object.assign(new Error('no such process'), { code: 'ESRCH' })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw esrch
    })
    try {
      const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(killSpy).toHaveBeenCalledWith(-4243, 'SIGTERM')
      expect(child.kill).not.toHaveBeenCalled() // ESRCH → no dead-pid fallback
      child.emit('close', null)
      await p
    } finally {
      killSpy.mockRestore()
    }
  })
})

describe('ClaudeCodeCliTransport progress watchdog (#125)', () => {
  // Long idle window so idle timer never interferes with progress watchdog tests
  const DISPATCH_WITH_PROGRESS = { ...DISPATCH, noProgressSec: 30, idleTimeoutSec: 200 }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('stall-kills with reason=stalled when no Write/Edit/Bash seen within noProgressSec', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH_WITH_PROGRESS)
    // Emit a complete Read round-trip (open + close) — non-mutating, openToolCalls
    // returns to 0 so the timer fires normally when noProgressSec elapses.
    const readOpen = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read' }] },
    })
    const readClose = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result' }] },
    })
    child.stdout.emit('data', Buffer.from(`${readOpen}\n${readClose}\n`))
    await vi.advanceTimersByTimeAsync(30_000) // noProgressSec elapses with no Write/Edit/Bash
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok || !isSubagentTimeoutCause(r.error.cause)) return
    expect(r.error.cause.reason).toBe('stalled')
  })

  it('Write tool_use resets the progress timer, preventing stall kill', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH_WITH_PROGRESS)
    // At t=25s, emit a Write tool — resets the 30s progress timer to t+30s=55s
    await vi.advanceTimersByTimeAsync(25_000)
    const writeEvent = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Write' }] },
    })
    child.stdout.emit('data', Buffer.from(`${writeEvent}\n`))
    // Advance another 25s (total 50s, but timer reset at 25s so only 25s have elapsed since reset)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(child.kill).not.toHaveBeenCalled() // progress timer reset, no stall yet
    child.emit('close', 0)
    await p
  })

  it('tool in flight (openToolCalls > 0) defers the stall kill until the tool closes', async () => {
    // Regression guard for the openToolCalls guard in armNoProgress:
    // a Bash tool running `pnpm test` keeps openToolCalls=1 silently for minutes.
    // The progress timer must re-arm (not kill) while the tool is open, then fire
    // once the tool closes and no new mutating tool appears.
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH_WITH_PROGRESS)

    // t=5s: Bash tool_use opens (openToolCalls=1, progress timer resets to t=35s)
    await vi.advanceTimersByTimeAsync(5_000)
    const bashOpen = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash' }] },
    })
    child.stdout.emit('data', Buffer.from(`${bashOpen}\n`))

    // t=35s: progress timer fires → openToolCalls=1 → re-arms to t=65s; no kill yet
    await vi.advanceTimersByTimeAsync(30_000)
    expect(child.kill).not.toHaveBeenCalled()

    // t=50s: tool_result closes the Bash call (openToolCalls=0)
    await vi.advanceTimersByTimeAsync(15_000)
    const bashClose = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result' }] },
    })
    child.stdout.emit('data', Buffer.from(`${bashClose}\n`))

    // t=65s: re-armed timer fires; openToolCalls=0, no new mutating tool → stall kill
    await vi.advanceTimersByTimeAsync(15_000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok || !isSubagentTimeoutCause(r.error.cause)) return
    expect(r.error.cause.reason).toBe('stalled')
  })

  it('SDLC_SUBAGENT_NO_PROGRESS_SEC env overrides the caller noProgressSec', async () => {
    // Env says 10s; caller DISPATCH_WITH_PROGRESS says 30s. Env wins.
    vi.stubEnv('SDLC_SUBAGENT_NO_PROGRESS_SEC', '10')
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH_WITH_PROGRESS)
    // Advance 10s with no mutating tools — env value should fire, not caller's 30s
    await vi.advanceTimersByTimeAsync(10_000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok || !isSubagentTimeoutCause(r.error.cause)) return
    expect(r.error.cause.reason).toBe('stalled')
  })

  it('watchdog is disabled when noProgressSec is not passed', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH) // no noProgressSec
    // Advance 40s with no mutating tools — should NOT stall-kill (watchdog disabled)
    await vi.advanceTimersByTimeAsync(40_000)
    // Only ceiling (100s) or idle (10s) can fire; idle fires first here
    expect(child.kill).toHaveBeenCalledWith('SIGTERM') // idle-killed, not stalled
    child.emit('close', null)
    const r = await p
    if (r.ok || !isSubagentTimeoutCause(r.error.cause)) return
    expect(r.error.cause.reason).toBe('idle') // should be idle, not stalled
  })
})

describe('ClaudeCodeCliTransport --allowedTools arg', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('passes opts.allowedTools to the CLI when set (left side of ?? exercised)', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch({ ...DISPATCH, allowedTools: 'Read,Glob,Grep' })
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'result', is_error: false, result: 'ok', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } })}\n`,
      ),
    )
    child.emit('close', 0)
    await p
    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
    const idx = spawnArgs.indexOf('--allowedTools')
    expect(idx).toBeGreaterThan(-1)
    expect(spawnArgs[idx + 1]).toBe('Read,Glob,Grep')
  })

  it('falls back to ALLOWED_AGENT_TOOLS when allowedTools is not set (right side of ?? exercised)', async () => {
    const child = makeFakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const p = new ClaudeCodeCliTransport().dispatch(DISPATCH)
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'result', is_error: false, result: 'ok', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } })}\n`,
      ),
    )
    child.emit('close', 0)
    await p
    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
    const idx = spawnArgs.indexOf('--allowedTools')
    expect(idx).toBeGreaterThan(-1)
    expect(spawnArgs[idx + 1]).toBe('Read,Glob,Grep,Edit,Write,Bash')
  })
})

describe('isSubagentTimeoutCause', () => {
  it('accepts a well-formed timeout cause', () => {
    expect(
      isSubagentTimeoutCause({
        reason: 'idle',
        idleSec: 120,
        ceilingSec: 600,
        recoveredTokens: { input: 1, output: 2 },
        recoveredCostUsd: 0.01,
        toolCalls: 3,
        lastActivityAgoMs: 121000,
        stdout: '',
        stderr: '',
      }),
    ).toBe(true)
  })

  it('rejects arbitrary causes', () => {
    expect(isSubagentTimeoutCause({ stdout: 'x', stderr: 'y' })).toBe(false)
    expect(isSubagentTimeoutCause(null)).toBe(false)
    expect(isSubagentTimeoutCause('nope')).toBe(false)
    expect(isSubagentTimeoutCause({ reason: 'idle', recoveredCostUsd: 'not-a-number' })).toBe(false)
  })
})

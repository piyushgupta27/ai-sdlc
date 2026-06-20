/**
 * Shared agent base — prompt loading, dispatch, response parsing.
 *
 * Every agent under `tools/sdlc/agents/<role>/index.ts` calls `runAgent()`
 * with its role + brief + response schema. This module handles:
 *   - Loading the prompt from `tools/sdlc/prompts/<role>/v1.md`
 *   - Dispatching via the subagent transport
 *   - Parsing the response as JSON (agents return JSON-only output)
 *   - Wrapping the result with token/cost/duration metadata
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type DispatchResponse,
  type SubagentTransport,
  defaultTransport,
} from '../router/claude-code-subagent.js'
import { estimateCost, selectModel } from '../router/select-model.js'
import {
  type AgentBrief,
  type AgentResult,
  type AppError,
  type ModelId,
  type ModelTransport,
  type Result,
  type V1AgentRole,
  err,
  makeError,
  ok,
} from '../types/index.js'

/**
 * Prompts directory — co-located with agents/ for easy editing.
 * Resolved relative to this module so we don't depend on cwd.
 */
const PROMPTS_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'prompts')
})()

/**
 * Options for a single agent run.
 */
export interface RunAgentOpts<TPayload> {
  readonly role: V1AgentRole
  readonly brief: AgentBrief<TPayload>
  /** Tier of the underlying task — drives model routing */
  readonly tier: number
  /** Set on retry runs (raises model + temperature behavior) */
  readonly isRetry?: boolean
  /** Set if epic was tagged complex */
  readonly isComplex?: boolean
  /** Inject a transport for testing */
  readonly transport?: SubagentTransport
}

/**
 * The user-message envelope sent to the subagent. Agents return JSON in
 * this format; the base layer parses it.
 */
interface AgentEnvelope<TOutput = unknown> {
  readonly outcome: 'success' | 'failure' | 'partial' | 'escalated'
  readonly output: TOutput
  readonly filesRead?: readonly string[]
  readonly filesWritten?: readonly string[]
  readonly notes?: string
}

/**
 * Run an agent. Loads prompt, dispatches, parses, returns typed Result.
 *
 * The agent prompt MUST instruct the agent to respond with a single JSON
 * object matching AgentEnvelope shape. If the response isn't valid JSON,
 * we return Result.err with `agent.invalid-response` and the raw text
 * preserved in the audit log for debugging.
 */
export async function runAgent<TPayload, TOutput>(
  opts: RunAgentOpts<TPayload>,
): Promise<Result<AgentResult<TOutput>, AppError>> {
  // 1. Load prompt
  const promptPath = join(PROMPTS_DIR, opts.role, 'v1.md')
  let systemPrompt: string
  try {
    systemPrompt = await readFile(promptPath, 'utf8')
  } catch (cause) {
    return err(
      makeError('agent.prompt-missing', `Cannot load prompt for ${opts.role} at ${promptPath}`, {
        cause,
        fix: `Ensure tools/sdlc/prompts/${opts.role}/v1.md exists`,
      }),
    )
  }

  // 2. Pick model
  const route = selectModel({
    role: opts.role,
    tier: opts.tier as 0 | 1 | 2 | 3 | 4,
    isRetry: opts.isRetry ?? false,
    isComplex: opts.isComplex ?? false,
  })

  // 3. Build user message: JSON-serialize the brief payload + add response-format reminder
  const userMessage = buildUserMessage(opts.role, opts.brief)

  // 4. Dispatch
  const transport = opts.transport ?? defaultTransport
  const dispatchResult = await transport.dispatch({
    userMessage,
    systemPrompt,
    model: route.model,
    temperature: route.temperature,
    cwd: opts.brief.targetRepo,
    // Activity-based timeout (#45): the transport idle-kills genuinely-hung agents;
    // here we only size the absolute ceiling by task category (tier) so heavy
    // code+test work isn't capped like a trivial edit. Env overrides globally.
    ceilingSec: ceilingSecForTier(opts.tier, opts.isComplex),
    // Progress watchdog (#125): mutating roles (builder/tester) must call Write/Edit/Bash
    // within noProgressSec or be killed as stalled. Read-only roles (reviewer/checker)
    // omit this — they legitimately read many files before returning JSON output.
    ...(MUTATING_ROLES.has(opts.role) ? { noProgressSec: noProgressSecForTier(opts.tier) } : {}),
    ...(opts.brief.blastRadiusApproved
      ? { blastRadiusApproved: opts.brief.blastRadiusApproved }
      : {}),
  })

  if (!dispatchResult.ok) return dispatchResult

  // 5. Parse response
  const envelope = parseEnvelope<TOutput>(dispatchResult.value.rawText)

  // #77: one-shot re-prompt when the agent emits prose instead of JSON.
  // Scoped to read-only roles (reviewer, checker, planner …) only.
  // Mutating roles (builder, tester) run in a stateless fresh subprocess —
  // a re-prompt would spawn a second independent agent and double-apply
  // any file writes. Those roles fall through to the orchestrator's existing
  // retry machinery instead.
  if (!envelope.ok && !MUTATING_ROLES.has(opts.role)) {
    const repromptResult = await transport.dispatch({
      userMessage: buildRepromptMessage(opts.role, opts.brief),
      systemPrompt,
      model: route.model,
      temperature: route.temperature,
      cwd: opts.brief.targetRepo,
      ceilingSec: 600,
      ...(opts.brief.blastRadiusApproved
        ? { blastRadiusApproved: opts.brief.blastRadiusApproved }
        : {}),
    })
    if (repromptResult.ok) {
      const reparsed = parseEnvelope<TOutput>(repromptResult.value.rawText)
      if (reparsed.ok) {
        return ok(
          makeAgentResult(
            reparsed.value,
            mergeDispatchResponses(dispatchResult.value, repromptResult.value),
            route.model,
            'claude-code-subagent',
          ),
        )
      }
    }
    return envelope
  }

  // Mutating roles (builder, tester) bypass the re-prompt above; handle their
  // parse failure here so TypeScript can narrow envelope.value below.
  if (!envelope.ok) return envelope

  // 6. Wrap with metadata
  const result = makeAgentResult(
    envelope.value,
    dispatchResult.value,
    route.model,
    'claude-code-subagent',
  )
  return ok(result)
}

/**
 * Absolute-ceiling seconds by task tier (#125). The ceiling is now a backstop —
 * the progress watchdog (no Write/Edit/Bash for 300s) is the primary stall detector
 * for builder-class agents. The ceiling only fires for agents that ARE writing but
 * are genuinely very slow (e.g. a massive refactor with continuous tool activity).
 * Env `SDLC_SUBAGENT_CEILING_SEC` (resolved in the transport) overrides globally.
 * Complex tasks (`isComplex`) get +600s headroom on top of the tier baseline.
 */
function ceilingSecForTier(tier: number, isComplex?: boolean): number {
  let base: number
  if (tier >= 4)
    base = 600 // trivial — progress watchdog (300s) fires first on stall
  else if (tier >= 2)
    base = 2400 // standard feature work backstop
  else base = 3600 // tier 0/1 — Red-zone / complex / careful
  return base + (isComplex ? 600 : 0)
}

/** Roles that write files and benefit from the progress watchdog (#125). */
const MUTATING_ROLES: ReadonlySet<V1AgentRole> = new Set(['builder', 'tester'])

/**
 * Seconds without Write/Edit/Bash before the progress watchdog fires, sized
 * by tier. Tier-0/1 tasks legitimately read many files before their first
 * write (deep exploration, security audits) — a flat 300s would false-fire.
 * Tier-4 trivial tasks should produce code quickly; the shorter window catches
 * real stalls sooner.
 */
function noProgressSecForTier(tier: number): number {
  if (tier >= 4) return 180 // trivial — fast write expected
  if (tier >= 2) return 300 // standard feature work
  return 500 // tier 0/1 — exploratory reads before first write
}

function buildUserMessage<TPayload>(role: V1AgentRole, brief: AgentBrief<TPayload>): string {
  return [
    `# ${role.toUpperCase()} TASK BRIEF`,
    '',
    `Project: ${brief.project}`,
    `Task ID: ${brief.taskId}`,
    `Target repo (cwd): ${brief.targetRepo}`,
    '',
    '## Payload',
    '```json',
    JSON.stringify(brief.payload, null, 2),
    '```',
    '',
    '## Response format',
    '',
    'Respond with EXACTLY one JSON object — no prose, no markdown fences, no commentary.',
    'The object MUST match this shape:',
    '',
    '```',
    '{',
    '  "outcome": "success" | "failure" | "partial" | "escalated",',
    '  "output": <agent-specific output type per system prompt>,',
    '  "filesRead": [<paths you read>],',
    '  "filesWritten": [<paths you wrote>],',
    '  "notes": "<optional debugging notes>"',
    '}',
    '```',
  ].join('\n')
}

/** #77: re-prompt message used when the first response was prose, not JSON. */
function buildRepromptMessage<TPayload>(role: V1AgentRole, brief: AgentBrief<TPayload>): string {
  return [
    buildUserMessage(role, brief),
    '',
    '---',
    '',
    'CORRECTION: Your previous response was prose, not a JSON object.',
    'Return ONLY the raw JSON envelope — no markdown, no prose, nothing outside the object.',
  ].join('\n')
}

/**
 * #77: merge two DispatchResponse values into one, combining costs and tokens.
 * Used when a re-prompt succeeds so the caller accounts for both round-trips.
 */
function mergeDispatchResponses(
  first: DispatchResponse,
  second: DispatchResponse,
): DispatchResponse {
  return {
    rawText: second.rawText,
    durationMs: first.durationMs + second.durationMs,
    exitCode: second.exitCode,
    costUsd: (first.costUsd ?? 0) + (second.costUsd ?? 0),
    tokens: {
      input: first.tokens.input + second.tokens.input,
      output: first.tokens.output + second.tokens.output,
      ...(first.tokens.cacheRead !== undefined || second.tokens.cacheRead !== undefined
        ? { cacheRead: (first.tokens.cacheRead ?? 0) + (second.tokens.cacheRead ?? 0) }
        : {}),
    },
  }
}

function parseEnvelope<TOutput>(rawText: string): Result<AgentEnvelope<TOutput>, AppError> {
  const tryParse = (text: string): AgentEnvelope<TOutput> | null => {
    try {
      const parsed = JSON.parse(text) as AgentEnvelope<TOutput>
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'outcome' in parsed &&
        'output' in parsed
      ) {
        return parsed
      }
      return null
    } catch {
      return null
    }
  }

  // Strategy 1: outer-fence-stripped, full-string parse
  const cleaned = rawText
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()
  const direct = tryParse(cleaned)
  if (direct) return ok(direct)

  // Strategy 2: extract first balanced {...} block. Handles prose-before-JSON,
  // prose-after-JSON, and mid-prose JSON. String-aware to avoid counting
  // braces inside string literals.
  const block = extractFirstJsonObject(rawText)
  if (block) {
    const parsed = tryParse(block)
    if (parsed) return ok(parsed)
  }

  // Surface what we got so the user can diagnose without grepping audit rows.
  process.stderr.write(
    `\n[agent.invalid-response] failed to parse response (first 800 chars):\n${rawText.slice(0, 800)}\n[/agent.invalid-response]\n\n`,
  )

  return err(
    makeError('agent.invalid-response', 'Agent response was not valid JSON', {
      cause: { rawText: rawText.slice(0, 800) },
      fix: 'Inspect stderr for the raw response. Either the prompt needs to forbid prose more strictly, or extend parseEnvelope to handle the wrapper format.',
    }),
  )
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let isEscaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (isEscaped) {
      isEscaped = false
      continue
    }
    if (c === '\\') {
      isEscaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function makeAgentResult<TOutput>(
  envelope: AgentEnvelope<TOutput>,
  dispatch: DispatchResponse,
  model: ModelId,
  transport: ModelTransport,
): AgentResult<TOutput> {
  return {
    outcome: envelope.outcome,
    output: envelope.output,
    filesRead: envelope.filesRead ?? [],
    filesWritten: envelope.filesWritten ?? [],
    ...(envelope.notes ? { notes: envelope.notes } : {}),
    tokens: dispatch.tokens,
    durationMs: dispatch.durationMs,
    // Prefer the CLI's real reported cost (F5); fall back to the local
    // token-based estimate if the transport didn't surface one.
    costUsd: dispatch.costUsd ?? estimateCost(model, dispatch.tokens),
    model,
    transport,
  }
}

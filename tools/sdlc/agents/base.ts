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
import { estimateCost, selectModel } from '../router/select-model.js'
import {
  type DispatchResponse,
  type SubagentTransport,
  defaultTransport,
} from '../router/claude-code-subagent.js'

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
      makeError(
        'agent.prompt-missing',
        `Cannot load prompt for ${opts.role} at ${promptPath}`,
        {
          cause,
          fix: `Ensure tools/sdlc/prompts/${opts.role}/v1.md exists`,
        },
      ),
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
    ...(opts.brief.blastRadiusApproved
      ? { blastRadiusApproved: opts.brief.blastRadiusApproved }
      : {}),
  })

  if (!dispatchResult.ok) return dispatchResult

  // 5. Parse response
  const envelope = parseEnvelope<TOutput>(dispatchResult.value.rawText)
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

function parseEnvelope<TOutput>(
  rawText: string,
): Result<AgentEnvelope<TOutput>, AppError> {
  // Strip markdown fences if present (some agents may add them despite instructions)
  const cleaned = rawText
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()

  try {
    const parsed = JSON.parse(cleaned) as AgentEnvelope<TOutput>
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('outcome' in parsed) ||
      !('output' in parsed)
    ) {
      return err(
        makeError(
          'agent.invalid-response',
          'Agent response missing required fields (outcome, output)',
          {
            cause: { rawText: rawText.slice(0, 500) },
            fix: 'Tune the agent prompt to enforce the response schema',
          },
        ),
      )
    }
    return ok(parsed)
  } catch (cause) {
    return err(
      makeError(
        'agent.invalid-response',
        'Agent response was not valid JSON',
        {
          cause: { rawText: rawText.slice(0, 500), parseError: (cause as Error).message },
          fix: 'Inspect raw response; consider tightening prompt to forbid prose',
        },
      ),
    )
  }
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
    costUsd: estimateCost(model, dispatch.tokens),
    model,
    transport,
  }
}

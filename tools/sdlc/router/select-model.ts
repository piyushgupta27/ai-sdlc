/**
 * Smart model routing — see ARCHITECTURE.md §12.2.
 *
 * Q-AI-2 amendment: all transports go through Claude Code Subagent for v1.
 * Mitigation for anti-monoculture (since same family): temperature + cold-read
 * hostile-eye prompt + smaller AGGREGATOR (deferred to v1.5+).
 *
 * v1 routing (5 agents only):
 *   PLANNER   → opus 4.7 (heavy reasoning, low frequency)
 *   BUILDER   → sonnet 4.6 (fast, capable); opus 4.7 fallback on Tier 0/1 or retry
 *   TESTER    → sonnet 4.6
 *   REVIEWER  → opus 4.7 (hostile-eye prompt, temp 0.7)
 *   REPORTER  → haiku 4.5 (formulaic)
 */

import type { ModelId, ModelTransport } from '../types/audit.js'
import type { Tier } from '../types/task.js'
import type { V1AgentRole } from '../types/agent.js'

/**
 * Routing decision returned by the router. Deterministic; logged in audit.
 */
export interface ModelRoute {
  readonly model: ModelId
  readonly transport: ModelTransport
  readonly temperature: number
  readonly reason: string
}

/**
 * Inputs that drive the routing decision.
 */
export interface RouteRequest {
  readonly role: V1AgentRole
  readonly tier: Tier
  /** Set true when this is a retry after a previous validation failure */
  readonly isRetry?: boolean
  /** Set true when the task is tagged `kind:complex` or similar */
  readonly isComplex?: boolean
}

const SONNET: ModelId = 'claude-sonnet-4-6'
const OPUS: ModelId = 'claude-opus-4-7'
const HAIKU: ModelId = 'claude-haiku-4-5-20251001'

const SUBAGENT: ModelTransport = 'claude-code-subagent'

/**
 * Pick a model + transport + temperature for an agent run.
 *
 * Routing logic is intentionally deterministic so the audit log makes the
 * decision explicit. No randomness, no LLM-based routing.
 */
export function selectModel(req: RouteRequest): ModelRoute {
  const { role, tier, isRetry = false, isComplex = false } = req

  switch (role) {
    case 'planner':
      return {
        model: OPUS,
        transport: SUBAGENT,
        temperature: 0.3,
        reason: 'PLANNER always uses Opus for heavy reasoning + low frequency',
      }

    case 'builder': {
      // Opus on retry, Tier 0/1, or complex; Sonnet otherwise
      const useOpus = isRetry || tier === 0 || tier === 1 || isComplex
      return {
        model: useOpus ? OPUS : SONNET,
        transport: SUBAGENT,
        temperature: 0.3,
        reason: useOpus
          ? `BUILDER → Opus (retry=${isRetry}, tier=${tier}, complex=${isComplex})`
          : 'BUILDER → Sonnet (default; fast + capable)',
      }
    }

    case 'tester': {
      // Sonnet usually; Opus only on second TESTER retry within same task
      return {
        model: isRetry ? OPUS : SONNET,
        transport: SUBAGENT,
        temperature: 0.3,
        reason: isRetry
          ? 'TESTER → Opus (retry after coverage shortfall)'
          : 'TESTER → Sonnet (default)',
      }
    }

    case 'reviewer':
      // Cold-read hostile-eye reviewer — different temp from BUILDER to
      // encourage divergent thinking (Q-AI-18 mitigation for same-family review)
      return {
        model: OPUS,
        transport: SUBAGENT,
        temperature: 0.7,
        reason:
          'REVIEWER → Opus + cold-read prompt + temp 0.7 (Q-AI-2 amended: Claude-on-Claude with hostile-eye mitigation)',
      }

    case 'reporter':
      return {
        model: HAIKU,
        transport: SUBAGENT,
        temperature: 0.3,
        reason: 'REPORTER → Haiku (formulaic; cost-sensitive)',
      }

    default: {
      // Exhaustiveness check — TypeScript ensures every V1AgentRole is handled
      const _exhaustive: never = role
      throw new Error(`Unhandled agent role in router: ${_exhaustive as string}`)
    }
  }
}

/**
 * Approximate cost per 1M tokens for each model (USD).
 * Used for cost estimation in the audit log. Update when Anthropic
 * pricing changes.
 *
 * Source: Anthropic pricing page (Sonnet 4.6, Opus 4.7, Haiku 4.5).
 */
export const MODEL_COST_PER_M_TOKENS: Record<
  ModelId,
  { readonly input: number; readonly output: number; readonly cache: number }
> = {
  [SONNET]: { input: 3.0, output: 15.0, cache: 0.3 },
  [OPUS]: { input: 15.0, output: 75.0, cache: 1.5 },
  [HAIKU]: { input: 0.8, output: 4.0, cache: 0.08 },
}

/**
 * Estimate cost of a run from token counts.
 */
export function estimateCost(
  model: ModelId,
  tokens: { input: number; output: number; cacheRead?: number },
): number {
  const pricing = MODEL_COST_PER_M_TOKENS[model]
  if (!pricing) return 0
  const cachedPortion = tokens.cacheRead ?? 0
  const uncachedInput = Math.max(0, tokens.input - cachedPortion)
  return (
    (uncachedInput * pricing.input) / 1_000_000 +
    (cachedPortion * pricing.cache) / 1_000_000 +
    (tokens.output * pricing.output) / 1_000_000
  )
}

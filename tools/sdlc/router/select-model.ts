/**
 * Smart model routing — see ARCHITECTURE.md §12.2.
 *
 * Q-AI-2 amendment: all transports go through Claude Code Subagent for v1.
 * Mitigation for anti-monoculture (since same family): temperature + cold-read
 * hostile-eye prompt + smaller AGGREGATOR (deferred to v1.5+).
 *
 * # Guardian-Opus invariant
 *
 * PLANNER, REVIEWER, and CHECKER are guardian roles: they ALWAYS run Opus,
 * regardless of tier. They are never cost-routed down to Sonnet or Haiku on
 * any tier. This is the quality floor of the pipeline — most critical on the
 * auto-merge tiers (Tier 3-4) where no human reviews the change before it
 * lands. Cheap guardians on cheap tiers would let weak reasoning ship code.
 *
 * Labor roles (BUILDER, TESTER) ARE tier-routed:
 *   Tier 4 (non-retry, non-complex)   → Haiku   (cost-sensitive auto-merge)
 *   Tier 2-3 (non-retry, non-complex) → Sonnet  (fast + capable default)
 *   Tier 0-1, retry, or complex       → Opus    (high-blast-radius / hard work)
 *
 * v1 routing:
 *   PLANNER   → opus 4.8 (GUARDIAN; always Opus, any tier)
 *   BUILDER   → haiku 4.5 on tier-4 | sonnet 4.6 on tier-2/3 | opus 4.8 on tier-0/1, retry, or complex
 *   TESTER    → haiku 4.5 on tier-4 | sonnet 4.6 on tier-2/3 | opus 4.8 on retry
 *   REVIEWER  → opus 4.8 (GUARDIAN; hostile-eye prompt, temp 0.7)
 *   CHECKER   → opus 4.8 (GUARDIAN; independent semantic auditor, temp 0.4)
 *   REPORTER  → haiku 4.5 (formulaic)
 */

import type { V1AgentRole } from '../types/agent.js'
import type { ModelId, ModelTransport } from '../types/audit.js'
import type { Tier } from '../types/task.js'

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
const OPUS: ModelId = 'claude-opus-4-8'
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
    /**
     * GUARDIAN — always Opus, any tier. PLANNER reasoning floor is never
     * cost-routed; weak planning on a cheap tier would propagate bad scope
     * to every downstream agent.
     */
    case 'planner':
      return {
        model: OPUS,
        transport: SUBAGENT,
        temperature: 0.3,
        reason: 'PLANNER → Opus (GUARDIAN; quality floor, any tier)',
      }

    case 'builder': {
      // LABOR — tier-routed. Opus on Tier 0/1, retry, or complex; Haiku on
      // Tier 4 default; Sonnet on Tier 2/3 default.
      const useOpus = isRetry || tier === 0 || tier === 1 || isComplex
      if (useOpus) {
        return {
          model: OPUS,
          transport: SUBAGENT,
          temperature: 0.3,
          reason: `BUILDER → Opus (tier=${tier}, retry=${isRetry}, complex=${isComplex})`,
        }
      }
      if (tier === 4) {
        return {
          model: HAIKU,
          transport: SUBAGENT,
          temperature: 0.3,
          reason: `BUILDER → Haiku (tier=${tier}; cost-sensitive auto-merge)`,
        }
      }
      return {
        model: SONNET,
        transport: SUBAGENT,
        temperature: 0.3,
        reason: `BUILDER → Sonnet (tier=${tier}; default fast + capable)`,
      }
    }

    case 'tester': {
      // LABOR — tier-routed. Opus on retry; Haiku on Tier 4 default; Sonnet
      // on Tier 2/3 default. (Tier 0/1 falls through to Sonnet here — TESTER
      // does not have a complexity-bump path; only retry escalates.)
      if (isRetry) {
        return {
          model: OPUS,
          transport: SUBAGENT,
          temperature: 0.3,
          reason: `TESTER → Opus (tier=${tier}; retry after coverage shortfall)`,
        }
      }
      if (tier === 4) {
        return {
          model: HAIKU,
          transport: SUBAGENT,
          temperature: 0.3,
          reason: `TESTER → Haiku (tier=${tier}; cost-sensitive auto-merge)`,
        }
      }
      return {
        model: SONNET,
        transport: SUBAGENT,
        temperature: 0.3,
        reason: `TESTER → Sonnet (tier=${tier}; default)`,
      }
    }

    /**
     * GUARDIAN — always Opus, any tier. Cold-read hostile-eye reviewer needs
     * the strongest model to be a real anti-monoculture check (Q-AI-2/Q-AI-18
     * mitigation). Cost-routing the reviewer would defeat the purpose.
     */
    case 'reviewer':
      return {
        model: OPUS,
        transport: SUBAGENT,
        temperature: 0.7,
        reason: 'REVIEWER → Opus (GUARDIAN; cold-read prompt + temp 0.7; Q-AI-2 amended)',
      }

    /**
     * GUARDIAN — always Opus, any tier. Independent semantic auditor (Stage 1).
     * Opus for judgment; temp 0.4 — lower than REVIEWER's 0.7 because the
     * CHECKER wants consistent, sober gate decisions, not divergent idea
     * generation. Deterministic facts are re-run by the orchestrator (H1);
     * this routes only the LLM audit pass.
     */
    case 'checker':
      return {
        model: OPUS,
        transport: SUBAGENT,
        temperature: 0.4,
        reason:
          'CHECKER → Opus (GUARDIAN; independent semantic auditor; consistency over divergence)',
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
 * Source: Anthropic pricing page (Sonnet 4.6, Opus 4.8, Haiku 4.5).
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
 *
 * `input` is the **uncached** input token count, as reported by the Claude
 * CLI's `input_tokens` field (already excludes cache-read tokens).
 * `cacheRead` is the cache-read token count, priced separately at the lower
 * cache rate. Pass both directly — do NOT subtract cacheRead from input.
 */
export function estimateCost(
  model: ModelId,
  tokens: { input: number; output: number; cacheRead?: number },
): number {
  const pricing = MODEL_COST_PER_M_TOKENS[model]
  if (!pricing) return 0
  const cacheRead = tokens.cacheRead ?? 0
  return (
    (tokens.input * pricing.input) / 1_000_000 +
    (cacheRead * pricing.cache) / 1_000_000 +
    (tokens.output * pricing.output) / 1_000_000
  )
}

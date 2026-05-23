/**
 * PLANNER agent — decomposes an epic into stories + tasks.
 *
 * Stateless. Reads PLAN.md + ADRs in target repo; produces structured
 * JSON output per the prompt's response schema (see prompts/planner/v1.md).
 */

import type {
  AgentBrief,
  AgentResult,
  AppError,
  PlannerOutput,
  PlannerPayload,
  Result,
} from '../../types/index.js'
import { runAgent } from '../base.js'

/**
 * Run the PLANNER on an epic. Always uses Opus (router pins it; heavy reasoning).
 */
export async function runPlanner(
  brief: AgentBrief<PlannerPayload>,
  opts: { isRetry?: boolean } = {},
): Promise<Result<AgentResult<PlannerOutput>, AppError>> {
  return runAgent<PlannerPayload, PlannerOutput>({
    role: 'planner',
    brief,
    tier: brief.payload.tierHint ?? 2,
    isRetry: opts.isRetry ?? false,
  })
}

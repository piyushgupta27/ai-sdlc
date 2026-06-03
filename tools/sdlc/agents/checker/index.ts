/**
 * CHECKER agent — independent, read-only L2 meta-checker (Stage 1).
 *
 * Audits whether a producer's OUTPUT QUALITY meets the bar and returns pointed
 * deficiencies for selective refire (AGENT-GOVERNANCE.md §3 H1–H5). It is
 * dispatched by the orchestrator AFTER the deterministic matrix has been re-run
 * in Node (H1, [D]); this agent does the SEMANTIC audit ([C]) on top.
 *
 * Routing: Opus + temp 0.4 (independent auditor; consistency over divergence).
 */

import type {
  AgentBrief,
  AgentResult,
  AppError,
  CheckerOutput,
  CheckerPayload,
  Result,
} from '../../types/index.js'
import { runAgent } from '../base.js'

export async function runChecker(
  brief: AgentBrief<CheckerPayload>,
): Promise<Result<AgentResult<CheckerOutput>, AppError>> {
  return runAgent<CheckerPayload, CheckerOutput>({
    role: 'checker',
    brief,
    tier: brief.payload.tier,
  })
}

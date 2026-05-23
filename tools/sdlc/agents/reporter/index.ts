/**
 * REPORTER agent — summarizes a merged change for the user.
 *
 * Routing: Haiku (formulaic, cost-sensitive).
 */

import type {
  AgentBrief,
  AgentResult,
  AppError,
  ReporterOutput,
  ReporterPayload,
  Result,
} from '../../types/index.js'
import { runAgent } from '../base.js'

export async function runReporter(
  brief: AgentBrief<ReporterPayload>,
): Promise<Result<AgentResult<ReporterOutput>, AppError>> {
  return runAgent<ReporterPayload, ReporterOutput>({
    role: 'reporter',
    brief,
    tier: 3, // REPORTER is always low-tier work
  })
}

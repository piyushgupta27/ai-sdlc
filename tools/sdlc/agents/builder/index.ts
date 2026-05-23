/**
 * BUILDER agent — takes a task brief; produces a commit on the feature branch.
 *
 * Routing: Sonnet default; Opus on Tier 0/1, retry, or complex flag.
 */

import type {
  AgentBrief,
  AgentResult,
  AppError,
  BuilderOutput,
  BuilderPayload,
  Result,
} from '../../types/index.js'
import { runAgent } from '../base.js'

export async function runBuilder(
  brief: AgentBrief<BuilderPayload>,
  opts: { isRetry?: boolean; isComplex?: boolean } = {},
): Promise<Result<AgentResult<BuilderOutput>, AppError>> {
  return runAgent<BuilderPayload, BuilderOutput>({
    role: 'builder',
    brief,
    tier: brief.payload.tier,
    isRetry: opts.isRetry ?? false,
    isComplex: opts.isComplex ?? false,
  })
}

/**
 * REVIEWER agent — single generalist reviewer for v1.
 *
 * v1.5+ adds the specialized reviewer fleet (SECURITY, CODE-QUALITY,
 * BUG-DETECTOR, DESIGN, PERF, I18N) per R-AISDLC-31. For v1, one reviewer
 * with a cold-read hostile-eye prompt does all dimensions in one pass.
 *
 * Routing: Opus + temp 0.7 (Q-AI-2 + Q-AI-18 anti-monoculture mitigation).
 */

import type {
  AgentBrief,
  AgentResult,
  AppError,
  Result,
  ReviewerOutput,
  ReviewerPayload,
} from '../../types/index.js'
import { runAgent } from '../base.js'

export async function runReviewer(
  brief: AgentBrief<ReviewerPayload>,
): Promise<Result<AgentResult<ReviewerOutput>, AppError>> {
  return runAgent<ReviewerPayload, ReviewerOutput>({
    role: 'reviewer',
    brief,
    tier: brief.payload.tier,
  })
}

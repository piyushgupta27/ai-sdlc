/**
 * TESTER agent — adds tests + verifies coverage on a built task.
 */

import type {
  AgentBrief,
  AgentResult,
  AppError,
  Result,
  TesterOutput,
  TesterPayload,
} from '../../types/index.js'
import { runAgent } from '../base.js'

export async function runTester(
  brief: AgentBrief<TesterPayload>,
  opts: { tier: number; isRetry?: boolean } = { tier: 2 },
): Promise<Result<AgentResult<TesterOutput>, AppError>> {
  return runAgent<TesterPayload, TesterOutput>({
    role: 'tester',
    brief,
    tier: opts.tier,
    isRetry: opts.isRetry ?? false,
  })
}

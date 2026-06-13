/**
 * Wiring test for the gh-12 fail-closed fix: --webhook must refuse to start
 * unless SDLC_NTFY_TOKEN is set, regardless of other flags.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock heavy deps that are loaded at import time but not needed for the
// fail-closed path (code returns before reaching them).
vi.mock('../../orchestrator/state.js', () => ({
  readState: vi.fn().mockResolvedValue({ ok: true, value: { slug: 'test-proj' } }),
  projectDir: vi.fn().mockReturnValue('/tmp/sdlc-test'),
}))
vi.mock('../../orchestrator/index.js', () => ({ runTask: vi.fn() }))
vi.mock('../../integrations/github-projects.js', () => ({
  findProject: vi.fn(),
  listItems: vi.fn(),
  moveItem: vi.fn(),
}))
vi.mock('../../sandbox/index.js', () => ({ provisionWorktreeSandbox: vi.fn() }))
vi.mock('../../orchestrator/budget.js', () => ({
  budgetGate: vi.fn(),
  PAUSE_THRESHOLD: 0.9,
}))

import { runDispatch } from './dispatch.js'

describe('runDispatch --webhook fail-closed (gh-12)', () => {
  const ORIG_TOKEN = process.env.SDLC_NTFY_TOKEN

  beforeEach(() => {
    delete process.env.SDLC_NTFY_TOKEN
  })
  afterEach(() => {
    if (ORIG_TOKEN !== undefined) process.env.SDLC_NTFY_TOKEN = ORIG_TOKEN
    else delete process.env.SDLC_NTFY_TOKEN
  })

  it('returns 2 when SDLC_NTFY_TOKEN is absent', async () => {
    const code = await runDispatch(['--project', 'test-proj', '--webhook', '--topic', 'my-topic'])
    expect(code).toBe(2)
  })

  it('returns 2 when SDLC_NTFY_TOKEN is an empty string', async () => {
    process.env.SDLC_NTFY_TOKEN = ''
    const code = await runDispatch(['--project', 'test-proj', '--webhook', '--topic', 'my-topic'])
    expect(code).toBe(2)
  })

  it('returns 2 when --webhook is given without --topic', async () => {
    process.env.SDLC_NTFY_TOKEN = 'tok'
    const code = await runDispatch(['--project', 'test-proj', '--webhook'])
    expect(code).toBe(2)
  })
})

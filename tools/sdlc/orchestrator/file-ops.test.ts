/**
 * Tests for the file-ops wrapper.
 *
 * Verifies that agentWrite invokes the blast-radius hook + blocks Red zone
 * writes without an approval token. Tier 0 → must hold 85%+ coverage.
 */

import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentRead, agentWrite } from './file-ops.js'

const FIXTURE_CLAUDE_MD = `
# Test CLAUDE.md

## Blast Radius — Red Zone files

### Tier 0
- private/
- LICENSE
- tools/check-blast-radius.sh

### Tier 1
- packages/contract.ts
`

describe('file-ops', () => {
  let tmpRepo: string
  const hookSrc = '/Users/user/Workspace/ai-sdlc/tools/check-blast-radius.sh'

  beforeEach(async () => {
    tmpRepo = await mkdtemp(join(tmpdir(), 'file-ops-test-'))
    await writeFile(join(tmpRepo, 'CLAUDE.md'), FIXTURE_CLAUDE_MD, 'utf8')

    // Copy the real hook into the tmp repo
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(tmpRepo, 'tools'), { recursive: true })
    await copyFile(hookSrc, join(tmpRepo, 'tools/check-blast-radius.sh'))
    await chmod(join(tmpRepo, 'tools/check-blast-radius.sh'), 0o755)
  })

  afterEach(async () => {
    await rm(tmpRepo, { recursive: true, force: true })
  })

  describe('agentWrite', () => {
    it('writes a non-Red-zone file successfully', async () => {
      const result = await agentWrite({
        path: 'src/util.ts',
        content: 'export const foo = 42\n',
        targetRepo: tmpRepo,
        agent: 'builder',
        taskId: '1.1.1',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        const read = await agentRead({ path: 'src/util.ts', targetRepo: tmpRepo })
        expect(read.ok).toBe(true)
        if (read.ok) expect(read.value).toBe('export const foo = 42\n')
      }
    })

    it('blocks a Red-zone write without approval token', async () => {
      const result = await agentWrite({
        path: 'LICENSE',
        content: 'fake license\n',
        targetRepo: tmpRepo,
        agent: 'builder',
        taskId: '1.1.1',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('file-ops.blast-radius-blocked')
      }
    })

    it('blocks a Red-zone write with a fake approval token', async () => {
      const result = await agentWrite({
        path: 'private/cookies.json',
        content: '{}',
        targetRepo: tmpRepo,
        agent: 'builder',
        taskId: '1.1.1',
        blastRadiusApproved: 'hitl-fake-001',
      })
      // Hook will look for an audit record matching the fake id — won't find it
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('file-ops.blast-radius-blocked')
      }
    })

    it('refuses paths that escape the target repo', async () => {
      const result = await agentWrite({
        path: '../escape.txt',
        content: 'nope',
        targetRepo: tmpRepo,
        agent: 'builder',
        taskId: '1.1.1',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('file-ops.path-escape')
      }
    })
  })

  describe('agentRead', () => {
    it('reads a file that exists', async () => {
      const { mkdir: mk } = await import('node:fs/promises')
      await mk(join(tmpRepo, 'src'), { recursive: true })
      await writeFile(join(tmpRepo, 'src/x.ts'), 'content\n', { flag: 'w' })
      const result = await agentRead({ path: 'src/x.ts', targetRepo: tmpRepo })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe('content\n')
    })

    it('returns error for missing file', async () => {
      const result = await agentRead({
        path: 'does-not-exist.ts',
        targetRepo: tmpRepo,
      })
      expect(result.ok).toBe(false)
    })
  })
})

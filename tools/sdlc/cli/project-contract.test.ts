import { describe, expect, it } from 'vitest'
import {
  RULES_END,
  RULES_START,
  checkRules,
  gitignoreMissing,
  injectRules,
  loadCanonicalRules,
  managedBlock,
} from './project-contract.js'

const RULES = '- rule one\n- rule two'

describe('managedBlock', () => {
  it('wraps content in the markers', () => {
    const b = managedBlock(RULES)
    expect(b.startsWith(RULES_START)).toBe(true)
    expect(b.endsWith(RULES_END)).toBe(true)
    expect(b).toContain('rule one')
  })
})

describe('injectRules', () => {
  it('appends the block when absent', () => {
    const out = injectRules('# CLAUDE.md\n\nsome content\n', RULES)
    expect(out).toContain('some content')
    expect(out).toContain(managedBlock(RULES))
  })

  it('is idempotent — running twice yields the same result', () => {
    const once = injectRules('# CLAUDE.md\n', RULES)
    const twice = injectRules(once, RULES)
    expect(twice).toBe(once)
  })

  it('repairs drift in place, without duplicating the block', () => {
    const drifted = `# CLAUDE.md\n\n${RULES_START}\n- stale rule\n${RULES_END}\n`
    const out = injectRules(drifted, RULES)
    expect(out).toContain('rule one')
    expect(out).not.toContain('stale rule')
    // exactly one block
    expect(out.split(RULES_START).length - 1).toBe(1)
  })

  it('handles a CLAUDE.md with no trailing newline', () => {
    const out = injectRules('# CLAUDE.md', RULES)
    expect(out).toContain(managedBlock(RULES))
  })
})

describe('checkRules', () => {
  it('reports missing when no block', () => {
    expect(checkRules('# CLAUDE.md\n', RULES)).toBe('missing')
  })

  it('reports ok when the block matches canonical', () => {
    const cm = injectRules('# CLAUDE.md\n', RULES)
    expect(checkRules(cm, RULES)).toBe('ok')
  })

  it('reports drift when the block content differs', () => {
    const drifted = `# CLAUDE.md\n${RULES_START}\n- old\n${RULES_END}\n`
    expect(checkRules(drifted, RULES)).toBe('drift')
  })

  it('reports drift when the end marker is missing', () => {
    const broken = `# CLAUDE.md\n${RULES_START}\n- half a block\n`
    expect(checkRules(broken, RULES)).toBe('drift')
  })
})

describe('gitignoreMissing', () => {
  it('returns dirs not present as exact lines', () => {
    expect(gitignoreMissing('node_modules/\n.audit/\n', ['.audit/', '.sdlc-queue/'])).toEqual([
      '.sdlc-queue/',
    ])
  })

  it('returns empty when all present', () => {
    expect(gitignoreMissing('.audit/\n.sdlc-queue/\n', ['.audit/', '.sdlc-queue/'])).toEqual([])
  })
})

describe('loadCanonicalRules', () => {
  it('loads the real template with the actual rules', async () => {
    const rules = await loadCanonicalRules()
    expect(rules).toContain('leads with the decision')
    expect(rules).toContain('Testbed duty')
  })
})

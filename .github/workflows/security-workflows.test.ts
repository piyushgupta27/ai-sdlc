import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function readWorkflow(name: string): string {
  return readFileSync(join(root, '.github', 'workflows', name), 'utf8')
}

describe('secret-scan.yml', () => {
  it('uses gitleaks/gitleaks-action (SHA-pinned)', () => {
    const content = readWorkflow('secret-scan.yml')
    expect(content).toContain('gitleaks/gitleaks-action@')
    expect(content).not.toContain('gitleaks/gitleaks-action@v2\n')
  })

  it('triggers on pull_request', () => {
    const content = readWorkflow('secret-scan.yml')
    expect(content).toContain('pull_request:')
  })

  it('triggers on push to main', () => {
    const content = readWorkflow('secret-scan.yml')
    expect(content).toContain('push:')
    expect(content).toMatch(/branches:\s*\[main\]/)
  })

  it('does not suppress gitleaks failures with continue-on-error', () => {
    const content = readWorkflow('secret-scan.yml')
    expect(content).not.toContain('continue-on-error: true')
  })
})

describe('dep-audit.yml', () => {
  it('runs pnpm audit --audit-level high --prod', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(content).toContain('pnpm audit --audit-level high --prod')
  })

  it('installs only production dependencies before audit', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(content).toContain('--prod --frozen-lockfile')
  })

  it('triggers on pull_request', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(content).toContain('pull_request:')
  })

  it('triggers on push to main', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(content).toContain('push:')
    expect(content).toMatch(/branches:\s*\[main\]/)
  })

  it('does not suppress audit failures with continue-on-error', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(content).not.toContain('continue-on-error: true')
  })
})

describe('sast.yml', () => {
  it('uses github/codeql-action (SHA-pinned)', () => {
    const content = readWorkflow('sast.yml')
    expect(content).toContain('github/codeql-action')
    expect(content).not.toMatch(/github\/codeql-action\/\w+@v3\b/)
  })

  it('configures TypeScript as the analysis language', () => {
    const content = readWorkflow('sast.yml')
    expect(content).toContain('languages: typescript')
  })

  it('uses security-extended queries', () => {
    const content = readWorkflow('sast.yml')
    expect(content).toContain('queries: security-extended')
  })

  it('triggers on push to main', () => {
    const content = readWorkflow('sast.yml')
    expect(content).toContain('push:')
    expect(content).toMatch(/branches:\s*\[main\]/)
  })

  it('triggers on pull_request to main', () => {
    const content = readWorkflow('sast.yml')
    expect(content).toContain('pull_request:')
    expect(content).toMatch(/branches:\s*\[main\]/)
  })

  it('filters pull_request to code-change events only', () => {
    const content = readWorkflow('sast.yml')
    expect(content).toContain('types: [opened, synchronize, reopened]')
  })
})

describe('pull_request_template.md §4 Evidence', () => {
  it('references all three security CI gates', () => {
    const template = readFileSync(join(root, '.github', 'pull_request_template.md'), 'utf8')
    expect(template).toContain('secret-scan')
    expect(template).toContain('dep-audit')
    expect(template).toContain('SAST')
  })
})

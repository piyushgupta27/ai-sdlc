import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function readWorkflow(name: string): string {
  return readFileSync(join(root, '.github', 'workflows', name), 'utf8')
}

function isValidYaml(content: string): boolean {
  const r = spawnSync('python3', ['-c', 'import yaml, sys; yaml.safe_load(sys.stdin)'], {
    input: content,
    encoding: 'utf8',
  })
  return r.status === 0
}

describe('secret-scan.yml', () => {
  it('uses gitleaks/gitleaks-action@v2', () => {
    const content = readWorkflow('secret-scan.yml')
    expect(content).toContain('gitleaks/gitleaks-action@v2')
  })

  it('triggers on pull_request', () => {
    const content = readWorkflow('secret-scan.yml')
    expect(content).toContain('pull_request:')
  })

  it('does not suppress gitleaks failures with continue-on-error', () => {
    const content = readWorkflow('secret-scan.yml')
    expect(content).not.toContain('continue-on-error: true')
  })

  it('is valid YAML', () => {
    const content = readWorkflow('secret-scan.yml')
    expect(isValidYaml(content)).toBe(true)
  })
})

describe('dep-audit.yml', () => {
  it('runs pnpm audit --audit-level high --prod', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(content).toContain('pnpm audit --audit-level high --prod')
  })

  it('triggers on pull_request', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(content).toContain('pull_request:')
  })

  it('does not suppress audit failures with continue-on-error', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(content).not.toContain('continue-on-error: true')
  })

  it('is valid YAML', () => {
    const content = readWorkflow('dep-audit.yml')
    expect(isValidYaml(content)).toBe(true)
  })
})

describe('sast.yml', () => {
  it('uses github/codeql-action', () => {
    const content = readWorkflow('sast.yml')
    expect(content).toContain('github/codeql-action')
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

  it('is valid YAML', () => {
    const content = readWorkflow('sast.yml')
    expect(isValidYaml(content)).toBe(true)
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

describe('commit fd8780e scope', () => {
  it('does not modify TypeScript source files', () => {
    const r = spawnSync('git', ['show', 'fd8780e', '--name-only', '--format='], {
      cwd: root,
      encoding: 'utf8',
    })
    const tsSourceFiles = r.stdout
      .trim()
      .split('\n')
      .filter((f) => f.length > 0 && f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(tsSourceFiles).toHaveLength(0)
  })
})

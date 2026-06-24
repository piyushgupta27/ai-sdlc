import { describe, expect, it } from 'vitest'
import { classifyCheck, parseMonitorArgs } from './ci-monitor.js'

describe('classifyCheck', () => {
  it('classifies biome/format/lint checks', () => {
    expect(classifyCheck('Biome Check')).toBe('biome')
    expect(classifyCheck('biome')).toBe('biome')
    expect(classifyCheck('Format Check')).toBe('biome')
    expect(classifyCheck('Lint')).toBe('biome')
    expect(classifyCheck('check')).toBe('biome')
  })

  it('classifies security checks before biome (security wins on "check" overlap)', () => {
    expect(classifyCheck('CodeQL')).toBe('security')
    expect(classifyCheck('codeql-analysis')).toBe('security')
    expect(classifyCheck('SAST')).toBe('security')
    expect(classifyCheck('gitleaks')).toBe('security')
    expect(classifyCheck('secret-scan')).toBe('security')
    expect(classifyCheck('Security Scan')).toBe('security')
  })

  it('classifies dependency audit checks', () => {
    expect(classifyCheck('dep-audit')).toBe('deps')
    expect(classifyCheck('dependency-audit')).toBe('deps')
    expect(classifyCheck('npm audit')).toBe('deps')
  })

  it('classifies test checks', () => {
    expect(classifyCheck('test')).toBe('test')
    expect(classifyCheck('vitest')).toBe('test')
    expect(classifyCheck('jest')).toBe('test')
    expect(classifyCheck('Run Tests')).toBe('test')
    expect(classifyCheck('coverage')).toBe('test')
  })

  it('returns other for unrecognised names', () => {
    expect(classifyCheck('build')).toBe('other')
    expect(classifyCheck('deploy')).toBe('other')
    expect(classifyCheck('typecheck')).toBe('other')
  })

  it('is case-insensitive', () => {
    expect(classifyCheck('BIOME')).toBe('biome')
    expect(classifyCheck('GITLEAKS')).toBe('security')
    expect(classifyCheck('Vitest')).toBe('test')
  })
})

describe('parseMonitorArgs', () => {
  const BASE_ARGS = [
    '--owner',
    'piyushgupta27',
    '--repo',
    'piyush-portfolio',
    '--sha',
    'abc1234def5678',
    '--pr-number',
    '42',
    '--slug',
    'piyush-portfolio',
    '--pr-url',
    'https://github.com/piyushgupta27/piyush-portfolio/pull/42',
    '--base-repo-path',
    '/home/user/repos/piyush-portfolio',
    '--branch',
    'feature/gh-42',
  ]

  it('parses all required args', () => {
    const result = parseMonitorArgs(BASE_ARGS)
    expect(result).not.toBeNull()
    expect(result?.owner).toBe('piyushgupta27')
    expect(result?.repo).toBe('piyush-portfolio')
    expect(result?.sha).toBe('abc1234def5678')
    expect(result?.prNumber).toBe('42')
    expect(result?.slug).toBe('piyush-portfolio')
    expect(result?.prUrl).toBe('https://github.com/piyushgupta27/piyush-portfolio/pull/42')
    expect(result?.baseRepoPath).toBe('/home/user/repos/piyush-portfolio')
    expect(result?.branch).toBe('feature/gh-42')
    expect(result?.webhookTopic).toBeUndefined()
  })

  it('parses optional webhook-topic', () => {
    const result = parseMonitorArgs([...BASE_ARGS, '--webhook-topic', 'my-ntfy-topic'])
    expect(result?.webhookTopic).toBe('my-ntfy-topic')
  })

  it('returns null when a required arg is missing', () => {
    const withoutOwner = BASE_ARGS.filter((a) => a !== '--owner' && a !== 'piyushgupta27')
    expect(parseMonitorArgs(withoutOwner)).toBeNull()
  })

  it('returns null for empty argv', () => {
    expect(parseMonitorArgs([])).toBeNull()
  })
})

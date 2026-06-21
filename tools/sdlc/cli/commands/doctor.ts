/**
 * `pnpm sdlc doctor` — verify each onboarded project still satisfies the
 * platform contract. Deterministic, machine-checkable items only (presence,
 * not adherence — adherence stays human review). `--fix` re-applies the safely
 * automatable ones. See #41.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listProjects, projectDir } from '../../orchestrator/state.js'
import { type ProjectConfig, type ProjectSlug, asProjectSlug } from '../../types/index.js'
import { getFlag, hasFlag, parseArgs } from '../args.js'
import {
  ARTIFACT_DIRS,
  checkRules,
  gitignoreMissing,
  injectRules,
  loadCanonicalRules,
} from '../project-contract.js'

const HELP = `pnpm sdlc doctor — verify onboarded projects satisfy the platform contract

Usage:
  pnpm sdlc doctor [options]

Options:
  --project <slug>   Check one project (omit = every onboarded project)
  --fix              Re-apply the auto-fixable checks (gitignore artifacts, rule-block)
  --json             Output JSON

Checks (deterministic — presence, not adherence):
  - .gitignore excludes pipeline artifacts (.audit/, .sdlc-queue/)
  - config.json declares validationCommands (typecheck/lint/test)
  - CLAUDE.md carries the canonical ai-sdlc rule-block (and matches it)
  - .github/pull_request_template.md present

ai-sdlc-specific checks (only when --project ai-sdlc):
  - .github/workflows/blast-radius.yml present
  - .github/workflows/pr-labels.yml present
  - 15 canonical GitHub labels present (tier:0-4, blocked, hitl-pending, security, adhoc, dogfood, phase:*)
`

const CANONICAL_LABELS = [
  'tier:0',
  'tier:1',
  'tier:2',
  'tier:3',
  'tier:4',
  'blocked',
  'hitl-pending',
  'security',
  'adhoc',
  'dogfood',
  'phase:0-floor',
  'phase:1-build',
  'phase:2-scale',
  'phase:3-ops',
  'phase:4-optimize',
] as const

type CheckStatus = 'pass' | 'fail' | 'warn'

interface CheckResult {
  readonly name: string
  readonly status: CheckStatus
  readonly detail: string
  readonly fixable: boolean
}

interface ProjectReport {
  readonly slug: string
  readonly checks: readonly CheckResult[]
}

function checkCanonicalLabels(owner: string, slug: string): CheckResult {
  try {
    const raw = execSync(`gh label list --repo ${owner}/${slug} --limit 100 --json name`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(raw) as Array<{ name: string }>
    const present = new Set(parsed.map((l) => l.name))
    const missing = CANONICAL_LABELS.filter((l) => !present.has(l))
    return {
      name: 'canonical labels',
      status: missing.length === 0 ? 'pass' : 'fail',
      detail:
        missing.length === 0 ? '15 canonical labels present' : `missing: ${missing.join(', ')}`,
      fixable: false,
    }
  } catch {
    return {
      name: 'canonical labels',
      status: 'warn',
      detail: 'gh unavailable — cannot verify labels',
      fixable: false,
    }
  }
}

async function readConfig(slug: ProjectSlug): Promise<ProjectConfig | null> {
  const p = join(projectDir(slug), 'config.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8')) as ProjectConfig
  } catch {
    return null
  }
}

async function checkProject(slug: ProjectSlug, fix: boolean): Promise<ProjectReport> {
  const cfg = await readConfig(slug)
  if (!cfg) {
    return {
      slug,
      checks: [
        { name: 'config.json', status: 'fail', detail: 'missing or unreadable', fixable: false },
      ],
    }
  }
  const repo = cfg.repoPath
  const checks: CheckResult[] = []

  // 1. gitignore covers the pipeline artifact dirs
  const giPath = join(repo, '.gitignore')
  let gi = existsSync(giPath) ? await readFile(giPath, 'utf8') : ''
  let missing = gitignoreMissing(gi, ARTIFACT_DIRS)
  if (missing.length > 0 && fix) {
    const sep = gi === '' || gi.endsWith('\n') ? '' : '\n'
    gi = `${gi}${sep}\n# ai-sdlc pipeline artifacts\n${missing.join('\n')}\n`
    await writeFile(giPath, gi, 'utf8')
    missing = []
  }
  checks.push({
    name: 'gitignore artifacts',
    status: missing.length === 0 ? 'pass' : 'fail',
    detail:
      missing.length === 0
        ? `${ARTIFACT_DIRS.join(', ')} ignored`
        : `missing: ${missing.join(', ')}`,
    fixable: true,
  })

  // 2. validationCommands declared (project-specific → not auto-fixable)
  const vc = cfg.validationCommands
  const vcMissing = (['typecheck', 'lint', 'test'] as const).filter((k) => !vc?.[k])
  checks.push({
    name: 'validationCommands',
    status: vcMissing.length === 0 ? 'pass' : 'fail',
    detail: vcMissing.length === 0 ? 'typecheck/lint/test set' : `missing: ${vcMissing.join(', ')}`,
    fixable: false,
  })

  // 3. canonical rule-block present + current in CLAUDE.md
  const cmPath = join(repo, 'CLAUDE.md')
  if (!existsSync(cmPath)) {
    checks.push({
      name: 'CLAUDE.md rule-block',
      status: 'fail',
      detail: 'CLAUDE.md missing',
      fixable: false,
    })
  } else {
    const rules = await loadCanonicalRules()
    let cm = await readFile(cmPath, 'utf8')
    let st = checkRules(cm, rules)
    if (st !== 'ok' && fix) {
      cm = injectRules(cm, rules)
      await writeFile(cmPath, cm, 'utf8')
      st = 'ok'
    }
    checks.push({
      name: 'CLAUDE.md rule-block',
      status: st === 'ok' ? 'pass' : 'fail',
      detail: st === 'ok' ? 'present + current' : st,
      fixable: true,
    })
  }

  // 4. PR template present (content + CI gate are tracked in #26)
  const prTemplate = join(repo, '.github', 'pull_request_template.md')
  checks.push({
    name: 'PR template',
    status: existsSync(prTemplate) ? 'pass' : 'warn',
    detail: existsSync(prTemplate)
      ? 'present'
      : 'missing .github/pull_request_template.md — see #26',
    fixable: false,
  })

  // 5–7. ai-sdlc platform self-checks (only when running doctor on the platform itself)
  if (slug === 'ai-sdlc') {
    // 5. blast-radius workflow
    const brWorkflow = join(repo, '.github', 'workflows', 'blast-radius.yml')
    checks.push({
      name: 'blast-radius workflow',
      status: existsSync(brWorkflow) ? 'pass' : 'fail',
      detail: existsSync(brWorkflow) ? 'present' : 'missing .github/workflows/blast-radius.yml',
      fixable: false,
    })

    // 6. pr-labels workflow
    const prLabelsWorkflow = join(repo, '.github', 'workflows', 'pr-labels.yml')
    checks.push({
      name: 'pr-labels workflow',
      status: existsSync(prLabelsWorkflow) ? 'pass' : 'fail',
      detail: existsSync(prLabelsWorkflow) ? 'present' : 'missing .github/workflows/pr-labels.yml',
      fixable: false,
    })

    // 7. 15 canonical GitHub labels
    checks.push(checkCanonicalLabels(cfg.owner, slug))
  }

  return { slug, checks }
}

export async function runDoctor(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help')) {
    process.stdout.write(HELP)
    return 0
  }
  const fix = hasFlag(args, 'fix')
  const json = hasFlag(args, 'json')
  const one = getFlag(args, 'project')

  let slugs: ProjectSlug[]
  if (one) {
    slugs = [asProjectSlug(one)]
  } else {
    const all = await listProjects()
    if (!all.ok) {
      process.stderr.write(`❌ ${all.error.message}\n`)
      return 1
    }
    slugs = [...all.value]
  }

  const reports: ProjectReport[] = []
  for (const slug of slugs) {
    reports.push(await checkProject(slug, fix))
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)
  } else {
    for (const r of reports) {
      process.stdout.write(`\n${r.slug}\n`)
      for (const c of r.checks) {
        const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'
        const hint = c.status === 'fail' && c.fixable && !fix ? '  (run --fix)' : ''
        process.stdout.write(`  ${icon} ${c.name}: ${c.detail}${hint}\n`)
      }
    }
    process.stdout.write('\n')
  }

  const anyFail = reports.some((r) => r.checks.some((c) => c.status === 'fail'))
  return anyFail ? 1 : 0
}

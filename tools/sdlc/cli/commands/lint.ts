/**
 * `pnpm sdlc lint --project <slug>` — pre-dispatch ticket clarification.
 *
 * Reads the Ready column on the project's GitHub Project board. For each
 * ticket, runs structural checks:
 *   - Has acceptance criteria (≥2 items)?
 *   - Title is imperative (starts with a verb, not a question)?
 *   - Has a tier label (tier:0..4)?
 *
 * v1: structural checks only. v1.5+ adds a Haiku call to propose AC fixes
 * for vague tickets (the full "Eric Superboard" UX).
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findProject, listItems } from '../../integrations/github-projects.js'
import { asProjectSlug } from '../../types/index.js'
import { projectDir } from '../../orchestrator/state.js'
import { hasFlag, parseArgs } from '../args.js'

const HELP = `pnpm sdlc lint — pre-dispatch ticket clarification

Usage:
  pnpm sdlc lint --project <slug>

Options:
  --owner <handle>   GitHub owner (defaults to project config)
  --json             Output JSON
`

const QUESTION_WORDS = ['should', 'could', 'would', 'can', 'why', 'what', 'how', 'when', 'where']
const TIER_LABEL_RE = /^tier:[0-4]$/

interface LintFinding {
  readonly issueNumber: number
  readonly title: string
  readonly severity: 'error' | 'warn'
  readonly rule: string
  readonly message: string
}

export async function runLint(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help')) {
    process.stdout.write(HELP)
    return 0
  }

  const slugRaw = args.flags.project
  if (typeof slugRaw !== 'string') {
    process.stderr.write(`❌ Missing --project <slug>\n${HELP}`)
    return 2
  }
  const slug = asProjectSlug(slugRaw)

  let owner = typeof args.flags.owner === 'string' ? args.flags.owner : undefined
  if (!owner) {
    const cfgPath = join(projectDir(slug), 'config.json')
    if (existsSync(cfgPath)) {
      const raw = await readFile(cfgPath, 'utf8')
      const cfg = JSON.parse(raw) as { owner?: string }
      owner = cfg.owner
    }
  }
  if (!owner) {
    process.stderr.write(`❌ Cannot determine GitHub owner. Pass --owner <handle> or onboard first.\n`)
    return 1
  }

  const project = await findProject(owner, slug)
  if (!project.ok) {
    process.stderr.write(`❌ ${project.error.message}\n`)
    return 1
  }

  const items = await listItems(project.value, 'Ready')
  if (!items.ok) {
    process.stderr.write(`❌ ${items.error.message}\n`)
    return 1
  }

  const findings: LintFinding[] = []
  for (const item of items.value) {
    findings.push(...lintItem(item))
  }

  if (hasFlag(args, 'json')) {
    process.stdout.write(`${JSON.stringify({ ticketsScanned: items.value.length, findings }, null, 2)}\n`)
    return findings.some((f) => f.severity === 'error') ? 1 : 0
  }

  process.stdout.write(`\n${slug} · lint Ready column · ${items.value.length} tickets scanned\n\n`)

  if (findings.length === 0) {
    process.stdout.write(`✓ No issues. Ready to dispatch.\n`)
    return 0
  }

  // Group findings by issue
  const byIssue = new Map<number, LintFinding[]>()
  for (const f of findings) {
    const list = byIssue.get(f.issueNumber) ?? []
    byIssue.set(f.issueNumber, [...list, f])
  }
  for (const [num, list] of byIssue) {
    const first = list[0]
    if (!first) continue
    process.stdout.write(`#${num} · ${first.title}\n`)
    for (const f of list) {
      const icon = f.severity === 'error' ? '❌' : '⚠️ '
      process.stdout.write(`  ${icon} ${f.rule}: ${f.message}\n`)
    }
    process.stdout.write('\n')
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length
  const warnCount = findings.filter((f) => f.severity === 'warn').length
  process.stdout.write(`${errorCount} error(s), ${warnCount} warning(s).\n`)
  if (errorCount > 0) {
    process.stdout.write(`Fix errors before dispatch — headless agents will stall on vague tickets.\n`)
    return 1
  }
  process.stdout.write(`OK to dispatch.\n`)
  return 0
}

function lintItem(item: import('../../integrations/github-projects.js').ProjectItem): LintFinding[] {
  const findings: LintFinding[] = []
  const num = item.content.number
  const title = item.title

  // Rule 1: title shouldn't start with a question word
  const firstWord = title.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (QUESTION_WORDS.includes(firstWord) || title.endsWith('?')) {
    findings.push({
      issueNumber: num,
      title,
      severity: 'error',
      rule: 'title-not-imperative',
      message: `Title should be imperative ("Add X" / "Refactor Y"), not a question`,
    })
  }

  // Rule 2: body should contain acceptance criteria
  const body = item.content.body ?? ''
  const acMatch = body.match(/##?\s*acceptance criteria/i)
  if (!acMatch) {
    findings.push({
      issueNumber: num,
      title,
      severity: 'error',
      rule: 'missing-acceptance-criteria',
      message: 'Body has no "Acceptance criteria" section',
    })
  } else {
    // Count bullets after the AC heading
    const afterHeading = body.slice(body.indexOf(acMatch[0]) + acMatch[0].length)
    const bullets = afterHeading.match(/^\s*[-*]\s+/gm) ?? []
    if (bullets.length < 2) {
      findings.push({
        issueNumber: num,
        title,
        severity: 'warn',
        rule: 'few-acceptance-criteria',
        message: `Only ${bullets.length} acceptance criterion bullet(s); aim for 2+`,
      })
    }
  }

  // Rule 3: has a tier label
  const labels = item.content.labels ?? []
  const hasTier = labels.some((l) => TIER_LABEL_RE.test(l))
  if (!hasTier) {
    findings.push({
      issueNumber: num,
      title,
      severity: 'warn',
      rule: 'missing-tier-label',
      message: 'No tier:0..4 label; orchestrator will default to tier:2',
    })
  }

  return findings
}

/**
 * `pnpm sdlc onboard --repo <path> --slug <name>` — add a new project.
 *
 * v1 scope:
 *   1. Verify repo exists at --repo
 *   2. Create projects/<slug>/config.json + state.json (initial state)
 *   3. Skeleton CLAUDE.md (Red zone = secrets + cookies only)
 *   4. Gitignore pipeline artifact dirs (.audit/, .sdlc-queue/)
 *   5. Inject canonical ai-sdlc rule-block into CLAUDE.md
 *   6. Scaffold blast-radius CI workflow (.github/workflows/blast-radius.yml)
 *   7. Scaffold PR label enforcement workflow (.github/workflows/pr-labels.yml)
 *   8. Scaffold PR template (.github/pull_request_template.md)
 *   9. Scaffold secret-scan CI workflow (.github/workflows/secret-scan.yml)
 *  10. Scaffold dep-audit CI workflow (.github/workflows/dep-audit.yml) — pnpm repos
 *  11. Scaffold SAST CI workflow (.github/workflows/sast.yml) — node/python/go repos
 *  12. Seed canonical label taxonomy in the GitHub repo (via gh CLI)
 *
 * v1.5+ deliverables NOT in this onboard yet:
 *   - GitHub Project board creation via gh project create
 *   - CODEOWNERS auto-write
 *   - Branch protection required-checks enforcement (needs #9 bot identity)
 *   - sdlc doctor drift verification
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { aiSdlcRoot, initialState, projectDir, writeState } from '../../orchestrator/state.js'
import { type ProjectConfig, asProjectSlug } from '../../types/index.js'
import { getFlag, hasFlag, parseArgs, requireFlag } from '../args.js'
import { injectRules, loadCanonicalRules } from '../project-contract.js'

const HELP = `pnpm sdlc onboard — add a new project as an ai-sdlc testbed

Usage:
  pnpm sdlc onboard --repo <path> --slug <name> [options]

Required:
  --repo <path>      Local path to the target project's git repo
  --slug <name>      Short name (kebab-case) — used in CLI + audit logs

Options:
  --owner <handle>   GitHub handle of project owner (defaults to piyushgupta27)
  --runtime <name>   node | python | go | rust (auto-detected if omitted)
  --visibility <v>   public | private (defaults to private)
  --dry-run          Show what would happen; don't write anything

Examples:
  pnpm sdlc onboard --repo ~/Workspace/trip-research --slug trip-research
  pnpm sdlc onboard --repo ~/Workspace/piyush-portfolio --slug portfolio --visibility public
`

/**
 * Canonical label taxonomy — every onboarded GitHub repo gets these via sdlc onboard.
 * Exported for test coverage of the data shape.
 */
export const CANONICAL_LABELS = [
  // Tier labels (blast radius)
  {
    name: 'tier:0',
    color: 'B60205',
    description: 'ALWAYS HITL — security, auth, cookies, rollback. Never auto-merged.',
  },
  {
    name: 'tier:1',
    color: 'D93F0B',
    description: 'High blast radius — architecture, contracts, migrations, public APIs.',
  },
  { name: 'tier:2', color: 'FBCA04', description: 'Standard feature work — default tier.' },
  {
    name: 'tier:3',
    color: '0E8A16',
    description: 'Low-risk — bug fixes, refactors, internal-only.',
  },
  { name: 'tier:4', color: 'C5DEF5', description: 'Cosmetic — typos, docs, comments.' },
  // Status labels
  {
    name: 'blocked',
    color: 'D73A4A',
    description: 'Companion to Status:Blocked — surfaces in default issue list.',
  },
  {
    name: 'hitl-pending',
    color: 'FBCA04',
    description: 'A HITL gate fired and is awaiting your reply.',
  },
  // Type labels
  { name: 'security', color: 'B60205', description: 'Security / runtime-safety work.' },
  {
    name: 'adhoc',
    color: 'E4E669',
    description: 'Unplanned item pulled in from dogfooding or production incident.',
  },
  { name: 'dogfood', color: '0075CA', description: 'Surfaced by dogfooding a testbed project.' },
  // Phase labels (ai-sdlc milestone tracking)
  {
    name: 'phase:0-floor',
    color: 'B60205',
    description: 'Safety floor — must land before any unattended autonomy.',
  },
  {
    name: 'phase:1-visibility',
    color: 'D93F0B',
    description: "Observability / KPIs — can't drive what you can't see.",
  },
  {
    name: 'phase:2-demand',
    color: 'FBCA04',
    description: "Review-compression — buys back the human's day.",
  },
  {
    name: 'phase:3-trust',
    color: '0E8A16',
    description: 'Earn trust with data — evals, cross-vendor, routing.',
  },
  {
    name: 'phase:4-scale',
    color: '1D76DB',
    description: 'Scale — concurrency, durable exec, self-host.',
  },
] as const

export async function runOnboard(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (hasFlag(args, 'help') || hasFlag(args, 'h')) {
    process.stdout.write(HELP)
    return 0
  }

  let repo: string
  let slug: string
  try {
    repo = requireFlag(args, 'repo', 'Path to target repo')
    slug = requireFlag(args, 'slug', 'Short kebab-case identifier')
  } catch (e) {
    process.stderr.write(`❌ ${(e as Error).message}\n\n${HELP}`)
    return 2
  }

  const owner = getFlag(args, 'owner') ?? 'piyushgupta27'
  const runtime = getFlag(args, 'runtime') ?? 'unknown'
  const visibility = getFlag(args, 'visibility') ?? 'private'
  const dryRun = hasFlag(args, 'dry-run')

  if (!['node', 'python', 'go', 'rust', 'unknown'].includes(runtime)) {
    process.stderr.write(
      `❌ Invalid --runtime: ${runtime}\n   Allowed: node, python, go, rust, unknown\n`,
    )
    return 2
  }
  if (!['public', 'private'].includes(visibility)) {
    process.stderr.write(`❌ Invalid --visibility: ${visibility}\n   Allowed: public, private\n`)
    return 2
  }

  // 1. Verify repo exists + is a git repo
  if (!existsSync(repo)) {
    process.stderr.write(
      `❌ Repo path not found: ${repo}\n   Create the repo first, then re-run onboard.\n`,
    )
    return 1
  }
  if (!existsSync(join(repo, '.git'))) {
    process.stderr.write(`❌ Not a git repo: ${repo}\n   Run: cd ${repo} && git init\n`)
    return 1
  }

  // 2. Build config
  const projectSlug = asProjectSlug(slug)
  const config: ProjectConfig = {
    slug: projectSlug,
    repoPath: repo,
    githubRemote: `git@github.com:${owner}/${slug}.git`,
    owner,
    runtime: runtime as ProjectConfig['runtime'],
    visibility: visibility as ProjectConfig['visibility'],
    onboardedAt: new Date().toISOString(),
  }

  if (dryRun) {
    process.stdout.write(`Would write project config to projects/${slug}/config.json:\n\n`)
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n\n`)
    process.stdout.write(`Would write initial state to projects/${slug}/state.json.\n`)
    process.stdout.write(`Would create skeleton CLAUDE.md if not present in ${repo}.\n`)
    process.stdout.write(`Would ensure .audit/ + .sdlc-queue/ are gitignored in ${repo}.\n`)
    const securityWorkflows = ['secret-scan']
    if (existsSync(join(repo, 'pnpm-lock.yaml'))) securityWorkflows.push('dep-audit')
    if (['node', 'python', 'go'].includes(runtime)) securityWorkflows.push('sast')
    process.stdout.write(
      `Would scaffold blast-radius workflow, PR label check, PR template, and security workflows (${securityWorkflows.join(', ')}) in ${repo}.\n`,
    )
    process.stdout.write(
      `Would seed ${CANONICAL_LABELS.length} canonical labels in ${owner}/${slug}.\n`,
    )
    process.stdout.write('\n(Dry run — no changes made.)\n')
    return 0
  }

  // 3. Write per-project config + state
  const pdir = projectDir(projectSlug)
  await mkdir(pdir, { recursive: true })
  await writeFile(join(pdir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')

  const stateResult = await writeState(initialState(projectSlug))
  if (!stateResult.ok) {
    process.stderr.write(`❌ Failed to write initial state: ${stateResult.error.message}\n`)
    return 1
  }

  // 4. Write skeleton CLAUDE.md in target repo if not present
  const claudeMdPath = join(repo, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    await writeFile(claudeMdPath, skeletonClaudeMd(slug, owner), 'utf8')
    process.stdout.write(`✓ Wrote skeleton CLAUDE.md at ${claudeMdPath}\n`)
  } else {
    process.stdout.write(`(CLAUDE.md exists at ${claudeMdPath} — left as-is)\n`)
  }

  // 5. Ensure the pipeline's own artifact dirs are gitignored in the target repo,
  // so the deterministic lint/format gate doesn't fail on the orchestrator's own
  // output (.audit/ audit log + .sdlc-queue/ HITL queue). See ai-sdlc#37.
  await seedGitignore(repo)

  // 6. Force-write the canonical ai-sdlc rule-block into the target CLAUDE.md.
  await seedRules(repo)

  // 7. Scaffold blast-radius CI workflow (platform-owned; see ai-sdlc#83).
  await seedBlastRadiusWorkflow(repo)

  // 8. Scaffold PR label enforcement workflow (.github/workflows/pr-labels.yml).
  await seedPrLabelsWorkflow(repo)

  // 9. Scaffold PR template (.github/pull_request_template.md).
  await seedPullRequestTemplate(repo)

  // 10. Scaffold secret-scan CI workflow (all repos — #178).
  await seedSecretScanWorkflow(repo)

  // 11. Scaffold dep-audit CI workflow (pnpm repos only — gated on pnpm-lock.yaml).
  if (existsSync(join(repo, 'pnpm-lock.yaml'))) {
    await seedDepAuditWorkflow(repo)
  }

  // 12. Scaffold SAST CI workflow (node/python/go repos — CodeQL language routing).
  if (['node', 'python', 'go'].includes(runtime)) {
    await seedSastWorkflow(repo, runtime as 'node' | 'python' | 'go')
  }

  // 13. Seed canonical label taxonomy in the GitHub repo.
  await seedLabelTaxonomy(owner, slug)

  const hasPnpm = existsSync(join(repo, 'pnpm-lock.yaml'))
  const sastLang =
    runtime === 'node'
      ? 'TypeScript'
      : runtime === 'python'
        ? 'Python'
        : runtime === 'go'
          ? 'Go'
          : null

  process.stdout.write(`
✓ Onboarded ${slug}.

Next steps (still manual — needs #9 bot identity to automate):
  1. Edit ${claudeMdPath} to declare Red zone files (secrets, cookies, etc.)
  2. Create GitHub Project board for ${owner}/${slug}:
       gh project create --owner ${owner} --title "${slug} pipeline"
     Then add canonical columns: Ready, Building, QA, Review, Done, Blocked
  3. Run \`pnpm sdlc status --project ${slug}\` to verify state

  ⚠  One-time steps required in GitHub:
     a. Settings → Environments → New environment: "red-zone-gate"
        Required reviewers: ${owner}
     b. Settings → Branches → Branch protection for main →
        Required status checks → add:
          • "require MANAGER approval"   (blast-radius; runs only on Red zone PRs)
          • "tier label required"        (pr-labels; runs on every PR)
          • "gitleaks secret scan"       (secret-scan; runs on every PR)
${hasPnpm ? `          • "pnpm audit (high+, prod only)"  (dep-audit; runs on every PR)\n` : ''}\
${sastLang ? `          • "CodeQL analyze (${sastLang})"  (sast; runs on every PR)\n` : ''}\

  Note: the pipeline opens PRs against \`main\` (we merge to main).
`)

  return 0
}

/**
 * Append the ai-sdlc pipeline's artifact dirs to the target repo's .gitignore
 * (idempotent). The orchestrator writes `.audit/` (audit log) and `.sdlc-queue/`
 * (HITL queue) into the working tree; without ignoring them, a deterministic
 * lint/format gate that scans the whole repo fails on the pipeline's own output.
 * See ai-sdlc#37.
 */
async function seedGitignore(repo: string): Promise<void> {
  const gitignorePath = join(repo, '.gitignore')
  const artifactDirs = ['.audit/', '.sdlc-queue/']
  const existing = existsSync(gitignorePath) ? await readFile(gitignorePath, 'utf8') : ''
  const lines = existing.split('\n')
  const missing = artifactDirs.filter((d) => !lines.includes(d))
  if (missing.length === 0) {
    process.stdout.write('(.gitignore already excludes ai-sdlc artifacts)\n')
    return
  }
  const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n'
  const block = `${prefix}\n# ai-sdlc pipeline artifacts (audit log + HITL queue written into the working tree)\n${missing.join('\n')}\n`
  await appendFile(gitignorePath, block, 'utf8')
  process.stdout.write(`✓ Added ${missing.join(', ')} to ${gitignorePath}\n`)
}

/**
 * Force-write the canonical ai-sdlc rule-block into the target repo's CLAUDE.md
 * (idempotent). CLAUDE.md is guaranteed to exist by this point (skeleton written
 * above if it was absent). See #41 / project-contract.ts.
 */
async function seedRules(repo: string): Promise<void> {
  const claudeMdPath = join(repo, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) return
  const rules = await loadCanonicalRules()
  const before = await readFile(claudeMdPath, 'utf8')
  const after = injectRules(before, rules)
  if (after === before) {
    process.stdout.write('(ai-sdlc rule-block already current)\n')
    return
  }
  await writeFile(claudeMdPath, after, 'utf8')
  process.stdout.write(`✓ Wrote ai-sdlc rule-block to ${claudeMdPath}\n`)
}

/**
 * Scaffold the platform-owned blast-radius CI workflow into the target repo.
 * Idempotent: skips if the file already exists to avoid overwriting customization.
 * The template calls the ai-sdlc reusable workflow so detection logic stays
 * platform-maintained — repos supply only their base_ref. See ai-sdlc#83.
 */
async function seedBlastRadiusWorkflow(repo: string): Promise<void> {
  const workflowDir = join(repo, '.github', 'workflows')
  const dest = join(workflowDir, 'blast-radius.yml')
  if (existsSync(dest)) {
    process.stdout.write('(.github/workflows/blast-radius.yml exists — left as-is)\n')
    return
  }
  const templatePath = join(aiSdlcRoot(), 'meta', 'templates', 'blast-radius-consumer.yml')
  const template = await readFile(templatePath, 'utf8')
  await mkdir(workflowDir, { recursive: true })
  await writeFile(dest, template, 'utf8')
  process.stdout.write(`✓ Wrote blast-radius CI workflow to ${dest}\n`)
}

/**
 * Scaffold the PR label enforcement workflow into the target repo.
 * Fails any PR that has no tier:* label — enforces that every PR is classified.
 * Idempotent: skips if the file already exists.
 */
async function seedPrLabelsWorkflow(repo: string): Promise<void> {
  const workflowDir = join(repo, '.github', 'workflows')
  const dest = join(workflowDir, 'pr-labels.yml')
  if (existsSync(dest)) {
    process.stdout.write('(.github/workflows/pr-labels.yml exists — left as-is)\n')
    return
  }
  const templatePath = join(aiSdlcRoot(), 'meta', 'templates', 'pr-labels-consumer.yml')
  const template = await readFile(templatePath, 'utf8')
  await mkdir(workflowDir, { recursive: true })
  await writeFile(dest, template, 'utf8')
  process.stdout.write(`✓ Wrote PR label enforcement workflow to ${dest}\n`)
}

/**
 * Copy the canonical PR template into the target repo's .github/ directory.
 * Idempotent: skips if the file already exists.
 */
async function seedPullRequestTemplate(repo: string): Promise<void> {
  const dest = join(repo, '.github', 'pull_request_template.md')
  if (existsSync(dest)) {
    process.stdout.write('(.github/pull_request_template.md exists — left as-is)\n')
    return
  }
  const templatePath = join(aiSdlcRoot(), 'meta', 'templates', 'pull-request.md')
  const template = await readFile(templatePath, 'utf8')
  await mkdir(join(repo, '.github'), { recursive: true })
  await writeFile(dest, template, 'utf8')
  process.stdout.write(`✓ Wrote PR template to ${dest}\n`)
}

/**
 * Scaffold the secret-scan CI workflow into the target repo (all runtimes).
 * Calls the platform-owned reusable workflow so SHA pins stay in ai-sdlc. (#178)
 */
async function seedSecretScanWorkflow(repo: string): Promise<void> {
  const workflowDir = join(repo, '.github', 'workflows')
  const dest = join(workflowDir, 'secret-scan.yml')
  if (existsSync(dest)) {
    process.stdout.write('(.github/workflows/secret-scan.yml exists — left as-is)\n')
    return
  }
  const templatePath = join(aiSdlcRoot(), 'meta', 'templates', 'secret-scan-consumer.yml')
  const template = await readFile(templatePath, 'utf8')
  await mkdir(workflowDir, { recursive: true })
  await writeFile(dest, template, 'utf8')
  process.stdout.write(`✓ Wrote secret-scan CI workflow to ${dest}\n`)
}

/**
 * Scaffold the dep-audit CI workflow into the target repo.
 * Only called when pnpm-lock.yaml is present — the workflow requires pnpm.
 */
async function seedDepAuditWorkflow(repo: string): Promise<void> {
  const workflowDir = join(repo, '.github', 'workflows')
  const dest = join(workflowDir, 'dep-audit.yml')
  if (existsSync(dest)) {
    process.stdout.write('(.github/workflows/dep-audit.yml exists — left as-is)\n')
    return
  }
  const templatePath = join(aiSdlcRoot(), 'meta', 'templates', 'dep-audit-consumer.yml')
  const template = await readFile(templatePath, 'utf8')
  await mkdir(workflowDir, { recursive: true })
  await writeFile(dest, template, 'utf8')
  process.stdout.write(`✓ Wrote dep-audit CI workflow to ${dest}\n`)
}

/**
 * Scaffold the SAST CI workflow into the target repo.
 * Only called for node/python/go runtimes — CodeQL supports these languages.
 */
async function seedSastWorkflow(repo: string, runtime: 'node' | 'python' | 'go'): Promise<void> {
  const workflowDir = join(repo, '.github', 'workflows')
  const dest = join(workflowDir, 'sast.yml')
  if (existsSync(dest)) {
    process.stdout.write('(.github/workflows/sast.yml exists — left as-is)\n')
    return
  }
  const templateName = `sast-${runtime}-consumer.yml`
  const templatePath = join(aiSdlcRoot(), 'meta', 'templates', templateName)
  const template = await readFile(templatePath, 'utf8')
  await mkdir(workflowDir, { recursive: true })
  await writeFile(dest, template, 'utf8')
  process.stdout.write(`✓ Wrote SAST CI workflow (${runtime}) to ${dest}\n`)
}

/**
 * Seed the canonical label taxonomy in the target GitHub repo (idempotent).
 * Uses the gh CLI — requires the user to be authenticated. Skips gracefully
 * if gh is unavailable or the repo doesn't exist on GitHub yet.
 */
async function seedLabelTaxonomy(owner: string, slug: string): Promise<void> {
  const repoRef = `${owner}/${slug}`

  // Fetch existing label names
  const listResult = spawnSync(
    'gh',
    ['label', 'list', '--repo', repoRef, '--limit', '100', '--json', 'name'],
    { encoding: 'utf8' },
  )
  if (listResult.status !== 0) {
    process.stdout.write(
      `⚠  Label taxonomy: could not list labels for ${repoRef} — skipping (gh error or repo not on GitHub yet)\n`,
    )
    return
  }

  const existing = new Set<string>(
    (JSON.parse(listResult.stdout) as Array<{ name: string }>).map((l) => l.name),
  )
  const missing = CANONICAL_LABELS.filter((l) => !existing.has(l.name))

  if (missing.length === 0) {
    process.stdout.write('(label taxonomy already current)\n')
    return
  }

  let created = 0
  for (const label of missing) {
    const r = spawnSync(
      'gh',
      [
        'label',
        'create',
        label.name,
        '--repo',
        repoRef,
        '--color',
        label.color,
        '--description',
        label.description,
      ],
      { encoding: 'utf8' },
    )
    if (r.status === 0) {
      created++
    } else {
      process.stdout.write(`  ⚠ label "${label.name}": ${(r.stderr ?? '').trim()}\n`)
    }
  }

  process.stdout.write(`✓ Created ${created}/${missing.length} missing labels in ${repoRef}\n`)
}

function skeletonClaudeMd(slug: string, owner: string): string {
  return `# CLAUDE.md — ${slug}

## Project overview

<Edit this — 2-3 sentences describing what this project is and who uses it.>

## Owner

@${owner}

## Blast Radius — Red Zone files (Tier 0 and Tier 1)

The following paths require human sign-off before agents can write. Pre-commit
hook \`tools/check-blast-radius.sh\` enforces this; orchestrator's file-ops
wrapper invokes the hook before every agent write.

### Tier 0 (extreme caution; never autonomous)

- private/                              # secrets, cookies — encrypted
- *.env                                 # env files
- *.env.*                               # environment overrides
- CLAUDE.md                             # this file

### Tier 1 (high blast radius)

<Add your project's Tier 1 files here. Examples:
- packages/security/                    # auth, signing, scope guards
- packages/data/migrations/*            # schema migrations
- src/lib/auth/                         # authentication code
>

(Other paths are Tier 2 by default — yellow zone, no special protection.)

## Code conventions

<Edit this — list patterns specific to this project that agents must honor.>

## Local dev

\`\`\`bash
<edit this — how to run, test, debug>
\`\`\`

## Known quirks

<Edit this — subtle gotchas, "if you change X you must also touch Y", legacy decisions worth knowing.>
`
}

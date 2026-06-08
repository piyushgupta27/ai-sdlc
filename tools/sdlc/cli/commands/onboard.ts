/**
 * `pnpm sdlc onboard --repo <path> --slug <name>` — add a new project.
 *
 * v1 scope (slim onboarding — per ROADMAP.md "v1 / v1.5+ scope split"):
 *   1. Verify repo exists at --repo
 *   2. Create projects/<slug>/config.json + state.json (initial state)
 *   3. Skeleton CLAUDE.md (Red zone = secrets + cookies only)
 *   4. Symlink ai-workspace/projects/active/<slug> → <repo> (if vault path exists)
 *   5. Write per-project config from defaults + CLI flags
 *
 * v1.5+ deliverables NOT in this onboard yet:
 *   - GitHub Project board creation via gh project create
 *   - .github/workflows/*.yml writes per consumer repo
 *   - CODEOWNERS auto-write
 *   - Label taxonomy creation via gh label create
 *
 * Those graduate when first real testbed onboards (trip-research, week 4).
 * For v1 they're documented in ONBOARDING.md but applied manually.
 */

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { initialState, projectDir, writeState } from '../../orchestrator/state.js'
import { type ProjectConfig, asProjectSlug } from '../../types/index.js'
import { getFlag, hasFlag, parseArgs, requireFlag } from '../args.js'

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

  process.stdout.write(`
✓ Onboarded ${slug}.

Next steps (v1 manual; v1.5+ automates these):
  1. Edit ${claudeMdPath} to declare Red zone files (secrets, cookies, etc.)
  2. Create GitHub Project board for ${owner}/${slug}:
       gh project create --owner ${owner} --title "${slug} pipeline"
     Then add canonical columns: Ready, Building, QA, Review, Done, Blocked
  3. Run \`pnpm sdlc status --project ${slug}\` to verify state

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

/**
 * Per-project state management.
 *
 * State lives at `<ai-sdlc-root>/projects/<slug>/state.json`. Writes are
 * atomic (tmp + rename) to survive a crash mid-write.
 *
 * Reads are cheap — no file watchers, no caching. Each operation re-reads
 * from disk so concurrent CLI invocations stay consistent.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type AppError,
  type ProjectSlug,
  type ProjectState,
  type Result,
  asProjectSlug,
  err,
  makeError,
  ok,
  tryAsync,
} from '../types/index.js'

/**
 * Root of the ai-sdlc repo, resolved relative to this module.
 * Used to compute `projects/<slug>/` paths.
 */
function aiSdlcRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..')
}

function projectDir(slug: ProjectSlug): string {
  return join(aiSdlcRoot(), 'projects', slug)
}

function statePath(slug: ProjectSlug): string {
  return join(projectDir(slug), 'state.json')
}

/**
 * Initial state for a freshly onboarded project.
 */
export function initialState(slug: ProjectSlug): ProjectState {
  return {
    slug,
    trustState: 'MANUAL',
    readinessScore: 0,
    readinessBreakdown: { context: 0, testing: 0, cicd: 0 },
    lastReadinessCheck: new Date(0).toISOString(),
    inFlightTaskIds: [],
    activeCohorts: {},
    hitlQueueDepth: 0,
    defectRate7d: 0,
  }
}

export async function readState(
  slug: ProjectSlug,
): Promise<Result<ProjectState | null, AppError>> {
  const path = statePath(slug)
  if (!existsSync(path)) return ok(null)

  return tryAsync(
    'state.read',
    async () => {
      const raw = await readFile(path, 'utf8')
      return JSON.parse(raw) as ProjectState
    },
    {
      fix: `Inspect ${path}; if corrupted, restore from git history`,
    },
  )
}

export async function writeState(state: ProjectState): Promise<Result<void, AppError>> {
  const slug = state.slug
  const path = statePath(slug)
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`

  return tryAsync(
    'state.write',
    async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8')
      await rename(tmpPath, path)
    },
    {
      fix: 'Check disk space + write permissions on projects/<slug>/',
    },
  )
}

/**
 * Update state via a function. Read-modify-write with retry-on-conflict
 * isn't needed (single-process orchestrator) — but we keep the pattern
 * for v1.5+ when multi-machine orchestration lands.
 */
export async function updateState(
  slug: ProjectSlug,
  mutator: (s: ProjectState) => ProjectState,
): Promise<Result<ProjectState, AppError>> {
  const current = await readState(slug)
  if (!current.ok) return current

  if (current.value === null) {
    return err(
      makeError('state.not-onboarded', `Project ${slug} has no state.json`, {
        fix: `Run \`pnpm sdlc onboard --slug ${slug} ...\` first`,
      }),
    )
  }

  const next = mutator(current.value)
  const writeResult = await writeState(next)
  if (!writeResult.ok) return writeResult

  return ok(next)
}

/**
 * List all onboarded projects by reading the projects/ directory.
 */
export async function listProjects(): Promise<Result<readonly ProjectSlug[], AppError>> {
  const dir = join(aiSdlcRoot(), 'projects')
  if (!existsSync(dir)) return ok([])

  return tryAsync('state.list-projects', async () => {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => asProjectSlug(e.name))
  })
}

/**
 * Re-export path helpers for callers that need them (CLI, dashboard).
 */
export { projectDir, statePath, aiSdlcRoot }

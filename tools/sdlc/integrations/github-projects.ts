/**
 * GitHub Projects integration — Q-AI-21 / R-AISDLC-100.
 *
 * Thin wrapper over the `gh` CLI for reading + writing project board state.
 * No direct GitHub REST or GraphQL — `gh` handles auth + rate limiting +
 * API drift; we just shape its output into typed objects.
 *
 * gh CLI surface used:
 *   gh project list --owner <owner> --format json
 *   gh project view <num> --owner <owner> --format json
 *   gh project item-list <num> --owner <owner> --format json --limit <n>
 *   gh project item-edit --id <id> --field-id <fid> --single-select-option-id <oid>
 *   gh project field-list <num> --owner <owner> --format json
 *   gh issue view <url> --json title,body,labels,number
 *   gh issue comment <url> --body <text>
 */

import { spawn } from 'node:child_process'
import { type AppError, type Result, err, makeError, ok } from '../types/index.js'

/**
 * Canonical column names ai-sdlc uses on every project board.
 * Q-AI-21: GitHub Project board IS the state machine.
 */
export const CANONICAL_COLUMNS = [
  'Ready',
  'Building',
  'QA',
  'Review',
  'Done',
  'Blocked',
  'Skipped',
] as const
export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number]

/**
 * A single item on a project board.
 *
 * `id` is the GraphQL project-item id (PVTI_xxx). `content` is the underlying
 * issue / PR — we usually care about the issue body + labels for routing.
 */
export interface ProjectItem {
  readonly id: string
  readonly title: string
  readonly content: {
    readonly type: 'Issue' | 'PullRequest' | 'DraftIssue'
    readonly number: number
    readonly url?: string
    readonly body?: string
    readonly labels?: readonly string[]
  }
  readonly column?: CanonicalColumn | string
}

export interface ProjectMeta {
  readonly number: number
  readonly owner: string
  readonly title: string
  /** GraphQL project id (PVT_xxx) — needed for item-edit calls */
  readonly id: string
  /** Field metadata — needed to map column name → optionId for move operations */
  readonly statusField: {
    readonly id: string
    readonly options: ReadonlyArray<{ readonly id: string; readonly name: string }>
  }
}

/**
 * Find a project by owner + slug-prefix.
 * E.g. owner=piyushgupta27, slugPrefix=trip-research returns the first
 * project whose title contains "trip-research".
 */
export async function findProject(
  owner: string,
  slugOrTitleContains: string,
): Promise<Result<ProjectMeta, AppError>> {
  const listResult = await runGh([
    'project',
    'list',
    '--owner',
    owner,
    '--format',
    'json',
    '--limit',
    '50',
  ])
  if (!listResult.ok) return listResult

  let listJson: { projects?: Array<{ number: number; title: string; id?: string }> }
  try {
    listJson = JSON.parse(listResult.value.stdout)
  } catch (cause) {
    return err(
      makeError('gh-projects.parse-failed', 'Could not parse gh project list output', {
        cause,
      }),
    )
  }

  const match = listJson.projects?.find((p) =>
    p.title.toLowerCase().includes(slugOrTitleContains.toLowerCase()),
  )
  if (!match) {
    return err(
      makeError(
        'gh-projects.not-found',
        `No project found for owner=${owner} matching "${slugOrTitleContains}"`,
        {
          fix: `Create one: gh project create --owner ${owner} --title "${slugOrTitleContains} pipeline"`,
        },
      ),
    )
  }

  // Fetch field-list to get status field + option ids
  const fieldsResult = await runGh([
    'project',
    'field-list',
    String(match.number),
    '--owner',
    owner,
    '--format',
    'json',
  ])
  if (!fieldsResult.ok) return fieldsResult

  let fieldsJson: {
    fields?: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }>
  }
  try {
    fieldsJson = JSON.parse(fieldsResult.value.stdout)
  } catch (cause) {
    return err(
      makeError('gh-projects.parse-failed', 'Could not parse field-list output', {
        cause,
      }),
    )
  }

  const statusField = fieldsJson.fields?.find((f) => f.name === 'Status')
  if (!statusField || !statusField.options) {
    return err(
      makeError(
        'gh-projects.no-status-field',
        `Project ${match.number} has no Status field — cannot route columns`,
        {
          fix: 'Add a Status single-select field with options: Ready, Building, QA, Review, Done, Blocked, Skipped',
        },
      ),
    )
  }

  return ok({
    number: match.number,
    owner,
    title: match.title,
    id: match.id ?? '',
    statusField: {
      id: statusField.id,
      options: statusField.options,
    },
  })
}

/**
 * List items in a project, optionally filtered by column name.
 */
export async function listItems(
  meta: ProjectMeta,
  filterColumn?: CanonicalColumn,
): Promise<Result<readonly ProjectItem[], AppError>> {
  const result = await runGh([
    'project',
    'item-list',
    String(meta.number),
    '--owner',
    meta.owner,
    '--format',
    'json',
    '--limit',
    '200',
  ])
  if (!result.ok) return result

  let json: { items?: Array<Record<string, unknown>> }
  try {
    json = JSON.parse(result.value.stdout)
  } catch (cause) {
    return err(
      makeError('gh-projects.parse-failed', 'Could not parse item-list output', {
        cause,
      }),
    )
  }

  const items: ProjectItem[] = (json.items ?? []).map((raw) => {
    const content = (raw.content as Record<string, unknown> | undefined) ?? {}
    const status = raw.status as string | undefined
    const url = typeof content.url === 'string' ? content.url : undefined
    const body = typeof content.body === 'string' ? content.body : undefined
    // `gh project item-list --format json` puts labels at the top-level of the
    // item (sibling of `content`), not under `content.labels`. Read top-level
    // first; fall back to content.labels for forward-compat with future gh
    // versions.
    const rawLabels = Array.isArray(raw.labels)
      ? raw.labels
      : Array.isArray(content.labels)
        ? content.labels
        : null
    const labels =
      rawLabels === null
        ? undefined
        : (rawLabels as Array<{ name?: string } | string>).map((l) =>
            typeof l === 'string' ? l : (l.name ?? ''),
          )

    return {
      id: String(raw.id ?? ''),
      title: String(raw.title ?? content.title ?? '(untitled)'),
      content: {
        type: (content.type as 'Issue' | 'PullRequest' | 'DraftIssue') ?? 'DraftIssue',
        number: Number(content.number ?? 0),
        ...(url !== undefined ? { url } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(labels !== undefined ? { labels } : {}),
      },
      ...(status !== undefined ? { column: status } : {}),
    }
  })

  if (filterColumn) {
    return ok(items.filter((it) => it.column === filterColumn))
  }
  return ok(items)
}

/**
 * Move an item to a different column.
 *
 * Implementation: edit the Status field on the item to the option id
 * matching the column name.
 */
export async function moveItem(
  meta: ProjectMeta,
  itemId: string,
  toColumn: CanonicalColumn,
): Promise<Result<void, AppError>> {
  const option = meta.statusField.options.find((o) => o.name === toColumn)
  if (!option) {
    return err(
      makeError('gh-projects.column-not-found', `Project board has no column named "${toColumn}"`, {
        fix: `Add the column via gh CLI or web UI; canonical names: ${CANONICAL_COLUMNS.join(', ')}`,
      }),
    )
  }

  const result = await runGh([
    'project',
    'item-edit',
    '--id',
    itemId,
    '--project-id',
    meta.id,
    '--field-id',
    meta.statusField.id,
    '--single-select-option-id',
    option.id,
  ])
  if (!result.ok) return result
  return ok(undefined)
}

/**
 * Add a comment to an issue or PR — used for iteration history posting
 * (R-AISDLC-102: PR body auto-populated by COMMIT; this helper is for
 * mid-flight progress comments on the underlying ticket).
 */
export async function addComment(
  issueOrPrUrl: string,
  body: string,
): Promise<Result<void, AppError>> {
  const result = await runGh(['issue', 'comment', issueOrPrUrl, '--body', body])
  if (!result.ok) return result
  return ok(undefined)
}

// ─── internal: gh subprocess ─────────────────────────────────────────────

interface RunResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

async function runGh(args: readonly string[]): Promise<Result<RunResult, AppError>> {
  return new Promise((resolve) => {
    const child = spawn('gh', [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (cause) => {
      const isENoent =
        cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT'
      resolve(
        err(
          makeError(
            isENoent ? 'gh-projects.gh-not-found' : 'gh-projects.spawn-failed',
            isENoent ? 'gh CLI not on PATH' : `Failed to spawn gh: ${(cause as Error).message}`,
            {
              cause,
              fix: isENoent
                ? 'Install GitHub CLI: https://cli.github.com'
                : 'Check gh installation + shell PATH',
            },
          ),
        ),
      )
    })
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve(ok({ stdout, stderr, exitCode: 0 }))
        return
      }
      resolve(
        err(
          makeError('gh-projects.non-zero-exit', `gh CLI exited with code ${exitCode}`, {
            cause: { exitCode, stderr: stderr.slice(0, 2000) },
            fix: 'Inspect stderr; common: not authenticated, project not found, label not found',
          }),
        ),
      )
    })
  })
}

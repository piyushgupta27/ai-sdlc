/**
 * Task + Epic + Story — the unit of work in ai-sdlc.
 *
 * PLANNER produces Tasks from Epics. BUILDER consumes one Task at a time.
 * Each Task has a tier (blast radius), DoD, AC, estimated cost, dependencies.
 *
 * See ARCHITECTURE.md §3.4 + HITL.md for how tasks flow through stages.
 */

import type { ProjectSlug } from './project.js'

/**
 * Tier — blast-radius classification. See CLAUDE.md Red zone declaration
 * for the project-specific file lists at each tier.
 *
 * Tier 0 + Tier 1 = "Red zone" in prior pattern doc vocab.
 * Tier 2 = "Yellow zone".
 * Tier 3 + Tier 4 = "Green zone".
 */
export type Tier = 0 | 1 | 2 | 3 | 4

/**
 * Pipeline stages — see ARCHITECTURE.md §5.
 */
export type Stage = 'PLAN' | 'BUILD' | 'TEST' | 'REVIEW' | 'DEMO' | 'COMMIT' | 'REPORT' | 'DONE'

/**
 * Task outcome at any given moment.
 */
export type TaskStatus =
  | 'proposed'
  | 'planned'
  | 'in-flight'
  | 'in-review'
  | 'demo'
  | 'blocked'
  | 'blocked-on-decision'
  | 'done'
  | 'revoked'

/**
 * Definition of Done — per-task checklist. PLANNER produces this; downstream
 * agents validate against it.
 */
export interface DefinitionOfDone {
  /** Acceptance criteria (user-visible behavior) */
  readonly acceptanceCriteria: readonly string[]
  /** Non-functional requirements (perf, a11y, etc.) */
  readonly nfr: readonly string[]
  /** Tests required */
  readonly testsRequired: ReadonlyArray<'unit' | 'integration' | 'e2e' | 'visual-diff'>
  /** Coverage floor for this task */
  readonly coverageFloor: number // 0-100
  /** Files where CONTEXT.md must be updated if touched */
  readonly contextUpdates: readonly string[]
  /** Whether an ADR is required (triggers G1.5) */
  readonly requiresAdr: boolean
  /** Rollback path (if not just `git revert`) */
  readonly rollbackPath?: string
}

/**
 * A single task — atomic unit BUILDER picks up.
 */
export interface Task {
  /** Project this task belongs to */
  readonly project: ProjectSlug
  /** Stable ID; format: "<epic>.<story>.<task>" e.g. "3.2.2" */
  readonly id: string
  /** Story this task belongs to */
  readonly storyId: string
  /** Epic this task belongs to */
  readonly epicId: string
  /** One-line title (shown in dashboard, notification, audit) */
  readonly title: string
  /** Long description (input to BUILDER prompt) */
  readonly description: string
  /** Blast-radius tier */
  readonly tier: Tier
  /** Definition of Done */
  readonly dod: DefinitionOfDone
  /** Estimated cost in USD (PLANNER's estimate; tracked vs actual) */
  readonly estimatedCostUsd: number
  /** Task IDs this depends on (must complete first) */
  readonly dependsOn: readonly string[]
  /** Task IDs this blocks (cannot start until this completes) */
  readonly blocks: readonly string[]
  /** Files PLANNER expects BUILDER to touch (informational; not enforced) */
  readonly expectedFiles: readonly string[]
  /** Current stage in the pipeline */
  readonly stage: Stage
  /** Current status */
  readonly status: TaskStatus
  /** Created timestamp */
  readonly createdAt: string
  /** Last updated timestamp */
  readonly updatedAt: string
}

/**
 * Story = collection of tasks that deliver one piece of value.
 */
export interface Story {
  readonly project: ProjectSlug
  readonly id: string
  readonly epicId: string
  readonly title: string
  readonly description: string
  readonly taskIds: readonly string[]
}

/**
 * Epic = collection of stories with a shared outcome.
 */
export interface Epic {
  readonly project: ProjectSlug
  readonly id: string
  readonly title: string
  readonly outcome: string
  readonly tier: Tier
  readonly storyIds: readonly string[]
  /** Budget cap; PLANNER refuses if estimated > budget unless ADR */
  readonly budgetUsd: number
  /** AC at the epic level (whole-epic completion criteria) */
  readonly acceptanceCriteria: readonly string[]
  /** Source GitHub issue (URL or "manual") */
  readonly source: string
  readonly createdAt: string
}

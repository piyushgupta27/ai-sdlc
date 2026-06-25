/**
 * Project = a tenant managed by ai-sdlc.
 *
 * Every operation in ai-sdlc is project-scoped. The pipeline manages N projects
 * concurrently; project isolation is enforced through naming (no auth boundary
 * for solo use). See ARCHITECTURE.md §13 for the multi-tenant infrastructure.
 */

/**
 * Slug — short kebab-case identifier for a project. Used in audit log paths,
 * dashboard URLs, CLI args. Must be unique across all onboarded projects.
 */
export type ProjectSlug = string & { readonly __brand: 'ProjectSlug' }

/**
 * Brand a string as a ProjectSlug. Caller is responsible for ensuring the string
 * matches the kebab-case + uniqueness rules; this brand is just for type safety.
 */
export function asProjectSlug(s: string): ProjectSlug {
  return s as ProjectSlug
}

/**
 * Project config — written by `pnpm sdlc onboard`. Lives at
 * `ai-sdlc/projects/<slug>/config.json`.
 */
export interface ProjectConfig {
  /** Slug must match the directory name */
  readonly slug: ProjectSlug
  /** Absolute path to the target repo on disk */
  readonly repoPath: string
  /** GitHub remote (SSH form preferred) */
  readonly githubRemote: string
  /** GitHub handle of the project owner */
  readonly owner: string
  /** Runtime hint for the target project (detected during onboarding) */
  readonly runtime: 'node' | 'python' | 'go' | 'rust' | 'unknown'
  /** Visibility on GitHub (informational; doesn't gate access) */
  readonly visibility: 'public' | 'private'
  /** When this project was onboarded */
  readonly onboardedAt: string
  /**
   * Deterministic checks the CHECKER gate re-runs (H1, [D]). Shell strings run
   * in `repoPath`; exit 0 = pass. Omit a check (or the whole object) to skip it —
   * a project with no commands yields an empty validations matrix, not a failure.
   * Example: `{ typecheck: 'pnpm run typecheck', lint: 'pnpm run lint', test: 'pnpm test' }`.
   */
  readonly validationCommands?: {
    readonly typecheck?: string
    readonly lint?: string
    readonly test?: string
  }
  /** Per-project rolling 5h window token budget override. Supersedes SDLC_WINDOW_TOKEN_BUDGET env var. */
  readonly sdlcWindowTokenBudget?: number
}

/**
 * Trust state machine — see ARCHITECTURE.md §11.3.
 */
export type TrustState =
  | 'MANUAL' // everything HITL
  | 'SUPERVISED' // Tier 4 auto; Tier 3 HITL at COMMIT
  | 'TRUSTED_LOW' // Tier 3-4 auto; Tier 2 HITL at REVIEW + COMMIT
  | 'TRUSTED_MID' // Tier 2-4 auto with confidence gate; Tier 1 always HITL
  | 'STEADY_STATE' // steady-state Tier 0/1 forever HITL

/**
 * Project state — mutated by the orchestrator. Lives at
 * `ai-sdlc/projects/<slug>/state.json`. Atomic writes (tmp + rename).
 */
export interface ProjectState {
  readonly slug: ProjectSlug
  readonly trustState: TrustState
  readonly readinessScore: number // 0-100
  readonly readinessBreakdown: ReadinessBreakdown
  readonly lastReadinessCheck: string // ISO timestamp
  readonly inFlightTaskIds: readonly string[]
  readonly activeCohorts: Record<string, string> // agent name → prompt version
  readonly hitlQueueDepth: number
  readonly defectRate7d: number // 0.0 - 1.0
}

/**
 * Repo Readiness Score breakdown — see ARCHITECTURE.md §5.0.
 * Weighted: 40% Context + 30% Testing + 30% CI/CD.
 */
export interface ReadinessBreakdown {
  readonly context: number // 0-40 weight
  readonly testing: number // 0-30 weight
  readonly cicd: number // 0-30 weight
}

/**
 * Threshold at which a project's auto-merge gate flips on (per Q-AI-10 amendment).
 * Phase A: 70. Phase B+: 80.
 */
export const READINESS_AUTO_MERGE_THRESHOLD = 70 as const

/**
 * Sandbox provider interface — per-dispatch isolation (issue #19).
 *
 * A `Sandbox` is an isolated, ephemeral workspace for one task dispatch: the
 * agent edits + commits inside `workspacePath`, never sharing a checkout with
 * a concurrent run. `cleanup()` tears it down.
 *
 * The first implementation is `WorktreeSandbox` (git worktree per task). The
 * interface exists so a `MicroVmSandbox` (remote Linux, the deterministic +
 * scalable end-state) can drop in later without changing `dispatch.ts` or the
 * orchestrator. See `docs/design/sandbox-isolation.md`.
 */

import type { Result } from '../types/index.js'

/** Inputs to provision one isolated workspace. */
export interface SandboxRequest {
  /** Canonical target repo — the durable root for audit log + HITL queue. */
  readonly repoPath: string
  /** Task id; names the workspace (e.g. `gh-19`). */
  readonly taskId: string
  /** Feature branch the sandbox creates + checks out (e.g. `feature/gh-19`). */
  readonly branch: string
  /** What to branch off. Default: the repo's current HEAD. */
  readonly baseRef?: string
}

/** A provisioned, isolated workspace. */
export interface Sandbox {
  /** Agent cwd — the isolated checkout. Pass as `targetRepo` to `runTask`. */
  readonly workspacePath: string
  /** The feature branch checked out in the workspace. */
  readonly branch: string
  /**
   * Tear down the workspace. Idempotent — safe to call more than once, and a
   * no-op after the first success. Best-effort: returns the first hard failure
   * but always attempts every teardown step.
   */
  cleanup(): Promise<Result<void>>
}

/** Provisions an isolated workspace for a dispatch. */
export type SandboxProvider = (req: SandboxRequest) => Promise<Result<Sandbox>>

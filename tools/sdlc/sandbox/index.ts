/**
 * Sandbox — per-dispatch isolation (issue #19).
 *
 * `provisionWorktreeSandbox` is the current `SandboxProvider`. The `Sandbox`
 * interface lets a future `MicroVmSandbox` (remote Linux) drop in unchanged.
 */

export type { Sandbox, SandboxRequest, SandboxProvider } from './types.js'
export { provisionWorktreeSandbox } from './worktree.js'
export { detectLockfileDrift } from './lockfile-guard.js'
export type { LockfileDriftResult } from './lockfile-guard.js'

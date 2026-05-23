/**
 * Result<T, E> — sum type for fallible operations.
 *
 * Used at every module boundary in ai-sdlc. Never throw across module boundaries;
 * return Result instead so the caller can pattern-match on success / failure
 * without exception bookkeeping.
 *
 * Style note: prefer `ok(value)` / `err(error)` constructors over object literals
 * to keep call sites short.
 */

export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

/**
 * Standard error shape across ai-sdlc.
 *
 * Every error has: a code (machine-readable), a message (human-readable),
 * optional cause (for chaining), optional fix (next action for the user),
 * optional docsUrl (link to the relevant doc). This format powers the
 * DESIGN.md §6 error message rendering.
 */
export interface AppError {
  readonly code: string
  readonly message: string
  readonly cause?: unknown
  readonly fix?: string
  readonly docsUrl?: string
}

export function makeError(code: string, message: string, opts?: Partial<AppError>): AppError {
  return { code, message, ...opts }
}

/**
 * Lift a Promise<T> that may throw into a Promise<Result<T, AppError>>.
 * Catches the throw and wraps it as an AppError with the given code.
 */
export async function tryAsync<T>(
  code: string,
  fn: () => Promise<T>,
  opts?: { message?: string; fix?: string; docsUrl?: string },
): Promise<Result<T, AppError>> {
  try {
    const value = await fn()
    return ok(value)
  } catch (cause) {
    const message =
      opts?.message ?? (cause instanceof Error ? cause.message : `Operation failed: ${code}`)
    return err(makeError(code, message, { cause, fix: opts?.fix, docsUrl: opts?.docsUrl }))
  }
}

/**
 * Lift a sync function that may throw into Result<T, AppError>.
 */
export function trySync<T>(
  code: string,
  fn: () => T,
  opts?: { message?: string; fix?: string; docsUrl?: string },
): Result<T, AppError> {
  try {
    return ok(fn())
  } catch (cause) {
    const message =
      opts?.message ?? (cause instanceof Error ? cause.message : `Operation failed: ${code}`)
    return err(makeError(code, message, { cause, fix: opts?.fix, docsUrl: opts?.docsUrl }))
  }
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok
}

/**
 * Unwrap a Result, throwing if it's an error. Use sparingly — only at top-level
 * entry points (CLI main) where there's no caller to propagate Result to.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value
  throw new Error(
    `unwrap() called on Err: ${JSON.stringify(r.error)}. This is a programmer bug; Result errors should be handled, not unwrapped, except at top-level entry points.`,
  )
}

/**
 * Tiny argv parser — no dependencies, no commander/yargs.
 *
 * Parses GNU-style flags: `--project foo`, `--json`, `--repo /abs/path`.
 * Positional args go in `_`. Short flags (-h) supported for help only.
 */

export interface ParsedArgs {
  readonly _: readonly string[]
  readonly flags: Readonly<Record<string, string | boolean>>
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue

    if (a === '--' || a === '-') {
      // End-of-options marker (or stdin marker); skip rest as positional
      positional.push(...argv.slice(i + 1).filter((x): x is string => x !== undefined))
      break
    }

    if (a.startsWith('--')) {
      const eqIdx = a.indexOf('=')
      if (eqIdx >= 0) {
        flags[a.slice(2, eqIdx)] = a.slice(eqIdx + 1)
        continue
      }
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
      continue
    }

    if (a.startsWith('-') && a.length === 2) {
      // Short flag — only -h supported for now
      flags[a.slice(1)] = true
      continue
    }

    positional.push(a)
  }

  return { _: positional, flags }
}

export function requireFlag(
  args: ParsedArgs,
  name: string,
  helpHint: string,
): string {
  const v = args.flags[name]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Missing required flag: --${name}\n   ${helpHint}`)
  }
  return v
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true || typeof args.flags[name] === 'string'
}

export function getFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name]
  return typeof v === 'string' ? v : undefined
}

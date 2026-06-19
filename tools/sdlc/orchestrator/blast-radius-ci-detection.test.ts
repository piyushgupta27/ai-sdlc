/**
 * Adversarial-filename tests for the blast-radius CI detection loop (gh-83).
 *
 * The bypass: git's default core.quotepath=true emits non-ASCII filenames as
 * octal-escaped quoted strings — e.g. "private/leak-\303\251.json" — when the
 * old loop iterated with `for f in $CHANGED`, $f started with a literal `"`
 * character and failed the `case "$f" in private/*)` match.
 *
 * These tests:
 *   1. Prove the OLD loop misses the adversarial file (bug demonstration)
 *   2. Prove the NEW NUL-delimited loop catches it (fix verification)
 *   3. Confirm check-blast-radius.sh itself is correct when given the real path
 *      (the bypass was in the caller, not the script)
 */

import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const FIXTURE_CLAUDE_MD = `
# Test CLAUDE.md

## Blast Radius — Red Zone files

### Tier 0
- private/
- LICENSE

### Tier 1
- packages/contract.ts
`

const hookSrc = fileURLToPath(new URL('../../../tools/check-blast-radius.sh', import.meta.url))

// Run a bash script in cwd; returns stdout as a string.
function bash(script: string, cwd: string): string {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8' })
  return r.stdout ?? ''
}

describe('blast-radius CI detection loop (gh-83)', () => {
  let tmpRepo: string

  beforeEach(async () => {
    tmpRepo = await mkdtemp(join(tmpdir(), 'blast-radius-ci-test-'))
    await writeFile(join(tmpRepo, 'CLAUDE.md'), FIXTURE_CLAUDE_MD, 'utf8')

    // Copy the real hook so check-blast-radius.sh tests work
    await mkdir(join(tmpRepo, 'tools'), { recursive: true })
    await copyFile(hookSrc, join(tmpRepo, 'tools/check-blast-radius.sh'))
    await chmod(join(tmpRepo, 'tools/check-blast-radius.sh'), 0o755)

    // Bootstrap a git repo: initial commit (the "base" state), then commit an
    // adversarial Red zone file with a non-ASCII name (simulates a PR change).
    bash(
      [
        'git init -q',
        'git config user.email "test@test.com"',
        'git config user.name "Test"',
        'git add CLAUDE.md',
        'git commit -q -m "base"',
        'mkdir -p private',
        // Write the adversarial file with a non-ASCII é (U+00E9, UTF-8: 0xC3 0xA9)
        "printf '{}' > 'private/leak-é.json'",
        "git add 'private/leak-é.json'",
        'git commit -q -m "adversarial file"',
      ].join(' && '),
      tmpRepo,
    )
  })

  afterEach(async () => {
    await rm(tmpRepo, { recursive: true, force: true })
  })

  it('old loop (core.quotepath=true word-split) misses the non-ASCII filename — bug proof', () => {
    // Reproduce the BUGGY blast-radius.yml detection loop:
    //   CHANGED=$(git diff --name-only HEAD~1...HEAD)
    //   for f in $CHANGED; do case "$f" in private | private/*) ... esac; done
    //
    // git emits: "private/leak-\303\251.json" (with literal quotes + octal escape).
    // Word-splitting on $CHANGED makes $f start with `"`, failing the case match.
    const matched = bash(
      `
      CHANGED=$(git diff --name-only HEAD~1...HEAD)
      matched=""
      for f in $CHANGED; do
        case "$f" in
          private | private/*) matched="$f" ;;
        esac
      done
      printf '%s' "$matched"
      `,
      tmpRepo,
    )
    // The bug: nothing matches — the Red zone file escapes undetected
    expect(matched).toBe('')
  })

  it('new loop (core.quotepath=false NUL-delimited) catches the non-ASCII filename — fix verification', () => {
    // Reproduce the FIXED detection logic from blast-radius-reusable.yml:
    //   while IFS= read -r -d '' f; do ... done \
    //     < <(git -c core.quotepath=false diff --name-only -z HEAD~1...HEAD)
    const touched = bash(
      `
      RED_ZONE=$(awk '
        /^### Tier 0/ { t=1; next }
        /^### Tier 1/ { t=1; next }
        /^### Tier [234]/ { t=0; next }
        /^## / { t=0; next }
        t && /^- / {
          sub(/^- /, "")
          sub(/[ \\t]+#.*$/, "")
          sub(/\\/$/, "")
          print
        }
      ' CLAUDE.md)

      TOUCHED="false"
      while IFS= read -r -d '' f; do
        [ -f "$f" ] || continue
        while IFS= read -r pattern; do
          [ -z "$pattern" ] && continue
          case "$f" in
            "$pattern" | "$pattern"/*) TOUCHED="true"; break ;;
          esac
        done <<< "$RED_ZONE"
      done < <(git -c core.quotepath=false diff --name-only -z HEAD~1...HEAD)

      printf '%s' "$TOUCHED"
      `,
      tmpRepo,
    )
    expect(touched).toBe('true')
  })

  it('check-blast-radius.sh exits 1 for the real unescaped path — bypass was in the caller', () => {
    // When given the actual filename (not the quotepath-escaped form), the hook
    // correctly blocks it. This confirms the bypass lived in the detection loop
    // (blast-radius.yml), not in the hook itself.
    const r = spawnSync(join(tmpRepo, 'tools/check-blast-radius.sh'), ['private/leak-é.json'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    })
    expect(r.status).toBe(1)
  })
})

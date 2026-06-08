/**
 * Shared helpers for the ai-sdlc "project contract" — the canonical rule-block
 * that `sdlc onboard` force-writes into every onboarded repo's CLAUDE.md and
 * `sdlc doctor` verifies. Presence is machine-checkable; adherence is not (that
 * stays human review). See #41.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { aiSdlcRoot } from '../orchestrator/state.js'

/** Bump when the canonical block format changes (drives drift detection). */
export const RULES_VERSION = 'v1'
export const RULES_START = `<!-- ai-sdlc:rules ${RULES_VERSION} — managed by \`sdlc onboard\` / \`sdlc doctor\`; do not edit between markers -->`
export const RULES_END = '<!-- /ai-sdlc:rules -->'

/** Pipeline artifact dirs that must be gitignored in every onboarded repo. */
export const ARTIFACT_DIRS = ['.audit/', '.sdlc-queue/'] as const

function rulesTemplatePath(): string {
  return join(aiSdlcRoot(), 'meta', 'templates', 'project-rules.md')
}

/** Load the canonical rule content (without markers). */
export async function loadCanonicalRules(): Promise<string> {
  return (await readFile(rulesTemplatePath(), 'utf8')).trim()
}

/** The full managed block: markers wrapping the canonical content. */
export function managedBlock(rules: string): string {
  return `${RULES_START}\n${rules.trim()}\n${RULES_END}`
}

/**
 * Insert or replace the managed block in CLAUDE.md content. Idempotent: running
 * it twice yields the same result; running it on drifted content repairs it.
 */
export function injectRules(claudeMd: string, rules: string): string {
  const block = managedBlock(rules)
  const start = claudeMd.indexOf(RULES_START)
  if (start === -1) {
    const sep = claudeMd === '' || claudeMd.endsWith('\n') ? '\n' : '\n\n'
    return `${claudeMd}${sep}${block}\n`
  }
  const endMarker = claudeMd.indexOf(RULES_END, start)
  const end = endMarker === -1 ? claudeMd.length : endMarker + RULES_END.length
  return claudeMd.slice(0, start) + block + claudeMd.slice(end)
}

export type RulesStatus = 'ok' | 'missing' | 'drift'

/** Compare the managed block in CLAUDE.md against the canonical block. */
export function checkRules(claudeMd: string, rules: string): RulesStatus {
  const start = claudeMd.indexOf(RULES_START)
  if (start === -1) return 'missing'
  const endMarker = claudeMd.indexOf(RULES_END, start)
  if (endMarker === -1) return 'drift'
  const current = claudeMd.slice(start, endMarker + RULES_END.length)
  return current === managedBlock(rules) ? 'ok' : 'drift'
}

/** Return the artifact dirs NOT already present as exact lines in .gitignore. */
export function gitignoreMissing(gitignore: string, dirs: readonly string[]): readonly string[] {
  const lines = gitignore.split('\n').map((l) => l.trim())
  return dirs.filter((d) => !lines.includes(d))
}

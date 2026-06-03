<!--
  ai-sdlc PR template v1 — CANONICAL SOURCE.
  Synced to each repo's .github/pull_request_template.md and consumed by the
  orchestrator's PR-body auto-fill (see issue #26). Edit here, not the copies.

  GOAL: a MANAGER can approve or reject from this description ALONE — no pinging.

  STYLE (keep it clean — enforced by convention + the CI completeness gate):
  - Reference issues/PRs as bare #N. GitHub auto-links them and shows the title
    on hover. NEVER paste full issue titles as link text (that is pure noise).
  - Inline `code` only for real identifiers — file paths, flags, symbols. Not prose,
    not regexes. Aim for ≤1–2 code spans per bullet.
  - Prose at the top (sections 1, 2, 8 are manager-facing). Terse / technical at the
    bottom (4, 5). Don't make everything technical.
  - One bold lead-label per bullet. Blank line between sections (GitHub draws a rule
    under each ## heading — let it breathe).

  TIERS: Tier 0–1 (Red-zone) fill every section. Tier 3–4 may write
  "n/a — cosmetic" for sections 3, 3b, 6, and 10.

  Delete this comment block when you fill the template in.
-->

## 1 · TL;DR

_One short paragraph: what this does and why it matters._

Tier <0–4> · <feat | fix | refactor | docs | chore | security> · closes #<issue> · <task id>

## 2 · What & why

_The problem, the change, and the key trade-off — in prose. A reviewer should grasp the decision here without reading the diff._

**Alternatives rejected** — <what you didn't do, and why>.

## 3 · Blast radius & risk

- **Reach** — what this can affect, and how it's mitigated.
- **Red-zone** — files touched + tier (or "none").
- **Breaking changes** — none | <contract / schema / API + migration path>.
- **Rollback** — clean `git revert` | <steps>.

## 3b · Security review

- **Ran** — yes (`/cso`, <date>) | no (<why: e.g. Tier 2–3, non-security-touching>).
- **Findings (this PR)** — none | <severity · finding · status>.
- **Open security issues** (touched here? y/n) — #<n> #<n>.

## 4 · Evidence

- **Gates** — typecheck · lint · format · tests <pass/total> · coverage <%>.
- **Acceptance criteria** — each AC mapped to its evidence (test / `file:line`), or "n/a".
- **Tests** — happy + sad + edge paths covered (what each asserts).
- **CHECKER** — verdict · confidence · deficiencies resolved (or n/a).
- **Manual** — UI: browser click-through + screenshot; CLI: transcript (or n/a).

## 5 · Diff map

- `path` (+adds/−dels) — what & why.
- **New dependencies** — name@version (license, size, why) | none.

## 6 · Audit & provenance

_AI-SDLC; auto-filled for pipeline runs._ Audit run IDs · agents + prompt cohort versions · models + spend · refire history. (n/a for human-driven PRs.)

## 7 · Governance

- [ ] PR-only, squash, no direct main push; agent did not self-approve
- [ ] No open P0/P1; CLAUDE.md unchanged (else flagged — always MANAGER-gated)
- [ ] Docs / continuation updated; affected `CONTEXT.md` bubbled up (or n/a)
- [ ] ADR written if required (G1.5), else "no ADR required"
- [ ] Secret-scan / dep-audit / SAST (or n/a)

## 8 · Decision

**Recommend** — Approve | Approve-with-follow-up | Request-changes | Reject, because <why>.

**Your call** — <the specific judgment(s) needed from the MANAGER>.

## 9 · Follow-ups

**Future backlog** (deferred work, filed as issues — or "none")
- [Issue #<n>](<url>): <brief one-line description>
- [Issue #<n>](<url>): <brief one-line description>

## 10 · Post-merge

<deploy steps · monitoring / canary · rollback trigger — or none>

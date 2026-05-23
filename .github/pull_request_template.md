## Summary

<1-2 sentences: what changed and why>

## Linked epic / issue

Closes #

## Tier classification

- [ ] **Tier 0** — extreme; never autonomous; all 5 HITL gates fire
- [ ] **Tier 1** — high blast radius; HITL at PLAN + REVIEW + COMMIT + POST
- [ ] **Tier 2** — yellow zone; HITL on confidence threshold
- [ ] **Tier 3** — green polish; mostly autonomous
- [ ] **Tier 4** — trivial; fully autonomous

**Justification:** <one line referencing CLAUDE.md Red zone if applicable>

## Acceptance criteria satisfied

- [ ] AC1: <description>
- [ ] AC2: <description>
- [ ] AC3: <description>

## Audit log

- **Run ID:** <ai-sdlc audit run id; or `manual` for human-authored PRs>
- **Diff path:** `.audit/<date>/diffs/<task>.diff`
- **Reviewer fleet report:** `.audit/<date>/review/<task>.json`

## Tests

- [ ] Unit tests added / updated
- [ ] Integration tests added / updated
- [ ] E2E test added (if UI changed)
- [ ] Negative-path test added for every new public function
- [ ] Coverage delta: ___% → ___% (target ≥70%, ≥85% for Tier 0/1)

## CONTEXT.md updates (bubble-up rule)

- [ ] Updated `<path>/CONTEXT.md` per the rule
- [ ] Bubbled up to parent CONTEXT.md (if substantial change)
- [ ] N/A (no public API surface change)

## ADR

- [ ] No ADR required
- [ ] ADR written at `docs/adr/<id>.md`
- [ ] G1.5 approval recorded at `.audit/<date>/hitl/<id>.json`

## Rollback path

<git revert is implicit; document only if revert alone is insufficient (e.g. schema migration, state change)>

## Reviewer fleet verdict (auto-populated for agent-authored PRs)

- SECURITY-REVIEWER:
- CODE-QUALITY-REVIEWER:
- BUG-DETECTOR (if Phase B+):
- DESIGN-REVIEWER (if frontend):
- AGGREGATOR verdict:
- AI filter drops: ___ findings

---

🤖 Generated-By: agent:<role>@<model> (for agent-authored PRs only — humans can omit this line)

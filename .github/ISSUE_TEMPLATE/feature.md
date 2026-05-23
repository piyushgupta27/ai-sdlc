---
name: Feature request
about: New capability or enhancement to ai-sdlc
title: "[feature] "
labels: ["kind:feature", "status:proposed"]
assignees:
  - piyushgupta27
---

## Problem
<What pain this solves; for whom; what's the current workaround>

## Proposed solution
<1-2 paragraph sketch of the proposed approach>

## Tier classification (proposed)
- [ ] Tier 0 — extreme blast radius (auth/secrets/audit chain/rollback)
- [ ] Tier 1 — high blast radius (orchestrator, types, reviewer fleet, projects state)
- [ ] Tier 2 — yellow zone (new agent, new workflow, dashboard feature)
- [ ] Tier 3 — green zone (CLI polish, error message improvements, docs)
- [ ] Tier 4 — trivial (typo, dep bump, comment)

**Justification:** <one-line reason for the tier classification>

## Acceptance criteria
- [ ] AC1:
- [ ] AC2:
- [ ] AC3:

## Alternatives considered
<List approaches considered and rejected, with one-line reasons>

## Dependencies
<Other features / epics / external work this depends on>

## Definition of Done
- [ ] All AC ticked
- [ ] Coverage ≥70% on changed files (≥85% if Tier 0/1)
- [ ] CONTEXT.md updated per bubble-up rule
- [ ] ADR written if architectural decision (G1.5)
- [ ] Reviewer fleet PASS
- [ ] G5 post-merge feedback positive

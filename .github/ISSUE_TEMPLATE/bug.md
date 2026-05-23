---
name: Bug report
about: Something's broken in ai-sdlc
title: "[bug] "
labels: ["kind:bug", "status:reported"]
assignees:
  - piyushgupta27
---

## What's broken
<One-line description of the bug>

## Reproduction
1.
2.
3.

## Expected behavior
<What should happen>

## Actual behavior
<What does happen — include error messages, stack traces, audit-log run id if available>

## Environment
- **ai-sdlc version / commit:**
- **Node version:**
- **OS:**
- **Target project being managed (if any):**

## Severity
- [ ] **Critical** — data loss, security breach, audit-chain corruption, three-layer enforcement bypassed
- [ ] **High** — pipeline cannot complete a workflow; primary feature broken
- [ ] **Medium** — feature degraded; workaround exists
- [ ] **Low** — cosmetic / documentation / minor inconvenience

## Tier (auto-set from severity)
- Critical → Tier 0
- High → Tier 1
- Medium → Tier 2
- Low → Tier 3 or 4

## Audit log reference (if applicable)
<Path to relevant `.audit/<date>/runs/*.jsonl` row, or run id>

## Additional context
<Logs, screenshots, dashboard state, related issues>

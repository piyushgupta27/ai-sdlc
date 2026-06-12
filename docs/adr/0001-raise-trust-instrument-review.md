# ADR 0001 — Raise trust + instrument review (don't cap autonomy with conservative trust)

- **Status:** Accepted
- **Date:** 2026-06-12
- **Deciders:** Piyush Gupta (owner)
- **Tier:** 1 (trust model — governs how every managed repo runs autonomously)

## Context

The trust ladder (`MANUAL → SUPERVISED → TRUSTED_LOW → TRUSTED_MID → STEADY_STATE`)
controls how many HITL gates fire during an autonomous run. While onboarding the
`piyush-portfolio` testbed and dispatching its first autonomous Tier-2 task
(piyush-portfolio#32 — UI testing), the question arose: a personal-brand / product
UI repo has a "taste" risk that CI can't catch (CI proves a change builds + passes
tests; it can't judge UX, animation feel, layout, or whether copy is right).

The reflexive response was to **cap trust** (keep the repo at `MANUAL`, or drop to
`TRUSTED_LOW`) so a human gates everything. The counter-proposal: **don't lower trust
to compensate for a thin review artifact — make the artifact rich enough that high
trust is safe, and add a risk-based escalation path.**

## Decision drivers

- The bottleneck on autonomy is **reviewability**, not risk appetite.
- Capping trust taxes *every* change (even trivial), and doesn't scale to one lead
  reviewing many repos.
- A brand/product UI's real review need is visual + experiential evidence, not raw diffs.

## Evidence (what actually reaches `main`)

From `tools/sdlc/types/hitl.ts` `TIER_GATE_MATRIX`:

- **Tier 2 has no auto-merge.** Tier-2 work → autonomous build → **opens a PR → human
  merges.** It never lands on `main` unreviewed, at any trust level. Trust state only
  changes how many times the build *pauses* (G1/G2/G3/G4) before the PR.
- Only **Tier 3/4** can auto-merge (CI-green + high confidence).
- Branch protection on `main` independently requires PR + CI-green.

So the worst case at `TRUSTED_MID` for substantive work is already "a PR you review."

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **A. Cap trust (MANUAL / TRUSTED_LOW)** | Simple; human sees everything | Taxes trivial work; doesn't scale to a lead over many repos; treats the symptom (thin PRs) not the cause |
| **B. Raise trust + instrument review (chosen)** | Autonomy where safe; human decides on a rich artifact; scales to a team lead; the review evidence is a free byproduct of the UI-test gate | Requires building the evidence pipeline (#104) + UI gate (#101); Tier 3/4 auto-merge needs an escalation guard |
| C. Raise trust, do nothing else | Max autonomy now | Tier 3/4 trivial changes can auto-merge to a brand site unreviewed |

## Decision

Adopt **Option B**. Concretely:

1. **`piyush-portfolio` stays at `TRUSTED_MID`** (a deliberate standing level, not a
   temporary bump). Substantive (Tier 2) work arrives as a reviewable PR; CI + branch
   protection gate `main`.
2. Build the **UI-testing gate** (#101): onboard force-writes Playwright + a11y + visual
   for `class: ui` repos; doctor verifies. This *is* the evidence engine.
3. Build **evidence-rich, escalation-aware PR review** (#104): auto-attach per-breakpoint
   screenshots + a walkthrough video + visual diffs + a11y summary to every UI PR;
   enriched PR template with an explicit content-change disclosure; a risk classifier that
   flags content/brand/large-diff/low-confidence PRs for **mandatory manager sign-off —
   even at Tier 2-4** (closes the Tier 3/4 auto-merge gap).

The human moves from *gatekeeper of raw diffs* → *decision-maker on a well-evidenced
artifact*. That is what makes it safe to *raise* trust rather than cap it.

## Consequences

- **Positive:** more autonomy without losing brand/taste control; review evidence falls
  out of the UI-test investment (build once, get both); scales to a lead over many repos.
- **Risk / mitigation:** Tier 3/4 auto-merge could land an unreviewed change → mitigated
  by #104's risk-escalation. Until #101/#104 land, the human reviews UI PRs manually.
- **Reusable:** this is the general pattern for any `class: ui` (and later `service`)
  repo, not portfolio-specific.

## Related

- piyush-portfolio#32 (reference implementation — the Playwright suite)
- #101 (UI-testing gate), #104 (evidence-rich + escalation-aware review)
- #62 (trustState × tier → HITL gate), #26 (MANAGER PR template), #47 (contract coverage map)

# Contributing to ai-sdlc

Thanks for your interest. This project is early-stage and personally maintained — contributions are welcome but expect a slow review cadence.

## Before you contribute

1. **Open an issue first** for anything non-trivial. Avoid surprise PRs for large changes; we'll likely have already considered the problem and have context worth sharing.
2. **Read the relevant planning doc.** The [ARCHITECTURE.md](./ARCHITECTURE.md), [PLAN.md](./PLAN.md), and [REQUIREMENTS.md](./REQUIREMENTS.md) explain decisions that aren't always obvious from code alone.
3. **Check the [ROADMAP.md](./ROADMAP.md).** If your contribution doesn't fit a current phase, it may sit in review longer.

## Contributor License Agreement (CLA)

ai-sdlc is licensed under AGPL-3.0. To preserve the project's ability to evolve its license over time (e.g. add a commercial license alongside AGPL), all external contributors must sign a Contributor License Agreement before their PR is merged.

The CLA grants the project a perpetual, irrevocable license to use, modify, and re-license your contributions, while you retain your copyright. It does NOT transfer ownership of your contribution.

The CLA bot will comment on your PR with a signing link the first time you contribute. Once signed, it remembers you for all future PRs.

If you cannot or do not want to sign the CLA, you can still:
- Report issues
- Suggest changes via discussion threads
- Maintain a personal fork

## Workflow

1. Fork the repo, clone your fork, create a feature branch off `main`.
2. Make your changes. Keep PRs focused — one logical change per PR.
3. Run `make ci` locally (typecheck + lint + unit tests) before opening the PR. *(Build target arrives in Phase A.)*
4. Open a PR using the [PR template](./.github/pull_request_template.md). Link the related issue, declare blast-radius tier, list AC.
5. The CLA bot will check your signing status. The CI workflow will run.
6. Review happens within the project's normal cadence (1-2 weeks for non-urgent changes).

## Code style

| Language | Standard |
|---|---|
| TypeScript / JavaScript | Biome (configured in repo, runs in CI) |
| Markdown | Plain — no enforced linter; aim for scannable |
| Shell | shellcheck-clean |

## Tests

- New public function → at least one happy-path test + one negative-path test
- New module → coverage target ≥70% on changed files; ≥85% for Tier 0/1 zones
- Bug fix → regression test that fails on `main` and passes on your branch

## Commit messages

Conventional Commits style:
```
feat: short imperative description
fix: short imperative description
refactor: ...
docs: ...
test: ...
chore: ...
```

Agent-authored commits land with a `Generated-By:` trailer for attribution.

## Issue templates

Use the right template for the kind of issue you're filing:

- **Bug** — something broken; include repro steps + expected/actual behavior
- **Feature** — new capability proposal; include problem statement + use case
- **Epic** — multi-task scope; include success criteria + sub-tasks
- **ADR** — architectural decision request; include options considered + recommendation

## Code of Conduct

Be kind. Read the [Code of Conduct](./CODE_OF_CONDUCT.md). Violations result in interaction restrictions.

## Questions

Open a [Discussion](https://github.com/piyushgupta27/ai-sdlc/discussions) for anything that isn't a bug report or feature request.

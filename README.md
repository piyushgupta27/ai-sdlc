# ai-sdlc

> Autonomous SDLC platform. Multi-agent pipeline that builds, tests, reviews, and ships code with human-in-the-loop gates calibrated to blast radius.

**Status:** Planning phase. Not yet for production use. See [ROADMAP.md](./ROADMAP.md) for phase plan and current milestone.

---

## What this is

ai-sdlc is an opinionated autonomous SDLC pipeline for solo and small-team builders running portfolios of products. It takes a project's planning artifacts (epics, stories, tasks) and ships them through a structured agent pipeline:

```
   PLAN  →  BUILD  →  TEST  →  REVIEWER FLEET  →  DEMO  →  COMMIT  →  REPORT
                                       ↓
                              AGGREGATOR + AI FILTER
                                       ↓
                              HITL queue (5 gates, tier-calibrated)
```

Key properties:

- **Multi-tenant from day 1.** One pipeline manages multiple consumer projects (testbeds) — each with its own CLAUDE.md, Red zone, audit log namespace, and CI surface.
- **Specialized reviewer fleet.** Per-dimension review (security, code quality, design, bug detection) dispatched in parallel. Verdicts aggregated through an AI filter layer that drops false positives.
- **Three-layer blast-radius enforcement.** Red zone files declared in CLAUDE.md + pre-write hook + CI validation. No single layer can be bypassed.
- **Trust expansion based on measured defect data.** Autonomy widens only when zone-specific criteria are met (20+ tickets processed, 0 production incidents, ≥85% coverage, explicit owner sign-off). Red zone never reclassifies.
- **HITL gates calibrated to blast radius.** Tier 0-1 fires all 5 human gates; Tier 4 fires 2. Quiet hours respected.
- **Auditable by default.** Every agent action lands in `.audit/<date>/runs/*.jsonl`. Replayable.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

---

## Why

Modern engineering teams ship code roughly the same way they did in 2010: developer reads spec, writes code, asks colleague for review, runs CI, merges. Agentic AI changes the unit economics. A single engineer with the right pipeline can ship at team velocity. But "agent writes code, autonomously merges" is a recipe for incidents — what's missing is the same operational rigor we apply to human teams: pre-mortem reviews, blast-radius classification, audit trails, rollback paths, calibrated approvals.

ai-sdlc is the rigor layer. It assumes agents will write most code. It does not assume they're trustworthy by default.

Reference influences:
- **Razorpay Slash** (production autonomous SDLC at enterprise scale) — specialized reviewer fleet, Repo Readiness scoring, AI filter layer
- **a prior internal pattern doc (private)** (Piyush's own canonical EM-level pattern doc for a prior internal project) — blast-radius zones, three-layer enforcement, trust expansion criteria

---

## Status

Currently in planning. Phase A (foundation) work has not started. Track progress via [ROADMAP.md](./ROADMAP.md) and the [Issues](https://github.com/piyushgupta27/ai-sdlc/issues) tab.

**Public roadmap testbeds (in order):**

1. trip-research — local-first hotel meta-search across 6 Indian platforms (private)
2. piyush-portfolio — personal portfolio + writing at piyushgupta.io (public)
3. career-automation — end-to-end job-search automation (private)
4. ai-finance-tracker (private)
5. ai-health-agent (private)

---

## Quick start

*Not yet runnable. Returns once Phase A foundation lands.*

---

## Documentation

| Doc | Purpose |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Full system design: orchestrator, agents, multi-tenant infra, gates, transports |
| [PLAN.md](./PLAN.md) | Phase plan, deliverables, success criteria |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | Registry of every requirement (R-AISDLC-*) and locked decision (Q-AI-*) |
| [ONBOARDING.md](./ONBOARDING.md) | How a new consumer project gets onto the pipeline |
| [HITL.md](./HITL.md) | Five human-in-the-loop gates: when they fire, what the human sees, how they respond |
| [ROADMAP.md](./ROADMAP.md) | Phase A-E timeline, testbed sequence |
| [DESIGN.md](./DESIGN.md) | CLI surface, dashboard, issue/PR templates, error formats |

---

## Contributing

This is an early-stage personal project. External contributions are welcome but not actively solicited yet. If you find a bug or have an idea, open an issue. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process, including the Contributor License Agreement requirement.

All contributors are expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

For security issues, see [SECURITY.md](./SECURITY.md) — please do not file public issues for vulnerabilities.

---

## License

This project is licensed under the [GNU Affero General Public License v3.0](./LICENSE) (AGPL-3.0).

The AGPL is a strong copyleft license that closes the "SaaS loophole" in the GPL: anyone who provides the software as a hosted service must also share their modified source code with users of that service. Internal use, modification, and self-hosting are unrestricted.

If you want to use ai-sdlc in a commercial product or hosted service without the AGPL's source-disclosure obligation, contact the author for a commercial license.

---

## Author

Piyush Gupta · Engineering Manager at slice · [piyushgupta.io](https://piyushgupta.io) · [LinkedIn](https://www.linkedin.com/in/piyushgupta27)

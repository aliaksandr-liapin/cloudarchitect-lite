# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break the project format, always with a migration).

## [Unreleased]

### Added

- AI generation in the editor: a Generate panel with a prompt box, six design-priority toggles (Serverless-first, Backups, Disaster recovery, High availability, Cost-optimized, Security hardening), stage text and Cancel.
- One clarification round: up to three questions with quick answers, "You decide" and free text, plus editable requirements before drawing (optional review pause when there are no questions).
- Versions: the current diagram is kept in browser storage (last 10 per project) before a generated one replaces it; a toast offers "Restore previous" and a Versions list restores any earlier diagram. Hand-edited diagrams ask before they are replaced.
- Component names can be edited in the Details panel.

## [0.1.0] - 2026-10-14

First tagged pre-alpha. AI generation is not implemented yet.

### Added

- Monorepo: React Flow editor (`apps/web`), Hono API gateway for Cloudflare Workers or Node (`apps/gateway`), shared domain (`packages/domain`), AWS catalog (`packages/catalog`), eval harness (`eval`).
- Project format 1.2.0 with containers, external nodes (users, client apps, third-party services, on-premises) and migrations from 1.0.0.
- Validation rules VR-001, VR-004–VR-007, VR-009, VR-010, VR-012–VR-018 with a findings panel.
- Gateway controls for free AI: daily and monthly budget caps with a kill switch, per-client rate limits and a credit ledger.
- Phase 0 AI quality spike: 15 benchmark scenarios, spike runner with a validator repair loop, blind rubric reviews ([report](docs/product/phase0-spike.md)).
- Model choice between Claude Haiku 5.5 and Sonnet 5.5, with measured quality, cost and latency shown wherever a model is chosen ([ADR-0011](docs/adr/0011-model-selection.md)).
- Self-hosted install with `docker compose up` and a browser setup wizard ([ADR-0012](docs/adr/0012-self-hosted-setup-wizard.md), [guide](docs/operations/installation.md)).
- CI: lint, typecheck, tests, build, eval harness, image builds with Trivy scans, install smoke test, CodeQL (fails on any finding), `pnpm audit`, gitleaks; release workflow with SBOM and build provenance.
- Apache-2.0 license, NOTICE, code of conduct, support guide; README screenshots and an illustrated setup guide (`pnpm screenshots` regenerates them).

[Unreleased]: https://github.com/aliaksandr-liapin/cloudarchitect-lite/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aliaksandr-liapin/cloudarchitect-lite/releases/tag/v0.1.0

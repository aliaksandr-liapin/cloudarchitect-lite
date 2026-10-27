# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break the project format, always with a migration).

## [Unreleased]

## [0.2.0] - 2026-11-xx

First public release. Includes the Phase 2 work below and a self-hosted install anyone can run.

### Added

- One-command install from published multi-arch images (`compose.yaml` plus `docker compose up`) for Windows, macOS and Linux; see the [installation guide](docs/operations/installation.md).
- Official AWS icons on nodes and groups, fetched from aws.amazon.com on first start and not redistributed by this project.
- A clickable editor demo on GitHub Pages.
- Export of the diagram as PNG and SVG, next to JSON.
- AI generation in the editor: a Generate panel with a prompt box, six design-priority toggles (Serverless-first, Backups, Disaster recovery, High availability, Cost-optimized, Security hardening), stage text and Cancel.
- One clarification round: up to three questions with quick answers, "You decide" and free text, plus editable requirements before drawing (optional review pause when there are no questions).
- Versions: the current diagram is kept in browser storage (last 10 per project) before a generated one replaces it; a toast offers "Restore previous" and a Versions list restores any earlier diagram. Hand-edited diagrams ask before they are replaced.
- Component names can be edited in the Details panel.
- Readable diagrams on first sight: wider component boxes with names wrapping to two lines, orthogonal connection routing with space reserved for labels (no label overlaps a component), and the view fits the whole diagram after generation, Restore, Import and Auto layout. Routes are recomputed when a diagram loads, wherever nothing was moved by hand.
- Every component and group can be resized; a group cannot be shrunk smaller than its contents. Sizes are saved in the project.
- Light/dark theme switch (light by default, remembered per browser).
- Resizable side panel (drag or arrow keys) with the description, design priorities and Generate pinned at the top; AI model and Versions are collapsible and start collapsed.
- Clear generation status: spinner, steps ("Reading your requirements" → "Designing the architecture" → "Checking the design"), elapsed timer, typical wait for the selected model, and Cancel; the canvas dims while a request runs.
- Phase 2 Gate A passed: Haiku blind median 2.29, no critical defect in 11 of 12 reviewed scenarios, live gate green (schema-valid 100%, pass 93.2%). Model benchmarks in the setup wizard and editor now show these measurements ([report](docs/product/phase2-gate-a.md)).

### Changed

- Project format 1.4.0: components may store a `size`. Older files load unchanged (migration from 1.3.0) and keep their positions.
- The editor follows its own theme switch instead of the operating system's color scheme.

### Removed

- Free AI credits and the credit ledger.
- The kill switch (`FREE_AI_DISABLED`).
- The Cloudflare deployment.

### Upgrade notes

- Settings for the removed features are ignored.
- The first start downloads the AWS icons, so the internet is needed once.

### Fixed

- The note under the model comparison shows the actual number of measured runs per model.
- Generator: `containerId` is required (null for external nodes), so designs no longer come back without VPC and subnet placement.
- Generator: output enums (service ids, feature keys, kinds) are enforced by constrained decoding; the SDK helper had moved them into field descriptions.
- Generator: repair turns now name the offending node and edge ids and the remediation for each finding.

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

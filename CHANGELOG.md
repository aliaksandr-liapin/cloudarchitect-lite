# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break the project format, always with a migration).

## [Unreleased]

### Added

- Validation rule VR-026 (warning): a component that is not connected to anything. Baseline services such as CloudWatch are exempt, and a design with one component is not flagged. It is shown in the editor only and not sent to the AI repair turn, so generation is unchanged.
- Editor: a component with findings shows a marker on its corner (red for an error, amber for a warning, blue for info). Hovering lists the findings; clicking opens the Findings window with them highlighted.
- Edit by hand: add services, outside actors and containers from the Add panel; connect, re-plug and edit connectors; link components to requirements; move components into and out of containers; delete; undo and redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z). Findings update after every edit.
- Edit by hand: a Settings section in Details sets, changes and removes catalog settings (encryption, authorizer, dead-letter queue, Multi-AZ, backup and more) on the selected component or connector, with fixed choices where the catalog has them (encryption: KMS or AWS-managed). Findings update as you edit, and undo works.
- A browser end-to-end test runs the app in Docker on every pull request, with recorded AI responses instead of paid calls.
- Experiment report: what happens when the repair turn also gets info findings ([docs/product/info-repair-experiment.md](docs/product/info-repair-experiment.md)), with the eval commands `info-repair`, `review --arms` and `info-repair-report` to reproduce it, and a follow-up for GPT Luna (`info-repair --info-message prioritized`, `info-repair-followup`). Result: the repair turn keeps sending only errors and warnings.

### Changed

- Editor: Add, Findings, Versions and AI model are now windows over the canvas, opened from the toolbar and closed by default, so the canvas can show the diagram alone. The side column defaults to the toolbar's width and its headings and buttons are easier to see.
- Editor: a cleaner toolbar and buttons. The window toggles form one group, Undo and Redo are icon buttons, all buttons share one height and outline, and Delete is red.
- Editor: the side column's default width lines up with the toolbar but is at most 420 px; dragging can still make it wider.
- Editor: a button at the right end of the toolbar hides and shows the side panel, like draw.io's Format panel; the canvas takes the freed width, and the choice is remembered.
- Editor: Settings in Details is a two-column list with a control on every row and no Add step. A setting with one allowed value is a switch (Origin Access Control), one with several is a dropdown that starts at "Not set" (encryption), and a free-text setting is a field where clearing the text removes it. Each name links to the AWS documentation (↗).
- GPT Luna's repair: a single-AZ load balancer warning gets its own repair turn first, then the remaining errors, warnings and five info rules (such as encryption at rest) go in a fresh turn. Measured twice on 110 designs each: errors and warnings per design 0.33 → 0.17 and 0.41 → 0.25, about $0.001 more per design ([report, follow-up 3](docs/product/info-repair-experiment.md#follow-up-3-continued-vs-clean-second-turn-gpt-luna)). Haiku and Flash-Lite are unchanged.
- Setup wizard: **Check key** honors `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` and `GOOGLE_GEMINI_BASE_URL`, like generation (useful behind a proxy).

### Fixed

- Editor: connector settings are offered only where they make sense. Origin Access Control: only between CloudFront and S3 (not browser → CDN). S3 Event Notifications: only towards Lambda, SQS, SNS or EventBridge. Presigned URL upload: only from an outside client or a backend that issues the URLs (Lambda, Fargate, ECS, EC2, EKS, API Gateway), so a CDN → bucket connector no longer offers either. The catalog can now limit a connector setting to certain services at the other end (`peerServiceIds`, with `external` for outside actors). A value already stored where it is no longer offered is kept and shown under "Not in catalog".
- Editor: a component added with an Add button goes in the nearest free spot instead of on top of another component, and is stored in the container it appears in. When the selected container is full, it grows to make room (one undo takes both back).
- Editor: undo and redo put connectors back exactly as they were, without re-running the layout.
- Editor: dragging several components at once moves each into the container it is dropped in (before, only a single component could change containers).
- Editor: if the layout engine fails to load (for example on a flaky connection), a message says so instead of an empty canvas or an Auto layout button that does nothing; trying again loads it afresh.
- Editor: on Windows and Linux, Delete and Backspace stopped deleting after Ctrl+Z until the page was reloaded.
- Editor: Backspace or Delete no longer hides a node or container while the design keeps it. Deletes now go through the design, its findings and the export.

## [0.3.1] - 2026-11-11

Fixes a node that could stay invisible after Restore or Import, Gemini retries transient errors, and the benchmark report shows which rules each model breaks.

### Added

- Benchmark report: rule hits per model (which validation rules each model's designs trigger), and `pnpm --filter @cloudarchitect/eval rules` to print them from saved live runs.
- The live eval also records findings on the first draft and the repair turns used, so the effect of the repair turn can be measured.

### Fixed

- Editor: after **Restore** or **Import JSON**, a diagram node could stay invisible until the page was reloaded (more likely on a busy computer). Found by the new browser end-to-end test.
- Gemini requests retry transient errors (408, 429, 5xx) up to twice, like Anthropic and OpenAI requests. Before, a single rate-limit or server error failed the generation ([#30](https://github.com/aliaksandr-liapin/cloudarchitect-lite/issues/30)).
- Setup wizard, Models step: when only one model is on offer (for example a Gemini-only install), it is selected; before, Next stayed disabled until you ticked it.
- Setup wizard: the Gemini 4 Argon note no longer compares its cost with Claude Sonnet, which a Gemini-only install does not show; the Limits step rounds the cost per generation like the Models step ($0.120, not $0.1197).

## [0.3.0] - 2026-11-10

Claude vs GPT vs Gemini: OpenAI and Gemini next to Claude, and a public three-provider benchmark.

### Added

- OpenAI (GPT-6.1 Sol) and Google Gemini (Gemini 4 Argon) next to Claude Haiku 5.5 and Claude Sonnet 5.5. GPT-6 Luna and Gemini 3.5 Flash-Lite are supported but not listed: they missed the listing bar (pass rate and no-critical-defect rate of at least 85%, blind median of at least 2.0).
- One key from any of the three providers is enough. The setup wizard has an "AI providers" step with a card per provider and a link to its key page; `OPENAI_API_KEY` and `GEMINI_API_KEY` work like `ANTHROPIC_API_KEY`.
- Re-running setup can replace or remove a saved provider key (**Remove saved key** on its card; at least one key must remain). Keys set in `.env` are not removable in the wizard.
- Requirements extraction runs on the selected provider's economical model, so one operation never mixes providers.
- Benchmark: six models measured on the same code, then a blind review by a panel of three reviewers, one per provider, scored by the median. GPT-6.1 Sol scored highest (2.86 of 3). See the [report](docs/product/phase3-provider-benchmark.md).
- [ADR-0014](docs/adr/0014-multi-provider-ai.md): multiple AI providers.

### Changed

- Models whose provider has no key are not offered; the editor shows "Add a key in setup" for them.
- Daily and monthly spending limits count all providers together.
- README, installation guide and `.env.example` cover the three providers; the setup wizard's key step is now "AI providers".

### Deprecated

- Kept for 0.2 web clients; removal planned in 0.4: the setup status field `keyFromEnvironment` (use `providers`), a verify-key request body without `provider` (treated as Anthropic), and `apiKey` in the setup request (`SetupInput.apiKey`; use `apiKeys.anthropic`).

### Upgrade notes

- 0.2 settings keep working: your saved key, enabled models, default and browser choices (`haiku`, `sonnet`) are unchanged. To use OpenAI or Gemini, add their keys by re-running setup (see the [installation guide](docs/operations/installation.md#re-running-setup)).

## [0.2.1] - 2026-11-04

### Fixed

- Setup wizard: the Models step no longer mentions bringing your own key (removed in 0.2.0) and says that models left off cannot be selected in the editor; the rate limit is labelled "AI requests per minute" instead of "per visitor".

## [0.2.0] - 2026-11-04

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
- If you run 0.1 from a clone of the repository: `compose.yaml` now pulls the published images instead of building. To keep building from your checkout, run `docker compose -f compose.yaml -f compose.build.yaml up --build`.

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

[Unreleased]: https://github.com/aliaksandr-liapin/cloudarchitect-lite/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/aliaksandr-liapin/cloudarchitect-lite/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/aliaksandr-liapin/cloudarchitect-lite/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/aliaksandr-liapin/cloudarchitect-lite/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/aliaksandr-liapin/cloudarchitect-lite/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aliaksandr-liapin/cloudarchitect-lite/releases/tag/v0.1.0

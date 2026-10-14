# CloudArchitect Lite

> Describe your application. Get an editable, explainable, validated AWS architecture. Free to start.

Local-first AI cloud architecture designer — AWS first, Azure/GCP ready. The architecture is a typed graph (not an image), validated by deterministic rules and traced back to requirements.

**Status:** pre-alpha scaffold (ROADMAP Phase 0–1). The editor, project schema, catalog, validation rules, gateway controls and CI/CD are in place; AI generation is not implemented yet.

## Repository layout

| Path                                                   | What it is                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                                             | React + React Flow editor: nested containers, ELK auto-layout, findings panel, IndexedDB save, JSON import/export                   |
| `apps/gateway`                                         | Hono API gateway for free AI credits: budget cap + kill switch, rate limits, credit ledger (D1). Runs on Cloudflare Workers or Node |
| `packages/domain`                                      | Shared project schema (Zod), graph patches, migrations, validation rule engine                                                      |
| `packages/catalog`                                     | Versioned AWS catalog: services, features, containers, rule metadata, icon-pack records, sample projects                            |
| `eval`                                                 | Benchmark scenarios and the automated evaluation harness (release gate)                                                             |
| `infra/docker`                                         | Container images for web (nginx, non-root) and gateway (Node, non-root)                                                             |
| `docs/product`                                         | PRD, technical architecture, catalog spec, roadmap                                                                                  |
| `docs/adr`                                             | Architecture decision records                                                                                                       |
| `docs/security`, `docs/operations`, `docs/engineering` | Threat model, deployment, scalability, observability, runbook, development and testing guides                                       |

## Quick start

Requirements: Node 26+ (see `.nvmrc`), pnpm 10.32 (`npm install -g pnpm@10.32.1`; Node 25+ no longer bundles corepack), and Docker for containers (Rancher Desktop or Docker Desktop).

```bash
pnpm install
cp .env.example .env            # set CLIENT_KEY_SALT to a long random string
pnpm dev                        # web on :5173, gateway on :8787
```

Full stack in containers:

```bash
docker compose up --build       # web on :8080, gateway on :8787
```

## Quality gates

```bash
pnpm run ci     # lint, format check, typecheck, unit tests, build
pnpm eval       # evaluation harness against eval/scenarios
```

CI runs the same checks plus container builds with vulnerability scanning, CodeQL, dependency review, `pnpm audit` and secret scanning. See [docs/engineering/development.md](docs/engineering/development.md).

## Documentation

- Product: [overview](docs/product/README.md) · [PRD](docs/product/PRD.md) · [technical architecture](docs/product/TECHNICAL_ARCHITECTURE.md) · [catalog](docs/product/CLOUD_PROVIDER_CATALOG.md) · [roadmap](docs/product/ROADMAP.md)
- Decisions: [docs/adr](docs/adr/)
- Security: [SECURITY.md](SECURITY.md) · [threat model](docs/security/threat-model.md)
- Operations: [deployment](docs/operations/deployment.md) · [scalability](docs/operations/scalability.md) · [observability](docs/operations/observability.md) · [runbook](docs/operations/runbook.md)

## License

No license has been chosen yet. All rights reserved. Cloud provider icons and trademarks belong to their owners; see [the catalog spec](docs/product/CLOUD_PROVIDER_CATALOG.md#2-sources-of-truth).

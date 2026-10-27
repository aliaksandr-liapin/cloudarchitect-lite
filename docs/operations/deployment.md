# Deployment

CloudArchitect Lite is self-hosted only ([ADR-0013](../adr/0013-self-hosted-only.md)): nobody runs a hosted service. Users run the two container images on their own machine.

## Runtime

| Component | Implementation                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------- |
| Web       | `web` container image (nginx serving `apps/web/dist`, proxying `/api` to the gateway)          |
| Gateway   | `gateway` container image (Node), single replica, settings and icon set on a named data volume |

The Cloudflare Workers + D1 and Cloudflare Pages deployment (staging and production, `wrangler`) was dropped 2026-10-26.

## Environments

| Environment         | How                                                                               |
| ------------------- | --------------------------------------------------------------------------------- |
| Local / self-hosted | `docker compose up --build` ([installation guide](installation.md)) or `pnpm dev` |
| Demo                | Static editor on GitHub Pages, built by a GitHub Actions workflow on each release |

The demo has no gateway and no AI. It is planned for release 0.2 (see the roadmap).

## Releases

Tag `vX.Y.Z` → `release.yml` publishes `ghcr.io/<repo>/web` and `/gateway` with SBOM and build provenance. Users upgrade by pulling the new images.

## Rollback

Redeploy the previous image tag or digest. Saved settings and the data volume are kept.

## Repository security features

The repository is private until the public release. CodeQL always runs and its SARIF is kept as the `codeql-sarif` workflow artifact. Uploading results to GitHub code scanning and running dependency review both require GitHub Advanced Security on private repositories; once it is enabled, set the repository variable `GHAS_ENABLED=true` to turn both on. Dependabot alerts and security updates work without it — enable them under Settings → Code security.

# Deployment

## Targets

| Component | Primary                                                                    | Alternative                                                                   |
| --------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Web       | Cloudflare Pages (static, `apps/web/dist`, headers from `public/_headers`) | `web` container image (nginx) on any container platform                       |
| Gateway   | Cloudflare Workers + D1 (`apps/gateway/wrangler.toml`)                     | `gateway` container image (Node) — single replica until a shared store exists |

## Environments

| Environment | Trigger                                         | Approval                                           |
| ----------- | ----------------------------------------------- | -------------------------------------------------- |
| Local       | `pnpm dev` or `docker compose up --build`       | —                                                  |
| Staging     | push to `main` (`.github/workflows/deploy.yml`) | none                                               |
| Production  | published GitHub release                        | required reviewers on the `production` environment |

## One-time setup

1. `wrangler d1 create cloudarchitect` and put the database ID into `apps/gateway/wrangler.toml` (default and `env.production`).
2. `wrangler secret put CLIENT_KEY_SALT` (and provider keys when the LLM adapter ships), per environment.
3. Create the Pages project `cloudarchitect-lite`.
4. In GitHub: repository variable `CLOUDFLARE_ACCOUNT_ID`; environment secret `CLOUDFLARE_API_TOKEN` (scoped to Workers, D1, Pages) in `staging` and `production`; add required reviewers to `production`.
5. Set `ALLOWED_ORIGINS` in `env.production.vars` to the real web origin.

Until step 4 is done, the deploy workflow skips cleanly.

## Releases

Tag `vX.Y.Z` → `release.yml` publishes `ghcr.io/<repo>/web` and `/gateway` with SBOM and build provenance. Publishing a GitHub release from the tag deploys production.

## Rollback

- Workers: `wrangler rollback` (or redeploy the previous tag).
- Pages: promote the previous deployment in the Cloudflare dashboard.
- D1 migrations are forward-only; write additive migrations and keep old columns until the next release.
- Containers: redeploy the previous image digest.

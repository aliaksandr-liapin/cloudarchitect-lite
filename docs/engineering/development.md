# Development Guide

## Setup

```bash
npm install -g pnpm@10.32.1  # Node 25+ no longer bundles corepack
pnpm install
cp .env.example .env       # set CLIENT_KEY_SALT
pnpm dev                   # web :5173, gateway :8787 (Node runtime, the only runtime)
```

Containers, built from source: `docker compose -f compose.yaml -f compose.build.yaml up --build` (tested with Rancher Desktop). Plain `docker compose up` pulls the published images instead.

## Commands

| Command                                    | What it does                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run ci`                              | Lint, format check, typecheck, tests, build — same as CI                                                                                                 |
| `pnpm test`                                | Unit tests in all packages (Vitest)                                                                                                                      |
| `pnpm eval`                                | Score `eval/candidates` against `eval/scenarios`                                                                                                         |
| `pnpm format`                              | Prettier write                                                                                                                                           |
| `pnpm screenshots`                         | Rebuild the web app and regenerate `docs/images/social-preview.png`; `--gif` records the README's `demo.gif` (needs Google Chrome; API calls are mocked) |
| `pnpm --filter @cloudarchitect/e2e manual` | Regenerate the user manual's screenshots in `docs/manual/images` (Docker stack with the fake AI, like the browser test)                                  |

Regenerate the screenshots whenever a change alters what they show, and commit the images with that change.

**User manual.** When a change adds or changes something a user sees or does, update the matching page in [docs/manual](../manual/README.md) in the same pull request, and add a shot to `e2e/tests/manual.spec.ts` if a new screen needs a picture. Skip it when nothing a user would notice changed (refactors, dependency updates, internal tooling). The pull request template asks about it.

## TypeScript versions

Packages typecheck with TypeScript 7 (native compiler). typescript-eslint does not support TypeScript 7 yet, so the repo root aliases `typescript` to `@typescript/typescript6` for linting only, following Microsoft's side-by-side guidance. Remove the alias when typescript-eslint supports TypeScript 7.

## Package boundaries

- `packages/domain` has no runtime dependencies besides Zod and must stay platform-neutral (browser and Node).
- `packages/catalog` holds data only, parsed with domain schemas at import time.
- Apps depend on packages; packages never depend on apps.

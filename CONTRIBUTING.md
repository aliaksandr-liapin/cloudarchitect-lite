# Contributing

## Workflow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>` or `docs/<topic>`.
2. Keep changes small and linked to a PRD item (FR-/NFR-/VR-) or roadmap epic.
3. Run `pnpm run ci` and `pnpm eval` before opening a pull request.
4. Open a PR using the template. `main` is protected: changes land only through pull requests with all required checks green. Code-owner approval becomes mandatory once the project has a second maintainer.
5. Squash-merge with a [Conventional Commits](https://www.conventionalcommits.org/) title, e.g. `feat(domain): add VR-003 rule`.

## Rules of the road

- **English only** in code, comments, docs and commit messages.
- **Schema changes** to the project format need a migration in `packages/domain/src/migrate.ts` and a test.
- **Catalog changes** need evidence (`sourceUrl`, `checkedAt`). New entries stay `needs_review` until the catalog maintainer approves them.
- **Validation rules** need positive and negative tests and metadata in `packages/catalog/data/aws/validation-rules.json`.
- **Prompt, model or catalog changes** must keep the eval harness green.
- **Never commit secrets.** Use `.env` / `.dev.vars` (both git-ignored) and the examples provided.
- **Icons** come only from the official AWS, Azure and GCP icon pages and are not committed to Git (see the catalog spec).

## Architecture decisions

Significant decisions get an ADR in `docs/adr/` (copy the format of an existing one). Update the product docs when behavior changes.

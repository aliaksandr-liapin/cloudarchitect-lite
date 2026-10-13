## What and why

<!-- Link the PRD requirement (FR-/NFR-/VR-) or roadmap epic this change serves. -->

## How it was verified

- [ ] `pnpm run ci` passes locally
- [ ] Tests added or updated for the change
- [ ] Eval harness unchanged or improved (`pnpm eval`)

## Checklist

- [ ] No secrets, prompts or user data in code, logs or fixtures
- [ ] Project schema change includes a migration (`packages/domain/src/migrate.ts`)
- [ ] Catalog change includes evidence (`sourceUrl`, `checkedAt`) and stays `needs_review` until approved
- [ ] Docs updated (`docs/`) if behavior or architecture changed

# Contributing

Thanks for your interest in CloudArchitect Lite. You can help without writing code: trying the
[demo](https://aliaksandr-liapin.github.io/cloudarchitect-lite/) or an install and telling us what
broke or confused you is one of the most useful contributions.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

| You want to…                               | Do this                                                                                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report something that does not work        | [Open a bug report](https://github.com/aliaksandr-liapin/cloudarchitect-lite/issues/new?template=bug.yml)                                                                                                                         |
| Suggest a feature, improvement or new idea | [Open a feature request](https://github.com/aliaksandr-liapin/cloudarchitect-lite/issues/new?template=feature.yml)                                                                                                                |
| Report a security problem                  | Do **not** open an issue. [Report it privately](https://github.com/aliaksandr-liapin/cloudarchitect-lite/security/advisories/new); see [SECURITY.md](SECURITY.md)                                                                 |
| Get help with an install                   | Start with [troubleshooting](docs/operations/installation.md#troubleshooting), then open a bug report if it is not covered                                                                                                        |
| Fix a bug or add a feature                 | Pick an issue, say in a comment that you are on it, then follow [Making a change](#making-a-change)                                                                                                                               |
| Find a first task                          | Look for the [`good first issue`](https://github.com/aliaksandr-liapin/cloudarchitect-lite/labels/good%20first%20issue) and [`help wanted`](https://github.com/aliaksandr-liapin/cloudarchitect-lite/labels/help%20wanted) labels |

Check the [open issues](https://github.com/aliaksandr-liapin/cloudarchitect-lite/issues) first; if
yours is already there, add a 👍 or a comment instead of a duplicate. See the
[roadmap](docs/product/roadmap.md) for what is planned next.

## Reporting a bug

A good bug report lets someone reproduce the problem. Please include:

- **What you did:** the steps, from a fresh start if you can.
- **What happened and what you expected.**
- **Version:** shown in `compose.yaml` (`CLOUDARCHITECT_VERSION`, for example `0.3.0`) or the commit you built from, or "demo".
- **Where:** operating system, Docker version (`docker compose version`), browser.
- **Logs:** the relevant lines of `docker compose logs gateway`, and any error in the browser console.

**Never paste API keys, setup codes (`/setup?code=…`) or private architecture details.** Remove
them from logs and screenshots before you post.

## Suggesting a feature or improvement

Describe the **problem first**: who needs it and what they are trying to do. A short example (a
prompt you tried, a diagram you wanted, a tool that does it well) helps more than a finished
design. Ideas for wording, docs and the setup flow are welcome too.

Bigger ideas are discussed in the issue before anyone writes code, so nobody spends time on a
change that does not fit the [roadmap](docs/product/roadmap.md) or the
[architecture decisions](docs/adr/).

## Making a change

### Set up

You need Node.js 24 or newer (the repository pins 26 in `.nvmrc`), pnpm 10.32.1 and Git. Docker is
only needed to test the containers; Google Chrome only to regenerate screenshots.

```bash
git clone https://github.com/<you>/cloudarchitect-lite.git   # your fork
cd cloudarchitect-lite
npm install -g pnpm@10.32.1   # Node 25+ no longer bundles corepack
pnpm install
cp .env.example .env          # set CLIENT_KEY_SALT; add ANTHROPIC_API_KEY only for AI features
pnpm dev                      # editor on http://localhost:5173, gateway on :8787
```

The editor, validation and export work without an API key. More in the
[development guide](docs/engineering/development.md) and the [testing guide](docs/engineering/testing.md).

### Workflow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>` or `docs/<topic>`.
2. Keep each pull request small and about one thing. Link the issue it closes (`Closes #123`) and,
   where it applies, the PRD item (FR-/NFR-/VR-) or roadmap epic.
3. Add or update tests for the change.
4. Run the checks locally:

   ```bash
   pnpm run ci    # lint, format check, typecheck, unit tests, build (same as CI)
   pnpm eval      # scores the saved AI outputs against the scenarios; free, no API key
   ```

   `pnpm format` fixes formatting. UI changes: include a before/after screenshot in the pull request.

   The browser end-to-end test runs the production images in Docker, with recorded AI responses
   instead of paid calls. It needs Docker running, Google Chrome and port 8080 free:

   ```bash
   E2E_SETUP=claude pnpm e2e   # one setup: claude, gemini or all; unset runs every setup in turn
   ```

   It builds the images from your checkout and never reads the repo-root `.env`, so your real API
   keys are not used. See [e2e/README.md](e2e/README.md).

5. Open a pull request using the template. CI runs the same checks plus a security scan, an
   install smoke test and the browser end-to-end test.
6. A maintainer reviews it. The pull request is squash-merged with a
   [Conventional Commits](https://www.conventionalcommits.org/) title, for example
   `feat(domain): add VR-026 rule` or `fix(web): keep the selection after export`.

`main` is protected: changes land only through pull requests with all required checks green.

**About the paid AI check.** Changes to the generator, catalog data or eval scenarios also run a
live evaluation that calls Claude and costs money. It needs the maintainer's API key, so it is
skipped on pull requests from forks; a maintainer runs it before merging when needed. You do not
need your own key to contribute.

## Rules of the road

- **English only** in code, comments, docs and commit messages.
- **Schema changes** to the project format need a migration in `packages/domain/src/migrate.ts` and a test.
- **Catalog changes** need evidence (`sourceUrl`, `checkedAt`). New entries stay `needs_review` until the catalog maintainer approves them.
- **Validation rules** need positive and negative tests and metadata in `packages/catalog/data/aws/validation-rules.json`.
- **Prompt, model or catalog changes** must keep the eval harness green.
- **Never commit secrets.** Keep keys in `.env` (git-ignored); use `.env.example` as the template.
- **Icons** come only from the official AWS, Azure and GCP icon pages and are never committed to Git or put in images (see the [catalog spec](docs/product/cloud-provider-catalog.md)).

## Architecture decisions

Significant decisions get an ADR in [`docs/adr/`](docs/adr/) (copy the format of an existing one).
Update the product docs when behavior changes.

## Releases

Maintainers ship versions as described in [Releasing](docs/operations/releasing.md).

## License

CloudArchitect Lite is licensed under [Apache-2.0](LICENSE). By opening a pull request you agree
that your contribution is licensed under the same terms.

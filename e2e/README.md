# @cloudarchitect/e2e

Browser end-to-end regression test: the production images run in Docker, and the AI providers are
replaced by a fake server that replays recorded real responses.

## Architecture

1. `src/stack.ts` starts `compose.yaml` (+ `compose.build.yaml` for local images) +
   `compose.e2e.yaml` as the Compose project `ca-e2e-<setup>` on port 8080.
2. `compose.e2e.yaml` adds the `fake-ai` service and points the gateway's provider base URLs at it.
3. The gateway's environment comes only from `envFor(setup)`: the repo-root `.env` is never used.
4. `tests/<setup>.spec.ts` drives the app in Chrome: setup wizard, generation, export, import, versions.
5. The fake server replays `fixtures/fixtures.json`; its control API injects 429s and rejected keys.

## Fake AI server

`fake-ai/server.ts` stands in for Anthropic, OpenAI and Gemini. The gateway reaches it through
`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` (ending in `/v1`) and `GOOGLE_GEMINI_BASE_URL`.

- **Replay** (default): each provider's requests get its responses from `fixtures/fixtures.json`
  in order, wrapping past the end. List-models calls (the gateway's key check) answer 200.
- **Record**: with `upstream` set, requests go to the real providers and each answer is passed to
  `record`. Keys are never stored, and only the `content-type` response header is kept.
- **Control API** on a separate port: `POST /reset`, `POST /fail-next` `{ provider, status: 429 }`,
  `POST /reject-key` `{ key }`, `GET /log`.

It imports only `node:` builtins, so plain Node runs it without `node_modules`:

```sh
PORT=4010 CONTROL_PORT=4011 FIXTURES=e2e/fixtures/fixtures.json node e2e/fake-ai/server.ts
```

## Scripts

- `pnpm --filter @cloudarchitect/e2e test` — unit tests of the fake server, using the real
  provider adapters from `@cloudarchitect/generator`.
- `E2E_SETUP=claude pnpm e2e` — the browser journey in `tests/claude.spec.ts` (Chrome, Docker, port
  8080 free). `E2E_SETUP` is one of `claude`, `gemini` and `all` (`tests/<setup>.spec.ts`); unset
  runs every spec in turn.
  `E2E_IMAGES=ghcr` uses the published images instead of a local build, at `E2E_VERSION` (for
  example `0.4.0`; the default image tag in `compose.yaml` when unset).

## CI

The `Browser end-to-end (<setup>)` jobs run one spec each: in `ci.yml` on every pull request and
push to `main` (local build), and in `release.yml` after a tag is published (`E2E_IMAGES=ghcr`).
To add a setup, add `tests/<setup>.spec.ts` and the setup to the `matrix.setup` list of both jobs.
On failure, `test-results/` (traces, screenshots, compose logs) is uploaded as an artifact.

## Fixtures

`fixtures/fixtures.json` holds real provider answers for the prompts in `src/prompts.ts` (two
Anthropic designs with Haiku, one each with GPT Sol and Gemini Argon). `src/fixtures.test.ts`
replays them through the current generator in `pnpm test`; when a catalog, schema or prompt
change makes them stop fitting it fails with
`fixtures are out of date: re-record with pnpm --filter @cloudarchitect/e2e record`.

Re-record only when that test fails, and only with the owner's OK: it calls the real APIs.

- `pnpm --filter @cloudarchitect/e2e record` — paid (about $0.20), needs `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY` and `GEMINI_API_KEY` (environment or repo-root `.env`). Runs the prompts
  against the real APIs through the fake server in record mode and rewrites the fixtures. Writes
  nothing if any provider answers non-2xx. Keys are never stored.

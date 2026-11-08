# @cloudarchitect/e2e

Browser end-to-end regression test: the production images run in Docker, and the AI providers are
replaced by a fake server that replays recorded real responses.

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
  8080 free). `E2E_IMAGES=ghcr` uses the published images instead of a local build.

## Fixtures

`fixtures/fixtures.json` holds real provider answers for the prompts in `src/prompts.ts` (two
Anthropic designs with Haiku, one each with GPT Sol and Gemini Argon). `src/fixtures.test.ts`
replays them through the current generator in `pnpm test`; when a catalog, schema or prompt
change makes them stop fitting it fails with
`fixtures are out of date: re-record with pnpm --filter @cloudarchitect/e2e record`.

- `pnpm --filter @cloudarchitect/e2e record` — paid (about $0.20), needs `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY` and `GEMINI_API_KEY` (environment or repo-root `.env`). Runs the prompts
  against the real APIs through the fake server in record mode and rewrites the fixtures. Writes
  nothing if any provider answers non-2xx. Keys are never stored.

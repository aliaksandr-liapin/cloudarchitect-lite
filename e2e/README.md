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

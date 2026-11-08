# Browser end-to-end regression test — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A blocking CI check that runs the production images in Docker and drives the app in Chrome through the main user journeys, with AI providers replaced by a fake server that replays recorded real responses.

**Architecture:** A new workspace package `e2e/` holds a fake provider server (replays recorded HTTP responses per provider, in order), a recorder (the same server as a recording proxy in front of the real APIs), a stack helper that starts `compose.yaml` + an e2e override, and Playwright specs. The gateway reaches the fake server through the SDKs' own base-URL variables; the only app change is that the wizard's key check honors the same variables.

**Tech Stack:** TypeScript (Node 26 runs `.ts` directly), `@playwright/test` 1.64.1 with the installed Chrome (`channel: 'chrome'`), Docker Compose, GitHub Actions, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-11-07-e2e-regression-design.md`

## Global Constraints

- No test switch in app code. The tested images are built from `infra/docker/*.Dockerfile` (PRs, `main`) or pulled from GHCR (release tags); the only test-specific settings are environment variables in the e2e compose override.
- Base-URL variables, exactly: `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GOOGLE_GEMINI_BASE_URL`.
- No paid calls in CI. Recording (`pnpm --filter @cloudarchitect/e2e record`) is manual, needs real keys, costs about $0.30.
- The repo-root `.env` (the owner's real keys) must never reach the e2e stack.
- Fake keys are constants in the test; the fake server's control port binds `127.0.0.1` only.
- Each CI job finishes in about 10 minutes; Playwright retries: 0.
- Actions pinned by commit SHA, like the existing workflows. Node 26, pnpm from `packageManager`.
- `pnpm run ci` does not start Docker; the browser test is `pnpm e2e`.
- Job matrix and coverage, from the spec:

  | Job      | Journeys                                                                                   | Failure tests         |
  | -------- | ------------------------------------------------------------------------------------------ | --------------------- |
  | `claude` | wizard (key typed), generate, findings, export PNG/SVG/JSON, import JSON, versions, reload | rejected key          |
  | `gemini` | wizard (key from `.env`), generate, findings, export JSON, reload                          | budget                |
  | `all`    | wizard (enable Haiku, Sonnet, Sol, Argon), one generation per provider                     | 429 once per provider |

## Review Focus

1. **The owner's real `.env` leaks into the stack** (compose.yaml loads `.env` from the project directory; locally that file holds real keys). Expected: the e2e stack only ever loads its own generated env file. Pinned by a test in Task 4.
2. **Fixtures go stale** after a catalog, schema or prompt change, and the browser test then fails with an unclear "Generation failed". Expected: a fast unit test replays the fixtures through the current generator and fails with "fixtures are out of date: re-record". Pinned in Task 3.
3. **One failed test leaves the fake server mid-sequence**, so every later test gets the wrong response. Expected: each test starts from a reset fake server. Pinned in Task 2 (reset) and Task 5 (`beforeEach`).
4. **Control port reachable from outside the runner.** Expected: published on `127.0.0.1` only. Pinned in Task 4.
5. **The real AWS icon download is slow or down**, failing the run for a reason unrelated to the change. Expected: the stack helper waits up to 120 s for `"state":"ready"` (as the install smoke test does) and fails with a message naming the icon download. Pinned in Task 4.

---

### Task 1: Key check honors the base-URL variables

**Files:**

- Modify: `apps/gateway/src/setup.ts:16-31` (`keyCheckRequest`)
- Modify: `.env.example`, `docs/operations/installation.md` (advanced settings)
- Test: `apps/gateway/src/app.test.ts` (or a new `apps/gateway/src/setup.test.ts` if the existing file has no `verifyKey` section)

**Interfaces:**

- Produces: `keyCheckRequest(provider: Provider, apiKey: string, env?: NodeJS.ProcessEnv): [string, Record<string, string>]`, exported. Defaults: Anthropic `https://api.anthropic.com` + `/v1/models?limit=1`; OpenAI `https://api.openai.com/v1` + `/models`; Gemini `https://generativelanguage.googleapis.com` + `/v1beta/models`. A set variable replaces the base; one trailing `/` is dropped.

- [ ] **Step 1: Write the failing tests**

```ts
it('uses the default provider URLs', () => {
  expect(keyCheckRequest('anthropic', 'k', {})[0]).toBe(
    'https://api.anthropic.com/v1/models?limit=1',
  );
  expect(keyCheckRequest('openai', 'k', {})[0]).toBe('https://api.openai.com/v1/models');
  expect(keyCheckRequest('google', 'k', {})[0]).toBe(
    'https://generativelanguage.googleapis.com/v1beta/models',
  );
});
it('honors the SDK base-URL variables', () => {
  const env = {
    ANTHROPIC_BASE_URL: 'http://fake-ai:8790/',
    OPENAI_BASE_URL: 'http://fake-ai:8790/v1',
    GOOGLE_GEMINI_BASE_URL: 'http://fake-ai:8790',
  };
  expect(keyCheckRequest('anthropic', 'k', env)[0]).toBe('http://fake-ai:8790/v1/models?limit=1');
  expect(keyCheckRequest('openai', 'k', env)[0]).toBe('http://fake-ai:8790/v1/models');
  expect(keyCheckRequest('google', 'k', env)[0]).toBe('http://fake-ai:8790/v1beta/models');
});
```

- [ ] **Step 2: Run them and see them fail** — `pnpm --filter @cloudarchitect/gateway exec vitest run <file>`; expected: `keyCheckRequest` is not exported.
- [ ] **Step 3: Implement** — export `keyCheckRequest` with the `env` parameter defaulting to `process.env`; `verifyKey` keeps its signature.
- [ ] **Step 4: Run the tests** — expected: PASS.
- [ ] **Step 5: Document** — `.env.example`: a commented "Advanced: provider endpoints (proxies, tests)" block with the three variables; installation guide: one short paragraph in its configuration section. Run `pnpm run ci`.
- [ ] **Step 6: Commit** — `feat(gateway): key check honors provider base-URL variables`

### Task 2: `e2e` package and the fake provider server

**Files:**

- Create: `e2e/package.json` (`@cloudarchitect/e2e`, private, version = repo version, scripts `test`, `typecheck`, `e2e`, `record`), `e2e/tsconfig.json`, `e2e/README.md`
- Create: `e2e/fake-ai/server.ts`, `e2e/fake-ai/fixtures.ts`
- Test: `e2e/fake-ai/server.test.ts`
- Modify: `pnpm-workspace.yaml` (add `e2e`), root `package.json` (`"e2e": "pnpm --filter @cloudarchitect/e2e e2e"`), `tools/check-versions.ts` if it lists packages explicitly

**Interfaces:**

- Produces, in `fixtures.ts`:
  - `type Provider = 'anthropic' | 'openai' | 'google'`
  - `interface RecordedResponse { status: number; headers: Record<string, string>; body: string; path: string }` (body is the raw response text, SSE included)
  - `interface FixtureSet { recordedAt: string; prompts: string[]; responses: Record<Provider, RecordedResponse[]> }` stored as `e2e/fixtures/fixtures.json`
  - `loadFixtures(path?: string): FixtureSet`
- Produces, in `server.ts`:
  - `startFakeAi(opts: { fixtures: FixtureSet; port: number; controlPort: number; upstream?: Record<Provider, string>; record?: (p: Provider, r: RecordedResponse) => void }): Promise<{ close(): Promise<void> }>`
  - Runnable as `node e2e/fake-ai/server.ts` (reads `PORT`, `CONTROL_PORT`, `FIXTURES`).
  - Provider routing by path: `/v1/messages`, `/v1/models` (Anthropic: `x-api-key` header; OpenAI: `authorization` header) — Anthropic vs OpenAI on `/v1/models` decided by which auth header is present; `/v1/responses` → OpenAI; `/v1beta/models...` → Gemini.
  - Replay: each provider has a cursor into `responses[provider]`, advanced by every non-`models` request; past the end it wraps to 0.
  - `GET .../models` answers 200 `{ "data": [] }` (Gemini: `{ "models": [] }`), or the provider's invalid-key answer (Anthropic/OpenAI 401; Gemini 400 with `API_KEY_INVALID`) when the key is in the rejected set.
  - Control API on `controlPort`: `POST /reset` (cursors to 0, faults and rejected keys cleared), `POST /fail-next` body `{ provider, status: 429 }` (next non-models request of that provider answers 429 with `retry-after: 0`, without advancing the cursor), `POST /reject-key` body `{ key }`, `GET /log` (list of `{ provider, path, status }` served since reset).
  - Record mode (when `upstream` is set): forward the request to `upstream[provider]` unchanged, return the response to the caller, and pass it to `record` with the `x-api-key`, `authorization`, `x-goog-api-key` request headers never stored and response headers limited to `content-type`.

- [ ] **Step 1: Write the failing tests** in `server.test.ts`, each starting the server on random ports with a small hand-made `FixtureSet` and calling it with the **real** adapters from `@cloudarchitect/generator` (`anthropicClient`, `openaiClient`, `googleClient`) after setting the three base-URL variables to the server:
  - `replays each provider's responses in order` — two Anthropic responses; two calls return the two texts in order.
  - `wraps past the end`.
  - `fail-next answers 429 once and the SDK retry gets the replay` — for each provider; `GET /log` shows `429` then `200`, and the cursor advanced once.
  - `reject-key makes the key check fail` — `GET` each provider's models path with the rejected key answers Anthropic 401, OpenAI 401, Gemini 400 with `API_KEY_INVALID` in the body (the answers `verifyKey` in `apps/gateway/src/setup.ts` maps to "invalid"); with a fake key it answers 200.
  - `reset clears cursors, faults and rejected keys`.
  - `control port is a separate listener` — the provider port answers 404 to `/reset`.
- [ ] **Step 2: Run them and see them fail** — `pnpm --filter @cloudarchitect/e2e test`.
- [ ] **Step 3: Implement** `fixtures.ts` and `server.ts` with `node:http` only (no new runtime dependency).
- [ ] **Step 4: Run the tests** — expected: PASS. Then `pnpm run ci`.
- [ ] **Step 5: Commit** — `test(e2e): fake AI provider server`

### Task 3: Recorder, recorded fixtures and the fixture freshness test

**Files:**

- Create: `e2e/src/record.ts`, `e2e/src/prompts.ts`, `e2e/fixtures/fixtures.json` (generated)
- Test: `e2e/src/fixtures.test.ts`

**Interfaces:**

- Consumes: `startFakeAi` (record mode), `extract` and `generateArchitecture` from `@cloudarchitect/generator`, `YOU_DECIDE` from `@cloudarchitect/domain`.
- Produces: `PROMPTS: { anthropic: [string, string]; openai: [string]; google: [string] }` in `prompts.ts` (the dental-clinic booking prompt from the 2026-11-07 run as the first prompt of each provider; a second, clearly different Anthropic prompt, such as a photo-sharing site, so the two Claude designs differ). `MODELS: Record<Provider, ModelChoice>` = `{ anthropic: 'haiku', openai: 'gpt-sol', google: 'gemini-argon' }` (the cheapest listed model per provider).

- [ ] **Step 1: Write the failing freshness test** `e2e/src/fixtures.test.ts`: for each provider and each of its prompts, point the base-URL variables at a fake server replaying `fixtures.json`, run `extract` then `generateArchitecture` with all questions answered `YOU_DECIDE`, and assert the project parses with `Project` from `@cloudarchitect/domain`. On a `GenerationError`, fail with: `fixtures are out of date: re-record with pnpm --filter @cloudarchitect/e2e record`. Also assert the two Anthropic designs differ (different node id sets).
- [ ] **Step 2: Run it and see it fail** — no `fixtures.json` yet.
- [ ] **Step 3: Implement `record.ts`** — reads keys from the repo-root `.env` (same parsing as `eval/src/live.ts`), starts the server in record mode with `upstream` = the providers' real base URLs, runs each prompt through `extract` + `generateArchitecture` with `MODELS[provider]`, writes `fixtures.json` (`recordedAt`, `prompts`, `responses`), prints the total cost from the returned usage. Refuses to run unless all three keys are present.
- [ ] **Step 4: Ask the owner before recording** (about $0.30 of API budget), then run `pnpm --filter @cloudarchitect/e2e record`. Check `fixtures.json` contains no key: `grep -E 'sk-|AIza' e2e/fixtures/fixtures.json` prints nothing.
- [ ] **Step 5: Run the freshness test** — expected: PASS. It runs in `pnpm run ci` (no Docker).
- [ ] **Step 6: Commit** — `test(e2e): recorded provider fixtures and freshness test`

### Task 4: Stack helper and compose override

**Files:**

- Create: `e2e/compose.e2e.yaml`, `e2e/src/stack.ts`, `e2e/playwright.config.ts`
- Test: `e2e/src/stack.test.ts`

**Interfaces:**

- Produces, in `stack.ts`:
  - `type Setup = 'claude' | 'gemini' | 'all'`
  - `const FAKE_KEYS = { anthropic: 'sk-ant-e2e-fake-key-0000000000000000', openai: 'sk-e2e-fake-key-0000000000000000', google: 'AIza-e2e-fake-key-000000000000000' }`, `const REJECTED_KEY = 'sk-ant-e2e-rejected-key-00000000000'`
  - `envFor(setup: Setup): Record<string, string>` — `gemini`: `GEMINI_API_KEY` and `DAILY_BUDGET_MICRO_USD=20000` (below one Argon generation, above its extraction); `all`: `OPENAI_API_KEY`, `GEMINI_API_KEY`; `claude`: none (the key is typed in the wizard).
  - `composeArgs(opts: { setup: Setup; images: 'local' | 'ghcr'; version?: string; envFile: string }): string[]` — files `compose.yaml` + (`local`: `compose.build.yaml`) + `e2e/compose.e2e.yaml`, project name `ca-e2e-<setup>`.
  - `startStack(opts: { setup: Setup; images: 'local' | 'ghcr'; version?: string }): Promise<{ baseUrl: string; setupUrl: string; control: string; stop(): Promise<void>; logs(): Promise<string> }>` — writes the setup's env file to a temp dir, `docker compose up --detach --wait`, reads the setup link from the gateway log, waits for icons `ready` (120 s, error message names the icon download), returns `baseUrl` `http://localhost:8080`.
- `compose.e2e.yaml`: service `fake-ai` from `node:26-alpine` running `node /e2e/fake-ai/server.ts`, the `e2e/` folder mounted read-only, control port published as `127.0.0.1:8799`; `gateway` gets the three base-URL variables (`http://fake-ai:8790`, OpenAI with `/v1`), `depends_on: fake-ai`, and `env_file: !override` with only `${E2E_ENV_FILE}`.
- `playwright.config.ts`: `use: { channel: 'chrome', baseURL: 'http://localhost:8080', trace: 'retain-on-failure', screenshot: 'only-on-failure', acceptDownloads: true }`, `retries: 0`, `workers: 1`, project per setup selected by `E2E_SETUP`.

- [ ] **Step 1: Write the failing tests** in `stack.test.ts`, using `docker compose ... config --format json` (no containers started):
  - `never loads the repo-root .env` — for each setup, the resolved `gateway` service has no environment variable that `envFor(setup)` and the override do not set (compare the resolved `environment` keys against that list), even when a repo-root `.env` exists.
  - `points every provider at the fake server` — the three variables are set on `gateway`.
  - `publishes the control port on 127.0.0.1 only`.
  - `ghcr images use the given version` — `images: 'ghcr', version: '0.3.0'` resolves `ghcr.io/aliaksandr-liapin/cloudarchitect-lite/gateway:0.3.0`.
    These tests need the Docker CLI but no daemon work beyond `config`; mark the file so `pnpm run ci` skips it when `docker` is absent, and the CI e2e job runs it.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** `compose.e2e.yaml`, `stack.ts`, `playwright.config.ts`.
- [ ] **Step 4: Run the tests** — expected: PASS. Smoke the helper by hand: start the `claude` stack, open `setupUrl` in Chrome, stop it.
- [ ] **Step 5: Commit** — `test(e2e): docker stack helper and compose override`

### Task 5: Claude-only journey

**Files:**

- Create: `e2e/tests/claude.spec.ts`, `e2e/tests/helpers.ts`

**Interfaces:**

- Consumes: `startStack`, `FAKE_KEYS`, `REJECTED_KEY`, `PROMPTS`.
- Produces, in `helpers.ts`: `resetFake(control: string)`, `finishWizard(page, opts: { typeKeys?: Partial<Record<'anthropic'|'openai'|'google', string>>; enable?: string[] })` (walks Welcome → AI providers → Models → Limits → Review → **Finish setup** → **Open the editor**; `enable` are model labels to tick), `generate(page, prompt: string)` (fills the description, **Generate**, **Continue** in the questions dialog, waits for "New diagram generated"), `download(page, menuItem: 'PNG image' | 'SVG image' | 'JSON project'): Promise<Buffer>`.

`beforeAll` starts the `claude` stack (`images` from `E2E_IMAGES`, default `local`); `beforeEach` calls `resetFake`; `afterAll` writes `logs()` to the test output folder and stops the stack. Tests run in order in one browser context.

- [ ] **Step 1: Write the spec** with these tests, asserting visible text and roles (no CSS selectors):
  - `rejected key`: in the wizard type `REJECTED_KEY` into "Claude API key", **Check key** → "Key rejected" visible, **Next** disabled; replace with `FAKE_KEYS.anthropic`, **Check key** passes, **Next** enabled.
  - `setup`: finish the wizard; the editor shows the MyBlog example.
  - `generate`: `generate(page, PROMPTS.anthropic[0])`; the title shows the fixture's project name; the canvas has the fixture's node labels; after the export test, the "Findings (n)" heading equals the number of findings from `validateProject(project, awsCatalog)` on the exported JSON.
  - `export`: PNG starts with the PNG signature and is > 10 kB; SVG contains `<svg`; JSON parses with `Project`.
  - `versions`: `generate(page, PROMPTS.anthropic[1])`; the diagram differs; **Restore** on the newest kept version brings back the first design's node labels.
  - `import`: import the JSON exported earlier; its node labels are back.
  - `reload`: reload; the current design and the Versions count are unchanged.
- [ ] **Step 2: Run it** — `E2E_SETUP=claude pnpm e2e`; expected: PASS. Then break one assertion on purpose (for example expect a wrong node label), confirm it fails with a trace in `e2e/test-results/`, and revert.
- [ ] **Step 3: Commit** — `test(e2e): Claude-only journey`

### Task 6: Gemini-only journey and budget

**Files:**

- Create: `e2e/tests/gemini.spec.ts`

- [ ] **Step 1: Write the spec:**
  - `setup`: the AI providers step shows "Set by environment (.env)" for Gemini; the Models step offers only Gemini 4 Argon, already ticked; finish the wizard. _The "already ticked" behavior ships in 0.3.1 (PR #38, merging 17 Nov). Start this task after #38 is on `main`, or rebase onto it first._
  - `generate`: `generate(page, PROMPTS.google[0])`; node labels and findings as in Task 5.
  - `export JSON` and `reload`: as in Task 5.
  - `budget`: start another generation; the error "AI generation is paused: the daily or monthly spending limit is reached. Manual editing still works." is shown; dragging a node still works (its position changes).
- [ ] **Step 2: Run it** — `E2E_SETUP=gemini pnpm e2e`; expected: PASS.
- [ ] **Step 3: Commit** — `test(e2e): Gemini-only journey and budget limit`

### Task 7: All providers and 429 retries

**Files:**

- Create: `e2e/tests/all.spec.ts`

- [ ] **Step 1: Write the spec:**
  - `setup`: type `FAKE_KEYS.anthropic` in the wizard (OpenAI and Gemini come from `.env`); the Models step offers Claude Haiku 5.5, Claude Sonnet 5.5, GPT-6.1 Sol, Gemini 4 Argon; tick Haiku, Sol and Argon; finish.
  - For each provider (`anthropic` with Claude Haiku 5.5, `openai` with GPT-6.1 Sol, `google` with Gemini 4 Argon): `POST /fail-next { provider, status: 429 }`, open the editor's **AI model** section and press that model's select button (it reads "Selected" afterwards), `generate(page, PROMPTS[provider][0])`; the design arrives with no error message, and the fake server's `/log` shows a 429 followed by a 200 for that provider.
- [ ] **Step 2: Run it** — `E2E_SETUP=all pnpm e2e`; expected: PASS.
- [ ] **Step 3: Commit** — `test(e2e): all providers with 429 retries`

### Task 8: CI, release workflow and docs

**Files:**

- Modify: `.github/workflows/ci.yml` (new job), `.github/workflows/release.yml` (new job + `workflow_dispatch` input)
- Modify: `CONTRIBUTING.md`, `docs/operations/releasing.md`, `CHANGELOG.md` (Unreleased → Added), `e2e/README.md`

- [ ] **Step 1: CI job** `e2e` in `ci.yml`, name `Browser end-to-end (${{ matrix.setup }})`, matrix `setup: [claude, gemini, all]`, `timeout-minutes: 15`, runs on pull requests and pushes to `main` like the other jobs: checkout, pnpm + Node 26 as in `verify`, `pnpm install --frozen-lockfile`, buildx with the same GHA cache scopes as `containers` (`web`, `gateway`), `pnpm --filter @cloudarchitect/e2e test` (includes the stack tests), `E2E_SETUP=${{ matrix.setup }} pnpm e2e`. On failure, upload `e2e/test-results/` (traces, screenshots, compose logs) with `actions/upload-artifact`, `retention-days: 7`. Always `docker compose ... down --volumes`.
- [ ] **Step 2: Release job** `e2e` in `release.yml` after `publish`, same matrix with `E2E_IMAGES=ghcr` and `E2E_VERSION=${GITHUB_REF_NAME#v}`; add a `workflow_dispatch` input `version` so a manual run can test published images (for example `0.3.0`); the job runs on tags or when `version` is given.
- [ ] **Step 3: Docs** — CONTRIBUTING: how to run `pnpm e2e` locally (Docker running, `E2E_SETUP`), and that the repo-root `.env` is never used; releasing guide: the release `e2e` job and the manual run; `e2e/README.md`: architecture in five lines, when and how to re-record (cost about $0.30, needs the owner's OK); CHANGELOG Unreleased → Added: "A browser end-to-end test runs the app in Docker on every pull request, with recorded AI responses instead of paid calls."
- [ ] **Step 4: Verify** — `pnpm run ci` passes; push the branch and open the PR; all three `Browser end-to-end` jobs pass. Run the release workflow by hand with `version: 0.3.0`; all three jobs pass against the published images.
- [ ] **Step 5: Commit** — `ci: browser end-to-end job on PRs, main and releases`
- [ ] **Step 6: Hand-off to the owner** — after the first green run on `main`, add the three `Browser end-to-end (…)` checks to the branch protection's required checks (Claude cannot change branch protection).

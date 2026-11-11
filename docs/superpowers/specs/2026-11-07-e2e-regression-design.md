# Browser end-to-end regression test — design

**Date:** 2026-11-07 · **Status:** draft for the product owner's review

## Why

Every pull request runs unit tests, the offline eval harness and an install smoke test (`curl` checks against a fresh `docker compose up`). Nothing uses the app the way a user does. The last two user-visible bugs (the 0.2.1 setup wizard wording, and three Gemini-only wizard issues found on 2026-11-07) were both found by hand in new-user runs. The owner wants a check that runs the whole app after every change and catches hidden regressions before a merge.

## Goals

- A browser test that drives the real app through the main user journeys and fails the pull request when one breaks.
- Production-like: the same images, the same `compose.yaml`, the same nginx and gateway code paths. The only difference from production is where AI provider requests go.
- No paid API calls in the regression run.

## Non-goals

- Design quality. The paid live eval (`live-eval.yml`) stays the separate, opt-in check for that.
- Browsers other than Chrome.
- The GitHub Pages demo and the README screenshots (`pnpm screenshots` stays as is).
- Load or performance testing.

## Anti-goals (a failure even if it technically works)

- A test mode inside the app: a flag, branch or stub in gateway or web code that only tests use. The tested code must be the shipped code.
- Real provider calls or spend in CI.
- A flaky check. A blocking check that fails at random teaches everyone to re-run and ignore it.
- A slow check: the whole job should finish in about 10 minutes.

## Decisions (product owner)

1. **Fake providers outside the app (option A).** The gateway's provider requests go to a fake server through environment variables, set only in the test's compose file. The Anthropic, OpenAI and Gemini SDKs already read `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` and `GOOGLE_GEMINI_BASE_URL`, so generation needs no code change.
2. **When:** every pull request as a **required, blocking** check, and every push to `main`.
3. **Journeys:** for each of three provider setups (Claude only, Gemini only, all three keys): setup wizard → generate (clarifying questions, then the design) → findings → export PNG, SVG and JSON → import JSON → restore a version → reload and confirm the design is still there.
4. **Failures in scope:** a 429 that is retried and then succeeds, a rejected key, and the daily budget limit.
5. **Fixtures are recorded from the real APIs once** and committed; a command re-records them. Recording costs about $0.20 per run and only happens when someone runs that command.

## How it works

### Stack

`compose.e2e.yaml`, used with `compose.yaml`, adds:

- **`fake-ai`**: a small Node HTTP server (new workspace package `e2e/`) that answers the provider endpoints the app uses:
  - Anthropic `POST /v1/messages` (streaming, server-sent events) and `GET /v1/models`,
  - OpenAI `POST /v1/responses` (the Responses API, streaming, as `packages/generator/src/openai.ts` uses) and `GET /v1/models`,
  - Gemini `POST /v1beta/models/{model}:streamGenerateContent` and `GET /v1beta/models`.
    It replays the committed fixtures byte for byte. Fixtures are selected by provider and request kind (extraction or generation), not by prompt text; where a provider has several generation fixtures, they play in order.
- **Gateway environment:** the three base-URL variables pointing at `http://fake-ai:<port>`. Keys are fake values that exist only in the test.

Web and gateway images:

- **Pull requests and `main`:** built from `infra/docker/*.Dockerfile`, the same files the release workflow uses.
- **Release tags:** the same test against the images just published to GHCR, added to `release.yml` after the existing smoke step. The workflow also takes a manual run with an image tag input, so the GHCR path can be checked against the published `0.3.0` images before the next real tag. _(Owner agreed to the release-tag run in the playback; the manual input is Claude's call.)_

The AWS icon pack is downloaded for real on first start, as in production and in the install smoke test today.

### Test control

The fake server has a control endpoint (for example `POST /__control`) published only to `127.0.0.1` on the CI runner, never to the containers' users. The test runner uses it to set up the next response: "replay normally", "return 429 once, then replay", "reject key X". The control state resets between tests.

### Gap to close: key check

The setup wizard's **Check key** button calls hardcoded provider URLs (`keyCheckRequest` in `apps/gateway/src/setup.ts`), so it would bypass the fake server. Change it to honor the same three base-URL variables as the SDKs, falling back to today's URLs. This is a normal production behavior (anyone behind a proxy needs it), not a test switch, and it gets unit tests. Document the three variables in `.env.example` and the installation guide as advanced settings.

### Test runner

Playwright (`@playwright/test`) with Chrome, in the `e2e/` package. One spec file per journey; the three provider setups run as separate CI jobs in a matrix, so they run in parallel and a failure names the setup.

Each job:

1. Starts the stack from an empty data volume and reads the setup link from the gateway log, as the README tells users to.
2. Runs the journeys for its provider setup.
3. On failure, uploads Playwright's trace and screenshots plus `docker compose logs` as workflow artifacts (kept 7 days). The logs never contain keys; the keys are fake anyway.

### Provider setups

| Setup       | How the key gets in                                  | Why                                                                    |
| ----------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Claude only | typed into the wizard, **Check key** passes          | the most common path, and the one the README shows                     |
| Gemini only | `.env` (`GEMINI_API_KEY`)                            | the environment-key path, and the setup where the 2026-11-07 bugs were |
| All three   | Anthropic in the wizard, OpenAI and Gemini in `.env` | mixed sources, the model choice across providers                       |

### Which journeys run in which setup

_Claude's call, to keep each job near the time budget while every provider adapter and every key source is exercised:_

| Job         | Journeys                                                                                                             | Failure tests                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude only | all: wizard, generate, findings, export, import, versions, reload                                                    | rejected key (typed in the wizard)                                                                                                                                |
| Gemini only | wizard, generate, findings, export JSON, reload                                                                      | budget (daily limit set in `.env`, below one Gemini 4 Argon generation; it lives here because the Claude-only job needs two generations for the versions journey) |
| All three   | wizard (models offered for all three providers), then one generation per provider, switching the model in the editor | 429 once per provider (the retry code differs per SDK: `maxRetries: 2` for Anthropic and OpenAI, `retryOptions` for Gemini)                                       |

### Journeys and what each asserts

- **Setup wizard:** the steps, the offered models per setup (only providers with a key), finishing setup, then "Open the editor".
- **Generate:** type a description, answer the clarifying questions, wait for the design; the canvas shows the nodes from the fixture, the progress status passes through its steps, the findings panel matches the validator's output for that fixture.
- **Export:** PNG, SVG and JSON downloads succeed and are non-empty; the JSON parses against the project schema.
- **Import JSON:** importing the exported file restores the same diagram.
- **Versions:** after a second generation with a different design, restoring the first version brings its diagram back. Anthropic has two recorded generation fixtures (two different prompts); the fake server plays them in order, so the two designs differ. _(Claude's call; other providers need one.)_
- **Reload:** after a page reload the current design and its versions are still there (IndexedDB).
- **429:** the fake server answers 429 once (with `retry-after: 0`; Gemini's SDK waits about 0.5 s regardless), then the design arrives; no error is shown.
- **Rejected key:** in the wizard, **Check key** with a key the fake server rejects shows the invalid-key message, and Next stays disabled for that provider.
- **Budget:** with a daily budget below the cost of one generation (cost comes from the fixture's token counts and the price table, so it is deterministic), the first generation is allowed (the gateway checks `spent < budget` before a call) and the second shows the budget message; manual editing still works.

### Recording fixtures

`pnpm --filter @cloudarchitect/e2e record` (needs real keys in the repo-root `.env`) sends one fixed prompt per provider (two for Anthropic, for the versions journey) through the real generator, with the cheapest listed model per provider, and saves each raw HTTP response stream, with headers that matter (content type, request ids redacted) and no keys. Fixtures live in `e2e/fixtures/`. The README of the package says when to re-record: after an SDK major upgrade, a provider API change, or a change to the output schema that the fixtures no longer satisfy.

## Constraints

- Node 26 and pnpm as in the rest of the repo; GitHub Actions pinned by SHA (the repo enforces it).
- No secrets in the CI job: the fake keys are constants in the test.
- `pnpm run ci` stays as fast as today; the browser test is its own script (`pnpm e2e`) and its own workflow job, runnable locally with Docker (Rancher Desktop or Docker Desktop).
- Branch protection: the owner adds the new job names to the required checks after the first green run on `main` (the auto-mode classifier blocks Claude from changing branch protection).

## Left to the builder

- The fake server's exact routing and the fixture file format.
- Playwright configuration (timeouts, retries; prefer zero retries so flakiness is visible, and fix causes instead).
- Whether the three setups share one compose project per job or start fresh per spec; each job starts from an empty volume either way.
- How the budget test sets the limit (the wizard's field, or `DAILY_BUDGET_MICRO_USD` in `.env`).

# Release 0.3: Claude vs GPT vs Gemini — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can generate with Claude, OpenAI or Gemini models using whichever keys they have, and the README publishes one measured benchmark of all six models with a three-provider blind review panel.

**Architecture:** One `LlmClient` adapter per provider behind the existing interface (`packages/generator/src/llm.ts`); each `ModelOption` names its provider, and the gateway picks the client and key by provider. Extraction uses the economical model of the selected model's provider. The eval gets multi-provider live runs and a scripted blind-review panel; measured numbers go into `MODEL_OPTIONS`.

**Tech Stack:** TypeScript, Zod 4, `@anthropic-ai/sdk` 1.x (existing), `openai` 7.x, `@google/genai` 2.x, Hono, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-multi-provider-ai-design.md` (approved 2026-11-04)

## Global Constraints

- Everything in English. Existing tests stay green; `pnpm run ci` passes after every task.
- New runtime dependencies: only `openai` and `@google/genai` (in `packages/generator`).
- Unit tests never call a real provider. Adapters are tested against hand-written responses (fake SDK client or `fetch`).
- Keys are never logged, never returned by any endpoint, never sent anywhere but their own provider, never in eval results or screenshots. Do not print keys; do not read `.env` except through `process.loadEnvFile`.
- Paid runs: every live call against a provider is approved by the product owner in chat first and capped with `--max-usd`. Budget for 0.3 in total about $9–12, at most about $5 per key (each key is hard-capped at $10 by the owner).
- Existing ids `haiku` and `sonnet`, saved 0.2 settings and saved browser choices keep working without re-running setup.
- One operation never mixes providers.
- Model ids and prices (from the spec, checked 2026-11-04; per million tokens):

  | Choice id           | Provider    | API model               | Input    | Cached input | Output | Label                                                    |
  | ------------------- | ----------- | ----------------------- | -------- | ------------ | ------ | -------------------------------------------------------- |
  | `haiku`             | `anthropic` | `claude-haiku-5-5`      | existing |              |        | Claude Haiku 5.5                                         |
  | `sonnet`            | `anthropic` | `claude-sonnet-5-5`     | existing |              |        | Claude Sonnet 5.5                                        |
  | `gpt-luna`          | `openai`    | `gpt-6-luna`            | 0.10     | 0.01         | 0.50   | GPT-6 Luna                                               |
  | `gpt-sol`           | `openai`    | `gpt-6.1-sol`           | 2.00     | 0.10         | 10.00  | GPT-6.1 Sol                                              |
  | `gemini-flash-lite` | `google`    | `gemini-3.5-flash-lite` | 0.30     | 0.03         | 2.50   | Gemini 3.5 Flash-Lite                                    |
  | `gemini-argon`      | `google`    | `gemini-4-argon`        | 4.00     | 0.20         | 20.00  | Gemini 4 Argon (December price; $2/$10 until 2026-11-30) |

  Economical (extraction) model per provider: `anthropic` → `claude-haiku-5-5`, `openai` → `gpt-6-luna`, `google` → `gemini-3.5-flash-lite`. Price source URLs: `https://developers.openai.com/api/docs/pricing`, `https://aistudio.google.com/docs/pricing` (2026-11-04).

- Env vars and setting keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`. Environment variables still win over saved settings.

## Review Focus

1. **An install upgraded from 0.2** (settings with only `ANTHROPIC_API_KEY`, `AI_MODELS=haiku`, and a browser that saved `haiku`) starts without errors and generates as before. Test in Task 4.
2. **A model whose provider key is missing or later removed** is dropped from the enabled list at startup instead of failing config; a request for it answers `setup_required`, and the editor shows "Add a key in setup". Tests in Tasks 4 and 5.
3. **OpenAI strict mode returns `null` for optional fields**: the adapter turns them back into absent fields so Zod accepts them, while fields that are required but nullable (`containerId: null` for external nodes) keep `null`. Test in Task 2.
4. **A provider error mid-operation** (401, 429, network, abort) maps to `provider_error` 502 or `client_closed`, never hangs, and any spend already reported is still counted. An error message that contains the key never reaches the log. Tests in Tasks 2, 3 and 4.
5. **Spending limits count all providers together**: spend from an OpenAI call and a Gemini call adds to the same daily and monthly counters and blocks the next call from any provider at the limit. Test in Task 4.

---

### Task 1: Models, providers and prices

**Files:**

- Modify: `packages/domain/src/models.ts`, `packages/generator/src/prices.ts`, `packages/generator/src/extract.ts`, `packages/generator/src/generate.ts` (only where `EXTRACTION_MODEL` is used)
- Test: `packages/domain/src/models.test.ts` (create if missing), `packages/generator/src/prices.test.ts`, `packages/generator/src/extract.test.ts`

**Interfaces:**

- Produces:
  - `type Provider = 'anthropic' | 'openai' | 'google'`; `PROVIDERS: readonly Provider[]` (that order).
  - `ModelChoice = z.enum(['haiku','sonnet','gpt-luna','gpt-sol','gemini-flash-lite','gemini-argon'])`.
  - `ModelOption { id; provider: Provider; model: string; label; summary; repairTurns: number; benchmark?: ModelBenchmark }`. New options: `repairTurns` 1 for economical, 0 for best quality (same as Claude).
  - `ModelBenchmark`: harness fields unchanged and required; `blindMedianScore`, `noCriticalDefectRate`, `majorDefects` become optional.
  - `listedModels(): ModelOption[]` — options that have a `benchmark` (a model with no run is not shown, spec §6).
  - `PROVIDER_LABEL: Record<Provider, string>` = `{ anthropic: 'Claude', openai: 'OpenAI', google: 'Gemini' }`.
  - In generator: `PRICES` gains the four API models above; `extractionModel(provider: Provider): string`; `EXTRACTION_MODEL` is removed.
  - `extract(llm, input, model: string)` — new third parameter, the extraction model id.

- [ ] **Step 1: Tests.** `models.test.ts`: every `ModelChoice` has exactly one option; `modelOption('gpt-sol').provider === 'openai'` and `.model === 'gpt-6.1-sol'`; `listedModels().map(o => o.id)` equals `['haiku','sonnet']` (new models have no benchmark yet). `prices.test.ts`: `costMicroUsd('gpt-6-luna', {input:1_000_000,output:0,cacheWrite:0,cacheRead:0}) === 100_000`; `costMicroUsd('gemini-4-argon', {input:0,output:1_000_000,cacheWrite:0,cacheRead:0}) === 20_000_000`; `extractionModel('google') === 'gemini-3.5-flash-lite'`. `extract.test.ts`: the request sent to the fake client uses the `model` argument.
- [ ] **Step 2:** Run `pnpm --filter @cloudarchitect/domain --filter @cloudarchitect/generator test`; expect FAIL.
- [ ] **Step 3:** Implement. Update every caller of `extract` (gateway `generate.ts`, `eval/src/live.ts`, `tools/record-generation.ts`) to pass `extractionModel(modelOption(choice).provider)`. Every place that renders `MODEL_OPTIONS` (wizard, editor panel, gateway `/api/models` `options`) switches to `listedModels()` in this task so nothing unmeasured shows.
- [ ] **Step 4:** `pnpm run ci` passes.
- [ ] **Step 5:** Commit `feat(domain): provider-aware model options and prices`.

### Task 2: OpenAI adapter

**Files:**

- Create: `packages/generator/src/openai.ts`, `packages/generator/src/openai.test.ts`
- Modify: `packages/generator/package.json` (add `openai`), `packages/generator/src/index.ts`

**Interfaces:**

- Consumes: `LlmClient`, `LlmRequest`, `TokenUsage` (llm.ts); `jsonOutputFormat(schema)` returns `{ type: 'json_schema', schema }` and is what `req.format` holds.
- Produces: `openaiClient(apiKey: string, sdk?: OpenAIish): LlmClient`; `strictSchema(schema: JsonSchema): JsonSchema`; `restoreOptional(value: unknown, original: JsonSchema): unknown`.

Use the Responses API through the official SDK. Before writing code, confirm in the installed `openai` package types: the structured-output request field (`text.format` with `type: 'json_schema'`, `name`, `strict: true`, `schema`), `reasoning.effort`, `max_output_tokens`, `instructions` for the system prompt, streaming or long-timeout options, `signal`, and the usage field names (`input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`). Record anything that differs in the task report.

- [ ] **Step 1: Tests** (fake SDK object, no network):
  - `strictSchema`: every object gets `additionalProperties: false` and lists all properties in `required`; a property that was not required becomes `anyOf: [<original>, {type:'null'}]` (or adds `'null'` to `type`); `$defs`/`$ref` are walked.
  - `restoreOptional`: `{a: null}` with `a` optional in the original → `{}`; `{containerId: null}` where `containerId` is required and nullable in the original → unchanged; nested arrays of objects are handled.
  - Request mapping: `system` → instructions, `messages` → input, `maxTokens` → `max_output_tokens`, `effort` `'low'|'medium'|'high'` → `reasoning.effort` same value, format → strict json_schema built from `strictSchema(req.format.schema)`.
  - Response mapping: text is `restoreOptional`-processed JSON re-serialized; usage `{input: input_tokens - cached, cacheRead: cached, cacheWrite: 0, output: output_tokens}`; `stopReason` from the response status (`'completed'` → `'end_turn'`, an incomplete with `max_output_tokens` → `'max_tokens'`).
  - Abort: an aborted `signal` rejects with the SDK's abort error (not a hang).
  - The thrown error for a 401 has no API key in its `message` (pass a key like `sk-test-SECRET` and assert `!message.includes('SECRET')`).
- [ ] **Step 2:** `pnpm --filter @cloudarchitect/generator test openai`; expect FAIL.
- [ ] **Step 3:** `pnpm --filter @cloudarchitect/generator add openai@^7`; implement.
- [ ] **Step 4:** Tests pass; `pnpm run ci` passes.
- [ ] **Step 5:** Commit `feat(generator): OpenAI adapter with strict-schema conversion`.

### Task 3: Gemini adapter

**Files:**

- Create: `packages/generator/src/google.ts`, `packages/generator/src/google.test.ts`
- Modify: `packages/generator/package.json` (add `@google/genai`), `packages/generator/src/index.ts`

**Interfaces:**

- Produces: `googleClient(apiKey: string, sdk?: GenAIish): LlmClient`; `geminiSchema(schema: JsonSchema): JsonSchema`.

Use `@google/genai` (`models.generateContentStream` or `generateContent`). Confirm in the installed package types: `config.systemInstruction`, `responseMimeType: 'application/json'`, `responseJsonSchema`, `maxOutputTokens`, `thinkingConfig` (level names), `abortSignal`, and `usageMetadata` (`promptTokenCount`, `cachedContentTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`). `geminiSchema` inlines `$ref`/`$defs` and removes keywords the API rejects (check the docs for the supported subset; keep `enum`). Effort mapping: `low` → the lowest thinking level, `high` → the highest, `medium` → the middle level if it exists, else the highest.

- [ ] **Step 1: Tests:** `geminiSchema` output has no `$ref` and keeps every `enum`; request mapping (system, messages with roles `user`/`model`, max tokens, thinking level per effort, JSON schema); usage `{input: prompt - cached, cacheRead: cached, cacheWrite: 0, output: candidates + thoughts}`; finish reason `MAX_TOKENS` → `'max_tokens'`, `STOP` → `'end_turn'`; abort rejects; an invalid-key error message does not contain the key.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** `pnpm --filter @cloudarchitect/generator add @google/genai@^2`; implement.
- [ ] **Step 4:** Tests pass; `pnpm run ci` passes.
- [ ] **Step 5:** Commit `feat(generator): Gemini adapter`.

### Task 4: Gateway — keys, availability and provider routing

**Files:**

- Modify: `apps/gateway/src/config.ts`, `apps/gateway/src/app.ts`, `apps/gateway/src/generate.ts`, `apps/gateway/src/setup.ts`, `apps/gateway/src/node.ts` (if it wires the client), `.env.example`
- Test: `apps/gateway/src/config.test.ts`, `apps/gateway/src/app.test.ts`, `apps/gateway/src/setup.test.ts`, `apps/gateway/src/generate.test.ts` (use the files that exist)

**Interfaces:**

- Consumes: `openaiClient`, `googleClient`, `anthropicClient`; `modelOption`, `listedModels`, `Provider`, `PROVIDERS`, `extractionModel`.
- Produces:
  - `Config` gains `GEMINI_API_KEY`; `SETTING_KEYS` gains `OPENAI_API_KEY`, `GEMINI_API_KEY`.
  - `providerKey(config, provider): string | undefined`; `effectiveModels(config): { enabled: ModelChoice[]; defaultModel: ModelChoice | undefined }` — `AI_MODELS` filtered to models whose provider has a key; default is `DEFAULT_MODEL` if still enabled, else the first enabled.
  - `Deps.llm?: (provider: Provider, apiKey: string) => LlmClient` (default picks the adapter).
  - `GET /api/models` → `{ defaultModel, enabled, options: listedModels(), available: Record<ModelChoice, boolean> }` (available = provider has a key).
  - Setup: `verifyKey(provider, apiKey): Promise<KeyCheck>` with read-only calls — Anthropic as today; OpenAI `GET https://api.openai.com/v1/models` with `Authorization: Bearer`; Gemini `GET https://generativelanguage.googleapis.com/v1beta/models` with `x-goog-api-key`. 401/403 → `invalid` (Gemini also 400 with `API_KEY_INVALID`), other failures → `unreachable`. `POST /api/setup/verify-key` body `{ code, provider, apiKey }`.
  - `status()` gains `providers: Record<Provider, 'environment' | 'saved' | 'none'>` (replaces `keyFromEnvironment`; keep `keyFromEnvironment` for one release as `providers.anthropic === 'environment'`).
  - `SetupInput.apiKeys?: Partial<Record<Provider, string>>` replaces `apiKey` (accept the old `apiKey` as Anthropic for compatibility). Completion requires at least one provider with a key after the update; each newly entered key is verified; a saved key is kept unless a new one is entered; `models` may only contain models whose provider has a key.
- [ ] **Step 1: Tests:**
  - 0.2 upgrade (Review Focus 1): settings `{ANTHROPIC_API_KEY, AI_MODELS:'haiku', DEFAULT_MODEL:'haiku', setupCompletedAt}` → config loads, `effectiveModels` = `{enabled:['haiku'], defaultModel:'haiku'}`, generate works with a fake Anthropic client.
  - Missing key (Review Focus 2): `AI_MODELS='haiku,gpt-luna'`, only Anthropic key → enabled `['haiku']`; request with `model:'gpt-luna'` → 503 `setup_required`; with `DEFAULT_MODEL='gpt-luna'` → default falls back to `haiku`.
  - Routing: a `gpt-sol` generate calls the fake factory with `('openai', <key>)` for both the extraction call (model `gpt-6-luna`) and the generation call (model `gpt-6.1-sol`); no Anthropic call happens.
  - Shared limits (Review Focus 5): spend recorded by an OpenAI call then a Gemini call reaches `DAILY_BUDGET_MICRO_USD` → the next request for any model is 503 `ai_unavailable`.
  - Provider error (Review Focus 4): the fake client throws an error whose message includes the key → 502 `provider_error`, and nothing passed to `log` contains the key.
  - Setup: verify-key per provider with fake `fetch`; complete with only `apiKeys.google` → saved as `GEMINI_API_KEY`; `/api/setup/status` and `/api/models` never contain any key value.
- [ ] **Step 2:** Run gateway tests; expect FAIL.
- [ ] **Step 3:** Implement. Precheck uses the chosen model's provider key; `op.tracked(deps.llm(provider, key))`.
- [ ] **Step 4:** `pnpm run ci` passes.
- [ ] **Step 5:** Commit `feat(gateway): keys and routing for Claude, OpenAI and Gemini`.

### Task 5: Setup wizard and editor

**Files:**

- Modify: `apps/web/src/SetupWizard.tsx`, `apps/web/src/models.tsx`, `apps/web/src/api.ts`, `apps/web/src/App.tsx` (model choice), `apps/web/src/styles.css`, `tools/screenshots.ts` and `tools/fixtures/*` (mocked `/api/models` and setup status)
- Test: `apps/web/src/*.test.ts(x)` next to the changed code

**Interfaces:**

- Consumes: `/api/models` with `available`; setup status `providers`; verify-key with `provider`; `PROVIDER_LABEL`, `listedModels()`.
- [ ] **Step 1: Tests:**
  - Wizard step 2 is titled **"AI providers"** with three cards (Claude, OpenAI, Gemini), each with a key field, **Check key**, a link to the provider's key page (`https://platform.claude.com/settings/keys`, `https://platform.openai.com/api-keys`, `https://aistudio.google.com/apikey`) and the result text (`✓ Key works`, `Key rejected`, `Could not reach <provider>`). A card for a key from the environment shows "Set by environment" and no field. **Next** is disabled until at least one provider has a working, saved or environment key.
  - Models step lists models grouped by provider, only for providers with a key, as one comparison table per provider; rows without a value show "Not yet measured".
  - Editor AI model panel groups by provider; a model whose provider has no key shows **"Add a key in setup"** instead of **Use**; a saved browser choice of `haiku` still selects Haiku.
  - Welcome and Review steps name the providers that have keys instead of only Anthropic.
- [ ] **Step 2:** Run web tests; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm run ci` passes; `pnpm screenshots` regenerates the setup and editor images; check them by eye.
- [ ] **Step 5:** Commit `feat(web): AI providers step and provider-grouped model choice`.

### Task 6: Multi-provider live eval

**Files:**

- Modify: `eval/src/live.ts`, `eval/src/gate.ts`, `.github/workflows/live-eval.yml`
- Test: `eval/src/gate.test.ts`

**Interfaces:**

- Consumes: provider clients, `modelOption`, `extractionModel`.
- Produces: `pnpm eval:live --models <ids>` accepts any `ModelChoice`; reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` from the environment or `.env`; a model whose key is missing is reported (`gpt-sol: OPENAI_API_KEY not set — skipped`) and skipped; `--max-usd` caps all providers together. `evaluateGate(summary, benchmarkCostUsd: number | undefined)` skips the cost ceiling when there is no benchmark yet.
- [ ] **Step 1: Tests:** `evaluateGate` with `undefined` cost passes a summary that meets the quality floors and lists no cost failure.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement.
- [ ] **Step 4:** Workflow: pull-request runs only when the PR has the `live-eval` label (`types: [labeled, synchronize, opened, reopened, ready_for_review]` and `contains(github.event.pull_request.labels.*.name, 'live-eval')`); manual dispatch unchanged; `OPENAI_API_KEY` and `GEMINI_API_KEY` passed as secrets; `models` input description lists the six ids; the $2.00 dispatch cap stays. Fork guard stays.
- [ ] **Step 5:** `pnpm run ci` passes. Commit `feat(eval): live eval for all providers; label-gated PR runs`.

### Task 7: Blind review panel script

**Files:**

- Create: `eval/src/review.ts`, `eval/src/packets.ts`, `eval/src/packets.test.ts`
- Modify: `eval/package.json` (script `review`), `docs/engineering/testing.md`

**Interfaces:**

- Consumes: live run directories `eval/results/live/<runId>/` (`records.json`, `outputs/<model>-<scenario>-<repeat>.project.json`), scenarios, `eval/reviews/phase2-gate-a-2026-10-18/packets/reviewer-instructions.md` and the rubric (copy both into the new review folder unchanged).
- Produces:
  - `buildPackets({ runs, pairs, seed }): { packets: Packet[]; key: Key }` — pairs each design with the same scenario's design from the same-tier Claude model (economical ↔ `haiku`, best ↔ `sonnet`; Claude pairs with each other as in Gate A), random A/B order from `seed`, three scenarios per packet. Packets contain the prompt, toggles, clarification answers and the two designs only: no model names, ids, providers or provider-specific formatting.
  - `pnpm --filter @cloudarchitect/eval review --runs <id,id,…> --max-usd <n> [--seed n]`: sends each packet to three reviewers — `claude-sonnet-5-5`, `gpt-6.1-sol`, `gemini-4-argon` — through the adapters with a Zod schema of the Gate A review JSON (`reviews[]` with `scenario`, `design`, `scores` of the 7 dimensions 0–3, `criticalDefect`, `defects[]`, `summary`; `preference[]`); reviewer spend counts toward `--max-usd`; writes `eval/reviews/phase3-<date>/{packets/, key.json, review-<reviewer>-g<N>.json, summary.json}`.
  - Aggregation (same as Gate A): score of a design = mean of the 7 dimensions; per design the published score is the **median of the three reviewers**; per model the blind score is the median over its designs; also critical-defect rate, major-defect count and pairwise preference counts.
- [ ] **Step 1: Tests (no network):** packets contain none of the strings `haiku`, `sonnet`, `gpt`, `gemini`, `claude`, `openai`, `google`, `anthropic`; the key maps every A/B back to a model; the same seed gives the same packets; the median-of-three aggregation on a fixed example gives the expected per-model scores.
- [ ] **Step 2–4:** Fail, implement, pass; `pnpm run ci` passes.
- [ ] **Step 5:** Commit `feat(eval): scripted three-provider blind review`.

### Task 8: Contract smoke run (paid — owner approval first)

- [ ] **Step 1:** Ask the product owner to approve: one scenario (`myblog`), one run each of `gpt-luna`, `gpt-sol`, `gemini-flash-lite`, `gemini-argon`, `--max-usd 0.40`.
- [ ] **Step 2:** `pnpm eval:live --models gpt-luna,gpt-sol,gemini-flash-lite,gemini-argon --scenarios myblog --max-usd 0.40`. Expected: each model schema-valid. If a provider rejects the schema or a parameter, fix the adapter (unit test first) and re-run only that model after a new approval.
- [ ] **Step 3:** Record spend and any adapter fix in the task report. Commit fixes as `fix(generator): …`.

### Task 9: Benchmark all six models (paid — owner approval first)

**Files:** `packages/domain/src/models.ts`, `docs/product/phase3-provider-benchmark.md`, `eval/reviews/phase3-<date>/`

- [ ] **Step 1:** Ask approval for the live runs, with the estimate: economical models `--repeats 2` over all 22 scenarios, best-quality models `--repeats 1` over the 15 base scenarios; caps `--max-usd 1.50` per model for economical, `1.00` for best quality. Run the Gemini models before 2026-12-01.
- [ ] **Step 2:** Run the six live runs (Claude Haiku and Sonnet re-measured on the same code, within a day or two of the others).
- [ ] **Step 3:** Ask approval for the review panel (estimate from the packet count; about $5–7 total across the three keys), then run `review` with all six run ids.
- [ ] **Step 4:** Fill `benchmark` for each model that meets the Gate A bar (`LIVE_GATE` floors in `eval/src/gate.ts`; blind median ≥ 2.0; no critical defect in ≥ 90% of reviewed scenarios), with `costPerOperationUsd` re-priced at the release-date price list (Argon at $4/$20). A model below the bar stays unlisted, and the report says why. Write each `summary` line comparing it with the others.
- [ ] **Step 5:** Add a test in `eval/src/gate.test.ts`: every option in `listedModels()` meets the `LIVE_GATE` floors and has `blindMedianScore ≥ 2.0` when present.
- [ ] **Step 6:** Write `docs/product/phase3-provider-benchmark.md`: method, panel, pairing, per-model table (runs, schema-valid, pass, blind median, critical-defect rate, major defects, cost per design, median latency), the three-provider agreement, limits (one design per scenario per variant; reviewers see no docs; prices and dates). Commit `docs(eval): Claude vs GPT vs Gemini benchmark`.

### Task 10: Docs and release 0.3.0

**Files:** `docs/adr/0014-multi-provider-ai.md` (new, extends ADR-0011), `docs/adr/README.md`, `docs/operations/installation.md`, `README.md`, `CHANGELOG.md`, `docs/product/roadmap.md`, all `package.json` versions and `compose.yaml` image tag → `0.3.0`, install links → `v0.3.0`, `.env.example`

- [ ] **Step 1:** ADR-0014: providers, per-provider adapters, price-matched tiers, extraction per provider, three-provider review panel.
- [ ] **Step 2:** Installation guide: keys for any of the three providers (links to each key page), the "AI providers" step, `.env` names, updated screenshots. README: requirements ("Docker and an API key from Anthropic, OpenAI or Google"), the benchmark table or link, the 0.3 hook. Roadmap: 0.3 released. CHANGELOG `[0.3.0]` with date, Added/Changed, upgrade note ("0.2 settings keep working; add more keys by re-running setup"), compare link.
- [ ] **Step 3:** `node tools/check-versions.ts` and `pnpm run ci` pass; `pnpm screenshots`.
- [ ] **Step 4:** Commit `docs: release 0.3.0`. Tagging and the GitHub release follow `docs/operations/releasing.md` and are done by the product owner.

## Owner steps

- Before Task 6's CI dispatch: add `OPENAI_API_KEY` and `GEMINI_API_KEY` as **GitHub Actions** secrets (Settings → Secrets and variables → Actions). Local runs read the keys from `.env`.
- Approve Task 8 and each part of Task 9 in chat.
- Merge the pull request, then tag `v0.3.0` per `docs/operations/releasing.md`.

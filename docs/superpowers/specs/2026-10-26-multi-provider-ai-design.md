# Multiple AI providers (Claude, OpenAI, Gemini) — design

Date: 2026-10-26, updated 2026-11-04 after the 0.2 release · Status: approved 2026-11-04 for release 0.3 · Scope: `packages/generator`, `packages/domain`, `apps/gateway`,
`apps/web` (setup wizard, AI model panel), `eval`

## Where this fits

Phase 3 was re-scoped on 2026-10-26 by the product owner:

- CloudArchitect Lite is a **free, open-source, self-hosted** tool. Each user brings their own AI key
  and pays their provider directly; the maintainer pays nothing to run it.
- The project is built in the open: the repository, its docs, tests and benchmarks are part of
  the product.
- On 2026-10-27 delivery moved to small public releases (`docs/product/roadmap.md` §2). This design
  is release **0.3** ("Claude vs GPT vs Gemini"), after the 0.2 public MVP (launch polish and
  PNG/SVG/JSON export). Review and Mermaid export follow in 0.4.
- Dropped: protecting a hosted owner key (free credits for strangers, owner budget cap
  and kill switch, BYOK direct browser calls, hosted Privacy Policy and Terms).

## Why

Today the tool only works with an Anthropic key. Supporting OpenAI and Gemini lets anyone with any of
the three common keys use it, and "compare Claude, GPT and Gemini on your own architecture" is a strong
launch hook. The code already routes every model call through one small interface (`LlmClient` in
`packages/generator/src/llm.ts`), so the change is mostly additive.

## What the product owner decided

1. **Providers at launch: Claude, OpenAI, Gemini.** Local models (Ollama) are a later stretch goal,
   because small local models are likely to fail the quality bar and make the tool look bad.
2. **As many providers as the user has keys for.** The setup wizard accepts a key for one, two or all
   three providers; the editor lists every model the user has a key for.
3. **Measured numbers only.** Each new model gets the same live eval and blind review Claude had, run
   with the maintainer's own OpenAI and Gemini keys (both created 2026-10-26, each behind a hard $10
   cap). Every paid run is approved by the product owner before it starts.
4. ~~Free credits stay in this project~~ Superseded: 0.2 removed free credits, the kill switch and the
   Cloudflare code (ADR-0013). What is left is the daily and monthly spending limits, which count all
   providers together.
5. **A three-provider review panel, and all six models re-measured together** (2026-10-27). See
   Goals §6.

## Goals

### 1. Provider layer

- One `LlmClient` implementation per provider: the existing Anthropic one, plus OpenAI and Gemini,
  each using the provider's official TypeScript SDK (`openai`, `@google/genai`) — my call, matching
  the Anthropic client.
- Each implementation supports what the generator relies on today: a system prompt, multi-turn
  messages, schema-constrained JSON output from the same Zod schemas, a max-token limit, a reasoning
  depth setting (`effort` low/medium/high mapped to the provider's equivalent), streaming or long
  timeouts so large outputs do not time out, cancellation via `AbortSignal`, and token usage reported
  in the existing `TokenUsage` shape (cached input counted where the provider reports it).
- Each provider's schema dialect differs (for example OpenAI strict mode requires every property to be
  listed as required, with optional fields expressed as nullable). The adapter converts the Zod schema
  to what the provider accepts, and the result is always re-validated with the original Zod schema by
  the existing `parseOutput`, so a provider can never return something the domain rejects.
- A failed or non-conforming answer behaves exactly as today (`GenerationError('schema_invalid')`,
  spend still counted, the existing repair turn applies).

### 2. Models and prices

- Each provider offers two models: a fast, economical one and a best-quality one. Claude keeps Haiku
  5.5 and Sonnet 5.5 with their existing ids `haiku` and `sonnet` (saved settings and browser choices
  keep working). OpenAI and Gemini models, checked against the official pricing pages on 2026-11-04
  (per million tokens, input / output). The best-quality tier is **price-matched to Claude Sonnet**
  rather than each provider's most expensive model, so the comparison is like for like and the
  benchmark fits the budget (product owner's call, 2026-11-04):

  | Tier         | Claude                   | OpenAI                      | Gemini                                                     |
  | ------------ | ------------------------ | --------------------------- | ---------------------------------------------------------- |
  | Economical   | Haiku 5.5, $0.10 / $0.50 | `gpt-6-luna`, $0.10 / $0.50 | `gemini-3.5-flash-lite`, $0.30 / $2.50                     |
  | Best quality | Sonnet 5.5, $2 / $10     | `gpt-6.1-sol`, $2 / $10     | `gemini-4-argon`, $2 / $10 until 2026-11-30, then $4 / $20 |

  Not chosen: `gpt-6-astra` ($10 / $50, OpenAI's flagship, about 5× Sonnet per design) and
  `gemini-3.1-pro-preview` (preview). The builder re-checks ids, structured-output support and prices
  on the day the adapters are written; any change is recorded in the plan.

- `PRICES` uses the price a user pays on the release date. Gemini 4 Argon's price doubles on
  2026-12-01, so the published cost per design uses the December price; measured token counts are
  re-priced if a price changes before release.
- `ModelOption` gains the real `provider` (`anthropic | openai | google`). `PRICES` gets an entry per
  new model, with the source URL and date, as today.
- The extraction step currently always uses Claude Haiku (`EXTRACTION_MODEL`). It moves to the
  economical model **of the selected provider**, so a user with only a Gemini key never needs Claude,
  and one operation never mixes providers.

### 3. Keys and configuration

- New settings and environment variables: `OPENAI_API_KEY` (already in the config schema, unused) and
  `GEMINI_API_KEY`, next to `ANTHROPIC_API_KEY`. The wizard may persist all three; environment
  variables still win over saved settings.
- A model is **available** when its provider has a key. `AI_MODELS` (the enabled models) may only
  contain available models; `DEFAULT_MODEL` must be one of them. A saved config that names a model
  whose key was removed starts up with that model dropped, not with an error — my call.
- Keys are never logged, never returned by any endpoint, and never sent anywhere but their own
  provider. `/api/models` reports per model whether it is available, never the key.

### 4. Setup wizard

- The "API key" step becomes **"AI providers"**: three cards (Claude, OpenAI, Gemini), each with a key
  field, a "Check key" button, a link to that provider's key page, and the result ("✓ Key works",
  rejected, unreachable). At least one working key is required to continue. A key supplied by an
  environment variable shows as "Set by environment" and cannot be edited, as today.
- Key checks use a read-only call per provider (list models), like the existing Anthropic check.
- The **Models** step lists the models of every provider with a working key, grouped by provider, with
  the comparison numbers; the user enables any of them and picks the default.
- Welcome and Review steps name the providers instead of only Anthropic. The **Limits** step is
  unchanged: the daily and monthly spending limits count spend across all providers together.
- Re-running setup to add or remove a provider key works the same way as today's re-run.

### 5. Editor

- The collapsed **AI model** panel lists all models grouped by provider, with measured quality, cost
  and typical wait. Models whose provider has no key show "Add a key in setup" instead of "Use".
- Generate (and later Review) uses the selected model end to end. The generation status hint ("usually
  about N s") uses the selected model's benchmark, as today.
- A model without benchmark numbers shows "Not yet measured" in each row; nothing is estimated.

### 6. Evaluation

- `pnpm eval:live --models …` accepts any model id and reads each provider's key from the environment
  or `.env`; a model whose key is missing is reported and skipped. The per-run spend cap
  (`--max-usd`) covers all providers together.
- The live-eval workflow accepts the new model ids on manual dispatch and receives `OPENAI_API_KEY` and
  `GEMINI_API_KEY` as secrets. Pull-request runs keep the current default (Claude Haiku only), so
  ordinary PRs do not spend on three providers.
- **One benchmark for all six models**, run on the same code within the same day or two, so the
  published numbers are comparable. Claude Haiku and Sonnet are re-measured too, because their Gate A
  numbers predate later fixes. Every model gets the same scenarios and repeats as the Claude Haiku Gate A
  run (all scenarios including toggle scenarios), scored by the harness.
- **Blind review by a three-provider panel.** Each design is scored against the PRD §14 rubric by
  three isolated reviewers: one Claude, one OpenAI and one Gemini model, each from the best-quality
  tier. The published blind score is the median of the three. Reviewers never see which model or
  provider produced a design: packets are stripped of model names, ids and provider-specific
  formatting.
- **Pairing**: each design is reviewed side by side with the same scenario's design from the Claude
  model in the same tier (economical with Haiku, best-quality with Sonnet), in random A/B order. Claude
  designs are paired with each other, as in Gate A.
- Review tooling is a repeatable script in `eval/` (packets in, rubric scores out), not hand-run
  sessions, so the benchmark can be re-run later. Reviewer calls count toward `--max-usd`.
- Budget (estimate from the Gate A run shape: economical models 22 scenarios × 2 repeats, best-quality
  models 15 base scenarios × 1, then the review panel): about $9–12 in total, at most about $5 on any
  one key, within the $10 caps (approved by the product owner, 2026-11-04). Each paid run is approved first and capped with `--max-usd`. Running the
  Gemini part before 2026-12-01 halves the Argon cost.
- **Pull requests stop spending by default:** the live eval runs on a pull request only with the
  `live-eval` label, or on manual dispatch (product owner's decision 2026-10-28). 0.3 changes the
  generator often, and each run costs money.
- The numbers go into `MODEL_OPTIONS` with a report `docs/product/phase3-provider-benchmark.md`
  (method, panel, per-model results, limits), linked from the README.
- **Partly measured models.** The blind-review fields of `ModelBenchmark` become optional. A model
  whose harness run is done but whose review is pending shows its harness numbers and "Not yet
  measured" for the review rows. A model with no run at all is not shown.
- **Quality bar**: every model must meet the Gate A thresholds (`docs/product/phase2-gate-a.md`) to
  appear in `MODEL_OPTIONS`; the bar is the same absolute bar for both tiers. Each model's one-line
  summary states how it compares with the others.

## Non-goals

- No local models (Ollama) in this project.
- No change to prompts beyond what a provider strictly needs; prompt tuning per provider is a later
  task, driven by eval results.
- No Review button yet (project 2).
- No mixing providers inside one operation.

## Anti-goals

- A provider shown with made-up or copied quality numbers.
- A key that leaves the user's machine for anything but its own provider, or appears in logs, errors,
  eval results or screenshots.
- Existing Claude-only installs breaking on upgrade: their saved settings, browser choices and project
  files keep working without re-running setup.

## Constraints

- Everything in English. Existing tests stay green.
- Unit tests never call a real provider: each adapter is tested against recorded or hand-written
  responses (request shape, schema conversion, usage mapping, error and abort handling).
- New runtime dependencies are limited to the two official SDKs.
- Live eval runs spend real money: each one is approved by the product owner first and capped with
  `--max-usd`.
- Docs updated: a new ADR (multi-provider, extending ADR-0011), the installation guide, README
  requirements and configuration, the CHANGELOG, and the roadmap.

## Builder-check answers (2026-10-27)

1. **Cross-provider blind review** — product owner's call: three-provider panel, median score, pairing
   against the same-tier Claude model, all six models re-measured together (Goals §6).
2. **Partly measured models and the quality bar** — my call: blind-review fields optional, shown as
   "Not yet measured"; one absolute Gate A bar for every model (Goals §6).
3. **Gemini- or OpenAI-only installs** — my call (updated 2026-11-04): the gateway's "AI available"
   check requires a key for the selected model's provider instead of `ANTHROPIC_API_KEY`; without one
   it answers `setup_required`. Spending limits count all providers together.

## Left to the builder

Final confirmation of the OpenAI and Gemini model ids, the effort mapping per provider, how schemas are converted,
the new model ids' naming, wizard card layout, and how cached-token usage maps per provider.

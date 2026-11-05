# 0.3 provider benchmark — Claude vs GPT vs Gemini

**Date:** 2026-11-05 · **Runner:** `pnpm eval:live` (results are local and git-ignored under `eval/results/live/`) · **Review panel:** `pnpm --filter @cloudarchitect/eval review` · **Reviews:** `eval/reviews/phase3-2026-11-05/`

Six models, two per provider, were measured on the same generator code on the same day: a live run scored by the eval harness, then a blind review of the designs by a panel of three AI reviewers, one from each provider. Four models meet the listing bar and are listed in the setup wizard and the editor; two are not listed.

## Models and tiers

Each provider has an economical model and a best-quality model. The tiers are matched by price class, not by name. Prices are per million tokens, checked 2026-11-04 (sources: the provider price pages linked in the [spec](../superpowers/specs/2026-10-26-multi-provider-ai-design.md)).

| Tier | Choice id | API model | Input | Output | Repair turns |
|---|---|---|---|---|---|
| Economical | `haiku` | `claude-haiku-5-5` | Anthropic list price | | 1 |
| Economical | `gpt-luna` | `gpt-6-luna` | $0.10 | $0.50 | 1 |
| Economical | `gemini-flash-lite` | `gemini-3.5-flash-lite` | $0.30 | $2.50 | 1 |
| Best quality | `sonnet` | `claude-sonnet-5-5` | Anthropic list price | | 0 |
| Best quality | `gpt-sol` | `gpt-6.1-sol` | $2.00 | $10.00 | 0 |
| Best quality | `gemini-argon` | `gemini-4-argon` | $4.00 (December) | $20.00 (December) | 0 |

One operation never mixes providers: the requirements-extraction call runs on the same provider's economical model (`claude-haiku-5-5`, `gpt-6-luna`, `gemini-3.5-flash-lite`), and the cost per generation below includes it.

## Method

### Live runs

- **Shape:** economical models ran all 22 eval scenarios (15 base + 7 toggle scenarios) × 2 repeats = 44 runs; best-quality models ran the 15 base scenarios × 1 repeat = 15 runs. This is the Gate A run shape ([phase2-gate-a.md](phase2-gate-a.md)). Claude Haiku and Sonnet were re-measured on the same code, because their Gate A numbers predate later generator fixes.
- **Scoring:** the eval harness checks every generated project: schema validity, required services, forbidden services and the validation rules. A run passes when all automated checks pass.
- **All failed checks were missing required services.** No run had an error-level rule finding, and no run used a forbidden service.

### Blind review

- **Scope (product owner's option A):** the 12 scenarios reviewed at Gate A, repeat 1 of every model, seed 1; 17 packets with 3 pairs each, 51 pairs in total.
  - Economical pairs: `gpt-luna` vs `haiku` and `gemini-flash-lite` vs `haiku` on all 12 scenarios.
  - Best-quality pairs: `gpt-sol` vs `sonnet` and `gemini-argon` vs `sonnet` on the 9 base scenarios among them; `haiku` vs `sonnet` on the same 9.
  - The 9 base scenarios: `brochure-site`, `claims-approval-workflow`, `fraud-model-serving`, `k8s-microservices`, `myblog`, `order-events`, `product-search`, `regulated-portal`, `saas-containers`. The 3 toggle scenarios: `nightly-reports-serverless`, `regulated-portal-security`, `saas-containers-multi-az`.
- **Panel:** three isolated reviewers from the best-quality tier, one per provider: `claude-sonnet-5-5`, `gpt-6.1-sol`, `gemini-4-argon`. Each reviewer gets every packet with the reviewer instructions and the PRD §14 rubric, copied unchanged from Gate A.
- **Pairing:** each design is reviewed side by side with the same scenario's design from the Claude model of the same tier (economical with Haiku, best quality with Sonnet), in random A/B order. Claude designs are paired with each other (Haiku vs Sonnet), as at Gate A.
- **Blinding:** a packet holds the user prompt, the selected toggles, the clarification answers and the two designs. Model names, ids, providers and provider-specific formatting are stripped. The unblinding key is `key.json`.
- **Scoring:** the score of a design is the mean of the 7 rubric dimensions (0–3). The published score of a design is the **median of the three reviewers**; a design that appears in several packets (Haiku and Sonnet designs) is averaged over them. A model's blind score is the median over its designs. A design has a critical defect when a majority of reviewers report one in a packet, and, for a design that appears in several packets, when more than half of those packets flag it that way. Its major-defect count is the median over reviewers in each packet, averaged over the packets the design appears in and rounded. A pair's preference is the majority of reviewers.

## Results

| Model | Runs | Schema-valid | Pass | Blind median (0–3) | No critical defect | Major defects | Designs reviewed | Cost / generation | Median latency | Listed |
|---|---|---|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | 44 | 100% | 86.4% | 2.52 | 100% (12/12) | 8 | 12 | $0.0071 | 53 s | yes |
| GPT-6 Luna | 44 | 100% | 75.0% | 2.14 | 83.3% (10/12) | 21 | 12 | $0.0039 | 62 s | no |
| Gemini 3.5 Flash-Lite | 44 | 100% | 65.9% | 1.64 | 66.7% (8/12) | 30 | 12 | $0.0147 | 12 s | no |
| Claude Sonnet 5.5 | 15 | 100% | 100% | 2.55 | 100% (9/9) | 9 | 9 | $0.0490 | 30 s | yes |
| GPT-6.1 Sol | 15 | 100% | 86.7% | 2.86 | 100% (9/9) | 1 | 9 | $0.0440 | 65 s | yes |
| Gemini 4 Argon | 15 | 100% | 100% | 2.43 | 88.9% (8/9) | 11 | 9 | $0.1197 | 50 s | yes |

Run ids: Haiku `2026-11-05T07-56-51-552Z`, Luna `2026-11-05T07-45-53-363Z`, Flash-Lite `2026-11-05T07-43-39-110Z`, Sonnet `2026-11-05T08-14-50-217Z`, Sol `2026-11-05T08-10-20-537Z`, Argon `2026-11-05T08-06-49-090Z`.

- Cost per generation is the mean over the live runs at the price list in force on the release date. Argon is priced at the December price ($4/$20); at the November price ($2/$10) it is about half.
- Designs with a critical defect (rule above): Argon `product-search`; Luna `myblog`, `regulated-portal`; Flash-Lite `nightly-reports-serverless`, `product-search`, `regulated-portal`, `regulated-portal-security`.
- Sonnet `fraud-model-serving` appears in three packets. In g11 two of three reviewers (OpenAI and Gemini) reported a critical defect; in g4 and g5 none did. It is flagged in one of three packets, so it is not counted, and Sonnet's no-critical-defect rate is 100%.
- Economical and best-quality rates cover different scenario sets (12 vs 9 reviewed scenarios; 22 vs 15 live scenarios), so compare models within a tier.

### Pairwise preferences

Majority of the three reviewers; no ties.

| Pair | Result |
|---|---|
| Haiku vs Flash-Lite | Haiku 12 of 12 |
| Haiku vs Luna | Haiku 11 of 12, Luna 1 |
| Sol vs Sonnet | Sol 9 of 9 |
| Sonnet vs Argon | Sonnet 5 of 9, Argon 4 |
| Sonnet vs Haiku | Sonnet 6 of 9, Haiku 3 |

### Agreement between reviewers

Preferences per reviewer, from the saved review files. The Claude reviewer's answers for packets g10, g14 and g16 covered only one scenario each, so its column covers 14 of the 17 packets.

| Pair | Claude reviewer | OpenAI reviewer | Gemini reviewer |
|---|---|---|---|
| Haiku vs Flash-Lite | Haiku 8–0 | Haiku 12–0 | Haiku 12–0 |
| Haiku vs Luna | Haiku 10–1 | Haiku 8–4 | Haiku 11–1 |
| Sol vs Sonnet | Sol 4–3, 1 tie | Sol 9–0 | Sol 9–0 |
| Sonnet vs Argon | Sonnet 5–3 | Sonnet 5–4 | Argon 5–4 |
| Sonnet vs Haiku | Sonnet 4–3 | Sonnet 6–3 | Sonnet 5–4 |

All three reviewers agree on the direction of the economical pairs and of Sonnet vs Haiku. Sol vs Sonnet is unanimous for the OpenAI and Gemini reviewers and close for the Claude reviewer. Sonnet vs Argon is split. On the pair that best matches its own provider, each reviewer leaned toward its own provider's model more than the other two reviewers did (the Claude reviewer on Sol vs Sonnet, the OpenAI reviewer on Haiku vs Luna, the Gemini reviewer on Sonnet vs Argon). This does not hold for every pair: on Sonnet vs Haiku the Claude reviewer favoured Haiku as often as the OpenAI reviewer did. The majority and median of three limit the effect of one reviewer.

## Listing bar

**Product owner's decision, 2026-11-05 (replaces the Gate A bar for 0.3):** a model is listed when

- live pass rate ≥ 0.85,
- no critical defect in ≥ 85% of its reviewed designs,
- blind median ≥ 2.0,

with a schema-valid rate of 100%. The bar is the same for both tiers. It is `LISTING_BAR` in `eval/src/gate.ts`, and a unit test checks every listed model against it. The live regression gate (`LIVE_GATE.passRate`) was lowered from 0.90 to 0.85 to match.

Gate A required a pass rate ≥ 0.90 and no critical defect in ≥ 90% of reviewed scenarios. Under that bar Haiku (86.4%) and Sol (86.7%) would fail on the pass rate and Argon (88.9%) on critical defects, which would leave only Sonnet. For scale: one run is 2.3 points of the pass rate at 44 runs and 6.7 points at 15 runs.

| Model | Pass ≥ 0.85 | No critical ≥ 0.85 | Blind ≥ 2.0 | Listed |
|---|---|---|---|---|
| Claude Haiku 5.5 | 0.864 ✓ | 1.000 ✓ | 2.52 ✓ | yes |
| Claude Sonnet 5.5 | 1.000 ✓ | 1.000 ✓ | 2.55 ✓ | yes |
| GPT-6.1 Sol | 0.867 ✓ | 1.000 ✓ | 2.86 ✓ | yes |
| Gemini 4 Argon | 1.000 ✓ | 0.889 ✓ | 2.43 ✓ | yes |
| GPT-6 Luna | 0.750 ✗ | 0.833 ✗ | 2.14 ✓ | no |
| Gemini 3.5 Flash-Lite | 0.659 ✗ | 0.667 ✗ | 1.64 ✗ | no |

- **GPT-6 Luna** is the cheapest model measured ($0.0039 per generation) but missed required services in 11 of 44 runs and had a critical defect in 2 of 12 reviewed designs.
- **Gemini 3.5 Flash-Lite** is the fastest (12 s) but missed required services in 15 of 44 runs, had a critical defect in 4 of 12 designs and 30 major defects, and scored 1.64.

Unlisted models keep no `benchmark` in `MODEL_OPTIONS`, so the setup wizard and the editor do not offer them. They can be re-measured after a generator or model change.

## Comparison of the listed models

- **GPT-6.1 Sol:** highest blind score (2.86) and one major defect in 9 designs; preferred over Sonnet in 9 of 9 pairs; slightly cheaper than Sonnet ($0.0440 vs $0.0490). It is the slowest listed model (65 s) and passed 13 of 15 automated checks.
- **Claude Sonnet 5.5:** passed all 15 automated checks; the fastest best-quality model (30 s); blind score 2.55.
- **Claude Haiku 5.5:** the cheapest listed model, about 7× cheaper than Sonnet; no critical defect in 12 designs; blind score 2.52, close to Sonnet's; preferred over the economical GPT and Gemini models in 23 of 24 pairs.
- **Gemini 4 Argon:** passed all 15 automated checks; blind score 2.43 with one critical defect in 9 designs; the highest cost, about 2.4× Sonnet at the December price.

## Change from Gate A (Claude models)

| Model | Metric | Gate A (2026-10-18) | 0.3 (2026-11-05) |
|---|---|---|---|
| Haiku 5.5 | Automated pass rate | 0.932 | 0.864 |
| Haiku 5.5 | Blind median score | 2.29 | 2.52 |
| Haiku 5.5 | No critical defect | 0.917 | 1.000 |
| Haiku 5.5 | Major defects | 10 | 8 |
| Haiku 5.5 | Cost / generation | $0.0067 | $0.0071 |
| Haiku 5.5 | Median latency | 49 s | 53 s |
| Sonnet 5.5 | Automated pass rate | 0.933 | 1.000 |
| Sonnet 5.5 | Blind median score | 2.57 | 2.55 |
| Sonnet 5.5 | Major defects | 3 | 9 |
| Sonnet 5.5 | Cost / generation | $0.0454 | $0.0490 |
| Sonnet 5.5 | Median latency | 27 s | 30 s |

The blind numbers are not directly comparable: Gate A used Claude-only reviewers on pre-fix designs; 0.3 uses the three-provider panel on designs from the current generator. Haiku's pass rate is 3 runs lower than at Gate A (38 vs 41 of 44); the failures were missing required services, as at Gate A.

## API spend

| Key | Billed (approx.) |
|---|---|
| Anthropic | ~$4.8 |
| OpenAI | ~$3.6 |
| Gemini | ~$3.8 |
| **Total** | **~$12** |

By activity: contract smoke run ~$0.19, live generation ~$3.4, review panel ~$8.5 including retries. Argon was billed at the November price ($2/$10, until 2026-11-30); the published cost per generation uses the December price ($4/$20). Every paid run was approved by the product owner and capped with `--max-usd`.

## Limits

- **One design per scenario per variant.** The review covers repeat 1 only; a model's blind score rests on 12 or 9 designs, so one design moves a rate by 8 or 11 points.
- **Live pass rates are small samples.** One run is 2.3 points of the pass rate at 44 runs and 6.7 points at 15 runs; re-runs on the same code can move a model by that much.
- **Reviewers are models, and they saw no documentation.** They review from their own knowledge of AWS. All three reviewers are also benchmarked best-quality models, so each one reviews designs from its own provider, and on the pair that best matches its own provider each leaned toward its own provider (see Agreement between reviewers). This is an AI review, not a human panel; a human spot check remains planned.
- **Three Claude-reviewer packets are incomplete.** The Claude reviewer's answers for packets g10, g14 and g16 covered only one scenario (that scenario reviewed three times, even after one retry), so its answer was dropped and all 9 pairs in those packets were scored by 2 reviewers. 17 designs have a 2-reviewer score in at least one packet (`reviewersPerDesign` in `summary.json`, which has `complete: false`), including GPT-6.1 Sol `product-search` and Gemini 4 Argon `claims-approval-workflow`, which count toward listed models' scores. The raw answers are in `review-anthropic-g10/g14/g16.raw.json`.
- **Repeated entries normalized.** Some Claude reviewer answers listed the same design twice; the first entry was kept. The raw answers are saved as `review-*.raw.json`.
- **Prices and dates.** Prices were checked on 2026-11-04. Argon's price doubles on 2026-12-01; its listed cost already uses the December price. Provider price changes after that date are not reflected.
- **Different populations per tier.** Economical models are measured on 22 live and 12 reviewed scenarios, best-quality models on 15 and 9.

Raw reviews, packets, the unblinding key and the aggregated summary: `eval/reviews/phase3-2026-11-05/`.

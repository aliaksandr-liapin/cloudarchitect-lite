# Phase 0 AI Quality Spike — Results

**Date:** 2026-10-14 · **Run:** `eval/results/spike/2026-10-14T04-37-46-735Z` (local, git-ignored) · **Runner:** `pnpm --filter @cloudarchitect/eval spike`

## Setup

- 15 benchmark scenarios (`eval/scenarios`), one-shot generation, **1 run per scenario per model** (no clarification round).
- Structured output (`output_config.format`, JSON schema) with the catalog service IDs as an enum; the full catalog, features and rule titles in a cached system prompt.
- Scored by the eval harness: schema validity, requirement recall (keyword match), required / any-of / forbidden services, expected unresolved services, error-level rule findings.
- Prices: Anthropic price list as of 2026-10-13.

## Results

| Model | Pass | Schema-valid | Recall | Error findings | Input tok | Output tok | Cost / op | Median latency |
|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 | 14/15 | 100% | 1.00 | 2 | 5.2k | 6.3k | **$0.0034** | 24 s |
| Sonnet 5.5 | 15/15 | 100% | 1.00 | 0 | 5.2k | 5.2k | **$0.053** | 32 s |
| Opus 5.5 | 15/15 | 100% | 1.00 | 0 | 5.2k | 5.3k | **$0.109** | 45 s |

Total spend for the spike, including smoke tests and a failed first attempt: about $2.60.

**Defects found**

- Haiku, `saas-containers`: no VPC or subnets at all → 2 VR-009 errors (RDS and ElastiCache outside a VPC).
- Haiku: 4 asynchronous Lambda triggers without a DLQ or failure destination (VR-004 warnings). Sonnet and Opus: none.
- Out-of-catalog needs were returned as unresolved by all models (SageMaker, IoT Core); none invented a catalog ID. Opus also marks ECR and external payment providers as unresolved, which is correct but noisy.

**Label corrections after the run** (re-scored with `pnpm rescore`, no new calls). The first pass reported Haiku 12/15, Sonnet 13/15, Opus 14/15; the failures were over-strict labels, not wrong designs:

- ECS on Fargate is commonly drawn as a single Fargate node → `anyOf` now accepts `aws.fargate`; `saas-containers` no longer requires a separate ECS node.
- `clickstream-analytics`: Data Firehose Direct PUT handles 5k events/s without Kinesis Data Streams → Kinesis is no longer required.

## Interpretation and limits

- **Quality:** all three models produce valid, catalog-constrained graphs. Sonnet and Opus pass every automated check; Haiku makes occasional placement and resilience mistakes.
- **The automated score is lenient.** Keyword recall is 1.00 everywhere because models echo the user's wording; it does not measure whether the design is good. Gate A still requires the blind rubric review (PRD §14–15).
- **One run per cell** says nothing about variance; repeat 3× before deciding the model.
- **Latency (24–45 s)** for a single response needs streaming and progress UI in the product.
- **Catalog modeling gap:** ECS vs Fargate as separate nodes is ambiguous; decide whether Fargate is a node, or a launch-type configuration on ECS.

## Cost model input (PRD §7)

| Model | Cost / op | Per free user (3 ops) | Free users per $100 |
|---|---|---|---|
| Haiku 5.5 | $0.0034 | $0.010 | ~9,800 |
| Sonnet 5.5 | $0.053 | $0.16 | ~630 |
| Opus 5.5 | $0.109 | $0.33 | ~305 |

These figures cover one generation call; a clarification round and Review add calls. Prompt caching barely matters at this volume because the cached system prompt is only ~5k tokens.

## Recommendation (pending blind review)

- **Free tier:** Sonnet 5.5, or Haiku 5.5 with the deterministic validator feeding errors back for one repair attempt, if the repair loop closes the gap measured here. Re-run both with 3 repeats.
- **BYOK default:** Sonnet 5.5; Opus 5.5 as an option.

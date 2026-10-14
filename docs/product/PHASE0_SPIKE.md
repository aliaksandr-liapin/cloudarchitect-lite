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

## Round 2 — 3 repeats, validator repair loop, blind review (2026-10-14)

**Run:** `eval/results/spike/2026-10-14T04-48-09-214Z` · 135 generations · $2.77.

`haiku+repair` adds one turn when the deterministic validator reports errors or warnings: the findings are sent back and the model returns a corrected architecture.

| Variant | Pass (45 runs) | Schema-valid | Error findings | Warning findings | Repair turns | Cost / op | Median latency |
|---|---|---|---|---|---|---|---|
| Haiku 5.5 | 82% | 89% | 6 | 4 | — | $0.0033 | 28 s |
| Haiku 5.5 + repair | 89% | 93% | 0 | 1 | 7 | $0.0038 | 29 s |
| Sonnet 5.5 | **100%** | 100% | 0 | 1 | — | $0.054 | 33 s |

- **Contract bug:** Haiku's schema failures are nodes with neither `serviceId` nor `unresolved` (e.g. "IoT Core MQTT broker", "Amazon ECR", "Mobile app client"). The generation schema allows it; it must require exactly one. The repair loop cannot catch this today because it only runs on a schema-valid draft.
- **Missing concept:** users, client apps and third-party APIs have no place in the project format (models drop them, or mark them unresolved). Add an `external` node kind.

### Blind expert review (PRD §14–15)

Five isolated reviewer sessions received only the user prompt, two anonymised designs per scenario (A/B, order randomised) and the rubric. They saw no model names and no generation prompts. Scope: repeat 1 of `haiku+repair` and `sonnet` for all 15 scenarios. Raw reviews and the unblinding key are in `eval/reviews/phase0-2026-10-14/`.

| Variant | Median rubric | Mean | No critical defect | Major/critical defects | Preferred |
|---|---|---|---|---|---|
| Sonnet 5.5 | **2.71** | 2.53 | **14/15 (93%)** | 10 | 12 of 15 |
| Haiku 5.5 + repair | 2.29 | 2.30 | 13/15 (87%) | 23 | 1 of 15 (2 ties) |

Gate A targets: median ≥ 2.0 and no critical defect in ≥ 90% of scenarios. **Sonnet meets both; Haiku + repair misses the critical-defect target.**

Mean score per rubric dimension:

| Dimension | Sonnet | Haiku + repair |
|---|---|---|
| Requirement coverage | 2.73 | 2.47 |
| Service fitness | 2.80 | 2.60 |
| Connection correctness | 2.40 | 2.27 |
| Security baseline | 2.53 | 2.13 |
| Reliability / operability | 2.27 | 1.93 |
| Cost awareness | 2.60 | 2.60 |
| Explanation accuracy | 2.40 | 2.13 |

**Critical defects found:**

- Sonnet, `regulated-portal`: attaches AWS WAF to an API Gateway **HTTP API**; WAF supports REST APIs only, so the API path is unprotected.
- Haiku, `myblog`: claims a Lambda on-failure destination handles failures of an **SQS-triggered** Lambda; for SQS event sources only the queue's redrive policy applies.
- Haiku, `nightly-reports`: promises 7-day presigned URLs signed with task-role temporary credentials; they expire with the credentials.

**Recurring weaknesses (both models):** reliability is the lowest dimension. Examples: dual writes without an outbox, no partial-batch failure handling, single-AZ placement contradicting a multi-AZ claim, initial data loads skipped. All three critical defects are wrong statements about AWS feature behaviour, not wrong topology.

**Label caveat:** a reviewer pointed out that Firehose Direct PUT defaults to 1,000 records/s in most regions (higher in a few large regions), so the 5k events/s clickstream design needs a quota increase or Kinesis Data Streams. The relaxed `clickstream-analytics` label stays, but the scenario should require the design to mention the quota.

**Limits:** one design per variant per scenario; reviewer and generator are the same model family (PRD §15), so the defects above must stay backed by AWS documentation links. A human spot check of ≥ 20% is still due before public beta.

## Recommendation

- **Free tier and BYOK default: Sonnet 5.5.** It is the only variant that meets Gate A quality, at ~$0.054 per generation (~$0.16 per free user, ~600 free users per $100).
- **Haiku 5.5:** not for generation yet. Revisit after the contract fix and a stronger repair loop; at ~15× lower cost it could fund a larger free quota, or handle cheaper operations (Ask, explanations).
- **Product changes from the review:**
  1. Require exactly one of `serviceId` / `unresolved` in the generation contract.
  2. Add an `external` node kind.
  3. Add integration-pattern facts and rules for the observed false claims: WAF on HTTP APIs, on-failure destinations for SQS event sources, ALB needing two AZs, presigned URL lifetime.
  4. Strengthen the prompt on reliability patterns.

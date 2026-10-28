# Phase 2 Gate A — AI generation results

**Date:** 2026-10-18 · **Runner:** `pnpm eval:live` (results are local and git-ignored under `eval/results/live/`) · **Reviews:** `eval/reviews/phase2-gate-a-2026-10-18/`

## What Gate A requires

Roadmap §7: a blind review of at least 10 distinct reference scenarios against the rubric (diagram fidelity, correct edges and containers, no critical defects) and a green eval harness. The numeric targets come from PRD §13–15 and are the same as in the Phase 0 spike:

- Haiku blind median rubric score ≥ 2.0.
- No critical defect in ≥ 90% of reviewed scenarios.
- Live gate green for Haiku (`pnpm eval:live --gate`: schema-valid and automated pass rate at or above the benchmark, cost within bounds).

## Live runs

All runs use the shipped generator (extraction call, generation, and one repair turn for Haiku) on the 22 eval scenarios (15 base + 7 toggle scenarios). Sonnet runs cover the 15 base scenarios, one repeat.

| Run | Model | Generator | Runs | Schema-valid | Pass | Mean cost / op | Median latency | Result |
|---|---|---|---|---|---|---|---|---|
| `2026-10-18T20-29-25-673Z` | Haiku 5.5 | before fix | 44 | 95.5% | 79.5% | $0.00626 | 47.6 s | gate FAIL |
| `2026-10-18T22-11-01-773Z` | Haiku 5.5 | after fix | 44 | **100%** | **93.2%** (41/44) | $0.00670 | 48.8 s | gate **PASS** |
| `2026-10-18T20-38-07-143Z` | Sonnet 5.5 | before fix | 15 | 100% | 80.0% | $0.0426 | 26.0 s | — |
| `2026-10-18T22-24-06-777Z` | Sonnet 5.5 | after fix | 15 | 100% | **93.3%** (14/15) | $0.0454 | 27.5 s | — |

## Root causes found and fixed

Fixed in commit `fcef501` (`fix(generator)`), found by reading the pre-fix outputs:

1. **`containerId` was optional in the output schema.** With structured outputs the model skipped it on every node of a design (18 of 59 pre-fix designs had no container ids), so RDS, Aurora and ElastiCache sat outside any VPC and VR-009 fired (9 errors in 7 Haiku runs), and the diagrams were flat. The repair turn did not help because it only named the rule, not the node. `containerId` is now required and nullable (null for external nodes), and every repair line names the offending node or edge ids and the remediation.
2. **The SDK's `zodOutputFormat` dropped enums.** It moved `enum` into the field description, so constrained decoding did not limit the feature key and Haiku emitted keys outside the catalog (2 schema-invalid runs). Its `parse` hook also threw before cost accounting. The generator now builds the output format from `z.toJSONSchema`, which keeps enums and has no parse hook.

Effect on Haiku: schema-valid 95.5% → 100%, pass 79.5% → 93.2%, VR-009 errors 9 → 0. Mean cost rose 7% ($0.00626 → $0.00670) because the repair message is longer and designs now carry container ids.

## Blind review

- **Method:** four isolated Claude reviewer sessions, each given anonymised packets (user prompt, selected toggles, clarification answers, two designs A/B in randomised order, PRD §14 rubric). No model names, no generation prompts, no plan. Score of a design = mean of the 7 rubric dimensions (0–3). Reviewers had to cite AWS documentation for every major or critical defect.
- **Scope:** 12 distinct scenarios: 9 base scenarios (Haiku vs Sonnet) and 3 toggle scenarios (Haiku repeat 1 against Haiku repeat 2, since the toggle scenarios were not run on Sonnet; see the key). Raw reviews and the unblinding key: `eval/reviews/phase2-gate-a-2026-10-18/`.
- **Packets were built from pre-fix outputs** (Haiku run `…20-29-25…`, Sonnet run `…20-38-07…`), before the container and enum fixes. Many of those diagrams were flat. The quality result is therefore conservative: the shipped generator should score at least as well. The packets were not regenerated to stay within budget.

| Variant | Designs | Median score | Critical defects | Major defects |
|---|---|---|---|---|
| Haiku, base scenarios, repeat 1 | 9 | 2.00 | 0 | 9 |
| Haiku, toggle scenarios, repeat 1 | 3 | 2.57 | 1 (`nightly-reports-serverless`) | 1 |
| Haiku, toggle scenarios, repeat 2 | 3 | 2.43 | 0 | 2 |
| Sonnet, base scenarios | 9 | 2.57 | 0 | 3 |

- **Haiku across the 12 scenarios (repeat 1):** per-scenario median **2.29**; no critical defect in **11/12 (91.7%)**; 10 major defects.
- **Sonnet:** no critical defect in 9/9; preferred in 7 of 9 base pairs (Haiku preferred in `brochure-site` and `claims-approval-workflow`).
- The one critical defect is Haiku's `nightly-reports-serverless` (repeat 1).
- **Reviewer caveat:** the reviewers are Claude models reviewing Claude output, so shared blind spots are possible (PRD §15). This is an AI review, not a human panel; major and critical defects must stay backed by AWS documentation, and a human spot check remains planned for the private beta (roadmap stage 4).

## Toggle effects

Seven scenarios exercise a design-priority toggle and carry `forbiddenRules` (VR-019 to VR-025: for example no VR-020 backup gaps with Backups on, no VR-025 security gaps with Security hardening on).

- Forbidden-rule hits in the post-fix Haiku run: **0** across all 44 runs (and 0 in the two pre-fix runs). The toggle-driven rules never fired on a generated design.
- Toggle scenarios, post-fix Haiku: 12 of 14 runs pass. Two of the three failing runs of the whole run are toggle scenarios; both are missing-service misses, not rule violations (below).

## Remaining failures (post-fix Haiku, 3 of 44)

All are missing required services with no error findings:

- `order-events-cross-region` #2: no SNS or EventBridge fan-out (Lambda plus several SQS queues).
- `regulated-portal-security` #1: no CloudFront. Route 53, Shield and WAF on the ALB is a valid AWS pattern, so this is a strict scenario expectation, not a defect; the scenario and prompt were left unchanged.
- `fraud-model-serving` #2: no API Gateway or Lambda (the same scenario failed on API Gateway in the pre-fix run).

Post-fix Sonnet: `product-search` is missing ElastiCache (no error findings).

## API spend

| Item | Spend |
|---|---|
| Phase 2 total before the Sonnet re-measure (development, pre-fix runs, blind-review packets, fix probe and Haiku gate re-run) | $2.217 |
| Sonnet re-measure on the fixed generator | $0.682 |
| **Phase total** | **$2.899** of the $5.59 budget |

## Phase 0 → Gate A

The `MODEL_OPTIONS` benchmarks were updated from the Phase 0 spike (Round 3) to the Gate A figures. Several numbers moved down:

| Model | Metric | Phase 0 (Round 3) | Gate A |
|---|---|---|---|
| Haiku 5.5 | Automated pass rate | 0.956 | 0.932 |
| Haiku 5.5 | No critical defect | 1.0 | 0.917 |
| Haiku 5.5 | Median latency | 44 s | 49 s |
| Haiku 5.5 | Mean cost / generation | $0.0061 | $0.0067 |
| Haiku 5.5 | Blind median score | 2.29 | 2.29 per-scenario (12 scenarios); 2.00 on the 9 base scenarios only |
| Sonnet 5.5 | Automated pass rate | 0.933 | 0.933 |
| Sonnet 5.5 | Blind median score | 2.86 | 2.57 |
| Sonnet 5.5 | Mean cost / generation | $0.08 | $0.0454 |

Caveats:

- **Different scenario sets.** Phase 0 used the 15 base scenarios; Gate A uses 22 (15 base + 7 toggle scenarios) for the live runs and 12 reviewed scenarios (9 base + 3 toggle) for the blind review, so the rates are not measured on the same population.
- **Pre-fix packets.** The blind review scored pre-fix outputs (flat diagrams without container ids); the shipped generator was not re-reviewed.
- **Cost and latency.** The spec (§7) accepts a cost or latency increase up to 1.5× over the Phase 0 single-call numbers for the added extraction call; Haiku's +10% cost and +11% latency are inside that.
- **Anti-goal.** Spec §4 lists "any regression on the Phase 0 benchmark numbers in `MODEL_OPTIONS`" as an anti-goal. The Haiku pass rate, no-critical-defect rate and Sonnet blind median are below Phase 0. **Regressions versus Phase 0 accepted by the product owner on 2026-10-27.**

## Verdict against Gate A

| Criterion | Target | Measured | Result |
|---|---|---|---|
| Haiku blind median | ≥ 2.0 | 2.29 (per-scenario median, 12 scenarios); 2.00 on the 9 base scenarios only | **Met** (base-only exactly at the bar) |
| No critical defect | ≥ 90% of scenarios | 11/12 = 91.7% | **Met** (thin margin: one critical defect) |
| Live gate (Haiku) | green | PASS: schema-valid 100%, pass 93.2% | **Met** |

**Gate A: passed** (the base-only Haiku median is 2.00, exactly at the bar; regressions versus Phase 0 accepted by the product owner on 2026-10-27). Free tier stays on Haiku 5.5 with one repair turn; Sonnet 5.5 stays the BYOK default ([ADR-0011](../adr/0011-model-selection.md)) (as of 2026-10-18; free tier and BYOK dropped 2026-10-26, [ADR-0013](../adr/0013-self-hosted-only.md)). Sonnet costs about 7× more per generation ($0.0454 vs $0.0067) and was preferred in 7 of 9 blind pairs.

**Limits:** one reviewed design per variant per scenario; the quality review used pre-fix outputs and an AI reviewer; the 91.7% critical-defect margin is one design. Re-review a sample of post-fix designs and run a human spot check before public beta.

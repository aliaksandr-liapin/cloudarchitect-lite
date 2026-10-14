# ADR-0011: AI model selection for free tier and BYOK

**Status:** Accepted · **Date:** 2026-10-14

**Context.** Free AI credits are paid by us, so cost per operation sets how many free users the budget cap serves (PRD §7). Quality must meet Gate A. The Phase 0 spike measured Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5 on the 15-scenario benchmark with the eval harness and two blind rubric reviews ([phase0-spike.md](../product/phase0-spike.md)). The product owner's rule was to use Haiku for the free tier if it met the requirements, otherwise Sonnet for both.

**Acceptance criteria (fixed before the final run):** schema-valid ≥ 99 %, automated pass rate ≥ 90 %, blind median rubric ≥ 2.0, no critical defect in ≥ 90 % of scenarios.

**Decision.**

- **Free tier:** `claude-haiku-5-5` with one validator-driven repair turn. Round 3 results: schema-valid 100 %, pass 95.6 %, median rubric 2.29, no critical defect in 15/15. About $0.006 per generation.
- **BYOK default (Anthropic key):** `claude-sonnet-5-5`. Round 3: median rubric 2.86, preferred in 15/15 blind pairs. About $0.08 per generation.
- **Users choose per operation** between Haiku and Sonnet. The editor and the setup wizard show the measured benchmark (quality, pass rate, cost, latency) for each, so the choice is informed. The operator decides which models the instance key serves (`AI_MODELS`, default `haiku`) and the default (`DEFAULT_MODEL`); other models need the user's own key (`403 model_not_enabled`).
- Options and benchmarks live in `packages/domain/src/models.ts` (`MODEL_OPTIONS`); the gateway exposes them at `GET /api/models`.

**Consequences.**

- Free-tier designs are acceptable but measurably weaker: 13 major defects vs 4 for Sonnet, reliability mean 1.73 vs 2.80. The UI must offer "Improve with your own key" (Sonnet) and make Review prominent for free-tier results.
- Changing either model, the prompt or the repair loop requires a new eval run and blind review (ADR-0009).
- Re-evaluate after beta with real prompts. If free-tier users report quality problems, switching the free tier to Sonnet costs ~13× more per operation.

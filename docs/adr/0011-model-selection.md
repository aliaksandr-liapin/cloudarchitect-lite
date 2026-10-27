# ADR-0011: AI model selection and benchmark

**Status:** Accepted · **Date:** 2026-10-14

**Context.** When written (2026-10-14) the plan had free AI credits paid by the owner (dropped 2026-10-26, [ADR-0013](0013-self-hosted-only.md)), so cost per operation set how many free users a budget cap served. Today the same figures tell each self-hosting user what an operation costs on their own key. Quality must meet Gate A. The Phase 0 spike measured Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5 on the 15-scenario benchmark with the eval harness and two blind rubric reviews ([phase0-spike.md](../product/phase0-spike.md)). The product owner's rule was to use Haiku as the economical default if it met the requirements, otherwise Sonnet for both.

**Acceptance criteria (fixed before the final run):** schema-valid ≥ 99 %, automated pass rate ≥ 90 %, blind median rubric ≥ 2.0, no critical defect in ≥ 90 % of scenarios.

**Decision.**

- **Economical default (called "free tier" until 2026-10-26):** `claude-haiku-5-5` with one validator-driven repair turn. Historical (Phase 0 Round 3, the basis of this decision): schema-valid 100 %, pass 95.6 %, median rubric 2.29, no critical defect in 15/15, about $0.006 per generation. Current (Phase 2 Gate A, [report](../product/phase2-gate-a.md)): schema-valid 100 %, pass 93.2 % on 22 scenarios, median rubric 2.29 per-scenario over 12 reviewed scenarios (2.00 on the 9 base scenarios), no critical defect in 11/12, about $0.0067 per generation.
- **Stronger option:** `claude-sonnet-5-5`. Historical (Round 3): median rubric 2.86, preferred in 15/15 blind pairs. Current (Gate A, fixed generator): pass 93.3 %, median 2.57, preferred in 7/9 blind pairs, about $0.045 per generation.
- Gate A figures are below Round 3 on several metrics (see the Phase 0 → Gate A table in the report); the product owner's acceptance is pending.
- **Users choose per operation** between Haiku and Sonnet. The editor and the setup wizard show the measured benchmark (quality, pass rate, cost, latency) for each, so the choice is informed. The person who runs the instance decides which models its key serves (`AI_MODELS`, default `haiku`) and the default (`DEFAULT_MODEL`); other models return `403 model_not_enabled`.
- Options and benchmarks live in `packages/domain/src/models.ts` (`MODEL_OPTIONS`); the gateway exposes them at `GET /api/models`.

**Consequences.**

- Haiku designs are acceptable but measurably weaker. Gate A: 10 major defects for Haiku (12 scenarios) vs 3 for Sonnet (9 base scenarios). Historical (Round 3): 13 vs 4, reliability mean 1.73 vs 2.80. The UI shows the benchmark so users can choose Sonnet, and keeps Review prominent for Haiku results.
- Changing either model, the prompt or the repair loop requires a new eval run and blind review (ADR-0009).
- Re-evaluate with real prompts after the public release. If users report quality problems with Haiku, making Sonnet the default costs ~7× more per operation (Gate A: $0.0454 vs $0.0067).

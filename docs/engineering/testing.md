# Testing Strategy

| Layer             | Where              | What                                                                                                   |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| Domain unit tests | `packages/domain`  | Schema invariants, every implemented validation rule (positive and negative), patches, migrations      |
| Catalog tests     | `packages/catalog` | Data parses, unique IDs, evidence for active services, rule metadata coverage, sample project validity |
| Gateway tests     | `apps/gateway`     | Security headers, config validation, spending-limit behavior, rate limiting, log privacy               |
| Web tests         | `apps/web`         | Container-aware layout, stored-position persistence, parent ordering                                   |
| Eval harness      | `eval`             | Scenario scoring; release gate for prompts, models and catalog                                         |
| Containers        | CI                 | Image build + Trivy scan                                                                               |
| Security          | CI                 | CodeQL, dependency review, audit, secret scan                                                          |

Planned: browser end-to-end tests (Playwright) for save/load/export and accessibility checks once the editor UI stabilizes (ROADMAP E6).

## Benchmark scenarios

`eval/scenarios/*.json` holds the benchmark (PRD §13): 15 base prompts covering every scenario class (static web, serverless API, event-driven, data pipeline, containerized API, ML inference, legacy migration, workflow, security/compliance). Each scenario labels:

- `expectedRequirements` — requirement recall is scored by keyword match against the generated requirement texts;
- `expectedServices` — `required` services, `anyOf` groups (one of them must be used) and `forbidden` services (over-engineering, e.g. DAX in MyBlog);
- `expectedUnresolved` — needs outside the catalog (e.g. SageMaker, IoT Core) that must come back as unresolved nodes, never as invented catalog IDs (FR-020, VR-015);
- `toggles`, `answers` and `forbiddenRules` — design toggles for the live run, clarification answers by topic ("You decide" when absent), and validation rules that must not fire (a toggle the design ignores).

Seven toggle scenarios (`<base>-<suffix>.json`, e.g. `myblog-backups`) copy a base prompt and enable one toggle each, forbidding the rule that checks it (VR-019 to VR-025). Where a toggle contradicts a base expectation, the toggle scenario is adjusted and its `title` says how.

Scenarios without a candidate in `eval/candidates/` are skipped until the generator (Phase 2) produces one. Labels are a first draft by the independent reviewer role and need product-owner review; rubric scoring (PRD §14) stays a separate, blind step.

## Live generator eval

`pnpm eval:live [--models haiku,sonnet] [--repeats 1] [--scenarios id,id] [--concurrency 4] [--max-usd 0.50] [--gate]` runs the production generator (`@cloudarchitect/generator`: extraction, clarification answers, generation with repair) on every scenario and scores each project with the harness. Spend is counted per call; once it reaches `--max-usd` no new call or job starts, and a run cut short this way fails the gate. Results go to `eval/results/live/<runId>/` (`records.json`, `summary.json`, and the generated projects under `outputs/`; git-ignored). The console shows ids, scores, cost and latency only. Without `ANTHROPIC_API_KEY` (environment or repo-root `.env`) the run is skipped with exit 0.

With `--gate`, each model must meet `LIVE_GATE` (`eval/src/gate.ts`): schema-valid rate 1, pass rate ≥ 0.9, no forbidden services, and mean cost per operation (extraction plus generation) ≤ 1.5× the model's `benchmark.costPerOperationUsd`. Any failure exits 1. A regression is fixed in the generator prompt, never by relaxing the thresholds.

In CI, `.github/workflows/live-eval.yml` runs `pnpm eval:live --gate` with `--models haiku --repeats 1 --max-usd 0.50` on non-draft pull requests (draft PRs skip it; it runs when the PR is marked ready for review) that touch `packages/generator/**`, `packages/catalog/data/**`, `packages/domain/src/models.ts`, `packages/domain/src/validation.ts`, `packages/domain/src/toggles.ts`, `eval/scenarios/**`, `eval/src/harness.ts`, `eval/src/live.ts` or `eval/src/gate.ts`. It can also be started manually (`workflow_dispatch`) with `models` (`haiku`, `sonnet`), `repeats` and `max_usd` inputs; `max_usd` above 2.00 (or not a number) fails the run before any API call. It uses the `ANTHROPIC_API_KEY` repository secret; without it (forks, Dependabot) the run is skipped with exit 0. One Haiku run costs about $0.15-0.25. Results are uploaded as the `live-eval-results` artifact. Because it is path-filtered, it cannot be a required check.

# Testing Strategy

| Layer             | Where              | What                                                                                                   |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| Domain unit tests | `packages/domain`  | Schema invariants, every implemented validation rule (positive and negative), patches, migrations      |
| Catalog tests     | `packages/catalog` | Data parses, unique IDs, evidence for active services, rule metadata coverage, sample project validity |
| Gateway tests     | `apps/gateway`     | Security headers, config validation, credit and budget behavior, rate limiting, log privacy            |
| Web tests         | `apps/web`         | Container-aware layout, stored-position persistence, parent ordering                                   |
| Eval harness      | `eval`             | Scenario scoring; release gate for prompts, models and catalog                                         |
| Containers        | CI                 | Image build + Trivy scan                                                                               |
| Security          | CI                 | CodeQL, dependency review, audit, secret scan                                                          |

Planned: browser end-to-end tests (Playwright) for save/load/export and accessibility checks once the editor UI stabilizes (ROADMAP E6).

## Benchmark scenarios

`eval/scenarios/*.json` holds the Phase 0 benchmark (PRD §13): 15 prompts covering every scenario class (static web, serverless API, event-driven, data pipeline, containerized API, ML inference, legacy migration, workflow, security/compliance). Each scenario labels:

- `expectedRequirements` — requirement recall is scored by keyword match against the generated requirement texts;
- `expectedServices` — `required` services, `anyOf` groups (one of them must be used) and `forbidden` services (over-engineering, e.g. DAX in MyBlog);
- `expectedUnresolved` — needs outside the catalog (e.g. SageMaker, IoT Core) that must come back as unresolved nodes, never as invented catalog IDs (FR-020, VR-015).

Scenarios without a candidate in `eval/candidates/` are skipped until the generator (Phase 2) produces one. Labels are a first draft by the independent reviewer role and need product-owner review; rubric scoring (PRD §14) stays a separate, blind step.

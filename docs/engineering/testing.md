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

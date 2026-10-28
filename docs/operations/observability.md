# Observability

## Principles

- Metadata only: request ID, route, status, latency, model ID, token counts. Never prompts, graphs, keys or raw IPs (NFR-006; enforced by gateway tests).
- Structured JSON logs to stdout (container log driver).

## Signals

| Signal                                  | Source                                               | Use                                   |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| Request rate, errors, latency per route | Gateway logs                                         | Health and SLOs                       |
| 429 / 503 rates                         | Gateway logs                                         | Rate limiting, spending limit reached |
| Daily and monthly spend                 | Gateway spend counters                               | Spending-limit proximity              |
| Tokens per operation                    | Gateway (with LLM adapter)                           | Cost model (PRD §7)                   |
| Eval results                            | CI artifact `eval-results`                           | Quality regression                    |
| Web errors                              | Browser error reporter (planned, with key scrubbing) | UX failures                           |

## Initial SLOs (self-hosted)

- Gateway availability (non-AI routes): 99.5% monthly (a target for operators, not a service level offered by the project).
- p95 latency for non-AI routes: < 300 ms.
- AI operations: tracked, no SLO until the provider is chosen.

## Alerts

- Daily spend > 80% of the daily limit.
- Spending limit reached (`ai_unavailable`).
- 5xx rate > 2% over 10 minutes.
- Eval harness failure on `main`.

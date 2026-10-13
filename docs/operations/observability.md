# Observability

## Principles

- Metadata only: request ID, route, status, latency, model ID, token counts. Never prompts, graphs, keys or raw IPs (NFR-006; enforced by gateway tests).
- Structured JSON logs to stdout (Workers Logs / container log driver).

## Signals

| Signal                                  | Source                                               | Use                                            |
| --------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| Request rate, errors, latency per route | Gateway logs / Workers analytics                     | Health and SLOs                                |
| 429 / 402 / 503 rates                   | Gateway logs                                         | Abuse, credit exhaustion, kill switch activity |
| Daily and monthly spend                 | `spend` table                                        | Budget burn and cap proximity                  |
| Tokens per operation                    | Gateway (with LLM adapter)                           | Cost model (PRD §7)                            |
| Eval results                            | CI artifact `eval-results`                           | Quality regression                             |
| Web errors                              | Browser error reporter (planned, with key scrubbing) | UX failures                                    |

## Initial SLOs (beta)

- Gateway availability (non-AI routes): 99.5% monthly.
- p95 latency for non-AI routes: < 300 ms.
- AI operations: tracked, no SLO until the provider is chosen.

## Alerts

- Daily spend > 80% of cap.
- Kill switch active.
- 5xx rate > 2% over 10 minutes.
- Eval harness failure on `main`.

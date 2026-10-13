# Scalability

## Load profile

Most work happens in the browser: editing, layout, validation, storage and export cost the backend nothing. Server load is limited to AI operations, which are rate-limited, credit-bounded and budget-capped.

## Components

| Component           | Scaling model                               | Limits and plan                                                                                                                                                    |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web                 | Static assets on CDN                        | Effectively unlimited; hashed assets cached for a year                                                                                                             |
| Gateway (Workers)   | Stateless isolates, auto-scaled at the edge | CPU per request is small; LLM latency dominates and is I/O wait                                                                                                    |
| Credit ledger (D1)  | Single primary database, read replicas      | Writes are one small row per operation; far below D1 write limits at expected volumes. If exceeded, shard by client-key prefix or move counters to Durable Objects |
| Rate limiting       | Per-isolate in scaffold                     | Move to the Workers Rate Limiting binding before public beta (per-isolate counters do not aggregate)                                                               |
| Gateway (container) | Single replica (in-memory store)            | Horizontal scaling requires a shared transactional store (e.g. Postgres or Redis with atomic ops) behind the `CreditStore` interface                               |
| AI providers        | External quotas                             | Concurrency cap per session, upstream timeouts, kill switch; BYOK shifts load to user quotas                                                                       |

## Client-side limits

- ≤ 150 nodes and ≤ 10 container levels per project (`LIMITS` in `packages/domain`).
- ELK layout target ≤ 2 s for 50 nodes; move layout to a Web Worker (ROADMAP E1).
- Catalog subsets, not the full catalog, are sent to the LLM to bound input tokens.

## Cost scaling

Cost grows with AI operations, not users. The budget cap bounds the worst case; Phase 0 measures cost per operation (PRD §7) to set the cap and the free quota.

# Scalability

## Load profile

Most work happens in the browser: editing, layout, validation, storage and export cost the backend nothing. Server load is limited to AI operations, which are rate-limited and bounded by the user's spending limits. The product is self-hosted for one person or a small team ([ADR-0013](../adr/0013-self-hosted-only.md)); scaling out is not a goal.

## Components

| Component   | Scaling model                       | Limits and plan                                                                                  |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Web         | Static assets behind nginx          | Hashed assets cached for a year                                                                  |
| Gateway     | Single replica (in-memory counters) | LLM latency dominates and is I/O wait; horizontal scaling would need a shared store, not planned |
| AI provider | The user's own account and quotas   | Concurrency cap per session, upstream timeouts, spending limits                                  |

## Client-side limits

- ≤ 150 nodes and ≤ 10 container levels per project (`LIMITS` in `packages/domain`).
- ELK layout target ≤ 2 s for 50 nodes; move layout to a Web Worker (ROADMAP E1).
- Catalog subsets, not the full catalog, are sent to the LLM to bound input tokens.

## Cost scaling

Cost grows with AI operations, not users. The spending limits bound the worst case; Phase 0 measured the cost per operation (PRD §7), and the setup wizard shows how many generations a limit covers.

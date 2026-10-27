# ADR-0010: pnpm monorepo and a portable gateway

**Status:** Accepted · **Date:** 2026-10-13

**Context.** Web and gateway must share the schema and validator exactly; hosting may change.

**Decision.** pnpm workspaces (`apps/*`, `packages/*`, `eval`). The gateway is written against Hono's web-standard API with a storage interface, so the same app ran on Workers (`worker.ts` + D1, dropped 2026-10-26, [ADR-0013](0013-self-hosted-only.md)) and Node (`node.ts`, container image). Node in Docker is now the only runtime.

**Consequences.** One lockfile and CI pipeline. The Node runtime's in-memory spend counters are single-replica only, which is enough for a self-hosted install.

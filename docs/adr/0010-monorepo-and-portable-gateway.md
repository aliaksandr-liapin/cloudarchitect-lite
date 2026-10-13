# ADR-0010: pnpm monorepo and a portable gateway

**Status:** Accepted · **Date:** 2026-10-13

**Context.** Web and gateway must share the schema and validator exactly; hosting may change.

**Decision.** pnpm workspaces (`apps/*`, `packages/*`, `eval`). The gateway is written against Hono's web-standard API with a storage interface, so the same app runs on Workers (`worker.ts` + D1) and Node (`node.ts`, container image).

**Consequences.** One lockfile and CI pipeline. The Node runtime's in-memory ledger is single-replica only; a shared store is required before scaling containers horizontally.

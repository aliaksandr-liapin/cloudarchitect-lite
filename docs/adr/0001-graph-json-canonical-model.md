# ADR-0001: Graph JSON as canonical model

**Status:** Accepted · **Date:** 2026-10-13

**Context.** Text-to-diagram tools that output images or Mermaid cannot be validated, edited reliably, or traced to requirements.

**Decision.** The canonical artifact is a versioned project JSON (requirements, containers, nodes, edges, findings) defined by Zod schemas in `packages/domain`. Images, Mermaid and draw.io are exports.

**Consequences.** Every feature (validation, AI edit, export) operates on one model. Schema changes need migrations (`migrate.ts`). AI output is untrusted input to this schema.

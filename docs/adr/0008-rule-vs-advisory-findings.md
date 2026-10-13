# ADR-0008: Rule findings vs advisory findings

**Status:** Accepted · **Date:** 2026-10-13

**Context.** LLM opinions must not look like verified checks.

**Decision.** `Finding.class` is `rule` (deterministic, versioned, tested) or `advisory` (AI Review). The UI shows them separately and never labels advisory findings as verified.

**Consequences.** Every rule needs metadata, positive and negative tests. Advisory output can change with the model; rule output cannot.

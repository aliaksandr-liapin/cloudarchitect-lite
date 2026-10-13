# ADR-0009: Evaluation harness as release gate

**Status:** Accepted · **Date:** 2026-10-13

**Context.** Prompt, model or catalog changes can silently degrade generation quality.

**Decision.** `eval/` holds labelled scenarios; CI scores candidate outputs (schema validity, requirement recall, required/forbidden services, error findings) and fails on regression below PRD §13 thresholds. Rubric scoring by the independent reviewer happens at gates.

**Consequences.** Until the generator exists, candidates are reference designs; the generator plugs into the same scorer in Phase 2.

# ADR-0002: AWS-first, provider-neutral registry

**Status:** Accepted · **Date:** 2026-10-13

**Context.** Multi-cloud content is expensive to verify; the data model should not need rework later.

**Decision.** IDs are provider-prefixed (`aws.lambda`), the domain types carry `provider`, and catalog files live per provider. Only AWS content ships in the MVP.

**Consequences.** Azure/GCP need content and icons, not schema changes. They must not be labelled supported until verified.

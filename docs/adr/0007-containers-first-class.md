# ADR-0007: Containers as first-class model entities

**Status:** Accepted · **Date:** 2026-10-13

**Context.** AWS diagrams without Region/VPC/subnet boundaries are misleading; VPC is not a service node.

**Decision.** `containers[]` with kinds aws-cloud, region, vpc, availability-zone, subnet, group and a `parentId` tree; nodes reference one `containerId`. Nesting rules come from the catalog.

**Consequences.** Layout, export and validation (VR-009, VR-010) understand placement. Schema moved to 1.1.0 with a migration.

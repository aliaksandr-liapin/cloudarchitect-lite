# ADR-0005: React Flow + ELK.js for canvas and layout

**Status:** Accepted · **Date:** 2026-10-13

**Context.** The editor needs editable nodes, nested containers and automatic layered layout.

**Decision.** `@xyflow/react` renders nodes and containers (parent nodes); `elkjs` computes hierarchical layouts with `hierarchyHandling: INCLUDE_CHILDREN`. Layout results are written back into the project so manual positions persist.

**Consequences.** ELK is ~1.4 MB and is loaded lazily; it should move to a Web Worker (ROADMAP E1).

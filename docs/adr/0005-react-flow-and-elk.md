# ADR-0005: React Flow + ELK.js for canvas and layout

**Status:** Accepted · **Date:** 2026-10-13

**Context.** The editor needs editable nodes, nested containers and automatic layered layout.

**Decision.** `@xyflow/react` renders nodes and containers (parent nodes); `elkjs` computes hierarchical layouts with `hierarchyHandling: INCLUDE_CHILDREN`. Layout results are written back into the project so manual positions persist.

**Consequences.** ELK is ~1.4 MB and is loaded lazily; it should move to a Web Worker (ROADMAP E1).

**Update 2026-10-19.** ELK now routes edges orthogonally (`elk.edgeRouting: ORTHOGONAL`) and receives estimated edge-label sizes, so layered layout reserves space for labels; routes come back in root coordinates (`elk.json.edgeCoords: ROOT`) and a custom React Flow edge draws them. Routes are not stored in the project: after a load, Import or Restore the editor re-runs ELK in memory and keeps a route only where the endpoints and their containers are exactly where that layout puts them; edges touched by hand edits fall back to React Flow's smoothstep path. Components store an optional `size` (project format 1.4.0); Auto layout resets sizes to the defaults.

# Editor Readability and Panel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated diagram readable on first sight, every box resizable, and the side panel resizable and calmer, with a light/dark switch (light by default) and a clear generation status.

**Architecture:** The layout step (ELK) is given real node sizes and edge-label sizes, routes edges orthogonally, and returns its edge routes next to the project. A custom React Flow edge draws those routes, or falls back to smoothstep. Node sizes are stored in the project (schema 1.4.0). Panel, theme and status changes stay inside `apps/web`, with small pure helpers that carry the unit tests.

**Tech Stack:** React 19, @xyflow/react 12.12 (`NodeResizer`, `EdgeLabelRenderer`, `getSmoothStepPath`, `BaseEdge`), elkjs 0.12, Zod 4, Vitest 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-editor-readability-design.md`

## Global Constraints

- All repo content is in English.
- No new runtime or dev dependencies.
- No changes to the gateway, generator prompts, eval scenarios, or any file in `.github/workflows/live-eval.yml` `paths:` (this PR must not trigger the paid live eval).
- Every `localStorage` read and write is wrapped in try/catch and falls back to the default.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only; never push.
- Before each commit, `pnpm -r typecheck && pnpm -r test && pnpm lint` passes from the repo root.
- Values the spec fixes:
  - default service node size 220 × 72;
  - legacy size, for nodes without `size`, 168 × 64;
  - minimum service size 160 × 56; minimum container size 160 × 80;
  - container padding top 40, left/right/bottom 16;
  - edge labels wrap at 160 px, at most 2 lines;
  - fit view never zooms past 1, and `minZoom` stays 0.2;
  - panel width 320 px min, 50 % of the window max, 380 px default, arrow step 16 px; the minimum wins on narrow windows;
  - panel font size 16 px;
  - `DESIGNING_AFTER_MS` 8000;
  - theme defaults to `light`.

## Review Focus

1. **Old saved projects** (no node `size`) must open with their stored positions and at the legacy 168 × 64 size, with no overlap introduced. Pinned by the Task 1 and Task 2 tests.
2. **Moving or resizing a container** must drop the routes of every edge whose endpoint sits inside it, at any depth, not only edges on the moved box itself. Pinned by the Task 2 `dropRoutes` test.
3. **Edge labels after Auto layout** must not overlap any service node box. Pinned by the Task 2 geometry test.
4. **Storage that is blocked or throws** (private window) must leave the default theme, panel width and section state in place without crashing. Pinned by the Task 4 prefs test.
5. **A window narrower than 640 px** must keep the panel at 320 px. Pinned by the Task 4 clamp test.

---

### Task 1: Store node sizes (schema 1.4.0)

**Files:**

- Modify: `packages/domain/src/project.ts` (add `size: Size.optional()` to `NodeBase`; `PROJECT_SCHEMA_VERSION = '1.4.0'`)
- Modify: `packages/domain/src/migrate.ts` (step `1.3.0 → 1.4.0`, nothing to rewrite; add a line to the doc comment)
- Modify: `packages/catalog/samples/myblog.project.json`, `eval/candidates/myblog.project.json` (`"schemaVersion": "1.4.0"`)
- Test: `packages/domain/src/domain.test.ts`

**Interfaces:**

- Produces: `ArchNode.size?: { width: number; height: number }` and `PROJECT_SCHEMA_VERSION === '1.4.0'`. `graphContentHash` already ignores `size`, so leave it as it is.

- [ ] **Step 1: Write the failing tests** in `domain.test.ts`:
  - `it('migrates 1.3.0 projects to 1.4.0 without changing nodes')`: take a 1.3.0 project with one node, run `migrateProject`, expect `schemaVersion` to be `'1.4.0'` and the node to equal the input node.
  - `it('keeps a node size and ignores it in the content hash')`: parse a project whose node has `size: { width: 300, height: 90 }`, expect the size to be kept, and expect `graphContentHash` to equal the hash of the same project without `size`.
  - Update any existing assertion that names `'1.3.0'` as the current version.
- [ ] **Step 2:** Run `pnpm --filter @cloudarchitect/domain test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the schema field, the version bump, the migration and the fixture bumps.
- [ ] **Step 4:** Run `pnpm -r typecheck && pnpm -r test`. Expected: PASS. This includes eval and generator, which use the constant.
- [ ] **Step 5:** Commit `feat(domain): optional service node size (schema 1.4.0)`.

### Task 2: Readable layout with routed, labelled edges

**Files:**

- Modify: `apps/web/src/layout.ts`
- Test: `apps/web/src/layout.test.ts`

**Interfaces:**

- Consumes: `ArchNode.size` from Task 1.
- Produces, all exported from `layout.ts`:
  - `NODE_SIZE = { width: 220, height: 72 }` and `LEGACY_NODE_SIZE = { width: 168, height: 64 }`.
  - `MIN_NODE_SIZE = { width: 160, height: 56 }`, `MIN_CONTAINER_SIZE = { width: 160, height: 80 }` and `CONTAINER_PAD = { top: 40, left: 16, right: 16, bottom: 16 }`. `CONTAINER_PADDING` is built from `CONTAINER_PAD`.
  - `type EdgeRoute = { points: { x: number; y: number }[]; label?: { x: number; y: number; width: number; height: number } }`, in absolute flow coordinates. `points` runs from start, through the bend points, to end.
  - `type Routes = ReadonlyMap<string, EdgeRoute>`.
  - `labelSize(text: string): { width: number; height: number }`. Estimate 7 px per character and 16 px per line, plus 4 px. Width is capped at 160, with at most 2 lines.
  - `applyLayout(project: Project): Promise<{ project: Project; routes: Routes }>`. This **changes the return type**. It writes `NODE_SIZE` to every node's `size` and container sizes as today. ELK root options keep today's options, plus:
    - `elk.edgeRouting: ORTHOGONAL`
    - `elk.json.edgeCoords: ROOT`
    - `elk.edgeLabels.placement: CENTER`
    - `elk.spacing.nodeNode: 48`
    - `elk.layered.spacing.nodeNodeBetweenLayers: 96`
    - `elk.spacing.edgeNode: 24`
    - `elk.spacing.edgeEdge: 16`
    - `elk.spacing.edgeLabel: 8`
    - `elk.layered.spacing.edgeNodeBetweenLayers: 24`

    Each ELK edge gets `labels: [{ text, ...labelSize(text) }]` when it has a label. Use the same label text that `toFlow` shows.

  - `toElkGraph(project)` uses `node.size ?? NODE_SIZE` for node dimensions. Auto layout resets sizes, so pass `NODE_SIZE` always. Keep the signature.
  - `toFlow(project, displayName, routes?: Routes)` does the following:
    - Service nodes get `style: { width, height }` from `node.size ?? LEGACY_NODE_SIZE`.
    - Edges get `type: 'routed'`, `data: { route?: EdgeRoute, label?: string }` and no top-level `label`.
    - `animated` stays as it is today.
  - `dropRoutes(routes: Routes, project: Project, changedIds: readonly string[]): Routes` returns a new map without every edge whose source or target is a changed id, or sits (at any depth) inside a changed container.
  - `containerMinSize(project: Project, containerId: string): { width: number; height: number }` returns the bounding box of its direct children (positions are parent-relative; nodes use `size ?? LEGACY_NODE_SIZE`, containers use `size`). Add `CONTAINER_PAD.right` and `.bottom`, then take the elementwise max with `MIN_CONTAINER_SIZE`.

- [ ] **Step 1: Write the failing tests** in `layout.test.ts`, using the `myblog` sample:
  - `it('gives every node the default size after layout')`: every `laid.project.nodes[i].size` equals `NODE_SIZE`.
  - `it('renders nodes without size at the legacy size')`: delete a node's `size`, and `toFlow(...).nodes` for it has `style.width === 168` and `style.height === 64`.
  - `it('returns a route for every edge, and no label overlaps a service node')`:
    - `routes.size === project.edges.length`, and every route has at least 2 points.
    - For each route with a label, the label rectangle does not intersect any service node's absolute rectangle. Compute absolute positions by summing parent container positions.
  - `it('labels wrap at 160 px over at most two lines')`:
    - `labelSize('x'.repeat(10))` gives `{ width: 70, height: 20 }`.
    - `labelSize('x'.repeat(200))` gives `{ width: 160, height: 36 }`.
  - `it('drops routes for moved endpoints and for edges inside a moved container')`:
    - after `dropRoutes(routes, laid.project, ['db'])`, no edge touching `db` keeps a route, and an edge not touching it keeps its route;
    - after `dropRoutes(routes, laid.project, ['region'])`, no edge with an endpoint inside `region` keeps a route.
  - `it('container minimum size covers its children plus padding')`: `containerMinSize(laid.project, 'region')` has a width of at least the right edge of every direct child plus 16.
  - Update the existing tests for the new `applyLayout` return shape.
- [ ] **Step 2:** Run `pnpm --filter @cloudarchitect/web test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the changes. Update `App.tsx` call sites only as far as typecheck needs: `commit` takes `.project` and ignores routes for now. Task 3 wires the routes.
- [ ] **Step 4:** Run `pnpm -r typecheck && pnpm --filter @cloudarchitect/web test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): orthogonal layout with edge-label space and stored node sizes`.

### Task 3: Routed edges, wrapping nodes, resizing, and fit to view

**Files:**

- Create: `apps/web/src/edges.tsx`
- Modify: `apps/web/src/nodes.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`

**Interfaces:**

- Consumes: `Routes`, `EdgeRoute`, `dropRoutes`, `containerMinSize`, `MIN_NODE_SIZE`, `toFlow(…, routes)` and `applyLayout(...) → { project, routes }` from Task 2.
- Produces:
  - `RoutedEdge`, which `edgeTypes = { routed: RoutedEdge }` exports from `edges.tsx`.
  - `routedPath(points): string`, an SVG `M … L …` path, exported and unit-tested in `edges.test.ts`.
  - Nodes accept `data.resizable: boolean` and `data.onResized(id, rect: { x, y, width, height })`, which `toFlow` callers attach in `App.tsx`.

- [ ] **Step 1: Write the failing test** `apps/web/src/edges.test.ts`: `routedPath([{x:0,y:0},{x:10,y:0},{x:10,y:5}])` equals `'M 0 0 L 10 0 L 10 5'`.
- [ ] **Step 2:** Run `pnpm --filter @cloudarchitect/web test`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - **`RoutedEdge`:**
    - With `data.route`, draw `BaseEdge` with `routedPath(route.points)`, and place the label at `route.label` (centre).
    - Without a route, use `getSmoothStepPath` and its `labelX`/`labelY`.
    - Render the label through `EdgeLabelRenderer` as a div with `max-width: 160px`, a 2-line clamp, `title` set to the full text, and the panel background.
  - **`ServiceNode`:** name and service text wrap with a 2-line clamp (`-webkit-line-clamp: 2`) instead of ellipsis, and each gets `title` set to the full text. Add `<NodeResizer isVisible={selected && data.resizable} minWidth={160} minHeight={56} onResizeEnd={(_, p) => data.onResized(id, p)} />`.
  - **`ContainerNode`:** the same, with `minWidth` and `minHeight` from `data.minSize`. `App` computes `data.minSize` with `containerMinSize`.
  - **`App.tsx`:**
    - Keep `routes` in a ref.
    - `commit(next, forceLayout)` stores the routes from `applyLayout` when it lays out, and passes them to `toFlow`.
    - Drag stop and resize end call `dropRoutes(routes, project, [id])` before committing. Resize end commits `size` (and `position`, because left and top handles move the box) to the node or container.
    - `resizable = !busy`.
    - Set `fitPendingRef.current = true` for Auto layout and Import too, not only generation and Restore. The effect calls `fitView({ padding: 0.12, maxZoom: 1, duration: 300 })`.
    - The `<ReactFlow>` `fitView` prop uses `fitViewOptions={{ padding: 0.12, maxZoom: 1 }}`.
    - Cancel and errors set no fit flag.
- [ ] **Step 4:** Run `pnpm -r typecheck && pnpm --filter @cloudarchitect/web test && pnpm --filter @cloudarchitect/web build`. Expected: PASS.
- [ ] **Step 5: Manual check.** Run `pnpm --filter @cloudarchitect/web dev` and open the sample. Then:
  - Auto layout: labels sit in gaps, names are not cut off, and the diagram fits.
  - Resize a node and a container. A container can't be shrunk below its children.
  - Drag a node: its edges switch to smoothstep.
  - Reload: sizes are kept.
- [ ] **Step 6:** Commit `feat(web): routed edges, wrapping labels, resizable boxes, fit after layout`.

### Task 4: Theme switch, resizable sticky panel, collapsible sections

**Files:**

- Create: `apps/web/src/prefs.ts` and `apps/web/src/prefs.test.ts`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/models.tsx` (`AiModelPanel` wraps in a section), `apps/web/src/VersionsPanel.tsx`, `apps/web/src/styles.css`, `apps/web/index.html` (`<html data-theme="light">`)

**Interfaces:**

- Produces, from `prefs.ts`:
  - `readPref<T>(key: string, parse: (raw: string) => T | undefined, fallback: T): T`;
  - `writePref(key: string, value: string): void`, which swallows errors;
  - `type Theme = 'light' | 'dark'` and `readTheme(): Theme`, which defaults to `'light'`;
  - `clampPanelWidth(width: number, windowWidth: number): number`, which returns `max(320, min(width, windowWidth * 0.5))`;
  - `PANEL_DEFAULT = 380` and `PANEL_STEP = 16`.
- `<Collapsible id title defaultOpen openSignal?>`: a `<details>`/`<summary>` section that remembers its open state through `readPref`/`writePref` (key `cloudarchitect.section.<id>`) and opens when `openSignal` increases.

- [ ] **Step 1: Write the failing tests** in `prefs.test.ts`:
  - `clampPanelWidth(1000, 1600)` is 800, `clampPanelWidth(200, 1600)` is 320, and `clampPanelWidth(500, 600)` is 320.
  - `readTheme()` is `'light'` with empty storage, and also when `localStorage.getItem` throws (stub `globalThis.localStorage` with a throwing object).
  - `readPref('k', Number, 5)` is 5 when storage throws.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - **Theme:**
    - Theme state in `App`, applied as `document.documentElement.dataset.theme`.
    - A top-bar button with `aria-pressed` and the label "Dark mode"/"Light mode".
    - In `styles.css`, replace the `@media (prefers-color-scheme: dark)` block with `:root[data-theme='dark']`.
    - Set `<ReactFlow colorMode={theme}>`.
  - **Panel:**
    - Width state from `readPref('cloudarchitect.panelWidth', …, PANEL_DEFAULT)`, re-clamped on window resize.
    - A `role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0}` handle on the panel's left edge. Pointer drag sets the width; the Left and Right arrows change it by `PANEL_STEP`. Persist on pointer-up and on keyup.
  - **`.side`:** font-size 16 px. The `GeneratePanel` section is `position: sticky; top: 0` with the panel background and a bottom border, and the rest scrolls.
  - **Sections:** `AiModelPanel` sits in `<Collapsible id="model" title="AI model" defaultOpen={false}>`. `VersionsPanel` sits in `<Collapsible id="versions" title={`Versions (${n})`} defaultOpen={false} openSignal={versionsAddedThisSession}>`. App increments that counter when a version is saved.
- [ ] **Step 4:** Run `pnpm -r typecheck && pnpm --filter @cloudarchitect/web test && pnpm --filter @cloudarchitect/web build`. Expected: PASS.
- [ ] **Step 5: Manual check.**
  - The app opens light even when the OS is dark. Toggle to dark and reload: it stays dark.
  - Drag the panel and reload: the width is kept.
  - Generate stays visible while the panel scrolls.
  - AI model is collapsed.
- [ ] **Step 6:** Commit `feat(web): light/dark switch, resizable sticky side panel, collapsible sections`.

### Task 5: Clear generation status

**Files:**

- Create: `apps/web/src/GenerationStatus.tsx` and `apps/web/src/status.test.ts`
- Modify: `apps/web/src/App.tsx` (`STAGE` becomes step ids), `apps/web/src/GeneratePanel.tsx`, `apps/web/src/styles.css`

**Interfaces:**

- Produces:
  - `type StepId = 'reading' | 'designing' | 'checking'`.
  - `STEPS: { id: StepId; label: string }[]`, with these labels verbatim: "Reading your requirements", "Designing the architecture", "Checking the design".
  - `formatElapsed(ms: number): string`, for example `0:07` and `1:05`.
  - `<GenerationStatus step startedAt typicalSeconds cancellable onCancel />`.
  - `GeneratePanel` takes `step?: StepId`, `startedAt?: number` and `typicalSeconds?: number` instead of `stage?: string`.

- [ ] **Step 1: Write the failing test** `status.test.ts`:
  - `formatElapsed(7000)` is `'0:07'`, `formatElapsed(65000)` is `'1:05'` and `formatElapsed(0)` is `'0:00'`.
  - `STEPS.map(s => s.label)` equals the three labels above.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - **`GenerationStatus` shows:**
    - a CSS spinner (respecting `prefers-reduced-motion`);
    - an ordered step list marking each step done, current or upcoming (`aria-current="step"` on the current one);
    - the elapsed timer, updated each second;
    - "usually about N s", where N comes from `typicalSeconds`;
    - a Cancel button when cancellable.

    The current step label sits in a `role="status" aria-live="polite"` element, and the timer is outside it.

  - **`App.tsx`:**
    - Track `step` and `startedAt`.
    - Reading switches to designing after `DESIGNING_AFTER_MS` or when the response arrives, and switches to checking while `showGenerated` runs.
    - Continue starts at designing.
    - `typicalSeconds` is `MODEL_OPTIONS.find(o => o.id === (readModelChoice() ?? 'haiku'))?.benchmark.medianLatencySeconds` rounded.
    - The canvas section gets the class `is-busy` while a request runs (`opacity: 0.55; pointer-events: none` on the React Flow pane only, and not on the clarify overlay).
- [ ] **Step 4:** Run `pnpm -r typecheck && pnpm --filter @cloudarchitect/web test && pnpm --filter @cloudarchitect/web build && pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): clear generation status with steps, timer and typical wait`.

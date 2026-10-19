# Editor readability and panel UX — design

Date: 2026-10-18 · Status: approved in chat by the product owner · Scope: `apps/web` (+ one optional field in `packages/domain`)

## Why

Manual testing of Phase 2 (five annotated screenshots, 2026-10-18) found the generated diagram hard to
read and the side panel hard to use. A generated design has to be readable the moment it appears, or
the AI result looks worse than it is. These fixes land before Phase 3.

## What the product owner asked for (verbatim intent)

1. The tool panel is resizable, more user-friendly, slightly bigger font; the generate buttons and
   design options are always visible; a light/dark background toggle, **light by default**.
2. Every rectangle — group (container) or component (service node) — can be resized freely.
3. The activity status while generating is much clearer.
4. The final solution has a clear view: auto zoom in/out, and components, relations and text are easy
   to read right after generation. All of these were confirmed as problems: cut-off component names,
   overlapping connection labels, crossing lines.
5. The AI model panel is collapsed by default and expands on click.

## Goals

### 1. Readable diagram after generation and after Auto layout

- Service nodes default to about 220 px wide. The component name and the service name wrap to at most
  two lines each instead of ending in "…"; the full text is in a `title` tooltip.
- Edge labels take part in layout: ELK gets each label with an estimated size (labels wrap at about
  160 px, at most 2 lines), so layered layout reserves space for them between layers.
- Edges are routed orthogonally (`elk.edgeRouting: ORTHOGONAL`) with more spacing between nodes,
  layers and edges than today. The route ELK computes (bend points and label position) is drawn while
  it is valid. Once an endpoint is moved by hand, or after a reload (routes are not persisted), the
  edge falls back to React Flow's `smoothstep` edge with its label at the midpoint.
- After every generation, Restore, Import and Auto layout, the viewport fits the whole diagram with
  padding and never zooms past 100 % (`maxZoom: 1` for the fit), so a small diagram is not blown up and
  a large one is shrunk to fit — down to the existing `minZoom` 0.2.
- The fit uses the visible canvas area: the side panel is beside the canvas, not over it.

### 2. Free resizing

- Every container and service node shows React Flow `NodeResizer` handles when selected (hidden
  while a generation is running).
- Minimum sizes: service 160 × 56; container 160 × 80. A container cannot be shrunk smaller than its
  children's bounding box.
- Sizes are stored in the project: containers already have `size`; service nodes get an optional
  `size` (schema 1.3.0 → 1.4.0, migration adds nothing). Files without it load with the default size.
  `size` stays excluded from the content hash, so resizing is a layout change, not a content edit
  (the "you edited this diagram" confirmation is not triggered by moves or resizes, as today).
- A resize is a hand edit like a drag: it commits the project (revision + 1, saved).
- **Auto layout resets every size to the defaults** (my call): ELK needs the sizes free, and keeping
  hand sizes would fight the layout.

### 3. Side panel

- The panel's left edge is a drag handle; width between 320 px and 50 % of the window, default 380 px,
  remembered in `localStorage` (wrapped in try/catch; falls back to the default). Keyboard: the
  handle is focusable and Left/Right arrows change the width by 16 px.
- Base font size 15 px → 16 px in the panel; headings and buttons scale with it.
- The top block — description, design-priority chips, review checkbox, the replace note, the status
  block and the Generate/Cancel buttons — is sticky at the top of the panel. Details, Findings,
  Versions, AI model and the disclaimer scroll below it.
- **AI model** and **Versions** are collapsible sections (`<details>`/`<summary>`); AI model collapsed
  by default, Versions collapsed by default (my call) with its count in the summary
  ("Versions (5)"). Open/closed state is remembered per browser.

### 4. Light/dark theme

- A theme switch in the top bar: Light / Dark. **Light is the default**, regardless of the OS
  setting (product owner's call). The choice is remembered in `localStorage`.
- Implemented as `data-theme` on `<html>` with the existing CSS variables; React Flow's `colorMode`
  follows the same value (today it is `system`).

### 5. Generation status

- Replaces the grey "Designing…" line with a status block in the sticky area: a spinner, the current
  step in plain words — "Reading your requirements" → "Designing the architecture" → "Checking the
  design" — an elapsed timer ("0:23"), the hint "usually about 50 s" (from the selected model's
  `medianLatencySeconds`), and Cancel beside it. It uses `role="status"` with polite announcements of
  step changes only (not every timer tick).
- While a request runs, the canvas is dimmed slightly and does not accept edits (it already ignores
  drags while busy).
- A step list shows done/current/upcoming steps (my call), so the user sees progress, not just a label.

## Non-goals

- No change to the AI pipeline, gateway, prompts or eval.
- No persisted edge routes or user-drawn bend points.
- No official AWS icons (still generic tiles).
- No undo/redo.

## Constraints

- Everything in English. Existing tests stay green; new behaviour gets unit tests (layout, schema
  migration, panel width clamp, theme default) and a Playwright-free manual check list in the PR.
- Bundle: no new runtime dependency unless it replaces hand-written code of equal size; React Flow
  already ships `NodeResizer` and `smoothstep` edges.
- Accessibility: the resize handle, theme switch and collapsible sections are keyboard operable and
  labelled; colours keep WCAG AA contrast in both themes.

## Left to the builder

Exact spacing values, label-size estimation method, spinner styling, and how edge routes are cached
in memory (as long as they are dropped when an endpoint moves).

## Builder-check answers (my calls, 2026-10-18)

1. **Status steps are client-side, and honest about it.** The gateway sends no progress events and stays
   unchanged. "Reading your requirements" shows until 8 s have passed (the existing
   `DESIGNING_AFTER_MS`) or the response arrives. "Designing the architecture" then shows until the
   response arrives. "Checking the design" covers the browser's own work after the response:
   migration, layout, validation and saving. A Continue after clarification starts at "Designing the
   architecture".
2. **Older saved projects are never re-laid out on load.** A service node without `size` renders at the
   legacy 168 × 64, so stored positions don't overlap. `applyLayout` writes an explicit `size` to
   every node (default 220 wide), so generated, auto-laid-out and imported-then-laid-out diagrams
   use the new size. Import, Restore and load keep stored positions (FR-006) and only fit the view.
3. **When a route is dropped.** A stored ELK route belongs to one layout pass. It is dropped when a hand
   move or resize changes either endpoint or any ancestor container of either endpoint. Routes are
   kept in memory only, keyed by edge id.
4. **Edges get a custom React Flow edge type.** It draws the ELK bend-point path when a valid route
   exists and the smoothstep path otherwise. The label is rendered through `EdgeLabelRenderer` and
   wraps at 160 px, 2 lines max, with the full text in `title`. This needs no new dependency.
5. **Nothing can be edited while busy.** That covers Auto layout, Import, Restore, drag, resize (handles
   hidden), rename and theme-independent canvas edits. This is the existing `busy` rule extended to
   resize.
6. **Cancel or failure leaves the current diagram, its viewport and its routes untouched**: no layout
   and no fit.
7. **A container cannot be shrunk below its children.** Its minimum size is the children's bounding
   box plus the layout padding (top 40, left/right/bottom 16). Shrinking further is blocked and
   children are never moved.
8. **On a narrow window the 320 px minimum wins** over the 50 % maximum.
9. **Versions stays collapsed by default.** The "Restore previous" toast covers the common case. The
   summary shows the count, and the section opens automatically when it gains a version during this
   session.

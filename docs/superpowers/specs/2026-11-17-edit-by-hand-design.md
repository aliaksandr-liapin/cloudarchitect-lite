# 0.4 Edit by hand: design

**Status:** approved by owner 2026-11-18 · **Date:** 2026-11-17 · **Release:** 0.4 (target Jan 2027)
**PRD:** FR-005 (editable canvas, editable edges, undo/redo), FR-014 (manual mode), US-04 (add and
delete nodes, edges and containers), acceptance case "manually added DAX flagged by VR-006".

## Intent and why

Today the editor can move, resize and rename, and nothing else. A design the AI drafted cannot be
corrected: a missing service cannot be added, a wrong connector cannot be re-plugged or removed,
and Cmd+Z does nothing. The owner hit all three on 16 Nov, along with a bug where Backspace hid
nodes the design still held (fixed in PR #53 by turning delete off).

0.4 makes the diagram fully editable by hand, with the 25 rules re-checking after every edit.

**Who it serves first (owner's call delegated, decided 17 Nov):** someone fixing a design the AI
drafted. That is the product's job and the PRD story. The demo visitor gets the same features for
free, because the demo already runs the validator in the browser; "drag DAX in and watch VR-006
fire" is the demo moment, and it falls out of the same build.

## Goals

1. **Add** from a Services panel: catalog services (38, grouped by catalog `category`, with
   search), external actors (user, client app, third-party, on-premises) and containers (kinds from
   `containers.json`). Drag onto the canvas or into a container; a keyboard path (Add button) also
   works.
2. **Connect:** drag from a node's source handle to another node's target handle.
   2a. **Move into or out of a container:** dropping an existing node inside a container makes that
   its container (`moveToContainer`); dropping it outside all containers clears it. Fixing "RDS in a
   public subnet" needs this.
3. **Re-plug:** drag either end of an existing connector to another node.
4. **Edit a connector** in Details (click to select it): label, kind (`EdgeKind`), protocol, auth
   notes.
5. **Edit a node's requirement links** in Details: tick from the design's existing requirements.
   This is what clears VR-006 and the requirement-coverage rule, so editing without it would leave
   findings the user cannot resolve by hand.
6. **Delete** nodes, connectors and containers: Delete/Backspace and a Delete button in Details.
7. **Undo/redo:** Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z (and Ctrl+Y), plus toolbar buttons. Covers every hand
   edit, including the existing move, resize and rename.
8. **Live findings:** every edit goes through `commit()`, so the Findings list, saving and every
   export always match what is on screen.

## Non-goals (0.4)

- Editing requirement text, adding requirements, or editing `configuration` / feature keys
  (encryption, OAC and so on). Later release; the rules that depend on them stay as they are.
- Copy/paste, multi-select bulk edits, alignment tools.
- Changing a node's service type in place (delete and add instead).
- Undo history that survives reload or crosses a generate, restore or import (Versions cover that).
- Any AI involvement (that is 0.6 Edit with AI, which reuses this work).

## Anti-goals (a failure even if it works)

- Anything on screen that the design does not hold, or the reverse. PR #53's bug must never come
  back in any form: React Flow state is a view, the `Project` is the truth.
- An edit that produces an invalid project (schema) or silently drops data the user did not delete.
- A hand edit that triggers a full auto-layout and scatters the user's arrangement.

## Constraints (from the code)

- `commit(next, forceLayout, opts)` in `apps/web/src/App.tsx` is the single path for changes; it
  lays out only when `needsLayout(p)` (a container without position or size), persists, and
  re-renders. Hand edits must set positions and sizes so `needsLayout` stays false.
- `packages/domain/src/patch.ts` already defines `PatchOp` (add/remove/update for nodes, edges and
  containers, plus `moveToContainer`) and `applyPatch`, which re-parses through `Project.parse`.
  `removeNode` also removes its edges; `removeContainer` detaches its children to the parent.
- Edges without an ELK route fall back to a smoothstep path (`edges.tsx`); `dropRoutes` drops routes
  for moved nodes. New and re-plugged edges simply have no route.
- Nodes already have one target handle (left) and one source handle (right) (`nodes.tsx`).
- `replaceDecision` (versions.ts) uses `generation.contentHash` to ask before a new generation
  replaces a hand-edited design; it keeps working because every hand edit changes content.
- Container nesting follows `allowedParents` in `packages/catalog/data/aws/containers.json`.
- `LIMITS.maxNodes` is 150.
- Edits are held while `busy` (generation, replace flow, dialog), as drag and rename are today.

## Approaches considered

**Undo**

|                            | How                                                                                   | Trade-off                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Snapshots (picked)**  | Keep a past/future stack of `Project` values; each hand edit pushes the previous one. | Simplest and exact: covers move, resize, rename and every new edit with no per-op logic. Memory is trivial (designs ≤150 nodes; cap 100 steps).                                             |
| B. Inverse patches         | Record each `GraphPatch` and compute its inverse.                                     | Elegant and shareable with 0.6, but `removeNode` cascades to edges and `removeContainer` re-parents children, so inverses need the removed data captured; more code, more ways to be wrong. |
| C. React Flow as the store | Let React Flow apply changes and sync back.                                           | Rejected: that split is exactly the PR #53 bug.                                                                                                                                             |

**Applying edits:** every structural edit is expressed as `PatchOp`s and applied with `applyPatch`
(picked), rather than ad-hoc object spreads in App.tsx. One tested path, schema-checked, and 0.6
Edit with AI reuses it. Moves and resizes keep their current code.

## Design

### State

- New module `apps/web/src/history.ts`: a pure past/present/future reducer over `Project`
  (`record`, `undo`, `redo`, `clear`, `canUndo`, `canRedo`), capped at 100. Unit-tested on its own.
- A new hand-edit entry point in App.tsx, `edit(ops: PatchOp[] | ((p) => Project), opts)`, that
  records the current project in history and calls `commit`. Drag, resize and rename move onto it.
- Undo/redo call `commit(snapshot, false, { recover: true })` so routes are recomputed for what is
  still valid.
- History is cleared on generate, restore, import and initial load.
- Coalescing: one drag = one step (already true: commit runs on drag stop). One rename = one step.
  Typing in a Details field commits on blur/Enter, so it is one step per field.

### Add (Services panel)

- A collapsible "Add" section in the side panel above Details: search box, then groups by catalog
  category (compute, database, …), then "Outside AWS" (the four external kinds), then "Containers"
  (the six kinds). Each item shows the icon and display name, is draggable, and has an Add button
  for keyboard users.
- Drop on canvas → `addNode` at the drop position (`screenToFlowPosition`). Drop inside a container
  → also sets `containerId` to the innermost container under the drop point, position relative to it.
- Add button → places the item at the viewport centre, or inside the selected container.
- New node: `id` = `${serviceId-or-kind}-${short random}` (unique, ≤128 chars), `label` = display
  name, `requirementIds: []`, `provider: 'aws'`, external actors as `external: { kind, name }`.
- New container: a fixed default size (for example 320×200) and position, so `needsLayout` stays
  false. Dropping a container where its kind is not an allowed child: refuse with a toast naming the
  allowed parents.
- At 150 nodes the Add items are disabled with a note.

### Connect, re-plug, edit connectors

- `onConnect` → `addEdge` with kind `other`, no label; the new edge is selected so Details opens on
  it. Self-loops and an exact duplicate (same source, target) are refused.
- `edgesReconnectable` + `onReconnect` → `updateEdge` changing `source`/`target`.
- Selection: `onSelectionChange` currently tracks nodes only; it will also track edges, and Details
  gains an edge view: from → to (read-only), label, kind (select), protocol, auth notes, and a
  Delete button.

### Node Details additions

- Requirements: a checklist of the design's requirements (id + text); toggling updates
  `requirementIds`.
- Delete button. Containers: label, subnet type for subnets, Delete button.

### Delete

- Re-enable React Flow's delete keys but route them: `onBeforeDelete` returns false and instead
  issues `removeNode` / `removeEdge` / `removeContainer` ops through `edit()`. React Flow never
  removes anything itself.
- Deleting a container keeps its contents (moved to the parent, as `applyPatch` does). No prompt:
  Undo is one keystroke away, and the toast says "Container deleted · Undo".
- Delete keys are ignored while focus is in a text field.

### Undo/redo controls

- Keyboard: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y, ignored while a text field has focus (the
  browser's own text undo wins there).
- Two buttons (Undo, Redo) in the canvas controls, disabled when there is nothing to do.

### Demo

Everything works in the demo. Edits there persist only in that browser, as today. No new copy
beyond the existing banner.

## Testing

- Domain: existing `applyPatch` tests plus any new edge cases (re-plug via `updateEdge`, container
  detach).
- Web unit: `history.ts` reducer (cap, redo cleared by a new edit, clear); id generation; drop-target
  container selection.
- E2E (extends `e2e/tests/claude.spec.ts` or a new spec): add DAX → VR-006 appears; link it to a
  requirement → VR-006 disappears; connect two nodes; delete a node → its edges go too and the JSON
  export matches; Cmd+Z restores it; Cmd+Shift+Z removes it again. Replace the PR #53 test
  ("delete keys do not hide nodes") with "delete keys delete from the design".
- Acceptance case from the PRD: manually added DAX flagged by VR-006.

## Left to the builder

- Exact visual design of the Add section and edge Details (follow existing `styles.css`).
- Whether the canvas Undo/Redo buttons live in React Flow `<Controls>` or the header.
- Default container size and exact id format.
- Splitting App.tsx (1,037 lines) where the new code makes a natural module (`Details`, the Add
  panel); not a refactor for its own sake.

## Calls made without the owner (check these)

1. Primary user: someone fixing an AI draft; the demo benefits for free.
2. Requirement links are in scope (needed so VR-006 can be cleared by hand); requirement text and
   `configuration` editing are not.
3. Snapshot undo, capped at 100 steps, session-only, cleared on generate/restore/import.
4. Deleting a container keeps its contents and does not prompt (Undo instead).
5. New connectors start as kind `other` with no label, and Details opens on them.
6. Dragging an existing node into or out of a container re-parents it (added after the builder
   check: without it, a misplaced database cannot be fixed by hand).

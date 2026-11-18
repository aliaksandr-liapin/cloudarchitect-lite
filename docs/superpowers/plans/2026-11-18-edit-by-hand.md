# 0.4 Edit by hand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the diagram fully editable by hand (add, connect, re-plug, edit connectors and
requirement links, move into/out of containers, delete, undo/redo), with findings re-checked after
every edit.

**Architecture:** The `Project` stays the only source of truth; React Flow is a view. Every hand
edit goes through one new `edit()` entry point in `App.tsx` that records the previous project in a
snapshot history (`history.ts`) and calls the existing `commit()`. Structural changes are expressed
with the domain's `PatchOp`/`applyPatch`; geometry-aware changes (re-parenting, new items) are pure
helpers in `edit.ts`.

**Tech Stack:** React 19 + `@xyflow/react` 12, TypeScript, zod, Vitest (`renderToStaticMarkup` for
component tests), Playwright e2e against the Docker stack.

**Spec:** `docs/superpowers/specs/2026-11-17-edit-by-hand-design.md` (approved 2026-11-18)

## Global Constraints

- The `Project` is the truth. React Flow must never add, remove or re-parent anything itself; every
  change reaches the screen only through `commit()` (the PR #53 bug must not come back).
- No hand edit may trigger a full auto-layout: new containers get a `position` and `size`, so
  `needsLayout(p)` stays false. Only the "Auto layout" button lays out.
- Every result goes through `Project.parse` (via `applyPatch`, or explicitly for function-form edits).
- Undo history: snapshots of `Project`, cap **100**, session only; cleared on initial load,
  generate, restore and import.
- Keyboard: Cmd/Ctrl+Z undo; Cmd/Ctrl+Shift+Z and Ctrl+Y redo; Delete/Backspace delete. All ignored
  while focus is in an `input`, `textarea`, `select` or contenteditable element.
- No edits while `busy` (generation, replace flow or dialog), including undo/redo and Add.
- `LIMITS.maxNodes` is 150: Add is disabled at the limit.
- New connectors: `kind: 'other'`, no label, `requirementIds: []`; self-loops and an exact duplicate
  (same source and target) are refused.
- Deleting a container keeps its contents (moved to its parent, unchanged on screen), with no prompt;
  the toast reads `Container deleted` with an Undo button.
- English only; public docs carry no personal-brand wording.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Deleting a container via the keyboard.** React Flow's `onBeforeDelete` also lists the
   container's child nodes; only the selected items may be deleted, children must survive
   (Task 2 `deletionOps` test, Task 6 e2e).
2. **Cmd+Z while typing in a Details field** must undo the text, not the diagram (Task 3
   `isTextTarget` test).
3. **Undo of a node delete** must bring back its connectors too, and the findings with it (Task 3
   history test; Task 8 e2e).
4. **Re-parenting must not make anything jump on screen:** moving a node into/out of nested
   containers, and removing a container, keep every absolute position (Task 2 tests).
5. **Edits during a generation** (busy) are ignored, including undo/redo and Add (Task 3 test of
   `shouldHandleShortcut`).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/domain/src/patch.ts` (modify) | `removeContainer` keeps children in place on screen |
| `apps/web/src/history.ts` (create) | Pure snapshot undo/redo reducer |
| `apps/web/src/edit.ts` (create) | Pure edit helpers: ids, new items, geometry, nesting, deletion, connect checks, shortcut matching |
| `apps/web/src/Details.tsx` (create) | Details panel moved out of `App.tsx`: node, connector and container views |
| `apps/web/src/AddPanel.tsx` (create) | Services/actors/containers list with search, drag and Add buttons |
| `apps/web/src/layout.ts` (modify) | `toFlow`: service nodes no longer locked inside their container (`extent`) |
| `apps/web/src/App.tsx` (modify) | `edit()`, history state, wiring of every interaction |
| `e2e/tests/claude.spec.ts` (modify) | End-to-end edit journey |
| `CHANGELOG.md` (modify) | Unreleased → Added |

---

### Task 1: Removing a container keeps its contents in place

**Files:**
- Modify: `packages/domain/src/patch.ts` (`removeContainer` case)
- Test: `packages/domain/src/domain.test.ts` (inside `describe('applyPatch')`)

**Interfaces:**
- Produces: `applyPatch` semantics later tasks rely on: after `removeContainer`, each direct child
  node and child container has `position` increased by the removed container's `position`
  (`{x:0,y:0}` when absent) and its parent set to the removed container's parent.

- [ ] **Step 1: Write the failing test**

```ts
it('removing a container keeps its children where they are on screen', () => {
  // vpc at (100, 50) inside region r; node n at (10, 20) inside vpc; subnet s at (5, 5) inside vpc
  const next = applyPatch(p, { baseRevision: p.revision, ops: [{ op: 'removeContainer', id: 'vpc' }] });
  expect(next.nodes.find((n) => n.id === 'n')).toMatchObject({ containerId: 'r', position: { x: 110, y: 70 } });
  expect(next.containers.find((c) => c.id === 's')).toMatchObject({ parentId: 'r', position: { x: 105, y: 55 } });
});
```

- [ ] **Step 2: Run it to make sure it fails**
Run: `pnpm --filter @cloudarchitect/domain test -- -t "keeps its children"`
Expected: FAIL (positions unchanged: `{ x: 10, y: 20 }`).

- [ ] **Step 3: Shift direct children by the removed container's position in the `removeContainer` case.**

- [ ] **Step 4: Run the domain tests**
Run: `pnpm --filter @cloudarchitect/domain test`
Expected: all pass.

- [ ] **Step 5: Commit** `fix(domain): removing a container keeps its contents in place`

---

### Task 2: Pure edit helpers (`edit.ts`)

**Files:**
- Create: `apps/web/src/edit.ts`
- Test: `apps/web/src/edit.test.ts`

**Interfaces:**
- Consumes: `Project`, `ArchNode`, `ArchEdge`, `Container`, `ContainerKind`, `PatchOp`, `LIMITS`
  from `@cloudarchitect/domain`; `awsCatalog` from `@cloudarchitect/catalog`; `NODE_SIZE` from
  `./layout`.
- Produces (all exported from `apps/web/src/edit.ts`):
  - `type Point = { x: number; y: number }`
  - `newId(prefix: string): string`: `${prefix}-${8 random [a-z0-9]}`, max 128 chars
  - `newServiceNode(serviceId: string, at: Point, containerId?: string): ArchNode`: label =
    catalog display name, `provider: 'aws'`, `requirementIds: []`, `size: NODE_SIZE`
  - `newExternalNode(kind: ExternalKind, at: Point, containerId?: string): ArchNode`: name and
    label from `EXTERNAL_LABELS`
  - `EXTERNAL_LABELS: Record<ExternalKind, string>` = `{ user: 'User', 'client-app': 'Client app',
    'third-party': 'Third-party service', 'on-premises': 'On-premises system' }`
  - `NEW_CONTAINER_SIZE = { width: 320, height: 200 }`
  - `newContainer(kind: ContainerKind, at: Point, parentId?: string): Container`: label = catalog
    `displayName`; subnets get `properties: { subnetType: 'private' }`
  - `canNest(kind: ContainerKind, parentKind: ContainerKind | undefined): boolean`: top level is
    always allowed; otherwise `allowedParents` from `awsCatalog.containers` must include `parentKind`
  - `absolutePosition(project: Project, containerId: string | undefined): Point`: sum of container
    positions up the parent chain (missing position counts as 0)
  - `containerAt(project: Project, point: Point, exclude?: string): Container | undefined`: the
    innermost (deepest) container whose absolute box contains `point`, ignoring `exclude` and its
    descendants
  - `reparentNode(project: Project, nodeId: string, containerId: string | undefined): Project`:
    keeps the node's absolute position; returns `project` unchanged when the container is the same
  - `deletionOps(project: Project, ids: { nodes: string[]; edges: string[] }): PatchOp[]`: one op
    per selected id (`removeNode`, `removeContainer` or `removeEdge`), ignoring unknown ids
  - `connectionError(project: Project, source: string, target: string): string | undefined`:
    `'A component cannot connect to itself.'` or `'These two are already connected.'`
  - `newEdge(source: string, target: string): ArchEdge`
  - `toggleRequirement(ids: string[], id: string): string[]`
  - `atNodeLimit(project: Project): boolean`

- [ ] **Step 1: Write the failing tests** in `edit.test.ts`, one `it` per helper, including:

```ts
it('containerAt picks the innermost container', () => {
  // region R (0,0 600x400) > vpc V (50,50 400x300) > subnet S (20,40 200x150)
  expect(containerAt(p, { x: 100, y: 120 })?.id).toBe('S'); // 50+20 ≤ 100, 50+40 ≤ 120
  expect(containerAt(p, { x: 460, y: 60 })?.id).toBe('V');
  expect(containerAt(p, { x: 700, y: 10 })).toBeUndefined();
});
it('reparentNode keeps the absolute position', () => {
  const next = reparentNode(p, 'n', 'S'); // n at (300, 300) top level
  expect(next.nodes.find((n) => n.id === 'n')).toMatchObject({ containerId: 'S', position: { x: 230, y: 210 } });
  expect(reparentNode(next, 'n', undefined).nodes.find((n) => n.id === 'n')?.position).toEqual({ x: 300, y: 300 });
});
it('deletionOps deletes only what was selected', () => {
  expect(deletionOps(p, { nodes: ['V'], edges: [] })).toEqual([{ op: 'removeContainer', id: 'V' }]);
  expect(deletionOps(p, { nodes: ['n', 'nope'], edges: ['e1'] })).toEqual([
    { op: 'removeNode', id: 'n' }, { op: 'removeEdge', id: 'e1' }]);
});
it('canNest follows the catalog', () => {
  expect(canNest('subnet', 'availability-zone')).toBe(true);
  expect(canNest('subnet', 'region')).toBe(false);
  expect(canNest('vpc', undefined)).toBe(true);
});
it('connectionError refuses self-loops and duplicates', () => { /* both messages, and undefined for a new pair */ });
it('newServiceNode parses as an ArchNode with the catalog name', () => {
  const n = newServiceNode('aws.dax', { x: 0, y: 0 });
  expect(ArchNode.parse(n).label).toBe('DynamoDB Accelerator (DAX)');
  expect(n.requirementIds).toEqual([]);
});
it('newContainer has a size, so adding one never triggers auto-layout', () => {
  expect(needsLayout({ ...p, containers: [...p.containers, newContainer('vpc', { x: 0, y: 0 })] })).toBe(false);
});
```

- [ ] **Step 2: Run them to make sure they fail**
Run: `pnpm --filter @cloudarchitect/web test -- edit.test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helpers** listed under Interfaces.

- [ ] **Step 4: Run the tests**
Run: `pnpm --filter @cloudarchitect/web test -- edit.test`
Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): pure helpers for hand edits`

---

### Task 3: Snapshot history, `edit()`, undo/redo

**Files:**
- Create: `apps/web/src/history.ts`, `apps/web/src/history.test.ts`
- Modify: `apps/web/src/edit.ts` (+ shortcut helpers), `apps/web/src/edit.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces (`history.ts`):
  - `type History = { past: Project[]; future: Project[] }`, `EMPTY_HISTORY`, `HISTORY_LIMIT = 100`
  - `record(h: History, previous: Project): History`: pushes, clears `future`, drops the oldest
    beyond 100
  - `undo(h: History, current: Project): { history: History; project: Project } | undefined`
  - `redo(h: History, current: Project): { history: History; project: Project } | undefined`
  - Undo/redo return the snapshot with `revision: current.revision + 1` (revisions only go up).
- Produces (`edit.ts`):
  - `type Shortcut = 'undo' | 'redo' | 'delete'`
  - `shortcutFor(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>): Shortcut | undefined`
  - `isTextTarget(target: EventTarget | null): boolean`
  - `shouldHandleShortcut(e: KeyboardEvent, busy: boolean): Shortcut | undefined`: undefined when
    busy or `isTextTarget(e.target)`
- Produces (`App.tsx`, used by Tasks 4–7):
  - `edit(change: PatchOp[] | ((p: Project) => Project), opts?: { routes?: Routes; forceLayout?: boolean; toast?: string }): void`:
    no-op when busy or no project; records the current project; applies `applyPatch` for ops, or the
    function then `Project.parse` with `revision + 1`; calls `commit`. With `toast`, shows it with an
    Undo button.
  - `undoEdit(): void`, `redoEdit(): void`: commit with `{ recover: true }`.

- [ ] **Step 1: Write the failing tests**

```ts
// history.test.ts
it('undo returns the previous design and redo the next', () => {
  const h = record(EMPTY_HISTORY, a);
  const u = undo(h, b)!; expect(u.project.nodes).toEqual(a.nodes); expect(u.project.revision).toBe(b.revision + 1);
  const r = redo(u.history, u.project)!; expect(r.project.nodes).toEqual(b.nodes);
});
it('a new edit clears redo', () => { const u = undo(record(EMPTY_HISTORY, a), b)!; expect(record(u.history, u.project).future).toEqual([]); });
it('keeps at most 100 steps', () => { /* record 101 times → past.length 100 and past[0] is the 2nd */ });
it('undo of a node delete brings back its connectors', () => {
  const after = applyPatch(a, { baseRevision: a.revision, ops: [{ op: 'removeNode', id: a.nodes[0]!.id }] });
  expect(undo(record(EMPTY_HISTORY, a), after)!.project.edges).toEqual(a.edges);
});
it('nothing to undo or redo returns undefined', () => { expect(undo(EMPTY_HISTORY, a)).toBeUndefined(); });

// edit.test.ts
it('shortcutFor maps the keys', () => {
  expect(shortcutFor({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: false })).toBe('undo');
  expect(shortcutFor({ key: 'z', metaKey: false, ctrlKey: true, shiftKey: true })).toBe('redo');
  expect(shortcutFor({ key: 'Z', metaKey: true, ctrlKey: false, shiftKey: true })).toBe('redo');
  expect(shortcutFor({ key: 'y', metaKey: false, ctrlKey: true, shiftKey: false })).toBe('redo');
  expect(shortcutFor({ key: 'Backspace', metaKey: false, ctrlKey: false, shiftKey: false })).toBe('delete');
  expect(shortcutFor({ key: 'z', metaKey: false, ctrlKey: false, shiftKey: false })).toBeUndefined();
});
it('shortcuts are ignored in text fields and while busy', () => {
  const input = document.createElement('input');
  expect(shouldHandleShortcut(keyEvent('z', { metaKey: true }, input), false)).toBeUndefined();
  expect(shouldHandleShortcut(keyEvent('z', { metaKey: true }, document.body), true)).toBeUndefined();
  expect(shouldHandleShortcut(keyEvent('z', { metaKey: true }, document.body), false)).toBe('undo');
});
```

If the web Vitest environment has no DOM, test `isTextTarget` with plain objects shaped like
elements (`{ tagName: 'INPUT' }`, `{ isContentEditable: true }`) instead of adding jsdom.

- [ ] **Step 2: Run them to make sure they fail**
Run: `pnpm --filter @cloudarchitect/web test -- history edit`
Expected: FAIL.

- [ ] **Step 3: Implement `history.ts` and the shortcut helpers.**

- [ ] **Step 4: Wire `App.tsx`:**
  - history in a ref plus a `canUndo`/`canRedo` state for the buttons;
  - `edit`, `undoEdit` and `redoEdit` as specified;
  - move `onNodeDragStop`, `onResized`, `rename` and the **Auto layout** button
    (`edit(p => p, { forceLayout: true })`) onto `edit`;
  - clear history at the four `commit` call sites for boot, `showGenerated`, `restore` and import;
  - a document `keydown` listener using `shouldHandleShortcut` for undo/redo (`preventDefault`);
  - Undo and Redo buttons (`aria-label="Undo"` / `"Redo"`, disabled when nothing to do or busy)
    in the header after **Auto layout**.

- [ ] **Step 5: Run checks**
Run: `pnpm --filter @cloudarchitect/web test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit** `feat(web): undo and redo for every hand edit`

---

### Task 4: Move nodes into and out of containers

**Files:**
- Modify: `apps/web/src/layout.ts` (`toFlow`), `apps/web/src/layout.test.ts`
- Modify: `apps/web/src/App.tsx` (`onNodeDragStop`)

**Interfaces:**
- Consumes: `containerAt`, `reparentNode`, `absolutePosition` (Task 2); `edit` (Task 3).

- [ ] **Step 1: Write the failing test** in `layout.test.ts`:

```ts
it('service nodes can leave their container; containers stay inside their parent', () => {
  const { nodes } = toFlow(p, (id) => id);
  expect(nodes.find((n) => n.id === 'node-in-vpc')).toMatchObject({ parentId: 'vpc' });
  expect(nodes.find((n) => n.id === 'node-in-vpc')?.extent).toBeUndefined();
  expect(nodes.find((n) => n.id === 'subnet-in-vpc')?.extent).toBe('parent');
});
```

- [ ] **Step 2: Run it to make sure it fails**
Run: `pnpm --filter @cloudarchitect/web test -- layout`
Expected: FAIL (`extent` is `'parent'`).

- [ ] **Step 3: In `toFlow`, set `extent: 'parent'` only for containers.**

- [ ] **Step 4: In `onNodeDragStop`, for a service node:** compute its centre in flow coordinates
  (`absolutePosition(project, node.containerId)` + dragged position + half its size). Then call
  `containerAt(project, centre)`. If that differs from `containerId`, apply one `edit` that sets the
  dropped position and then `reparentNode`. Otherwise keep the current position-only edit. Drop the
  routes for the node (`dropRoutes`), as today.

- [ ] **Step 5: Run checks** `pnpm --filter @cloudarchitect/web test && pnpm typecheck`; expected pass.

- [ ] **Step 6: Commit** `feat(web): drag a component into or out of a container`

---

### Task 5: Details panel: connectors, containers, requirement links, Delete buttons

**Files:**
- Create: `apps/web/src/Details.tsx`, `apps/web/src/details.test.tsx`
- Modify: `apps/web/src/App.tsx` (remove `Details`/`describe`, select edges, pass callbacks)

**Interfaces:**
- Consumes: `toggleRequirement`, `deletionOps` (Task 2); `edit` (Task 3).
- Produces:
  ```ts
  export type Selection = { kind: 'node' | 'edge'; id: string };
  export function Details(props: {
    project: Project;
    selection: Selection;
    disabled: boolean;
    onEdit: (ops: PatchOp[]) => void;
  }): JSX.Element | null;
  ```
  The node view keeps today's fields and adds a **Requirements** checklist (one checkbox per
  `project.requirements`, label `${id}: ${text}`, "No requirements in this design" when empty) and
  a **Delete** button. The connector view has: From → To (read-only labels), **Label** (input,
  max 200), **Kind** (select of `EdgeKind`), **Protocol** (input, max 100), **Auth notes**
  (textarea, max 2000), **Delete**. The container view has: **Name** (input), **Subnet type**
  (select public/private, subnets only), **Delete**. Text fields commit on blur/Enter as
  `updateNode`/`updateEdge`/`updateContainer` with only the changed field; an unchanged or (for
  names) blank value commits nothing.
- App: `selected` becomes `Selection | undefined`. `onSelectionChange` takes the first selected
  node, else the first selected edge. `locate()` sets `{ kind: 'node', id }`. Deleting a container
  passes `toast: 'Container deleted'`.

- [ ] **Step 1: Write the failing tests** (`renderToStaticMarkup`, as in `setup.test.tsx`):

```ts
it('connector view shows its fields', () => {
  const html = render({ kind: 'edge', id: p.edges[0]!.id });
  for (const label of ['Label', 'Kind', 'Protocol', 'Auth notes', 'Delete']) expect(html).toContain(label);
});
it('node view lists requirements as checkboxes, linked ones checked', () => { /* one checked, one not */ });
it('subnet shows subnet type; vpc does not', () => { /* ... */ });
it('unknown id renders nothing', () => { expect(render({ kind: 'edge', id: 'nope' })).toBe(''); });
```

- [ ] **Step 2: Run them to make sure they fail**
Run: `pnpm --filter @cloudarchitect/web test -- details`
Expected: FAIL.

- [ ] **Step 3: Implement `Details.tsx` and wire it in `App.tsx`.**

- [ ] **Step 4: Run checks** `pnpm --filter @cloudarchitect/web test && pnpm typecheck && pnpm lint`; expected pass.

- [ ] **Step 5: Commit** `feat(web): edit connectors, containers and requirement links in Details`

---

### Task 6: Delete with the keyboard; connect and re-plug

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `deletionOps`, `connectionError`, `newEdge` (Task 2); `edit` (Task 3).

- [ ] **Step 1: Delete keys.** Remove `deleteKeyCode={null}` and its comment. Add
  `onBeforeDelete={async ({ nodes, edges }) => { edit(deletionOps(project, { nodes: nodes.filter(n => n.selected).map(n => n.id), edges: edges.filter(e => e.selected).map(e => e.id) })); return false; }}`
  (pass the toast when a container is among them). React Flow never deletes anything itself, and
  children it adds to the list stay because they are not selected.

- [ ] **Step 2: Connect.** `onConnect={({ source, target }) => ...}`: show `connectionError` as a
  toast and stop when set; otherwise `edit([{ op: 'addEdge', edge }])` and select the new edge.

- [ ] **Step 3: Re-plug.** Set `edgesReconnectable`. On `onReconnect(old, conn)`, check
  `connectionError` against the design without `old`, then
  `edit([{ op: 'updateEdge', id: old.id, changes: { source, target } }])` and drop that edge's route.

- [ ] **Step 4: Run checks** `pnpm --filter @cloudarchitect/web test && pnpm typecheck && pnpm lint`; expected pass.
  Behaviour is covered end to end in Task 8.

- [ ] **Step 5: Commit** `feat(web): delete, connect and re-plug by hand`

---

### Task 7: Add panel

**Files:**
- Create: `apps/web/src/AddPanel.tsx`, `apps/web/src/addPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `newServiceNode`, `newExternalNode`, `newContainer`, `canNest`, `containerAt`,
  `absolutePosition`, `atNodeLimit`, `EXTERNAL_LABELS` (Task 2); `edit` (Task 3).
- Produces:
  ```ts
  export type AddItem =
    | { type: 'service'; serviceId: string }
    | { type: 'external'; kind: ExternalKind }
    | { type: 'container'; kind: ContainerKind };
  export const DRAG_MIME = 'application/x-cloudarchitect-add';
  export function filterServices(query: string): { category: string; services: CloudService[] }[];
  export function AddPanel(props: {
    disabled: boolean; atLimit: boolean; iconUrls: IconUrls; onAdd: (item: AddItem) => void;
  }): JSX.Element;
  ```
  `filterServices` matches case-insensitively on display name, id and capabilities, groups by
  `category` (alphabetical), and drops empty groups. The panel is a collapsible "Add" section
  (reuse `Collapsible.tsx`) above Details. It holds a search box, the service groups, "Outside AWS"
  (the four external kinds) and "Containers" (the six kinds). Each row is `draggable` and sets
  `DRAG_MIME` to the JSON `AddItem`, and has an **Add** button with `aria-label={`Add ${name}`}`.
  At the limit, a note reads "This design has the maximum of 150 components."

- App: the canvas section gets `onDragOver` (preventDefault when `DRAG_MIME` is present) and `onDrop`:
  `screenToFlowPosition`, then `containerAt`, then the new item at the position relative to that
  container. A container whose kind cannot nest there gets the toast
  `A ${kind name} can only go inside: ${allowed parents}.`. The **Add** button places the item
  at the viewport centre, or inside the selected container when one is selected. The new item is
  selected after adding.

- [ ] **Step 1: Write the failing tests**

```ts
it('filterServices finds DAX by name and groups by category', () => {
  const groups = filterServices('dax');
  expect(groups).toHaveLength(1);
  expect(groups[0]!.services.map((s) => s.id)).toEqual(['aws.dax']);
});
it('an empty query lists all 38 services', () => {
  expect(filterServices('').flatMap((g) => g.services)).toHaveLength(38);
});
it('at the limit the Add buttons are disabled and the note shows', () => { /* render atLimit */ });
```

- [ ] **Step 2: Run them to make sure they fail**
Run: `pnpm --filter @cloudarchitect/web test -- addPanel`
Expected: FAIL.

- [ ] **Step 3: Implement `AddPanel.tsx`, the drop handling and styles.**

- [ ] **Step 4: Run checks** `pnpm --filter @cloudarchitect/web test && pnpm typecheck && pnpm lint`; expected pass.

- [ ] **Step 5: Commit** `feat(web): add services, actors and containers from a panel`

---

### Task 8: End-to-end journey and changelog

**Files:**
- Modify: `e2e/tests/claude.spec.ts` (replace the test "delete keys do not hide nodes")
- Modify: `CHANGELOG.md` (Unreleased → `### Added`)

- [ ] **Step 1: Replace the PR #53 test** with tests run in order on the restored `dental` design:

```ts
test('add a service by hand and see its finding', async () => {
  await page.getByRole('searchbox', { name: 'Search services' }).fill('dax');
  await page.getByRole('button', { name: 'Add DynamoDB Accelerator (DAX)' }).click();
  await expect(canvas(page).getByText('DynamoDB Accelerator (DAX)').first()).toBeVisible();
  await expect(page.locator('.findings').getByText('VR-006')).toBeVisible();
});
test('linking a requirement clears it', async () => {
  // DAX is selected after adding; tick the first requirement in Details
  await page.getByRole('checkbox').first().check();
  await expect(page.locator('.findings').getByText('VR-006')).toHaveCount(0);
});
test('delete keys delete from the design, and undo brings it back', async () => {
  const label = dental.nodes[0]!.label;
  await canvas(page).getByText(label, { exact: true }).first().click();
  await page.keyboard.press('Delete');
  await expect(canvas(page).getByText(label, { exact: true })).toHaveCount(0);
  const json = Project.parse(JSON.parse((await download(page, 'JSON project')).toString('utf8')));
  expect(json.nodes.some((n) => n.label === label)).toBe(false);
  expect(json.edges.some((e) => e.source === dental.nodes[0]!.id || e.target === dental.nodes[0]!.id)).toBe(false);
  await page.keyboard.press('ControlOrMeta+z');
  await expectNodes(page, dental);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(canvas(page).getByText(label, { exact: true })).toHaveCount(0);
});
```

Use whatever accessible names Task 7 actually produced. The assertions are the contract.

- [ ] **Step 2: Run the e2e suite**
Run: `pnpm e2e -- claude.spec.ts` (local images; first build is slow)
Expected: all claude tests pass.

- [ ] **Step 3: CHANGELOG.** Under Unreleased `### Added`: "Edit by hand: add services, outside
  actors and containers from the Add panel; connect, re-plug and edit connectors; link components
  to requirements; move components into and out of containers; delete; undo and redo
  (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z). Findings update after every edit." Remove or reword the
  Unreleased `### Fixed` entry from PR #53 so it no longer says the editor has no delete.

- [ ] **Step 4: Full check**
Run: `pnpm run ci`
Expected: lint, format, typecheck, tests and build all pass.

- [ ] **Step 5: Commit** `test(e2e): edit by hand journey; changelog`

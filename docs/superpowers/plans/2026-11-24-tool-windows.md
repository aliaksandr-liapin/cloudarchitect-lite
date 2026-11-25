# Tool Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Add, Findings, Versions and AI model out of the right column into toggleable windows
floating over the canvas's left edge. Make the column default to the toolbar's width and its
controls easier to see.

**Architecture:** A small pure module (`toolWindows.ts`) holds which windows are open, in a fixed
order, and saves that per browser. A `ToolWindow` frame and the toolbar toggles live in
`ToolWindow.tsx`. App renders the open windows in an absolutely positioned stack inside the canvas
`<section>`. The panels lose their `<details>` wrapper (`Collapsible`, deleted) and render only
their contents.

**Tech Stack:** React 19, @xyflow/react 12, vitest (static markup only, no DOM), Playwright e2e
(Docker/CI only), plain CSS in `apps/web/src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-24-tool-windows-design.md`

## Global Constraints

- Window order, toggle order and storage order: `add`, `findings`, `versions`, `model`.
- Toggle labels, exactly: `Add`, `Findings (n)`, `Versions (n)`, `AI model`. Each toggle has
  `aria-pressed`.
- Window titles, exactly: `Add`, `Findings`, `Versions`, `AI model` (no counts). Each window is a
  `<section aria-label={title}>` with an `<h2>` title and a close button named `Close {title}`.
- Storage key `cloudarchitect.toolWindows` holds a JSON array of open window ids. It is read and
  written through `readPref`/`writePref`. A missing or invalid value means all four are closed.
- Saved column width key `cloudarchitect.panelWidth` keeps winning over the toolbar default.
- Existing accessible names stay: `Search services`, the `Add …` buttons, `Restore`, the model
  tables.
- English only. Both themes. Phone width (< 760 px): windows span the canvas width.

## Review Focus

1. A saved open-windows value from an older or edited build (unknown ids, duplicates, not JSON)
   gives a valid, ordered list or all closed, never a crash. Pinned in Task 1.
2. With storage blocked (private mode), toggling still works for the session. `readPref` and
   `writePref` already swallow errors; Task 1 uses only them.
3. The column default when the toolbar is wider than half the window, or the window is narrow:
   clamped exactly like a dragged width. Pinned in Task 2.
4. Clicking a finding while the Findings window covers the component it selects: the canvas still
   pans to it (existing `locate`). Checked in the Task 3 browser check.
5. Dragging a service from the Add window onto the canvas: the window sits inside the canvas
   section, so the drop must still reach `onCanvasDrop`. Checked in the Task 3 browser check.

---

### Task 1: Open-window state

**Files:**
- Create: `apps/web/src/toolWindows.ts`
- Test: `apps/web/src/toolWindows.test.ts`

**Interfaces:**
- Produces:
  - `export type ToolWindowId = 'add' | 'findings' | 'versions' | 'model'`
  - `export const TOOL_WINDOWS: readonly ToolWindowId[]` (the order above)
  - `export const TOOL_WINDOWS_KEY = 'cloudarchitect.toolWindows'`
  - `export function parseOpenWindows(raw: string): ToolWindowId[] | undefined`
  - `export function readOpenWindows(): ToolWindowId[]`
  - `export function toggleWindow(open: readonly ToolWindowId[], id: ToolWindowId): ToolWindowId[]`

- [ ] **Step 1: Write the failing tests**

```ts
describe('tool windows', () => {
  it('toggleWindow opens in the fixed order and closes', () => {
    expect(toggleWindow([], 'model')).toEqual(['model']);
    expect(toggleWindow(['model'], 'add')).toEqual(['add', 'model']);
    expect(toggleWindow(['add', 'model'], 'add')).toEqual(['model']);
  });
  it('parseOpenWindows keeps known ids once, in order', () => {
    expect(parseOpenWindows('["versions","add","add","nope"]')).toEqual(['add', 'versions']);
    expect(parseOpenWindows('[]')).toEqual([]);
  });
  it('parseOpenWindows rejects what is not a list', () => {
    expect(parseOpenWindows('not json')).toBeUndefined();
    expect(parseOpenWindows('{"add":true}')).toBeUndefined();
  });
  it('readOpenWindows starts with everything closed', () => {
    expect(readOpenWindows()).toEqual([]); // no localStorage in vitest: readPref falls back
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/web exec vitest run src/toolWindows.test.ts`.
  Expected: FAIL (module not found).
- [ ] **Step 3: Implement** in `toolWindows.ts`. `parseOpenWindows` wraps `JSON.parse` in
  try/catch and returns `TOOL_WINDOWS.filter((id) => list.includes(id))` for an array.
  `readOpenWindows` is `readPref(TOOL_WINDOWS_KEY, parseOpenWindows, [])`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "web: open tool-window state"`.

### Task 2: Column width defaults to the toolbar's width

**Files:**
- Modify: `apps/web/src/prefs.ts`, `apps/web/src/App.tsx` (header around 1042, width state at 172)
- Test: `apps/web/src/prefs.test.ts`

**Interfaces:**
- Produces:
  - `export function toolbarPanelWidth(windowWidth: number, toolbarLeft: number): number`, which
    is `clampPanelWidth(windowWidth - toolbarLeft, windowWidth)`
  - `export function readSavedPanelWidth(): number | undefined` (the saved width, or `undefined`
    if none is saved)

- [ ] **Step 1: Write the failing tests** in `prefs.test.ts`:

```ts
it('toolbarPanelWidth spans from the toolbar group to the window edge', () => {
  expect(toolbarPanelWidth(1910, 1398)).toBe(512);
});
it('toolbarPanelWidth is clamped like a dragged width', () => {
  expect(toolbarPanelWidth(1000, 100)).toBe(500); // at most half the window
  expect(toolbarPanelWidth(1910, 1800)).toBe(PANEL_MIN);
});
it('readSavedPanelWidth is undefined when nothing is saved', () => {
  expect(readSavedPanelWidth()).toBeUndefined();
});
```

- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/web exec vitest run src/prefs.test.ts`.
  Expected: FAIL (not exported).
- [ ] **Step 3: Implement both in `prefs.ts`.** In App:
  - wrap the right-hand header buttons (Dark mode … the hidden file input) in
    `<div className="bar-actions" ref={barActions}>`;
  - initialise `panelWidth` from `readSavedPanelWidth() ?? PANEL_DEFAULT`;
  - in a `useLayoutEffect` on mount, when `readSavedPanelWidth()` is `undefined`, call
    `setPanelWidth(toolbarPanelWidth(window.innerWidth, barActions.current.getBoundingClientRect().left))`.
    Use plain `setPanelWidth`, not `chooseWidth`, so the default is never saved as the user's
    choice.
  - Add CSS `.bar-actions { display: flex; gap: <same as .bar> }`.
- [ ] **Step 4: Run** the prefs tests and `pnpm --filter @cloudarchitect/web typecheck`.
  Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "web: side column defaults to the toolbar's width"`.

### Task 3: Windows, toggles, and panels without `<details>`

**Files:**
- Create: `apps/web/src/ToolWindow.tsx`
- Test: `apps/web/src/toolWindow.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/AddPanel.tsx`, `apps/web/src/VersionsPanel.tsx`,
  `apps/web/src/models.tsx`, `apps/web/src/styles.css`, `apps/web/src/addPanel.test.tsx` (only if
  it asserts the old `<details>`)
- Delete: `apps/web/src/Collapsible.tsx`

**Interfaces:**
- Consumes: Task 1 (`ToolWindowId`, `TOOL_WINDOWS`, `TOOL_WINDOWS_KEY`, `readOpenWindows`,
  `toggleWindow`).
- Produces:
  - `export function ToolWindow(props: { title: string; onClose(): void; children: ReactNode })`
  - `export function ToolToggles(props: { open: readonly ToolWindowId[]; findings: number; versions: number; onToggle(id: ToolWindowId): void })`
  - `export const WINDOW_TITLES: Record<ToolWindowId, string>`

- [ ] **Step 1: Write the failing tests** in `toolWindow.test.tsx` (`renderToStaticMarkup`):

```tsx
it('ToolToggles labels each window, with counts, and marks the open ones', () => {
  const html = render(<ToolToggles open={['findings']} findings={7} versions={2} onToggle={() => {}} />);
  expect(html).toMatch(/aria-pressed="false"[^>]*>Add</);
  expect(html).toMatch(/aria-pressed="true"[^>]*>Findings \(7\)</);
  expect(html).toContain('>Versions (2)<');
  expect(html).toContain('>AI model<');
});
it('ToolWindow is a named region with a title and a close button', () => {
  const html = render(<ToolWindow title="Findings" onClose={() => {}}><p>x</p></ToolWindow>);
  expect(html).toContain('aria-label="Findings"');
  expect(html).toContain('<h2>Findings</h2>');
  expect(html).toContain('aria-label="Close Findings"');
});
it('panels no longer render a details wrapper', () => {
  expect(render(<AddPanel disabled={false} atLimit={false} iconUrls={{}} onAdd={() => {}} />)).not.toContain('<details');
  expect(render(<VersionsPanel versions={[]} onRestore={() => {}} />)).not.toContain('<details');
});
```

- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/web exec vitest run src/toolWindow.test.tsx`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`ToolWindow.tsx`:**
    - `ToolWindow` renders
      `<section className="tool-window" aria-label={title}><header><h2>{title}</h2><button aria-label={`Close ${title}`} onClick={onClose}>×</button></header><div className="tool-window-body">{children}</div></section>`.
    - `ToolToggles` renders one `<button aria-pressed>` per `TOOL_WINDOWS` id inside
      `<div className="tool-toggles">`.
  - **Panels:** `AddPanel`, `VersionsPanel` and `AiModelPanel` return their contents without
    `Collapsible`. Remove the `openSignal` prop and delete `Collapsible.tsx`.
  - **App:**
    - `const [openWindows, setOpenWindows] = useState(readOpenWindows)`. A toggle does
      `setOpenWindows(next)` and `writePref(TOOL_WINDOWS_KEY, JSON.stringify(next))`.
    - Remove `versionsAdded` and its setter calls.
    - Render `<ToolToggles>` in the header after the project name.
    - Move Add, the Findings list (the existing `<ul className="findings">` and "No rule findings."),
      `VersionsPanel` and `AiModelPanel` into
      `<div className="tool-windows">{openWindows.map(...)}</div>`, placed inside the canvas
      `<section>`, each wrapped in `<ToolWindow title={WINDOW_TITLES[id]}>`. Add renders only when
      `project` is set, as today.
    - The right column keeps `GeneratePanel`, `Details` and the review note.
  - **CSS:**
    - `.canvas { position: relative }` (if it isn't already).
    - `.tool-windows`: `position: absolute; left: 12px; top: 12px; bottom: 132px` (clear of the
      React Flow `<Controls />`); `width: 300px; display: flex; flex-direction: column; gap: 8px;
      z-index: 5; pointer-events: none`.
    - `.tool-window`: `pointer-events: auto; flex: 1 1 0; min-height: 0; display: flex;
      flex-direction: column`, with panel background, border and shadow.
    - `.tool-window-body`: `overflow: auto`.
    - Under `@media (max-width: 760px)`: `.tool-windows { right: 12px; width: auto }`.
- [ ] **Step 4: Run** `pnpm --filter @cloudarchitect/web exec vitest run`, typecheck and
  `pnpm exec eslint apps/web/src`. Expected: all PASS.
- [ ] **Step 5: Browser check** on `VITE_DEMO=true pnpm --filter @cloudarchitect/web dev`, with
  site storage cleared:
  - all four windows are closed on load;
  - each toggle opens and closes its window;
  - two windows open stack and scroll;
  - clicking a finding selects its component;
  - dragging a service from Add onto the canvas adds it;
  - open windows survive a reload;
  - zoom controls are not covered.
- [ ] **Step 6: Commit** `git commit -m "web: Add, Findings, Versions and AI model as tool windows"`.

### Task 4: e2e follows the windows

**Files:**
- Modify: `e2e/tests/helpers.ts`, `e2e/tests/claude.spec.ts`, `e2e/tests/gemini.spec.ts`

**Interfaces:**
- Produces: `export async function openWindow(page: Page, name: 'Add' | 'Findings' | 'Versions' | 'AI model'): Promise<void>`.
  It clicks the toolbar toggle whose accessible name starts with `name` when that toggle's
  `aria-pressed` is `"false"`.

- [ ] **Step 1: Edit.**
  - `versionsHeading(n)` becomes `page.getByRole('button', { name: `Versions (${n})`, exact: true })`.
  - Both `Findings (n)` heading checks become the toolbar button with that exact name.
  - Call `openWindow` before:
    - `Search services` (claude.spec 171 and 187);
    - the `.findings` locators (claude.spec 176, 183 and 193);
    - the `Restore` clicks (claude.spec 129 and 144).
  - `selectModel` replaces its `getByText('AI model')` click with `openWindow(page, 'AI model')`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/e2e exec tsc --noEmit` (or the package's
  typecheck) and `pnpm run ci`. Expected: PASS. Full e2e runs in CI on the PR (Docker).
- [ ] **Step 3: Commit** `git commit -m "e2e: open tool windows before using them"`.

### Task 5: Easier-to-see column, docs

**Files:**
- Modify: `apps/web/src/styles.css`, `CHANGELOG.md`, `docs/architecture/technical-architecture.md`
  (the editor layout paragraph, if it lists the side sections)

- [ ] **Step 1: CSS, in both themes using the existing tokens:**
  - `.side h2` and `.tool-window h2`: weight 600, about 15px, with a 1px `--border` divider under
    the section;
  - `.side button` and `.tool-window button`: a 1px solid visible border, about 6px radius,
    `--panel` background, and a hover background;
  - `.side`: a 2px left border;
  - `.tool-window header`: the title bar on a slightly tinted background.

  If a token is missing in either theme, add it to both theme blocks.
- [ ] **Step 2: Browser check** in light and dark mode, at 1910 and 600 px wide. Text and borders
  should be readable and nothing should overflow.
- [ ] **Step 3: CHANGELOG** Unreleased → Changed:

  > Editor: Add, Findings, Versions and AI model are now windows over the canvas, opened from the
  > toolbar and closed by default, so the canvas can show the diagram alone. The side column
  > defaults to the toolbar's width and its headings and buttons are easier to see.

- [ ] **Step 4: Run** `pnpm run ci`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "web: clearer side column; changelog"`.

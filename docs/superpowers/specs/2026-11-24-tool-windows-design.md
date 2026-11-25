# Tool windows and a clearer side panel (design)

Status: draft for approval, 24 Nov 2026. Target: 0.4.

## Intent

Users sometimes want to see the diagram alone, with only one or two tools at hand. Example: a user
generates a design, likes it, then wants one more component. They open Add, add it, close Add, and
are back to a clean canvas.

Today everything lives in one scrolling right column: Generate, Details, Add, Findings, Versions,
AI model and the review note. The column is 380 px wide by default and its controls are faint.

## Goals

- The right column stays and holds the diagram's properties: Generate and Details (plus the review
  note). By default it is as wide as the toolbar above it, so its left edge lines up with
  "Dark mode". Dragging its edge still resizes it, and a width the user set is still remembered.
- Add, Findings, Versions and AI model become tool windows, closed by default. Each has a toolbar
  toggle button. Any number can be open; one or two is the usual case.
- The side panel and the windows are easier to read: clear section headings, visible borders and
  outlined buttons.

## Non-goals

- Windows the user can drag or resize. They can come later, on top of this design.
- Hiding the right column.
- Changes to what each section does: only where it lives and how it looks.

## Approaches

1. **Floating over the canvas, at fixed spots (chosen).** Windows open over the left part of the
   canvas. The diagram never shrinks or jumps. This is the smallest change and the easiest to test.
2. A left column that slides in when any window opens. Windows never cover the diagram, but the
   diagram shifts sideways each time one opens or closes.
3. Free windows the user drags anywhere. The most flexible, but it costs the most (stacking order,
   windows dragged off-screen, remembered positions) and adds days just before the release.

The owner chose 1.

## Design

- **Toolbar:** four toggle buttons at the left of the toolbar, after the project name and above
  where the windows open: `Add`, `Findings (n)`, `Versions (n)`, `AI model`. Each shows whether
  its window is open (`aria-pressed`), and the counts stay current while the windows are closed.
  The right-hand group (Dark mode … Import JSON) is unchanged, so the column still lines up with
  "Dark mode". (Placing the toggles after Import JSON would widen that group by about 330 px and
  push the column to about 850 px.)
- **Windows:** each is a panel over the canvas's left edge, with a title bar and a close (×)
  button. Open windows stack top to bottom in a fixed order (Add, Findings, Versions, AI model) and
  share the canvas height, stopping above the canvas zoom controls in the bottom-left corner. Each
  one scrolls inside itself. Window titles carry no counts (the toolbar buttons have them).
- **Behaviour kept:**
  - clicking a finding still selects and shows its component;
  - dragging from Add onto the canvas still works, and so does Add with a container selected;
  - restoring a version and choosing a model work as before.
- **Remembered:** which windows are open is saved per browser, like the column width. A first
  visit starts with all four closed.
- **Phone width (under 760 px, where the column already moves below the canvas):** a window covers
  the canvas width; with several open, they stack in the same order.
- **Look:**
  - section headings in the side panel and window titles get weight and a divider;
  - buttons get a visible outline in both themes;
  - the column gets a stronger left border.

## Calls I made (please check)

- Findings and Versions show their counts on the toolbar button, so problems and new versions stay
  noticeable while the windows are closed.
- A new version (after a generation) no longer opens the Versions section by itself. The count on
  the button changes instead.
- Open windows are remembered across reloads, but every window starts closed on a first visit.

## Left to the builder

- Exact spacing, colours and window width. The width should fit Add's service list without
  wrapping.
- e2e updates: open the window before using Findings, Versions, AI model or the service search,
  and update the helpers that look for those sections.

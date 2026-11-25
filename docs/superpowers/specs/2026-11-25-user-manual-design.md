# Illustrated user manual (design)

Status: approved by the owner in conversation, 25 Nov 2026. Target: 0.4.

## Intent

One place that shows a user everything CloudArchitect Lite can do, with pictures, that stays
correct as the product changes. Every feature PR that changes what a user sees or does updates it.

## Goals

- Cover all current capabilities: install and setup, models and spending limits, generating,
  reading the diagram, findings (every rule in plain words), editing by hand, layout and versions,
  import and export, theme and demo, privacy.
- Screenshots are generated, never hand-made: one command refreshes them all, so they cannot drift.
- Reachable from the README and from the app (a Help link).
- Keeping it current is part of the PR checklist.

## Non-goals

- A website build (the Pages site keeps serving the demo). A site can later be built from the same
  Markdown.
- Translations, videos, in-app tours.

## Approaches

1. **Markdown in the repo with generated screenshots (chosen).** GitHub renders it, it is
   versioned with the code, and a screenshot script keeps the pictures current.
2. In-app help panel. Always at hand, but it costs UI work, and the content still needs a source.
3. A docs site on GitHub Pages. Nicer to read, but it needs a build and a second deploy path. It
   can come later on top of 1.

## Design

- `docs/manual/README.md` is the index. There is one page per area, in task order. Plain language,
  short steps, one screenshot per screen.
- `e2e/tests/manual.spec.ts`, run with `pnpm --filter @cloudarchitect/e2e manual`:
  - starts the same Docker stack as the browser test, with the fake AI replaying recorded
    responses, so the setup wizard, generation and clarifying questions are real screens;
  - writes PNGs to `docs/manual/images/` at a fixed 1440×900 viewport in light mode.

  The spec is not part of the regular e2e projects, so CI does not rewrite images.

- **Help link:** a `?` button at the toolbar's right end opens the manual on GitHub in a new tab.
- **README:** links to the manual. Its editor screenshots are replaced by generated ones.
- **PR template:** a new checkbox, "User manual updated (`docs/manual/`), or not user-visible".

## Left to the builder

- Page split and wording.
- Which recorded design the screenshots use. It should be one with findings, containers and a
  connector with settings.

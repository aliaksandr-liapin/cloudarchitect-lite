import type { Project } from '@cloudarchitect/domain';

/**
 * One undo step: the design and the connector routes drawn for it, so undo and redo put back
 * exactly what was on screen without a layout pass.
 */
export type Step<R = unknown> = { project: Project; routes?: R };

export type History<R = unknown> = { past: Step<R>[]; future: Step<R>[] };

export const EMPTY_HISTORY: History<never> = { past: [], future: [] };
export const HISTORY_LIMIT = 100;

/** Remember `previous` (and its routes) before an edit. A new edit ends the redo chain. */
export function record<R>(h: History<R>, previous: Project, routes?: R): History<R> {
  return { past: [...h.past, { project: previous, routes }].slice(-HISTORY_LIMIT), future: [] };
}

/** Revisions only go up, so a restored snapshot is stamped as the next revision. */
const stamp = (snapshot: Project, current: Project): Project => ({
  ...snapshot,
  revision: current.revision + 1,
});

export function undo<R>(
  h: History<R>,
  current: Project,
  routes?: R,
): { history: History<R>; project: Project; routes?: R } | undefined {
  const previous = h.past[h.past.length - 1];
  if (!previous) return undefined;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, { project: current, routes }] },
    project: stamp(previous.project, current),
    routes: previous.routes,
  };
}

export function redo<R>(
  h: History<R>,
  current: Project,
  routes?: R,
): { history: History<R>; project: Project; routes?: R } | undefined {
  const next = h.future[h.future.length - 1];
  if (!next) return undefined;
  return {
    history: {
      past: [...h.past, { project: current, routes }].slice(-HISTORY_LIMIT),
      future: h.future.slice(0, -1),
    },
    project: stamp(next.project, current),
    routes: next.routes,
  };
}

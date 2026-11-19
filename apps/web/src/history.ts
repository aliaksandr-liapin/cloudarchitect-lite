import type { Project } from '@cloudarchitect/domain';

export type History = { past: Project[]; future: Project[] };

export const EMPTY_HISTORY: History = { past: [], future: [] };
export const HISTORY_LIMIT = 100;

/** Remember `previous` before an edit. A new edit ends the redo chain. */
export function record(h: History, previous: Project): History {
  return { past: [...h.past, previous].slice(-HISTORY_LIMIT), future: [] };
}

/** Revisions only go up, so a restored snapshot is stamped as the next revision. */
const stamp = (snapshot: Project, current: Project): Project => ({
  ...snapshot,
  revision: current.revision + 1,
});

export function undo(
  h: History,
  current: Project,
): { history: History; project: Project } | undefined {
  const previous = h.past[h.past.length - 1];
  if (!previous) return undefined;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, current] },
    project: stamp(previous, current),
  };
}

export function redo(
  h: History,
  current: Project,
): { history: History; project: Project } | undefined {
  const next = h.future[h.future.length - 1];
  if (!next) return undefined;
  return {
    history: { past: [...h.past, current].slice(-HISTORY_LIMIT), future: h.future.slice(0, -1) },
    project: stamp(next, current),
  };
}

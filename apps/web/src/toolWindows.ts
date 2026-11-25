/** Which tool windows (Add, Findings, Versions, AI model) are open, kept per browser. */
import { readPref } from './prefs';

export type ToolWindowId = 'add' | 'findings' | 'versions' | 'model';

/** Display, toggle and storage order. */
export const TOOL_WINDOWS: readonly ToolWindowId[] = ['add', 'findings', 'versions', 'model'];

export const TOOL_WINDOWS_KEY = 'cloudarchitect.toolWindows';

/** Known ids once each, in the fixed order; undefined when the value is not a JSON list. */
export function parseOpenWindows(raw: string): ToolWindowId[] | undefined {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  return TOOL_WINDOWS.filter((id) => list.includes(id));
}

/** All closed on a first visit or when the saved value is unusable. */
export function readOpenWindows(): ToolWindowId[] {
  return readPref(TOOL_WINDOWS_KEY, parseOpenWindows, []);
}

export function toggleWindow(open: readonly ToolWindowId[], id: ToolWindowId): ToolWindowId[] {
  const next = open.includes(id) ? open.filter((w) => w !== id) : [...open, id];
  return TOOL_WINDOWS.filter((w) => next.includes(w));
}

/** A screen rectangle, as from getBoundingClientRect. */
export type Box = { left: number; top: number; right: number; bottom: number };

/** Narrower than this, the strip beside the windows is no use; the windows span the canvas. */
const MIN_FREE = 200;

/** The part of the canvas the open windows leave visible (they cover a strip on the left). */
export function freeArea(canvas: Box, windows: Box | undefined): Box {
  // Copied side by side: a DOMRect's sides are prototype getters, which a spread would drop.
  const { left, top, right, bottom } = canvas;
  if (!windows || right - windows.right < MIN_FREE) return { left, top, right, bottom };
  return { left: Math.max(left, windows.right), top, right, bottom };
}

/**
 * How far to pan so a node shows: undefined when it is already inside the free area; otherwise
 * each axis on which it sticks out is moved to the free area's middle.
 */
export function revealDelta(node: Box, free: Box): { dx: number; dy: number } | undefined {
  const inX = node.left >= free.left && node.right <= free.right;
  const inY = node.top >= free.top && node.bottom <= free.bottom;
  if (inX && inY) return undefined;
  return {
    dx: inX ? 0 : (free.left + free.right) / 2 - (node.left + node.right) / 2,
    dy: inY ? 0 : (free.top + free.bottom) / 2 - (node.top + node.bottom) / 2,
  };
}

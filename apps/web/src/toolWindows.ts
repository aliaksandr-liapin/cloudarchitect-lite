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

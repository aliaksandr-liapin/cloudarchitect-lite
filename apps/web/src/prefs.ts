/** Per-browser editor preferences. Storage can be blocked, so every access falls back quietly. */

export type Theme = 'light' | 'dark';

export const PANEL_WIDTH_KEY = 'cloudarchitect.panelWidth';
export const THEME_KEY = 'cloudarchitect.theme';
export const PANEL_DEFAULT = 380;
export const PANEL_STEP = 16;
export const PANEL_MIN = 320;

export function readPref<T>(key: string, parse: (raw: string) => T | undefined, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted; the choice still applies to this session */
  }
}

/** Light unless the user chose dark; the OS setting is ignored on purpose. */
export function readTheme(): Theme {
  return readPref<Theme>(THEME_KEY, (raw) => (raw === 'dark' ? 'dark' : undefined), 'light');
}

/** Panel width between 320 px and half the window; the minimum wins on a narrow window. */
export function maxPanelWidth(windowWidth: number): number {
  return Math.max(PANEL_MIN, Math.floor(windowWidth * 0.5));
}

export function clampPanelWidth(width: number, windowWidth: number): number {
  return Math.max(PANEL_MIN, Math.min(width, windowWidth * 0.5));
}

/** The width the user dragged to, or undefined if they never chose one. */
export function readSavedPanelWidth(): number | undefined {
  return readPref<number | undefined>(
    PANEL_WIDTH_KEY,
    (raw) => (raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : undefined),
    undefined,
  );
}

/** Default column width: from the toolbar's right-hand group to the window edge, clamped. */
export function toolbarPanelWidth(windowWidth: number, toolbarLeft: number): number {
  return clampPanelWidth(windowWidth - toolbarLeft, windowWidth);
}

export const SIDE_PANEL_KEY = 'cloudarchitect.sidePanel';

/** The side panel is shown unless the user hid it ('hidden'). */
export function readSidePanelOpen(): boolean {
  return readPref(SIDE_PANEL_KEY, (raw) => (raw === 'hidden' ? false : undefined), true);
}

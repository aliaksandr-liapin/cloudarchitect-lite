import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampPanelWidth,
  maxPanelWidth,
  PANEL_DEFAULT_MAX,
  PANEL_MIN,
  readPref,
  readSavedPanelWidth,
  readSidePanelOpen,
  readTheme,
  toolbarPanelWidth,
} from './prefs';

const throwing = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('clampPanelWidth', () => {
  it('keeps a width inside the range', () => expect(clampPanelWidth(1000, 1600)).toBe(800));
  it('raises a too small width to the minimum', () => expect(clampPanelWidth(200, 1600)).toBe(320));
  it('lets the 320 px minimum win on a narrow window', () =>
    expect(clampPanelWidth(500, 600)).toBe(320));
});

describe('readTheme', () => {
  it('is light with empty storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    expect(readTheme()).toBe('light');
  });
  it('is light when storage throws', () => {
    vi.stubGlobal('localStorage', throwing);
    expect(readTheme()).toBe('light');
  });
  it('returns a stored dark choice', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'dark', setItem: () => {} });
    expect(readTheme()).toBe('dark');
  });
});

describe('readPref', () => {
  it('falls back when storage throws', () => {
    vi.stubGlobal('localStorage', throwing);
    expect(readPref('k', Number, 5)).toBe(5);
  });
});

describe('maxPanelWidth', () => {
  it('is half the window', () => expect(maxPanelWidth(1601)).toBe(800));
  it('never drops below the minimum', () => expect(maxPanelWidth(500)).toBe(320));
});

describe('toolbarPanelWidth', () => {
  it('spans from the toolbar group to the window edge', () =>
    expect(toolbarPanelWidth(1910, 1520)).toBe(390));
  it('never defaults wider than 420 px; a dragged width may be wider', () => {
    expect(toolbarPanelWidth(1440, 855)).toBe(PANEL_DEFAULT_MAX);
    expect(PANEL_DEFAULT_MAX).toBe(420);
  });
  it('is clamped like a dragged width', () => {
    expect(toolbarPanelWidth(700, 100)).toBe(350); // at most half the window
    expect(toolbarPanelWidth(1910, 1800)).toBe(PANEL_MIN);
  });
  it('readSavedPanelWidth is undefined when nothing is saved', () =>
    expect(readSavedPanelWidth()).toBeUndefined());
});

describe('readSidePanelOpen', () => {
  it('is open unless the user hid it', () => expect(readSidePanelOpen()).toBe(true));
});

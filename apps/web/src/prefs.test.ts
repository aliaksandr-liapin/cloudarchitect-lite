import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampPanelWidth, readPref, readTheme } from './prefs';

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

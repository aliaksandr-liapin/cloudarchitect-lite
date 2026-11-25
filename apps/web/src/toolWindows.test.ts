import { describe, expect, it } from 'vitest';
import {
  freeArea,
  parseOpenWindows,
  readOpenWindows,
  revealDelta,
  toggleWindow,
} from './toolWindows';

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
    expect(readOpenWindows()).toEqual([]);
  });
});

describe('free canvas area', () => {
  const canvas = { left: 0, top: 60, right: 1400, bottom: 800 };
  it('is the canvas right of the open windows', () => {
    expect(freeArea(canvas, { left: 12, top: 72, right: 332, bottom: 668 })).toEqual({
      left: 332,
      top: 60,
      right: 1400,
      bottom: 800,
    });
  });
  it('is the whole canvas with no windows, or when windows span it (phone width)', () => {
    expect(freeArea(canvas, undefined)).toEqual(canvas);
    expect(freeArea(canvas, { left: 12, top: 72, right: 1388, bottom: 668 })).toEqual(canvas);
  });
  it('reads a DOMRect-like box whose sides are prototype getters', () => {
    class Rect {
      get left() {
        return 0;
      }
      get top() {
        return 60;
      }
      get right() {
        return 1400;
      }
      get bottom() {
        return 800;
      }
    }
    expect(freeArea(new Rect(), { left: 12, top: 72, right: 332, bottom: 668 })).toEqual({
      left: 332,
      top: 60,
      right: 1400,
      bottom: 800,
    });
  });
  it('revealDelta leaves a visible node alone', () => {
    const free = { left: 332, top: 60, right: 1400, bottom: 800 };
    expect(revealDelta({ left: 400, top: 100, right: 580, bottom: 160 }, free)).toBeUndefined();
  });
  it('revealDelta moves a covered node to the middle of the free area', () => {
    const free = { left: 332, top: 60, right: 1400, bottom: 800 };
    // Node centre (100, 430) → free centre (866, 430).
    expect(revealDelta({ left: 10, top: 400, right: 190, bottom: 460 }, free)).toEqual({
      dx: 766,
      dy: 0,
    });
  });
});

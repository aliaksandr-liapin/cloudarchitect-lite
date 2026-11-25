import { describe, expect, it } from 'vitest';
import { parseOpenWindows, readOpenWindows, toggleWindow } from './toolWindows';

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

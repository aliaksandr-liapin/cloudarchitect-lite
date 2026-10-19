import { describe, expect, it } from 'vitest';
import { routedPath } from './edges';

describe('routedPath', () => {
  it('draws an SVG polyline through the route points', () => {
    expect(
      routedPath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toBe('M 0 0 L 10 0 L 10 5');
  });
});

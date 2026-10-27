import { migrateProject } from '@cloudarchitect/domain';
import { samples } from '@cloudarchitect/catalog';
import { describe, expect, it } from 'vitest';
import { canExport, imageFrame } from './exportImage';

describe('imageFrame', () => {
  it('adds padding and translates to the origin', () => {
    expect(imageFrame({ x: 100, y: 50, width: 400, height: 300 })).toEqual({
      width: 480,
      height: 380,
      transform: 'translate(-60px, -10px) scale(1)',
    });
  });

  it('covers negative coordinates', () => {
    expect(imageFrame({ x: -200, y: -100, width: 100, height: 100 }).transform).toBe(
      'translate(240px, 140px) scale(1)',
    );
  });
});

describe('canExport', () => {
  const sample = migrateProject(samples.myblog);
  it('is true for a project with nodes', () => expect(canExport(sample)).toBe(true));
  it('is false without nodes and containers', () =>
    expect(canExport({ ...sample, nodes: [], containers: [] })).toBe(false));
});

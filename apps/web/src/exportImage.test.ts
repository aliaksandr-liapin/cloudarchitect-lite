import { migrateProject } from '@cloudarchitect/domain';
import { samples } from '@cloudarchitect/catalog';
import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { canExport, diagramBounds, imageFrame, svgBlob } from './exportImage';

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

describe('diagramBounds', () => {
  const box = (id: string, x: number, y: number, parentId?: string): Node => ({
    id,
    position: { x, y },
    width: 100,
    height: 50,
    data: {},
    ...(parentId ? { parentId } : {}),
  });

  it('uses absolute positions for children, even outside their parent box', () => {
    const nodes = [box('c', 200, 100), box('inner', 10, 10, 'c'), box('out', 500, 400, 'inner')];
    // inner is at (210,110); out is at (710,510) and overflows both containers.
    expect(diagramBounds(nodes)).toEqual({ x: 200, y: 100, width: 610, height: 460 });
  });
});

describe('svgBlob', () => {
  it('decodes the data URL into plain SVG markup', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>a & b, 100%</text></svg>';
    const blob = svgBlob(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toBe(svg);
  });
});

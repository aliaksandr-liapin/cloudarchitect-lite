import { samples } from '@cloudarchitect/catalog';
import { migrateProject } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { applyLayout, needsLayout, toElkGraph, toFlow } from './layout';

const project = migrateProject(samples.myblog);

describe('layout', () => {
  it('nests nodes inside their containers in the ELK graph', () => {
    const root = toElkGraph(project).children!;
    const cloud = root.find((n) => n.id === 'cloud')!;
    const region = cloud.children!.find((n) => n.id === 'region')!;
    expect(cloud.children!.map((n) => n.id)).toContain('cdn');
    expect(region.children!.map((n) => n.id)).toContain('db');
  });

  it('lays out once, then keeps stored positions', async () => {
    expect(needsLayout(project)).toBe(true);
    const laid = await applyLayout(project);
    expect(needsLayout(laid)).toBe(false);
    expect(laid.containers.every((c) => c.size!.width > 0)).toBe(true);

    const moved = {
      ...laid,
      nodes: laid.nodes.map((n) => (n.id === 'db' ? { ...n, position: { x: 7, y: 9 } } : n)),
    };
    expect(toFlow(moved, (id) => id).nodes.find((n) => n.id === 'db')!.position).toEqual({
      x: 7,
      y: 9,
    });
  });

  it('emits parents before children for React Flow', async () => {
    const { nodes } = toFlow(await applyLayout(project), (id) => id);
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    for (const n of nodes)
      if (n.parentId) expect(index.get(n.parentId)!).toBeLessThan(index.get(n.id)!);
  });
});

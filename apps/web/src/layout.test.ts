import { samples } from '@cloudarchitect/catalog';
import { migrateProject, type Project } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import {
  applyLayout,
  containerMinSize,
  dropRoutes,
  fitsChildren,
  labelSize,
  needsLayout,
  NODE_SIZE,
  toElkGraph,
  toFlow,
} from './layout';

const project = migrateProject(samples.myblog);

type Rect = { x: number; y: number; width: number; height: number };
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Absolute origin of a container, summing parent-relative positions up the chain. */
const containerOrigin = (p: Project, id: string | undefined): { x: number; y: number } => {
  const c = id ? p.containers.find((k) => k.id === id) : undefined;
  if (!c) return { x: 0, y: 0 };
  const up = containerOrigin(p, c.parentId);
  return { x: up.x + (c.position?.x ?? 0), y: up.y + (c.position?.y ?? 0) };
};

/** Whether a node or container sits (at any depth) inside the container `ancestor`. */
const isInside = (p: Project, containerId: string | undefined, ancestor: string): boolean => {
  for (let id = containerId; id; id = p.containers.find((c) => c.id === id)?.parentId)
    if (id === ancestor) return true;
  return false;
};

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
    const laid = (await applyLayout(project)).project;
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
    const { nodes } = toFlow((await applyLayout(project)).project, (id) => id);
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    for (const n of nodes)
      if (n.parentId) expect(index.get(n.parentId)!).toBeLessThan(index.get(n.id)!);
  });

  it('gives every node the default size after layout', async () => {
    const laid = await applyLayout(project);
    for (const n of laid.project.nodes) expect(n.size).toEqual(NODE_SIZE);
  });

  it('renders nodes without size at the legacy size', async () => {
    const laid = (await applyLayout(project)).project;
    const legacy = {
      ...laid,
      nodes: laid.nodes.map((n) => (n.id === 'db' ? { ...n, size: undefined } : n)),
    };
    const db = toFlow(legacy, (id) => id).nodes.find((n) => n.id === 'db')!;
    expect(db.style?.width).toBe(168);
    expect(db.style?.height).toBe(64);
  });

  it('returns a route for every edge, and no label overlaps a service node', async () => {
    const { project: laid, routes } = await applyLayout(project);
    expect(routes.size).toBe(laid.edges.length);
    for (const e of laid.edges) expect(routes.get(e.id)!.points.length).toBeGreaterThanOrEqual(2);

    const nodeRects: Rect[] = laid.nodes.map((n) => {
      const o = containerOrigin(laid, n.containerId);
      return { x: o.x + n.position.x, y: o.y + n.position.y, ...n.size! };
    });
    // Routes are absolute (`edgeCoords: ROOT`): each end touches its node's summed-up rectangle.
    const rectOf = new Map(laid.nodes.map((n, i) => [n.id, nodeRects[i]!]));
    const touches = (pt: { x: number; y: number }, r: Rect) =>
      pt.x >= r.x - 1 && pt.x <= r.x + r.width + 1 && pt.y >= r.y - 1 && pt.y <= r.y + r.height + 1;
    for (const e of laid.edges) {
      const { points } = routes.get(e.id)!;
      expect(touches(points[0]!, rectOf.get(e.source)!)).toBe(true);
      expect(touches(points.at(-1)!, rectOf.get(e.target)!)).toBe(true);
    }

    const labelled = [...routes.values()].filter((r) => r.label);
    expect(labelled.length).toBeGreaterThan(0);
    for (const r of labelled)
      for (const rect of nodeRects) expect(intersects(r.label!, rect)).toBe(false);
  });

  it('labels wrap at 160 px over at most two lines', () => {
    expect(labelSize('x'.repeat(10))).toEqual({ width: 70, height: 20 });
    expect(labelSize('x'.repeat(200))).toEqual({ width: 160, height: 36 });
  });

  it('drops routes for moved endpoints and for edges inside a moved container', async () => {
    const { project: laid, routes } = await applyLayout(project);

    const afterDb = dropRoutes(routes, laid, ['db']);
    const touchesDb = laid.edges.filter((e) => e.source === 'db' || e.target === 'db');
    const other = laid.edges.find((e) => e.source !== 'db' && e.target !== 'db')!;
    expect(touchesDb.length).toBeGreaterThan(0);
    for (const e of touchesDb) expect(afterDb.has(e.id)).toBe(false);
    expect(afterDb.get(other.id)).toBe(routes.get(other.id));

    const afterRegion = dropRoutes(routes, laid, ['region']);
    const inRegion = (id: string) =>
      isInside(laid, laid.nodes.find((n) => n.id === id)?.containerId, 'region');
    const regionEdges = laid.edges.filter((e) => inRegion(e.source) || inRegion(e.target));
    expect(regionEdges.length).toBeGreaterThan(0);
    for (const e of regionEdges) expect(afterRegion.has(e.id)).toBe(false);
  });

  it('container minimum size covers its children plus padding', async () => {
    const laid = (await applyLayout(project)).project;
    const min = containerMinSize(laid, 'region');
    const children = [
      ...laid.nodes
        .filter((n) => n.containerId === 'region')
        .map((n) => ({ ...n.position, ...n.size! })),
      ...laid.containers
        .filter((c) => c.parentId === 'region')
        .map((c) => ({ ...c.position!, ...c.size! })),
    ];
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) {
      expect(min.width).toBeGreaterThanOrEqual(c.x + c.width + 16);
      expect(min.height).toBeGreaterThanOrEqual(c.y + c.height + 16);
    }
  });

  it('a container resize must keep its children inside the padding', async () => {
    const laid = (await applyLayout(project)).project;
    const region = laid.containers.find((c) => c.id === 'region')!;
    const box = { ...region.position!, ...region.size! };
    expect(fitsChildren(laid, 'region', box)).toBe(true);
    // Grow from the left and top: children shift right and down inside the box.
    expect(
      fitsChildren(laid, 'region', {
        ...box,
        x: box.x - 50,
        y: box.y - 50,
        width: box.width + 50,
        height: box.height + 50,
      }),
    ).toBe(true);
    // Shrink from the top into the 40 px label band.
    expect(fitsChildren(laid, 'region', { ...box, y: box.y + 30, height: box.height - 30 })).toBe(
      false,
    );
    // Shrink from the left into the 16 px pad.
    expect(fitsChildren(laid, 'region', { ...box, x: box.x + 10, width: box.width - 10 })).toBe(
      false,
    );
    // Shrink from the right past the children.
    expect(fitsChildren(laid, 'region', { ...box, width: box.width / 4 })).toBe(false);
  });

  it('a container resize does not reject a child that was already in the padding', () => {
    const p: Project = {
      ...project,
      containers: [
        { ...project.containers[0]!, position: { x: 0, y: 0 }, size: { width: 400, height: 300 } },
      ],
    };
    const id = p.containers[0]!.id;
    p.nodes = p.nodes.map((n, i) =>
      i === 0
        ? { ...n, containerId: id, position: { x: 4, y: 10 }, size: { width: 100, height: 60 } }
        : { ...n, containerId: undefined },
    );
    p.containers[0] = { ...p.containers[0]!, parentId: undefined };
    expect(fitsChildren(p, id, { x: 0, y: 0, width: 300, height: 200 })).toBe(true);
    expect(fitsChildren(p, id, { x: 2, y: 0, width: 398, height: 300 })).toBe(false);
  });
});

import { ArchNode, Project, PROJECT_SCHEMA_VERSION } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import {
  absolutePosition,
  atNodeLimit,
  canNest,
  nestRefusal,
  connectionError,
  containerAt,
  deletionOps,
  dragReparents,
  EXTERNAL_LABELS,
  newContainer,
  newEdge,
  newExternalNode,
  newId,
  newServiceNode,
  placeNew,
  reparentNode,
  selectedIds,
  shortcutFor,
  isTextTarget,
  shouldHandleShortcut,
  toggleRequirement,
} from './edit';
import { needsLayout } from './layout';

const p = Project.parse({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  projectId: 'proj',
  name: 'Test',
  revision: 0,
  providerContext: ['aws'],
  catalogSnapshot: {},
  containers: [
    {
      id: 'R',
      kind: 'region',
      label: 'R',
      position: { x: 0, y: 0 },
      size: { width: 600, height: 400 },
    },
    {
      id: 'V',
      kind: 'vpc',
      parentId: 'R',
      label: 'V',
      position: { x: 50, y: 50 },
      size: { width: 400, height: 300 },
    },
    {
      id: 'S',
      kind: 'subnet',
      parentId: 'V',
      label: 'S',
      position: { x: 20, y: 40 },
      size: { width: 200, height: 150 },
    },
    { id: 'NoBox', kind: 'group', label: 'No box' },
  ],
  nodes: [
    { id: 'n', serviceId: 'aws.lambda', provider: 'aws', label: 'n', position: { x: 300, y: 300 } },
    { id: 'm', serviceId: 'aws.lambda', provider: 'aws', label: 'm', position: { x: 0, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'n', target: 'm', kind: 'invoke' }],
});

describe('edit helpers', () => {
  it('newId has the prefix and a short random suffix', () => {
    expect(newId('node')).toMatch(/^node-[a-z0-9]{8}$/);
    expect(newId('node')).not.toBe(newId('node'));
  });

  it('newServiceNode parses as an ArchNode with the catalog name', () => {
    const n = newServiceNode('aws.dax', { x: 0, y: 0 });
    expect(ArchNode.parse(n).label).toBe('DynamoDB Accelerator (DAX)');
    expect(n.requirementIds).toEqual([]);
    expect(newServiceNode('aws.dax', { x: 1, y: 2 }, 'S')).toMatchObject({
      containerId: 'S',
      position: { x: 1, y: 2 },
      provider: 'aws',
    });
  });

  it('newExternalNode uses the external label', () => {
    const n = newExternalNode('client-app', { x: 5, y: 6 });
    expect(ArchNode.parse(n)).toMatchObject({
      label: 'Client app',
      external: { kind: 'client-app', name: 'Client app' },
    });
    expect(EXTERNAL_LABELS.user).toBe('User');
  });

  it('newContainer has a size, so adding one never triggers auto-layout', () => {
    expect(
      needsLayout({
        ...p,
        containers: [...p.containers.slice(0, 3), newContainer('vpc', { x: 0, y: 0 })],
      }),
    ).toBe(false);
    expect(newContainer('subnet', { x: 0, y: 0 }, 'V')).toMatchObject({
      parentId: 'V',
      properties: { subnetType: 'private' },
      label: 'Subnet',
    });
  });

  it('canNest follows the catalog', () => {
    expect(canNest('subnet', 'availability-zone')).toBe(true);
    expect(canNest('subnet', 'region')).toBe(false);
    expect(canNest('vpc', undefined)).toBe(true);
    expect(canNest('aws-cloud', 'region')).toBe(false);
  });

  it('canNest lets a group sit anywhere', () => {
    expect(canNest('group', 'vpc')).toBe(true);
    expect(canNest('group', 'subnet')).toBe(true);
    expect(canNest('group', 'group')).toBe(true);
    expect(canNest('group', undefined)).toBe(true);
  });

  it('nestRefusal names the allowed parents, or the top level when there are none', () => {
    expect(nestRefusal('subnet')).toBe('Subnet can only go inside: VPC, Availability Zone.');
    expect(nestRefusal('aws-cloud')).toBe('AWS Cloud can only be placed at the top level.');
  });

  it('absolutePosition sums the parent chain', () => {
    expect(absolutePosition(p, 'S')).toEqual({ x: 70, y: 90 });
    expect(absolutePosition(p, undefined)).toEqual({ x: 0, y: 0 });
    expect(absolutePosition(p, 'NoBox')).toEqual({ x: 0, y: 0 });
  });

  it('containerAt picks the innermost container', () => {
    expect(containerAt(p, { x: 100, y: 120 })?.id).toBe('S');
    expect(containerAt(p, { x: 440, y: 60 })?.id).toBe('V');
    expect(containerAt(p, { x: 700, y: 10 })).toBeUndefined();
  });

  it('dragReparents moves every dragged component into the container it lands in', () => {
    // n (root, 168x64) dropped so its centre is in S; m dropped inside V but outside S.
    const moves = dragReparents(p, [
      { id: 'n', type: 'service', position: { x: 60, y: 80 } },
      { id: 'm', type: 'service', position: { x: 300, y: 250 } },
    ]);
    expect(moves).toEqual([
      { id: 'n', target: 'S' },
      { id: 'm', target: 'V' },
    ]);
  });

  it('dragReparents leaves components that stay in their container', () => {
    expect(dragReparents(p, [{ id: 'm', type: 'service', position: { x: 700, y: 10 } }])).toEqual(
      [],
    );
  });

  it('dragReparents does nothing when a container is part of the drag', () => {
    expect(
      dragReparents(p, [
        { id: 'n', type: 'service', position: { x: 60, y: 80 } },
        { id: 'S', type: 'container', position: { x: 30, y: 40 } },
      ]),
    ).toEqual([]);
  });

  it('containerAt ignores the excluded container and its descendants', () => {
    expect(containerAt(p, { x: 100, y: 120 }, 'V')?.id).toBe('R');
    expect(containerAt(p, { x: 100, y: 120 }, 'S')?.id).toBe('V');
  });

  it('reparentNode keeps the absolute position', () => {
    const next = reparentNode(p, 'n', 'S');
    expect(next.nodes.find((n) => n.id === 'n')).toMatchObject({
      containerId: 'S',
      position: { x: 230, y: 210 },
    });
    expect(reparentNode(next, 'n', undefined).nodes.find((n) => n.id === 'n')?.position).toEqual({
      x: 300,
      y: 300,
    });
    expect(reparentNode(p, 'n', undefined)).toBe(p);
  });

  it('deletionOps deletes only what was selected', () => {
    expect(deletionOps(p, { nodes: ['V'], edges: [] })).toEqual([
      { op: 'removeContainer', id: 'V' },
    ]);
    expect(deletionOps(p, { nodes: ['n', 'nope'], edges: ['e1'] })).toEqual([
      { op: 'removeNode', id: 'n' },
      { op: 'removeEdge', id: 'e1' },
    ]);
  });

  it('connectionError refuses self-loops and duplicates', () => {
    expect(connectionError(p, 'n', 'n')).toBe('A component cannot connect to itself.');
    expect(connectionError(p, 'n', 'm')).toBe('These two are already connected.');
    expect(connectionError(p, 'm', 'n')).toBeUndefined();
  });

  it('newEdge builds a valid edge', () => {
    expect(newEdge('a', 'b')).toMatchObject({
      source: 'a',
      target: 'b',
      kind: 'other',
      requirementIds: [],
    });
  });

  it('toggleRequirement adds and removes', () => {
    expect(toggleRequirement(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleRequirement(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('atNodeLimit trips at the node cap', () => {
    expect(atNodeLimit(p)).toBe(false);
    const full = { ...p, nodes: Array.from({ length: 150 }, () => p.nodes[0]!) };
    expect(atNodeLimit(full)).toBe(true);
  });
});

describe('shortcuts', () => {
  const key = (
    k: string,
    o: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey', boolean>> = {},
  ) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...o,
  });
  const event = (k: string, o: object, target: unknown) =>
    ({ ...key(k), ...o, target }) as unknown as KeyboardEvent;

  it('shortcutFor maps the keys', () => {
    expect(shortcutFor(key('z', { metaKey: true }))).toBe('undo');
    expect(shortcutFor(key('z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutFor(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutFor(key('y', { ctrlKey: true }))).toBe('redo');
    expect(shortcutFor(key('Backspace'))).toBeUndefined();
    expect(shortcutFor(key('z'))).toBeUndefined();
  });

  it('isTextTarget is true only for text entry', () => {
    expect(isTextTarget(null)).toBe(false);
    expect(isTextTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTextTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(false);
    expect(
      isTextTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
    expect(isTextTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isTextTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTextTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(
      false,
    );
    expect(isTextTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
  });

  it('shortcuts are ignored in text fields and while busy', () => {
    const input = { tagName: 'INPUT', type: 'text' };
    const body = { tagName: 'BODY' };
    expect(shouldHandleShortcut(event('z', { metaKey: true }, input), false)).toBeUndefined();
    expect(shouldHandleShortcut(event('z', { metaKey: true }, body), true)).toBeUndefined();
    expect(shouldHandleShortcut(event('z', { metaKey: true }, body), false)).toBe('undo');
  });
});

describe('selectedIds', () => {
  it('keeps only the selected items React Flow offered', () => {
    expect(
      selectedIds(
        [{ id: 'a', selected: true }, { id: 'child' }, { id: 'c', selected: false }],
        [{ id: 'e1' }, { id: 'e2', selected: true }],
      ),
    ).toEqual({ nodes: ['a'], edges: ['e2'] });
  });
});

describe('placeNew', () => {
  const small = { width: 160, height: 56 };
  type Box = { x: number; y: number; width: number; height: number };
  const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const inside = (a: Box, b: Box) =>
    a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  /** The placed box in canvas coordinates. */
  const absBox = (placed: { at: { x: number; y: number }; parentId?: string }, size = small) => {
    const o = absolutePosition(p, placed.parentId);
    return { x: o.x + placed.at.x, y: o.y + placed.at.y, ...size };
  };
  const nodeBoxes = p.nodes.map((n) => {
    const o = absolutePosition(p, n.containerId);
    return { x: o.x + n.position!.x, y: o.y + n.position!.y, width: 168, height: 64 };
  });
  const containerBoxes = p.containers
    .filter((c) => c.position && c.size)
    .map((c) => ({ ...absolutePosition(p, c.id), ...c.size! }));

  it('keeps a free spot where it is, inside the container it lands in', () => {
    // Centre (170, 170) is free and inside S (70..270, 90..240).
    expect(placeNew(p, { x: 170, y: 170 }, small)).toEqual({ at: { x: 20, y: 52 }, parentId: 'S' });
  });

  it('moves off an existing service instead of covering it', () => {
    const placed = absBox(placeNew(p, { x: 384, y: 332 }, small)); // n's centre
    for (const b of nodeBoxes) expect(overlaps(placed, b)).toBe(false);
  });

  it('never straddles a container border', () => {
    const placed = absBox(placeNew(p, { x: 50, y: 200 }, small)); // on V's left edge
    for (const c of containerBoxes) expect(inside(placed, c) || !overlaps(placed, c)).toBe(true);
  });

  // R widened to 800x500, so it has free room right of V (V ends at x 450).
  const wide = {
    ...p,
    containers: p.containers.map((c) =>
      c.id === 'R' ? { ...c, size: { width: 800, height: 500 } } : c,
    ),
  };

  it('stores the container it visually sits in', () => {
    expect(placeNew(wide, { x: 620, y: 200 }, small)).toEqual({
      at: { x: 540, y: 172 },
      parentId: 'R',
    });
  });

  it('keeps the new service directly in the selected container', () => {
    // V's centre is inside S; with V selected the service goes in V, not S.
    const placed = placeNew(p, { x: 250, y: 200 }, small, 'V');
    expect(placed.parentId).toBe('V');
    const box = absBox(placed);
    expect(inside(box, containerBoxes[1]!)).toBe(true);
    expect(overlaps(box, containerBoxes[2]!)).toBe(false);
  });

  it('grows a full selected container to fit, below its contents', () => {
    // 220 wide does not fit in S (200 wide): S grows; V still holds the grown S.
    expect(placeNew(p, { x: 170, y: 165 }, { width: 220, height: 72 }, 'S')).toEqual({
      at: { x: 8, y: 32 },
      parentId: 'S',
      grow: [{ id: 'S', size: { width: 236, height: 150 } }],
    });
  });

  it('grows the containers around a grown container too', () => {
    expect(placeNew(p, { x: 170, y: 165 }, { width: 400, height: 72 }, 'S').grow).toEqual([
      { id: 'S', size: { width: 416, height: 150 } },
      { id: 'V', size: { width: 444, height: 300 } },
    ]);
  });

  it('puts the service below what a full container already holds', () => {
    // m moved into S fills its top: 168x64 at (0, 40) relative to S.
    const full = {
      ...p,
      nodes: p.nodes.map((n) =>
        n.id === 'm' ? { ...n, containerId: 'S', position: { x: 0, y: 40 } } : n,
      ),
    };
    const placed = placeNew(full, { x: 170, y: 165 }, { width: 220, height: 72 }, 'S');
    expect(placed.at).toEqual({ x: 8, y: 112 });
    expect(placed.grow).toEqual([{ id: 'S', size: { width: 236, height: 192 } }]);
  });

  it('starts below a container header', () => {
    const placed = placeNew(wide, { x: 620, y: 40 }, small); // in R's header band
    expect(placed.parentId).toBe('R');
    expect(placed.at.y).toBeGreaterThanOrEqual(32);
  });
});

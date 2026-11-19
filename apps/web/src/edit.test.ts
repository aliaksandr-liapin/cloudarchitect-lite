import { ArchNode, Project, PROJECT_SCHEMA_VERSION } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import {
  absolutePosition,
  atNodeLimit,
  canNest,
  connectionError,
  containerAt,
  deletionOps,
  EXTERNAL_LABELS,
  newContainer,
  newEdge,
  newExternalNode,
  newId,
  newServiceNode,
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
    expect(canNest('group', 'vpc')).toBe(false);
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
    expect(isTextTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
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

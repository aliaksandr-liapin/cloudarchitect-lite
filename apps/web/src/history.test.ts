import { applyPatch, Project, PROJECT_SCHEMA_VERSION } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, HISTORY_LIMIT, record, redo, undo } from './history';

const make = (revision: number, label: string) =>
  Project.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: 'proj',
    name: 'Test',
    revision,
    providerContext: ['aws'],
    catalogSnapshot: {},
    nodes: [
      { id: 'n', serviceId: 'aws.lambda', provider: 'aws', label, position: { x: 0, y: 0 } },
      { id: 'm', serviceId: 'aws.lambda', provider: 'aws', label: 'm', position: { x: 1, y: 1 } },
    ],
    edges: [{ id: 'e1', source: 'n', target: 'm', kind: 'invoke' }],
  });

const a = make(1, 'a');
const b = make(2, 'b');

describe('history', () => {
  it('undo returns the previous design and redo the next', () => {
    const h = record(EMPTY_HISTORY, a);
    const u = undo(h, b)!;
    expect(u.project.nodes).toEqual(a.nodes);
    expect(u.project.revision).toBe(b.revision + 1);
    const r = redo(u.history, u.project)!;
    expect(r.project.nodes).toEqual(b.nodes);
    expect(r.project.revision).toBe(u.project.revision + 1);
  });

  it('a new edit clears redo', () => {
    const u = undo(record(EMPTY_HISTORY, a), b)!;
    expect(u.history.future).toHaveLength(1);
    expect(record(u.history, u.project).future).toEqual([]);
  });

  it('keeps at most 100 steps', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 1; i++) h = record(h, make(i, `v${i}`));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]!.project.revision).toBe(1);
  });

  it('undo of a node delete brings back its connectors', () => {
    const after = applyPatch(a, {
      baseRevision: a.revision,
      ops: [{ op: 'removeNode', id: a.nodes[0]!.id }],
    });
    expect(after.edges).toEqual([]);
    expect(undo(record(EMPTY_HISTORY, a), after)!.project.edges).toEqual(a.edges);
  });

  it('nothing to undo or redo returns undefined', () => {
    expect(undo(EMPTY_HISTORY, a)).toBeUndefined();
    expect(redo(EMPTY_HISTORY, a)).toBeUndefined();
  });

  it('undo and redo bring back the connector routes of each step', () => {
    const routesA = new Map([['e1', 'route of a']]);
    const routesB = new Map([['e1', 'route of b']]);
    const u = undo(record(EMPTY_HISTORY, a, routesA), b, routesB)!;
    expect(u.routes).toBe(routesA);
    const r = redo(u.history, u.project, routesA)!;
    expect(r.routes).toBe(routesB);
  });
});

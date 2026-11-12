import type { ArchEdge, ArchNode, Finding, Project } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { classifyChanges, diffDesigns, findingKey, regressions } from './design-diff.js';

const node = (id: string, extra: Record<string, unknown> = {}): ArchNode =>
  ({
    id,
    provider: 'aws',
    label: id,
    serviceId: 'aws.lambda',
    requirementIds: [],
    position: { x: 0, y: 0 },
    ...extra,
  }) as ArchNode;

const edge = (id: string, source: string, target: string, requirementIds: string[] = []) =>
  ({ id, source, target, kind: 'invoke', requirementIds }) as ArchEdge;

const project = (nodes: ArchNode[], edges: ArchEdge[] = []): Project =>
  ({ nodes, edges, containers: [], requirements: [], findings: [] }) as unknown as Project;

const finding = (extra: Partial<Finding>): Finding =>
  ({
    id: 'f',
    class: 'rule',
    severity: 'info',
    nodeIds: [],
    edgeIds: [],
    containerIds: [],
    requirementIds: [],
    explanation: '',
    evidence: [],
    producerVersion: '1',
    ...extra,
  }) as Finding;

describe('diffDesigns', () => {
  it('reports no changes for identical designs, and ignores positions and labels', () => {
    const a = project([node('n1'), node('n2')], [edge('e1', 'n1', 'n2')]);
    const b = project(
      [
        node('n1', { position: { x: 9, y: 9 }, label: 'renamed', purpose: 'p' }),
        node('n2', { size: { width: 5, height: 5 } }),
      ],
      [edge('e1', 'n1', 'n2')],
    );
    expect(diffDesigns(a, b)).toEqual([]);
  });

  it('detects each change kind', () => {
    const before = project(
      [
        node('gone'),
        node('svc'),
        node('ext', { serviceId: undefined, external: { kind: 'user', name: 'U' } }),
        node('box', { containerId: 'c1' }),
        node('req', { requirementIds: ['R1', 'R2'] }),
        node('a'),
        node('b'),
      ],
      [edge('e-rm', 'a', 'b'), edge('e-rw', 'a', 'b'), edge('e-req', 'a', 'b', ['R1', 'R2'])],
    );
    const after = project(
      [
        node('new'),
        node('svc', { serviceId: 'aws.ec2' }),
        node('ext', { serviceId: undefined, external: { kind: 'user', name: 'V' } }),
        node('box', { containerId: 'c2' }),
        node('req', { requirementIds: ['R2'] }),
        node('a'),
        node('b'),
      ],
      [edge('e-add', 'b', 'a'), edge('e-rw', 'a', 'new'), edge('e-req', 'a', 'b', ['R2'])],
    );
    const changes = diffDesigns(before, after);
    const of = (kind: string) => changes.filter((c) => c.kind === kind);
    expect(of('node-added')).toEqual([{ kind: 'node-added', nodeIds: ['new'], edgeIds: [] }]);
    expect(of('node-removed')).toEqual([{ kind: 'node-removed', nodeIds: ['gone'], edgeIds: [] }]);
    expect(of('service-changed').map((c) => c.nodeIds)).toEqual([['ext'], ['svc']]);
    expect(of('edge-added')).toEqual([
      { kind: 'edge-added', nodeIds: ['b', 'a'], edgeIds: ['e-add'] },
    ]);
    expect(of('edge-removed')).toEqual([
      { kind: 'edge-removed', nodeIds: ['a', 'b'], edgeIds: ['e-rm'] },
    ]);
    expect(of('edge-rewired')).toEqual([
      { kind: 'edge-rewired', nodeIds: ['a', 'b', 'new'], edgeIds: ['e-rw'] },
    ]);
    expect(of('container-moved')).toEqual([
      { kind: 'container-moved', nodeIds: ['box'], edgeIds: [] },
    ]);
    expect(of('requirement-link-dropped')).toEqual([
      { kind: 'requirement-link-dropped', nodeIds: [], edgeIds: ['e-req'], requirementId: 'R1' },
      { kind: 'requirement-link-dropped', nodeIds: ['req'], edgeIds: [], requirementId: 'R1' },
    ]);
  });

  it('treats a renamed node as removed plus added', () => {
    const before = project([node('old'), node('x')], [edge('e1', 'old', 'x')]);
    const after = project([node('fresh'), node('x')], [edge('e2', 'fresh', 'x')]);
    const kinds = diffDesigns(before, after).map(
      (c) => `${c.kind}:${[...c.nodeIds, ...c.edgeIds]}`,
    );
    expect(kinds).toEqual([
      'node-added:fresh',
      'node-removed:old',
      'edge-added:fresh,x,e2',
      'edge-removed:old,x,e1',
    ]);
  });

  it('does not throw for an edge pointing at a node that does not exist', () => {
    const before = project([node('x')], [edge('e1', 'ghost', 'x')]);
    const after = project([node('x')], []);
    expect(diffDesigns(before, after)).toEqual([
      { kind: 'edge-removed', nodeIds: ['ghost', 'x'], edgeIds: ['e1'] },
    ]);
  });
});

describe('classifyChanges', () => {
  it('marks an edge change targeted when a finding names either endpoint', () => {
    const changes = diffDesigns(
      project([node('a'), node('b'), node('c')], []),
      project([node('a'), node('b'), node('c')], [edge('e1', 'a', 'b')]),
    );
    expect(classifyChanges(changes, [finding({ nodeIds: ['b'] })]).targeted).toHaveLength(1);
    expect(classifyChanges(changes, [finding({ nodeIds: ['a'] })]).targeted).toHaveLength(1);
    expect(classifyChanges(changes, [finding({ nodeIds: ['c'] })])).toEqual({
      targeted: [],
      collateral: changes,
    });
  });

  it('marks an edge change targeted when a finding names the edge id', () => {
    const changes = diffDesigns(project([node('a')]), project([node('a')], [edge('e1', 'a', 'a')]));
    expect(classifyChanges(changes, [finding({ edgeIds: ['e1'] })]).targeted).toHaveLength(1);
  });

  it('uses requirementIds for dropped links', () => {
    const changes = diffDesigns(
      project([node('n', { requirementIds: ['R1'] })]),
      project([node('n')]),
    );
    const vr012 = finding({ ruleId: 'VR-012', requirementIds: ['R1'] });
    expect(classifyChanges(changes, [vr012]).targeted).toEqual(changes);
    expect(classifyChanges(changes, [finding({ requirementIds: ['R9'] })]).collateral).toEqual(
      changes,
    );
  });
});

describe('regressions', () => {
  it('ignores findings present in the first draft and reports new ones', () => {
    const old = finding({ ruleId: 'VR-005', nodeIds: ['b', 'a'] });
    const same = finding({ id: 'other-id', ruleId: 'VR-005', nodeIds: ['a', 'b'] });
    const fresh = finding({ ruleId: 'VR-005', nodeIds: ['a', 'c'] });
    const sev = finding({ ruleId: 'VR-005', severity: 'warning', nodeIds: ['a', 'b'] });
    expect(regressions([old], [same, fresh, sev])).toEqual([fresh, sev]);
  });

  it('keys findings without a rule as structural', () => {
    expect(findingKey(finding({ nodeIds: ['b', 'a'], edgeIds: ['e'] }))).toBe(
      'structural|info|a,b|e',
    );
  });
});

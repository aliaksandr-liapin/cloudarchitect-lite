import type { ArchEdge, ArchNode, Finding, Project } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { awsCatalog } from '@cloudarchitect/catalog';
import { IMPLEMENTED_RULE_IDS } from '@cloudarchitect/domain';
import {
  classifyChanges,
  diffDesigns,
  findingKey,
  leftUnfixed,
  regressions,
  RULE_REQUESTED_SERVICES,
} from './design-diff.js';

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

const cw = { serviceId: 'aws.cloudwatch' };

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
  /** Diffs two designs and classifies the changes against `sent`. */
  const classify = (before: Project, after: Project, sent: Finding[]) =>
    classifyChanges(diffDesigns(before, after), sent, { before, after });
  const ids = (cs: { kind: string; nodeIds: string[]; edgeIds: string[] }[]) =>
    cs.map((c) => `${c.kind}:${[...c.nodeIds, ...c.edgeIds]}`);

  it('marks an edge change targeted when a finding names either endpoint', () => {
    const before = project([node('a'), node('b'), node('c')], []);
    const after = project([node('a'), node('b'), node('c')], [edge('e1', 'a', 'b')]);
    const changes = diffDesigns(before, after);
    const designs = { before, after };
    expect(classifyChanges(changes, [finding({ nodeIds: ['b'] })], designs).targeted).toHaveLength(
      1,
    );
    expect(classifyChanges(changes, [finding({ nodeIds: ['a'] })], designs).targeted).toHaveLength(
      1,
    );
    expect(classifyChanges(changes, [finding({ nodeIds: ['c'] })], designs)).toEqual({
      targeted: [],
      collateral: changes,
    });
  });

  it('marks an edge change targeted when a finding names the edge id', () => {
    const r = classify(project([node('a')]), project([node('a')], [edge('e1', 'a', 'a')]), [
      finding({ edgeIds: ['e1'] }),
    ]);
    expect(r.targeted).toHaveLength(1);
  });

  it('uses requirementIds for dropped links', () => {
    const before = project([node('n', { requirementIds: ['R1'] })]);
    const after = project([node('n')]);
    const vr012 = finding({ ruleId: 'VR-012', requirementIds: ['R1'] });
    expect(classify(before, after, [vr012]).targeted).toEqual(diffDesigns(before, after));
    expect(classify(before, after, [finding({ requirementIds: ['R9'] })]).collateral).toEqual(
      diffDesigns(before, after),
    );
  });

  it('counts a VR-007 fix (CloudWatch plus its edges) as targeted', () => {
    const before = project([node('fn'), node('db', { serviceId: 'aws.dynamodb' })]);
    const after = project(
      [node('fn'), node('db', { serviceId: 'aws.dynamodb' }), node('logs', cw)],
      [edge('e-logs', 'fn', 'logs'), edge('e-metrics', 'db', 'logs')],
    );
    const r = classify(before, after, [finding({ ruleId: 'VR-007' })]);
    expect(r.collateral).toEqual([]);
    expect(ids(r.targeted)).toEqual([
      'node-added:logs',
      'edge-added:fn,logs,e-logs',
      'edge-added:db,logs,e-metrics',
    ]);
  });

  it('counts a VR-005 fix (RDS Proxy between the named edge ends) as targeted', () => {
    const db = { serviceId: 'aws.rds' };
    const before = project([node('fn'), node('db', db)], [edge('e1', 'fn', 'db')]);
    const after = project(
      [node('fn'), node('db', db), node('proxy', { serviceId: 'aws.rds-proxy' })],
      [edge('e2', 'fn', 'proxy'), edge('e3', 'proxy', 'db')],
    );
    const r = classify(before, after, [finding({ ruleId: 'VR-005', edgeIds: ['e1'] })]);
    expect(r.collateral).toEqual([]);
    expect(ids(r.targeted)).toEqual([
      'node-added:proxy',
      'edge-added:fn,proxy,e2',
      'edge-added:proxy,db,e3',
      'edge-removed:fn,db,e1',
    ]);
  });

  it('counts a VR-004 DLQ added next to a named edge end as targeted', () => {
    const q = { serviceId: 'aws.sqs' };
    const before = project([node('queue', q), node('fn')], [edge('e1', 'queue', 'fn')]);
    const after = project(
      [node('queue', q), node('fn'), node('dlq', q)],
      [edge('e1', 'queue', 'fn'), edge('e-dlq', 'queue', 'dlq')],
    );
    const r = classify(before, after, [
      finding({ ruleId: 'VR-004', severity: 'warning', edgeIds: ['e1'] }),
    ]);
    expect(r.collateral).toEqual([]);
    expect(ids(r.targeted)).toEqual(['node-added:dlq', 'edge-added:queue,dlq,e-dlq']);
  });

  it('keeps an unrelated added node and its edges collateral', () => {
    const before = project(
      [node('fn'), node('db', { serviceId: 'aws.rds' }), node('web')],
      [edge('e1', 'fn', 'db')],
    );
    const after = project(
      [node('fn'), node('db', { serviceId: 'aws.rds' }), node('web'), node('cdn', cw), node('x')],
      [edge('e1', 'fn', 'db'), edge('e-x', 'web', 'x'), edge('e-cdn', 'web', 'cdn')],
    );
    // CloudWatch is only requested by a sent VR-007; here only VR-005 was sent.
    const r = classify(before, after, [finding({ ruleId: 'VR-005', edgeIds: ['e1'] })]);
    expect(r.targeted).toEqual([]);
    expect(ids(r.collateral)).toEqual([
      'node-added:cdn',
      'node-added:x',
      'edge-added:web,cdn,e-cdn',
      'edge-added:web,x,e-x',
    ]);
  });
});

describe('RULE_REQUESTED_SERVICES', () => {
  it('names only implemented rules and catalog services', () => {
    const services = new Set(awsCatalog.services.map((s) => s.id));
    for (const [rule, ids] of Object.entries(RULE_REQUESTED_SERVICES)) {
      expect(IMPLEMENTED_RULE_IDS, rule).toContain(rule);
      for (const id of ids) expect(services.has(id), id).toBe(true);
    }
  });
});

describe('leftUnfixed', () => {
  it('returns first-draft errors and warnings still present after the repair', () => {
    const warn = finding({ ruleId: 'VR-018', severity: 'warning', nodeIds: ['lb'] });
    const err = finding({ ruleId: 'VR-009', severity: 'error', nodeIds: ['db'] });
    const info = finding({ ruleId: 'VR-008', severity: 'info', nodeIds: ['db'] });
    const fixed = finding({ ruleId: 'VR-003', severity: 'warning', nodeIds: ['fn'] });
    const fresh = finding({ ruleId: 'VR-012', severity: 'warning', nodeIds: ['x'] });
    const warnAgain = finding({
      id: 'other',
      ruleId: 'VR-018',
      severity: 'warning',
      nodeIds: ['lb'],
    });
    expect(leftUnfixed([warn, err, info, fixed], [warnAgain, err, info, fresh])).toEqual([
      warn,
      err,
    ]);
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

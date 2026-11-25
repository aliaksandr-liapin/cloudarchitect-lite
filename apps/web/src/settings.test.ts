import { awsCatalog } from '@cloudarchitect/catalog';
import {
  applyPatch,
  migrateProject,
  type ArchEdge,
  type ArchNode,
  type Project,
} from '@cloudarchitect/domain';
import { samples } from '@cloudarchitect/catalog';
import { describe, expect, it } from 'vitest';
import { setSettingOps, settingsView } from './settings';

const node = (id: string, extra: Partial<ArchNode>): ArchNode =>
  ({
    id,
    provider: 'aws',
    label: id,
    requirementIds: [],
    position: { x: 0, y: 0 },
    size: { width: 100, height: 60 },
    ...extra,
  }) as ArchNode;

const project = (nodes: ArchNode[], edges: ArchEdge[] = []): Project =>
  ({
    schemaVersion: 1,
    id: 'p',
    name: 'P',
    revision: 0,
    requirements: [],
    assumptions: [],
    containers: [],
    nodes,
    edges,
  }) as unknown as Project;

const edge = (id: string, source: string, target: string, extra: Partial<ArchEdge> = {}) =>
  ({ id, source, target, kind: 'invoke', requirementIds: [], ...extra }) as ArchEdge;

const nodeKeys = (serviceId: string) => [
  ...new Set(
    awsCatalog.features
      .filter((f) => f.appliesTo === 'node' && f.serviceId === serviceId)
      .map((f) => f.configKey),
  ),
];

describe('settingsView', () => {
  it('node rows follow the catalog', () => {
    const p = project([node('t', { serviceId: 'aws.dynamodb' })]);
    const view = settingsView(p, { kind: 'node', id: 't' }, awsCatalog)!;
    expect(view.rows.map((r) => r.key)).toEqual(nodeKeys('aws.dynamodb'));
    expect(view.rows.map((r) => r.key)).toContain('encryption');
    expect(view.rows.find((r) => r.key === 'encryption')?.feature.values).toEqual([
      'KMS',
      'AWS-managed',
    ]);
    expect(view.rows.every((r) => r.value === undefined)).toBe(true);
    expect(view.other).toEqual([]);
  });

  it('connector rows come from both ends', () => {
    const p = project(
      [
        node('q', { serviceId: 'aws.sqs' }),
        node('fn', { serviceId: 'aws.lambda' }),
        node('b', { serviceId: 'aws.s3' }),
      ],
      [edge('e1', 'q', 'fn'), edge('e2', 'b', 'fn')],
    );
    const keys = (id: string) =>
      settingsView(p, { kind: 'edge', id }, awsCatalog)!.rows.map((r) => r.key);
    expect(keys('e1')).toEqual(expect.arrayContaining(['deadLetterQueue', 'failureDestination']));
    expect(keys('e2')).toEqual(expect.arrayContaining(['eventNotification', 'failureDestination']));
    expect(keys('e1')).not.toContain('eventNotification');
  });

  it('Origin Access Control is offered only between CloudFront and S3', () => {
    const p = project(
      [
        node('user', { external: { kind: 'user', name: 'Browser' } }),
        node('cdn', { serviceId: 'aws.cloudfront' }),
        node('b', { serviceId: 'aws.s3' }),
        node('api', { serviceId: 'aws.apigateway' }),
      ],
      [edge('in', 'user', 'cdn'), edge('s3', 'cdn', 'b'), edge('apiE', 'cdn', 'api')],
    );
    const keys = (id: string) =>
      settingsView(p, { kind: 'edge', id }, awsCatalog)!.rows.map((r) => r.key);
    expect(keys('s3')).toContain('originAccess');
    expect(keys('in')).not.toContain('originAccess');
    expect(keys('apiE')).not.toContain('originAccess');
  });

  it('S3 event notifications are offered only towards Lambda, SQS, SNS or EventBridge', () => {
    const p = project(
      [
        node('b', { serviceId: 'aws.s3' }),
        node('fn', { serviceId: 'aws.lambda' }),
        node('q', { serviceId: 'aws.sqs' }),
        node('cdn', { serviceId: 'aws.cloudfront' }),
      ],
      [edge('toFn', 'b', 'fn'), edge('toQ', 'b', 'q'), edge('origin', 'cdn', 'b')],
    );
    const keys = (id: string) =>
      settingsView(p, { kind: 'edge', id }, awsCatalog)!.rows.map((r) => r.key);
    expect(keys('toFn')).toContain('eventNotification');
    expect(keys('toQ')).toContain('eventNotification');
    expect(keys('origin')).not.toContain('eventNotification');
  });

  it('presigned upload is offered from a client or a backend, not from CloudFront', () => {
    const p = project(
      [
        node('user', { external: { kind: 'user', name: 'Browser' } }),
        node('b', { serviceId: 'aws.s3' }),
        node('fn', { serviceId: 'aws.lambda' }),
        node('cdn', { serviceId: 'aws.cloudfront' }),
      ],
      [edge('client', 'user', 'b'), edge('backend', 'fn', 'b'), edge('origin', 'cdn', 'b')],
    );
    const keys = (id: string) =>
      settingsView(p, { kind: 'edge', id }, awsCatalog)!.rows.map((r) => r.key);
    expect(keys('client')).toContain('presignedUrl');
    expect(keys('backend')).toContain('presignedUrl');
    expect(keys('origin')).not.toContain('presignedUrl');
    expect(keys('origin')).toEqual(['originAccess']);
  });

  it('a stored setting the catalog no longer offers there is kept as not in catalog', () => {
    const p = project(
      [
        node('user', { external: { kind: 'user', name: 'Browser' } }),
        node('cdn', { serviceId: 'aws.cloudfront' }),
      ],
      [edge('in', 'user', 'cdn', { configuration: { originAccess: 'OAC' } })],
    );
    expect(settingsView(p, { kind: 'edge', id: 'in' }, awsCatalog)!.other).toEqual([
      { key: 'originAccess', value: 'OAC' },
    ]);
  });

  it('external and unresolved nodes have no rows', () => {
    const p = project([
      node('u', { external: { kind: 'user', name: 'User' }, configuration: { tier: 'gold' } }),
      node('x', { unresolved: { name: 'Mainframe', rationale: 'n/a' } }),
    ]);
    expect(settingsView(p, { kind: 'node', id: 'u' }, awsCatalog)).toEqual({
      rows: [],
      other: [{ key: 'tier', value: 'gold' }],
    });
    expect(settingsView(p, { kind: 'node', id: 'x' }, awsCatalog)).toEqual({ rows: [], other: [] });
  });

  it('a key of another service is not in catalog', () => {
    const p = project([
      node('fn', { serviceId: 'aws.lambda', configuration: { encryption: 'KMS' } }),
    ]);
    const view = settingsView(p, { kind: 'node', id: 'fn' }, awsCatalog)!;
    expect(view.rows.map((r) => r.key)).not.toContain('encryption');
    expect(view.other).toEqual([{ key: 'encryption', value: 'KMS' }]);
  });

  it('non-string values are shown as text', () => {
    const p = project([
      node('db', { serviceId: 'aws.rds', configuration: { multiAz: true, backup: 7 } }),
    ]);
    const rows = settingsView(p, { kind: 'node', id: 'db' }, awsCatalog)!.rows;
    expect(rows.find((r) => r.key === 'multiAz')?.value).toBe('true');
    expect(rows.find((r) => r.key === 'backup')?.value).toBe('7');
  });

  it('containers and unknown ids have no view', () => {
    const p = project([node('t', { serviceId: 'aws.dynamodb' })]);
    expect(settingsView(p, { kind: 'node', id: 'nope' }, awsCatalog)).toBeUndefined();
    expect(settingsView(p, { kind: 'edge', id: 'nope' }, awsCatalog)).toBeUndefined();
  });
});

describe('setSettingOps', () => {
  const p = project(
    [
      node('t', { serviceId: 'aws.dynamodb', configuration: { backup: 'PITR' } }),
      node('q', { serviceId: 'aws.sqs' }),
      node('fn', { serviceId: 'aws.lambda' }),
      node('db', { serviceId: 'aws.rds', configuration: { multiAz: true, backup: 7 } }),
    ],
    [edge('e1', 'q', 'fn')],
  );

  it('set, change and remove produce one update op', () => {
    expect(setSettingOps(p, { kind: 'node', id: 't' }, 'encryption', 'KMS')).toEqual([
      {
        op: 'updateNode',
        id: 't',
        changes: { configuration: { backup: 'PITR', encryption: 'KMS' } },
      },
    ]);
    expect(setSettingOps(p, { kind: 'node', id: 't' }, 'backup', 'versioning')).toEqual([
      { op: 'updateNode', id: 't', changes: { configuration: { backup: 'versioning' } } },
    ]);
    expect(setSettingOps(p, { kind: 'edge', id: 'e1' }, 'deadLetterQueue', 'orders-dlq')).toEqual([
      { op: 'updateEdge', id: 'e1', changes: { configuration: { deadLetterQueue: 'orders-dlq' } } },
    ]);
  });

  it('removing the last setting drops configuration', () => {
    expect(setSettingOps(p, { kind: 'node', id: 't' }, 'backup', '')).toEqual([
      { op: 'updateNode', id: 't', changes: { configuration: undefined } },
    ]);
  });

  it('blank or whitespace removes the key; values are trimmed', () => {
    expect(setSettingOps(p, { kind: 'node', id: 't' }, 'backup', '   ')).toEqual([
      { op: 'updateNode', id: 't', changes: { configuration: undefined } },
    ]);
    expect(setSettingOps(p, { kind: 'node', id: 't' }, 'encryption', '  KMS ')).toEqual([
      {
        op: 'updateNode',
        id: 't',
        changes: { configuration: { backup: 'PITR', encryption: 'KMS' } },
      },
    ]);
  });

  it('unchanged value gives no ops', () => {
    expect(setSettingOps(p, { kind: 'node', id: 't' }, 'backup', 'PITR')).toEqual([]);
    expect(setSettingOps(p, { kind: 'node', id: 't' }, 'encryption', '')).toEqual([]);
    expect(setSettingOps(p, { kind: 'node', id: 'db' }, 'backup', '7')).toEqual([]);
    expect(setSettingOps(p, { kind: 'node', id: 'nope' }, 'backup', 'x')).toEqual([]);
  });

  it('non-string values of other keys are kept', () => {
    expect(setSettingOps(p, { kind: 'node', id: 'db' }, 'encryption', 'KMS')).toEqual([
      {
        op: 'updateNode',
        id: 'db',
        changes: { configuration: { multiAz: true, backup: 7, encryption: 'KMS' } },
      },
    ]);
  });

  it('placeholder words like none or false count as blank', () => {
    for (const word of ['none', 'Disabled', ' false ', 'no', 'off', 'n/a'])
      expect(setSettingOps(p, { kind: 'node', id: 't' }, 'backup', word), word).toEqual([
        { op: 'updateNode', id: 't', changes: { configuration: undefined } },
      ]);
    expect(setSettingOps(p, { kind: 'node', id: 't' }, 'encryption', 'none')).toEqual([]);
  });
});

describe('round trip through the real patch', () => {
  it('removing the last setting exports the component without configuration', () => {
    const sample = migrateProject(samples.myblog);
    const id = sample.nodes[0]!.id;
    const base = {
      ...sample,
      nodes: sample.nodes.map((n) =>
        n.id === id ? { ...n, configuration: { backup: 'PITR' } } : n,
      ),
    };
    const ops = setSettingOps(base, { kind: 'node', id }, 'backup', '');
    const after = applyPatch(base, { baseRevision: base.revision, ops });
    const exported = JSON.parse(JSON.stringify(after)) as Project;
    expect(exported.nodes.find((n) => n.id === id)).not.toHaveProperty('configuration');
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  migrateProject,
  Project,
  PROJECT_SCHEMA_VERSION,
  StalePatchError,
  UnsupportedSchemaError,
  validateProject,
  type CatalogSnapshot,
  type CloudService,
} from './index.js';

const service = (
  id: string,
  scope: CloudService['scope'],
  lifecycle: CloudService['lifecycle'] = 'active',
): CloudService => ({
  id,
  provider: 'aws',
  displayName: id,
  category: 'test',
  scope,
  capabilities: [],
  lifecycle,
  reviewStatus: 'needs_review',
  cfnResourceTypes: [],
  documentationUrl: 'https://docs.aws.amazon.com/',
  features: [],
  evidence: [],
});

const catalog: CatalogSnapshot = {
  manifest: {
    provider: 'aws',
    catalogVersion: 'test',
    schemaVersion: '1.0.0',
    generatedAt: '2026-10-13T00:00:00Z',
    reviewedAt: null,
  },
  services: [
    service('aws.cloudfront', 'global'),
    service('aws.s3', 'regional'),
    service('aws.lambda', 'regional'),
    service('aws.rds', 'vpc'),
    service('aws.dax', 'vpc'),
    service('aws.cloudwatch', 'regional'),
    service('aws.legacy', 'regional', 'deprecated'),
    service('aws.waf', 'regional'),
    service('aws.apigateway', 'regional'),
    service('aws.sqs', 'regional'),
    service('aws.alb', 'vpc'),
    service('aws.cognito', 'regional'),
    service('aws.dynamodb', 'regional'),
  ],
  features: [],
  facts: [],
  containers: [
    { kind: 'aws-cloud', displayName: 'AWS Cloud', allowedParents: [] },
    { kind: 'region', displayName: 'Region', allowedParents: ['aws-cloud'] },
    { kind: 'vpc', displayName: 'VPC', allowedParents: ['region'] },
    { kind: 'availability-zone', displayName: 'AZ', allowedParents: ['vpc'] },
    { kind: 'subnet', displayName: 'Subnet', allowedParents: ['vpc', 'availability-zone'] },
    { kind: 'group', displayName: 'Group', allowedParents: [] },
  ],
  rules: [],
};

const base = (over: Partial<Project> = {}): Project =>
  Project.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: 'p',
    name: 'Test',
    revision: 0,
    providerContext: ['aws'],
    catalogSnapshot: { aws: 'test' },
    containers: [
      { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
      { id: 'region', kind: 'region', parentId: 'cloud', label: 'us-east-1' },
    ],
    nodes: [
      {
        id: 'cw',
        provider: 'aws',
        serviceId: 'aws.cloudwatch',
        label: 'Monitoring',
        position: { x: 0, y: 0 },
        containerId: 'region',
      },
    ],
    ...over,
  });

const ruleIds = (p: Project) => validateProject(p, catalog).map((f) => f.ruleId);
const pos = { x: 0, y: 0 };

describe('Project schema', () => {
  it('rejects a node that has both serviceId and unresolved', () => {
    const bad = {
      id: 'n',
      provider: 'aws',
      serviceId: 'aws.s3',
      unresolved: { name: 'X', rationale: '' },
      label: 'n',
      position: pos,
    };
    expect(() => base({ nodes: [bad as never] })).toThrow();
  });

  it('accepts external actors and rejects a node with no service, unresolved or external', () => {
    const user = {
      id: 'u',
      provider: 'aws',
      external: { kind: 'user', name: 'Shopper' },
      label: 'Shopper',
      position: pos,
    };
    expect(base({ nodes: [user as never] }).nodes[0]?.external?.kind).toBe('user');
    expect(() =>
      base({ nodes: [{ id: 'n', provider: 'aws', label: 'n', position: pos } as never] }),
    ).toThrow();
  });
});

describe('validateProject', () => {
  it('returns no findings for a clean graph', () => {
    expect(validateProject(base(), catalog)).toEqual([]);
  });

  it('flags dangling edges, unknown services and bad container nesting', () => {
    const p = base({
      containers: [
        { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
        { id: 'vpc', kind: 'vpc', parentId: 'cloud', label: 'VPC' },
      ],
      nodes: [
        {
          id: 'cw',
          provider: 'aws',
          serviceId: 'aws.cloudwatch',
          label: 'CW',
          requirementIds: [],
          position: pos,
        },
        {
          id: 'x',
          provider: 'aws',
          serviceId: 'aws.madeup',
          label: 'X',
          requirementIds: [],
          position: pos,
        },
      ],
      edges: [{ id: 'e', source: 'cw', target: 'ghost', kind: 'read', requirementIds: [] }],
    });
    expect(ruleIds(p)).toEqual(
      expect.arrayContaining([
        'STRUCT-DANGLING-EDGE',
        'CATALOG-UNKNOWN-SERVICE',
        'STRUCT-CONTAINER-NESTING',
      ]),
    );
  });

  it('VR-001: CloudFront → S3 without OAC warns; with OAC is clean', () => {
    const nodes = [
      ...base().nodes,
      {
        id: 'cf',
        provider: 'aws' as const,
        serviceId: 'aws.cloudfront',
        label: 'CDN',
        requirementIds: ['R1'],
        position: pos,
      },
      {
        id: 's3',
        provider: 'aws' as const,
        serviceId: 'aws.s3',
        label: 'Site',
        requirementIds: ['R1'],
        position: pos,
      },
    ];
    const requirements = [
      { id: 'R1', text: 'Static site', type: 'functional' as const, status: 'confirmed' as const },
    ];
    const edge = {
      id: 'e',
      source: 'cf',
      target: 's3',
      kind: 'origin' as const,
      requirementIds: [],
    };
    expect(ruleIds(base({ nodes, requirements, edges: [edge] }))).toContain('VR-001');
    expect(
      ruleIds(
        base({ nodes, requirements, edges: [{ ...edge, configuration: { originAccess: 'OAC' } }] }),
      ),
    ).not.toContain('VR-001');
  });

  it('VR-006: DAX without a justifying requirement warns', () => {
    const dax = {
      id: 'dax',
      provider: 'aws' as const,
      serviceId: 'aws.dax',
      label: 'DAX',
      requirementIds: [],
      position: pos,
    };
    expect(ruleIds(base({ nodes: [...base().nodes, dax] }))).toContain('VR-006');
    const justified = { ...dax, requirementIds: ['R1'] };
    const requirements = [
      {
        id: 'R1',
        text: 'Microsecond reads',
        type: 'non-functional' as const,
        status: 'confirmed' as const,
      },
    ];
    expect(ruleIds(base({ nodes: [...base().nodes, justified], requirements }))).not.toContain(
      'VR-006',
    );
  });

  it('VR-009 / VR-010: VPC-bound services outside a VPC or in a public subnet are errors', () => {
    const rdsOutside = {
      id: 'db',
      provider: 'aws' as const,
      serviceId: 'aws.rds',
      label: 'DB',
      requirementIds: [],
      position: pos,
      containerId: 'region',
    };
    expect(ruleIds(base({ nodes: [...base().nodes, rdsOutside] }))).toContain('VR-009');

    const containers = [
      ...base().containers,
      { id: 'vpc', kind: 'vpc' as const, parentId: 'region', label: 'VPC' },
      {
        id: 'pub',
        kind: 'subnet' as const,
        parentId: 'vpc',
        label: 'Public',
        properties: { subnetType: 'public' as const },
      },
    ];
    const rdsPublic = { ...rdsOutside, containerId: 'pub' };
    const ids = ruleIds(base({ containers, nodes: [...base().nodes, rdsPublic] }));
    expect(ids).toContain('VR-010');
    expect(ids).not.toContain('VR-009');
  });

  it('VR-012 / VR-013 / VR-014 / VR-015: coverage, lifecycle and unresolved nodes', () => {
    const p = base({
      requirements: [{ id: 'R1', text: 'Send email', type: 'functional', status: 'confirmed' }],
      nodes: [
        ...base().nodes,
        {
          id: 'old',
          provider: 'aws',
          serviceId: 'aws.legacy',
          label: 'Old',
          requirementIds: [],
          position: pos,
        },
        {
          id: 'u',
          provider: 'aws',
          unresolved: { name: 'Amazon Rekognition', rationale: 'moderation' },
          label: 'Moderation',
          requirementIds: [],
          position: pos,
        },
      ],
    });
    expect(ruleIds(p)).toEqual(expect.arrayContaining(['VR-012', 'VR-013', 'VR-014', 'VR-015']));
  });

  it('VR-007: missing CloudWatch is reported', () => {
    const p = base({
      nodes: [
        {
          id: 's3',
          provider: 'aws',
          serviceId: 'aws.s3',
          label: 'S3',
          requirementIds: [],
          position: pos,
        },
      ],
    });
    expect(ruleIds(p)).toContain('VR-007');
  });
});

describe('integration rules from the Phase 0 review', () => {
  const node = (id: string, serviceId: string, extra: Record<string, unknown> = {}) =>
    ({
      id,
      provider: 'aws',
      serviceId,
      label: id,
      requirementIds: [],
      position: pos,
      containerId: 'region',
      ...extra,
    }) as never;
  const edge = (
    source: string,
    target: string,
    kind: string,
    configuration?: Record<string, string>,
  ) =>
    ({
      id: `${source}-${target}`,
      source,
      target,
      kind,
      requirementIds: [],
      configuration,
    }) as never;

  it('VR-016: WAF on an HTTP API is an error; on a REST API it is clean', () => {
    const p = (apiType: string) =>
      base({
        nodes: [
          node('waf', 'aws.waf'),
          node('api', 'aws.apigateway', { configuration: { apiType } }),
          node('cw', 'aws.cloudwatch'),
        ],
        edges: [edge('waf', 'api', 'other')],
      });
    expect(ruleIds(p('HTTP'))).toContain('VR-016');
    expect(ruleIds(p('REST'))).not.toContain('VR-016');
  });

  it('VR-017 / VR-004: an on-failure destination does not cover an SQS event source', () => {
    const p = (configuration: Record<string, string>) =>
      base({
        nodes: [node('q', 'aws.sqs'), node('fn', 'aws.lambda'), node('cw', 'aws.cloudwatch')],
        edges: [edge('q', 'fn', 'event', configuration)],
      });
    expect(ruleIds(p({ failureDestination: 'dlq' }))).toEqual(
      expect.arrayContaining(['VR-017', 'VR-004']),
    );
    expect(ruleIds(p({ deadLetterQueue: 'dlq' }))).not.toEqual(expect.arrayContaining(['VR-017']));
    expect(ruleIds(p({ deadLetterQueue: 'dlq' }))).not.toContain('VR-004');
  });

  it('VR-018: an ALB in one availability zone warns; across two is clean', () => {
    const containers = [
      { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
      { id: 'region', kind: 'region', parentId: 'cloud', label: 'r' },
      { id: 'vpc', kind: 'vpc', parentId: 'region', label: 'v' },
      { id: 'az1', kind: 'availability-zone', parentId: 'vpc', label: 'a' },
      { id: 'az2', kind: 'availability-zone', parentId: 'vpc', label: 'b' },
      {
        id: 's1',
        kind: 'subnet',
        parentId: 'az1',
        label: 's1',
        properties: { subnetType: 'public' },
      },
      {
        id: 's2',
        kind: 'subnet',
        parentId: 'az2',
        label: 's2',
        properties: { subnetType: 'public' },
      },
    ] as Project['containers'];
    const one = base({
      containers,
      nodes: [node('alb', 'aws.alb', { containerId: 's1' }), node('cw', 'aws.cloudwatch')],
    });
    const two = base({
      containers,
      nodes: [
        node('alb', 'aws.alb', { containerId: 's1' }),
        node('alb2', 'aws.alb', { containerId: 's2' }),
        node('cw', 'aws.cloudwatch'),
      ],
    });
    expect(ruleIds(one)).toContain('VR-018');
    expect(ruleIds(two)).not.toContain('VR-018');
  });
});

describe('applyPatch', () => {
  it('applies ops, bumps revision and removes edges of removed nodes', () => {
    const p = base({
      nodes: [
        ...base().nodes,
        {
          id: 's3',
          provider: 'aws',
          serviceId: 'aws.s3',
          label: 'S3',
          requirementIds: [],
          position: pos,
        },
      ],
      edges: [{ id: 'e', source: 'cw', target: 's3', kind: 'read', requirementIds: [] }],
    });
    const next = applyPatch(p, { baseRevision: 0, ops: [{ op: 'removeNode', id: 's3' }] });
    expect(next.revision).toBe(1);
    expect(next.edges).toEqual([]);
  });

  it('never overwrites positions through updateNode', () => {
    const next = applyPatch(base(), {
      baseRevision: 0,
      ops: [{ op: 'updateNode', id: 'cw', changes: { label: 'Obs', position: { x: 9, y: 9 } } }],
    });
    expect(next.nodes[0]).toMatchObject({ label: 'Obs', position: pos });
  });

  it('rejects stale patches', () => {
    expect(() =>
      applyPatch(base({ revision: 3 }), { baseRevision: 2, ops: [{ op: 'removeNode', id: 'cw' }] }),
    ).toThrow(StalePatchError);
  });
});

describe('migrateProject', () => {
  it('upgrades 1.0.0 projects into a default aws-cloud container', () => {
    const v1 = {
      schemaVersion: '1.0.0',
      projectId: 'old',
      name: 'Old',
      providerContext: ['aws'],
      catalogSnapshot: { aws: 'x' },
      nodes: [{ id: 'n', provider: 'aws', serviceId: 'aws.s3', label: 'S3', position: pos }],
      edges: [],
      warnings: ['free text'],
    };
    const p = migrateProject(v1);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.containers[0]?.kind).toBe('aws-cloud');
    expect(p.nodes[0]?.containerId).toBe(p.containers[0]?.id);
  });

  it('upgrades 1.1.0 projects without touching nodes', () => {
    const v11 = { ...base(), schemaVersion: '1.1.0' };
    const p = migrateProject(v11);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.nodes).toEqual(base().nodes);
  });

  it('upgrades 1.2.0 projects to 1.3.0 unchanged otherwise', () => {
    expect(PROJECT_SCHEMA_VERSION).toBe('1.3.0');
    const v12 = { ...base(), schemaVersion: '1.2.0' };
    const p = migrateProject(v12);
    expect(p.schemaVersion).toBe('1.3.0');
    expect(p).toEqual(Project.parse({ ...base(), schemaVersion: '1.3.0' }));
  });

  it('rejects unknown versions', () => {
    expect(() => migrateProject({ schemaVersion: '9.9.9' })).toThrow(UnsupportedSchemaError);
  });
});

describe('PRD rules VR-002, VR-003, VR-008, VR-011', () => {
  const node = (id: string, serviceId: string, extra: Record<string, unknown> = {}) =>
    ({
      id,
      provider: 'aws',
      serviceId,
      label: id,
      requirementIds: [],
      position: pos,
      containerId: 'region',
      ...extra,
    }) as never;
  const ext = (id: string, kind: string) =>
    ({
      id,
      provider: 'aws',
      label: id,
      requirementIds: [],
      position: pos,
      external: { kind, name: id },
    }) as never;
  const edge = (
    source: string,
    target: string,
    kind: string,
    configuration?: Record<string, string>,
  ) =>
    ({
      id: `${source}-${target}`,
      source,
      target,
      kind,
      requirementIds: [],
      configuration,
    }) as never;
  const cw = node('cw', 'aws.cloudwatch');

  it('VR-002 flags clients reading S3 that CloudFront also serves', () => {
    const p = base({
      nodes: [ext('u', 'user'), node('cf', 'aws.cloudfront'), node('s3', 'aws.s3'), cw],
      edges: [edge('cf', 's3', 'origin', { originAccess: 'OAC' }), edge('u', 's3', 'read')],
    });
    expect(ruleIds(p)).toContain('VR-002');
  });
  it('VR-002 accepts S3 reached only through CloudFront', () => {
    const p = base({
      nodes: [ext('u', 'user'), node('cf', 'aws.cloudfront'), node('s3', 'aws.s3'), cw],
      edges: [edge('cf', 's3', 'origin', { originAccess: 'OAC' }), edge('u', 'cf', 'read')],
    });
    expect(ruleIds(p)).not.toContain('VR-002');
  });

  it('VR-003 flags a public API without an authorizer', () => {
    const p = base({
      nodes: [ext('u', 'user'), node('api', 'aws.apigateway'), cw],
      edges: [edge('u', 'api', 'invoke')],
    });
    expect(ruleIds(p)).toContain('VR-003');
  });
  it('VR-003 accepts an API with authorizer config', () => {
    const p = base({
      nodes: [
        ext('u', 'user'),
        node('api', 'aws.apigateway', { configuration: { authorizer: 'JWT' } }),
        cw,
      ],
      edges: [edge('u', 'api', 'invoke')],
    });
    expect(ruleIds(p)).not.toContain('VR-003');
  });
  it('VR-003 accepts an authorizer on the incoming edge or a Cognito link', () => {
    const nodes = [ext('u', 'user'), node('alb', 'aws.alb'), node('c', 'aws.cognito'), cw];
    expect(
      ruleIds(base({ nodes, edges: [edge('u', 'alb', 'invoke', { authorizer: 'OIDC' })] })),
    ).not.toContain('VR-003');
    expect(
      ruleIds(base({ nodes, edges: [edge('u', 'alb', 'invoke'), edge('alb', 'c', 'other')] })),
    ).not.toContain('VR-003');
  });

  it('VR-008 flags a data store without encryption', () => {
    const p = base({ nodes: [node('t', 'aws.dynamodb'), cw] });
    expect(ruleIds(p)).toContain('VR-008');
  });
  it('VR-008 accepts a data store with encryption', () => {
    const p = base({
      nodes: [node('t', 'aws.dynamodb', { configuration: { encryption: 'KMS' } }), cw],
    });
    expect(ruleIds(p)).not.toContain('VR-008');
  });

  it('VR-011 flags a client upload to S3 without authorization', () => {
    const p = base({
      nodes: [ext('c', 'client-app'), node('s3', 'aws.s3'), cw],
      edges: [edge('c', 's3', 'write')],
    });
    expect(ruleIds(p)).toContain('VR-011');
  });
  it('VR-011 accepts a presigned URL or a Cognito link', () => {
    const nodes = [ext('c', 'client-app'), node('s3', 'aws.s3'), node('cog', 'aws.cognito'), cw];
    expect(
      ruleIds(base({ nodes, edges: [edge('c', 's3', 'write', { presignedUrl: 'PUT' })] })),
    ).not.toContain('VR-011');
    expect(
      ruleIds(base({ nodes, edges: [edge('c', 's3', 'write'), edge('c', 'cog', 'invoke')] })),
    ).not.toContain('VR-011');
  });
});

describe('toggle rules VR-019…VR-025', () => {
  const node = (id: string, serviceId: string, extra: Record<string, unknown> = {}) =>
    ({
      id,
      provider: 'aws',
      serviceId,
      label: id,
      requirementIds: [],
      position: pos,
      containerId: 'region',
      ...extra,
    }) as never;
  const ext = (id: string) =>
    ({
      id,
      provider: 'aws',
      label: id,
      requirementIds: [],
      position: pos,
      external: { kind: 'user', name: id },
    }) as never;
  const edge = (source: string, target: string) =>
    ({ id: `${source}-${target}`, source, target, kind: 'invoke', requirementIds: [] }) as never;
  const gen = (toggles: Record<string, unknown>) => ({
    toggles,
    model: 'sonnet',
    generatedAt: '2026-10-18T00:00:00Z',
    contentHash: 'h',
  });
  const req = (id: string, provenance: string, status = 'confirmed') =>
    ({ id, text: id, type: 'functional', status, provenance }) as never;
  const withToggles = (toggles: Record<string, unknown>, over: Partial<Project> = {}) =>
    base({ generation: gen(toggles) as never, ...over });
  const found = (p: Project, id: string) =>
    validateProject(p, catalog).filter((f) => f.ruleId === id);

  it('VR-019 flags unrequested servers and accepts user-requested ones', () => {
    const bad = withToggles(
      { serverlessFirst: true },
      {
        nodes: [node('vm', 'aws.ec2', { requirementIds: ['R1'] })],
        requirements: [req('R1', 'ai')],
      },
    );
    expect(found(bad, 'VR-019')[0]?.requirementIds).toEqual(['T-serverless-first']);
    const ok = withToggles(
      { serverlessFirst: true },
      {
        nodes: [node('vm', 'aws.ec2', { requirementIds: ['R1'] })],
        requirements: [req('R1', 'user')],
      },
    );
    expect(found(ok, 'VR-019')).toHaveLength(0);
  });

  it('VR-020 flags a data store without backup', () => {
    const t = { backups: true };
    expect(found(withToggles(t, { nodes: [node('s3', 'aws.s3')] }), 'VR-020')).toHaveLength(1);
    const ok = node('s3', 'aws.s3', { configuration: { backup: 'versioning' } });
    expect(found(withToggles(t, { nodes: [ok] }), 'VR-020')).toHaveLength(0);
  });

  it('VR-021 flags a database that is not Multi-AZ', () => {
    const t = { disasterRecovery: 'multi-az' };
    expect(found(withToggles(t, { nodes: [node('db', 'aws.rds')] }), 'VR-021')).toHaveLength(1);
    const ok = node('db', 'aws.rds', { configuration: { multiAz: 'true' } });
    expect(found(withToggles(t, { nodes: [ok] }), 'VR-021')).toHaveLength(0);
    expect(
      found(
        withToggles({ disasterRecovery: 'cross-region' }, { nodes: [node('db', 'aws.rds')] }),
        'VR-021',
      ),
    ).toHaveLength(0);
  });

  it('VR-022 needs two regions and replicated stores', () => {
    const t = { disasterRecovery: 'cross-region' };
    const bad = withToggles(t, { nodes: [node('d', 'aws.dynamodb'), node('e', 'aws.efs')] });
    expect(found(bad, 'VR-022')).toHaveLength(2); // one region + dynamodb; EFS exempt
    const ok = withToggles(t, {
      containers: [
        { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
        { id: 'region', kind: 'region', parentId: 'cloud', label: 'a' },
        { id: 'region2', kind: 'region', parentId: 'cloud', label: 'b' },
      ],
      nodes: [node('d', 'aws.dynamodb', { configuration: { replication: 'global-table' } })],
    });
    expect(found(ok, 'VR-022')).toHaveLength(0);
  });

  it('VR-022 accepts a replica in another region of a replicated store', () => {
    const t = { disasterRecovery: 'cross-region' };
    const containers = [
      { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
      { id: 'region', kind: 'region', parentId: 'cloud', label: 'a' },
      { id: 'region2', kind: 'region', parentId: 'cloud', label: 'b' },
    ];
    const replicated = { containerId: 'region', configuration: { replication: 'global tables' } };
    const replica = withToggles(t, {
      containers: containers as never,
      nodes: [
        node('d', 'aws.dynamodb', replicated),
        node('d2', 'aws.dynamodb', { containerId: 'region2' }),
      ],
    });
    expect(found(replica, 'VR-022')).toHaveLength(0);
    // Same region, or a different service, is not a replica.
    const sameRegion = withToggles(t, {
      containers: containers as never,
      nodes: [
        node('d', 'aws.dynamodb', replicated),
        node('d2', 'aws.dynamodb', { containerId: 'region' }),
        node('s', 'aws.s3', { containerId: 'region2' }),
      ],
    });
    expect(found(sameRegion, 'VR-022').flatMap((f) => f.nodeIds)).toEqual(['d2', 's']);
  });

  describe('VR-023', () => {
    const containers = (azs: string[]) => [
      { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
      { id: 'region', kind: 'region', parentId: 'cloud', label: 'r' },
      { id: 'vpc', kind: 'vpc', parentId: 'region', label: 'vpc' },
      ...azs.map((a) => ({ id: a, kind: 'availability-zone', parentId: 'vpc', label: a })),
    ];
    const at = (id: string, serviceId: string, containerId: string) =>
      node(id, serviceId, { containerId });
    it('flags a single AZ or no AZ and accepts two', () => {
      const t = { highAvailability: true };
      const one = withToggles(t, {
        containers: containers(['a']) as never,
        nodes: [at('lb', 'aws.alb', 'a'), at('db', 'aws.rds', 'a')],
      });
      expect(found(one, 'VR-023')).toHaveLength(1);
      const none = withToggles(t, {
        containers: containers([]) as never,
        nodes: [at('db', 'aws.rds', 'vpc')],
      });
      expect(found(none, 'VR-023')).toHaveLength(1);
      const two = withToggles(t, {
        containers: containers(['a', 'b']) as never,
        nodes: [at('lb', 'aws.alb', 'a'), at('db', 'aws.rds', 'b')],
      });
      expect(found(two, 'VR-023')).toHaveLength(0);
    });
    it('also runs for disaster recovery', () => {
      const p = withToggles(
        { disasterRecovery: 'multi-az' },
        { containers: containers(['a']) as never, nodes: [at('db', 'aws.rds', 'a')] },
      );
      expect(found(p, 'VR-023')[0]?.requirementIds).toEqual(['T-dr']);
    });
  });

  it('VR-024 flags cost drivers with only toggle requirements', () => {
    const t = { costOptimized: true };
    const mk = (r: string) =>
      withToggles(t, {
        nodes: [node('vm', 'aws.ec2', { requirementIds: ['T-cost', 'R1'] })],
        requirements: [req('T-cost', 'toggle'), req('R1', r)],
      });
    expect(found(mk('toggle'), 'VR-024')).toHaveLength(1);
    expect(found(mk('user'), 'VR-024')).toHaveLength(0);
  });

  it('VR-025 flags public entry points without WAF and data stores without KMS', () => {
    const t = { securityHardening: true };
    const kms = { configuration: { encryption: 'KMS' } };
    const bad = withToggles(t, {
      nodes: [ext('u'), node('api', 'aws.apigateway'), node('s3', 'aws.s3')],
      edges: [edge('u', 'api')],
    });
    expect(found(bad, 'VR-025')).toHaveLength(2);
    const ok = withToggles(t, {
      nodes: [
        ext('u'),
        node('api', 'aws.apigateway'),
        node('waf', 'aws.waf'),
        node('s3', 'aws.s3', kms),
      ],
      edges: [edge('u', 'api'), edge('waf', 'api')],
    });
    expect(found(ok, 'VR-025')).toHaveLength(0);
  });

  it('never fires without project.generation', () => {
    const p = base({
      nodes: [node('vm', 'aws.ec2'), node('s3', 'aws.s3'), node('api', 'aws.apigateway'), ext('u')],
      edges: [edge('u', 'api')],
    });
    expect(ruleIds(p).filter((id) => /^VR-0(19|2[0-5])$/.test(id ?? ''))).toEqual([]);
  });
});

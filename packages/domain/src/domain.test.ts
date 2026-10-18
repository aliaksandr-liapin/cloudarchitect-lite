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

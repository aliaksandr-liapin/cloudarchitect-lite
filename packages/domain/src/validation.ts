import type { CatalogSnapshot, CloudService } from './catalog.js';
import type { ArchEdge, ArchNode, Container, Finding, Project, Severity } from './project.js';
import { LIMITS } from './project.js';
import { TOGGLE_REQUIREMENT_IDS, type DesignToggles } from './toggles.js';

export const VALIDATOR_VERSION = 'validator-0.1.0';

type Draft = Omit<
  Finding,
  | 'id'
  | 'class'
  | 'producerVersion'
  | 'nodeIds'
  | 'edgeIds'
  | 'containerIds'
  | 'requirementIds'
  | 'evidence'
> &
  Partial<Pick<Finding, 'nodeIds' | 'edgeIds' | 'containerIds' | 'requirementIds' | 'evidence'>>;

interface Ctx {
  project: Project;
  catalog: CatalogSnapshot;
  services: Map<string, CloudService>;
  nodes: Map<string, ArchNode>;
  containers: Map<string, Container>;
}

type Rule = { id: string; severity: Severity; check: (ctx: Ctx) => Draft[] };

const svc = (n: ArchNode) => n.serviceId;
const nodesOf = (ctx: Ctx, ...ids: string[]) =>
  ctx.project.nodes.filter((n) => n.serviceId !== undefined && ids.includes(n.serviceId));
const edgeEnds = (ctx: Ctx, e: ArchEdge) =>
  [ctx.nodes.get(e.source), ctx.nodes.get(e.target)] as const;

/** Walks up the container chain; returns the first container of `kind`, if any. */
function enclosing(ctx: Ctx, containerId: string | undefined, kind: Container['kind']) {
  let cur = containerId ? ctx.containers.get(containerId) : undefined;
  for (let depth = 0; cur && depth <= LIMITS.maxContainerDepth; depth++) {
    if (cur.kind === kind) return cur;
    cur = cur.parentId ? ctx.containers.get(cur.parentId) : undefined;
  }
  return undefined;
}

const toggles = (ctx: Ctx): DesignToggles => ctx.project.generation?.toggles ?? {};

/** True when an edge connects the node to a node of `serviceId`, in either direction. */
function linkedToService(ctx: Ctx, nodeId: string, serviceId: string): boolean {
  return ctx.project.edges.some((e) => {
    const other = e.source === nodeId ? e.target : e.target === nodeId ? e.source : undefined;
    const o = other ? ctx.nodes.get(other) : undefined;
    return o !== undefined && svc(o) === serviceId;
  });
}

const VPC_BOUND = ['aws.ec2', 'aws.rds', 'aws.aurora', 'aws.elasticache', 'aws.efs'];
const DATABASES = ['aws.rds', 'aws.aurora', 'aws.elasticache'];
const ASYNC_SOURCES = ['aws.sqs', 'aws.sns', 'aws.eventbridge', 'aws.s3'];
export const DATA_STORES = [
  'aws.s3',
  'aws.dynamodb',
  'aws.rds',
  'aws.aurora',
  'aws.efs',
  'aws.elasticache',
];
const CLIENT_KINDS = ['user', 'client-app'];
const BASELINE = [
  'aws.cloudwatch',
  'aws.xray',
  'aws.cloudtrail',
  'aws.iam',
  'aws.kms',
  'aws.waf',
  'aws.shield',
];

/**
 * Deterministic rules from PRD §11. Each rule's metadata lives in the catalog
 * (`validation-rules.json`); logic lives here, keyed by rule ID.
 * VR-016…VR-018 come from the Phase 0 blind review (docs/product/phase0-spike.md).
 */
const RULES: Rule[] = [
  {
    id: 'VR-001',
    severity: 'warning',
    check: (ctx) =>
      ctx.project.edges
        .filter((e) => {
          const [s, t] = edgeEnds(ctx, e);
          return (
            s &&
            t &&
            svc(s) === 'aws.cloudfront' &&
            svc(t) === 'aws.s3' &&
            e.configuration?.originAccess !== 'OAC'
          );
        })
        .map((e) => ({
          ruleId: 'VR-001',
          severity: 'warning',
          edgeIds: [e.id],
          explanation:
            'S3 origin is served through CloudFront without Origin Access Control (OAC).',
          remediation: 'Set originAccess = OAC and keep the bucket private.',
        })),
  },
  {
    id: 'VR-002',
    severity: 'warning',
    check: (ctx) => {
      const served = new Set(
        ctx.project.edges
          .filter(
            (e) =>
              e.kind === 'origin' &&
              svc(ctx.nodes.get(e.source) ?? ({} as ArchNode)) === 'aws.cloudfront',
          )
          .map((e) => e.target),
      );
      return ctx.project.edges
        .filter((e) => {
          const [s, t] = edgeEnds(ctx, e);
          return (
            s &&
            t &&
            s.external &&
            CLIENT_KINDS.includes(s.external.kind) &&
            svc(t) === 'aws.s3' &&
            served.has(t.id)
          );
        })
        .map((e) => ({
          ruleId: 'VR-002',
          severity: 'warning',
          edgeIds: [e.id],
          explanation:
            'Clients reach the S3 bucket directly while CloudFront also serves its content.',
          remediation:
            'Route client reads through CloudFront and keep the bucket private behind OAC.',
        }));
    },
  },
  {
    id: 'VR-003',
    severity: 'warning',
    check: (ctx) =>
      nodesOf(ctx, 'aws.apigateway', 'aws.alb')
        .filter((n) => {
          const incoming = ctx.project.edges.filter((e) => e.target === n.id);
          const exposed = incoming.some((e) => {
            const s = ctx.nodes.get(e.source);
            return s && (s.external || svc(s) === 'aws.cloudfront');
          });
          if (!exposed) return false;
          return (
            !n.configuration?.authorizer &&
            !incoming.some((e) => e.configuration?.authorizer) &&
            !linkedToService(ctx, n.id, 'aws.cognito')
          );
        })
        .map((n) => ({
          ruleId: 'VR-003',
          severity: 'warning',
          nodeIds: [n.id],
          explanation: `${n.label} is reachable from the internet without a stated authentication mechanism.`,
          remediation:
            'Add a Cognito, IAM or Lambda authorizer (or Cognito/OIDC authentication on the ALB).',
        })),
  },
  {
    id: 'VR-008',
    severity: 'info',
    check: (ctx) =>
      nodesOf(ctx, ...DATA_STORES)
        .filter((n) => !n.configuration?.encryption)
        .map((n) => ({
          ruleId: 'VR-008',
          severity: 'info',
          nodeIds: [n.id],
          explanation: `${n.label} has no stated encryption at rest.`,
          remediation: 'Set encryption to KMS or AWS-managed.',
        })),
  },
  {
    id: 'VR-004',
    severity: 'warning',
    check: (ctx) =>
      ctx.project.edges
        .filter((e) => {
          const [s, t] = edgeEnds(ctx, e);
          return (
            s &&
            t &&
            e.kind === 'event' &&
            ASYNC_SOURCES.includes(svc(s) ?? '') &&
            svc(t) === 'aws.lambda' &&
            !e.configuration?.deadLetterQueue &&
            // On-failure destinations do not apply to SQS event sources (VR-017).
            !(svc(s) !== 'aws.sqs' && e.configuration?.failureDestination)
          );
        })
        .map((e) => ({
          ruleId: 'VR-004',
          severity: 'warning',
          edgeIds: [e.id],
          explanation: 'Asynchronous consumer has no dead-letter queue or failure destination.',
          remediation: 'Add an SQS DLQ or a Lambda on-failure destination.',
        })),
  },
  {
    id: 'VR-005',
    severity: 'info',
    check: (ctx) =>
      ctx.project.edges
        .filter((e) => {
          const [s, t] = edgeEnds(ctx, e);
          return (
            s && t && svc(s) === 'aws.lambda' && ['aws.rds', 'aws.aurora'].includes(svc(t) ?? '')
          );
        })
        .map((e) => ({
          ruleId: 'VR-005',
          severity: 'info',
          edgeIds: [e.id],
          explanation:
            'Lambda connects to a relational database directly; connection storms are likely under load.',
          remediation: 'Consider RDS Proxy between Lambda and the database.',
        })),
  },
  {
    id: 'VR-006',
    severity: 'warning',
    check: (ctx) =>
      nodesOf(ctx, 'aws.dax')
        .filter(
          (n) =>
            !n.requirementIds.some((rid) => {
              const r = ctx.project.requirements.find((q) => q.id === rid);
              return r && r.status !== 'open';
            }),
        )
        .map((n) => ({
          ruleId: 'VR-006',
          severity: 'warning',
          nodeIds: [n.id],
          explanation:
            'DynamoDB Accelerator (DAX) is not justified by any confirmed or inferred requirement; it adds cost and operational surface.',
          remediation: 'Remove DAX, or link it to a requirement for microsecond read latency.',
        })),
  },
  {
    id: 'VR-007',
    severity: 'info',
    check: (ctx) =>
      ctx.project.nodes.length > 0 && nodesOf(ctx, 'aws.cloudwatch').length === 0
        ? [
            {
              ruleId: 'VR-007',
              severity: 'info',
              explanation: 'No observability component (CloudWatch) in the architecture.',
            },
          ]
        : [],
  },
  {
    id: 'VR-009',
    severity: 'error',
    check: (ctx) =>
      nodesOf(ctx, ...VPC_BOUND)
        .filter((n) => !enclosing(ctx, n.containerId, 'vpc'))
        .map((n) => ({
          ruleId: 'VR-009',
          severity: 'error',
          nodeIds: [n.id],
          explanation: `${n.label} must run inside a VPC.`,
          remediation: 'Move the node into a subnet of a VPC container.',
        })),
  },
  {
    id: 'VR-010',
    severity: 'error',
    check: (ctx) =>
      nodesOf(ctx, ...DATABASES)
        .filter((n) => enclosing(ctx, n.containerId, 'subnet')?.properties?.subnetType === 'public')
        .map((n) => ({
          ruleId: 'VR-010',
          severity: 'error',
          nodeIds: [n.id],
          explanation: `${n.label} is placed in a public subnet.`,
          remediation: 'Move the database to a private subnet.',
        })),
  },
  {
    id: 'VR-011',
    severity: 'warning',
    check: (ctx) =>
      ctx.project.edges
        .filter((e) => {
          const [s, t] = edgeEnds(ctx, e);
          if (!s || !t || e.kind !== 'write' || !s.external || svc(t) !== 'aws.s3') return false;
          if (e.configuration?.presignedUrl) return false;
          return !linkedToService(ctx, s.id, 'aws.cognito');
        })
        .map((e) => ({
          ruleId: 'VR-011',
          severity: 'warning',
          edgeIds: [e.id],
          explanation: 'A client writes to S3 without a stated authorization mechanism.',
          remediation: 'Issue presigned URLs from a backend, or authorize the client with Cognito.',
        })),
  },
  {
    id: 'VR-012',
    severity: 'warning',
    check: (ctx) => {
      const covered = new Set([
        ...ctx.project.nodes.flatMap((n) => n.requirementIds),
        ...ctx.project.edges.flatMap((e) => e.requirementIds),
      ]);
      return ctx.project.requirements
        .filter((r) => r.status !== 'open' && !covered.has(r.id))
        .map((r) => ({
          ruleId: 'VR-012',
          severity: 'warning',
          requirementIds: [r.id],
          explanation: `Requirement ${r.id} is not covered by any component or connection.`,
        }));
    },
  },
  {
    id: 'VR-013',
    severity: 'info',
    check: (ctx) =>
      ctx.project.nodes
        .filter(
          (n) => !n.external && n.requirementIds.length === 0 && !BASELINE.includes(svc(n) ?? ''),
        )
        .map((n) => ({
          ruleId: 'VR-013',
          severity: 'info',
          nodeIds: [n.id],
          explanation: `${n.label} is not linked to any requirement.`,
        })),
  },
  {
    id: 'VR-014',
    severity: 'warning',
    check: (ctx) =>
      ctx.project.nodes
        .filter((n) => {
          const s = n.serviceId ? ctx.services.get(n.serviceId) : undefined;
          return s && ['deprecated', 'retired', 'unknown'].includes(s.lifecycle);
        })
        .map((n) => ({
          ruleId: 'VR-014',
          severity: 'warning',
          nodeIds: [n.id],
          explanation: `${n.label} uses a service whose lifecycle is ${ctx.services.get(n.serviceId!)!.lifecycle}.`,
        })),
  },
  {
    id: 'VR-015',
    severity: 'info',
    check: (ctx) =>
      ctx.project.nodes
        .filter((n) => n.unresolved)
        .map((n) => ({
          ruleId: 'VR-015',
          severity: 'info',
          nodeIds: [n.id],
          explanation: `${n.unresolved!.name} is not in the verified catalog.`,
          remediation:
            'Replace it with a catalog service or keep it as an explicitly unverified component.',
        })),
  },
  {
    id: 'VR-016',
    severity: 'error',
    check: (ctx) =>
      ctx.project.edges
        .filter((e) => {
          const [s, t] = edgeEnds(ctx, e);
          const api = [s, t].find((n) => n && svc(n) === 'aws.apigateway');
          const waf = [s, t].some((n) => n && svc(n) === 'aws.waf');
          const type = String(api?.configuration?.apiType ?? '').toUpperCase();
          return waf && api && (type === 'HTTP' || type === 'WEBSOCKET');
        })
        .map((e) => ({
          ruleId: 'VR-016',
          severity: 'error',
          edgeIds: [e.id],
          explanation:
            'AWS WAF cannot be associated with an API Gateway HTTP or WebSocket API; this API is unprotected.',
          remediation:
            'Use a REST API, or put CloudFront with WAF in front and block direct access to the API.',
          evidence: [
            'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html',
          ],
        })),
  },
  {
    id: 'VR-017',
    severity: 'warning',
    check: (ctx) =>
      ctx.project.edges
        .filter((e) => {
          const [s, t] = edgeEnds(ctx, e);
          return (
            s &&
            t &&
            svc(s) === 'aws.sqs' &&
            svc(t) === 'aws.lambda' &&
            e.configuration?.failureDestination !== undefined
          );
        })
        .map((e) => ({
          ruleId: 'VR-017',
          severity: 'warning',
          edgeIds: [e.id],
          explanation:
            'Lambda on-failure destinations do not apply to SQS event sources; failed messages are not captured this way.',
          remediation:
            "Configure a dead-letter queue on the source queue's redrive policy and enable ReportBatchItemFailures.",
          evidence: [
            'https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html',
          ],
        })),
  },
  {
    id: 'VR-018',
    severity: 'warning',
    check: (ctx) => {
      // Group ALBs by VPC; only placements inside availability-zone containers are conclusive.
      const zonesByVpc = new Map<string, { zones: Set<string>; nodeIds: string[] }>();
      for (const n of nodesOf(ctx, 'aws.alb')) {
        const vpc = enclosing(ctx, n.containerId, 'vpc');
        const az = enclosing(ctx, n.containerId, 'availability-zone');
        if (!vpc || !az) continue;
        const entry = zonesByVpc.get(vpc.id) ?? { zones: new Set(), nodeIds: [] };
        entry.zones.add(az.id);
        entry.nodeIds.push(n.id);
        zonesByVpc.set(vpc.id, entry);
      }
      return [...zonesByVpc.values()]
        .filter((v) => v.zones.size < 2)
        .map((v) => ({
          ruleId: 'VR-018',
          severity: 'warning',
          nodeIds: v.nodeIds,
          explanation: 'The Application Load Balancer is placed in a single Availability Zone.',
          remediation:
            'An ALB needs subnets in at least two Availability Zones; place it across both.',
          evidence: [
            'https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html',
          ],
        }));
    },
  },
  {
    id: 'VR-019',
    severity: 'warning',
    check: (ctx) => {
      if (!toggles(ctx).serverlessFirst) return [];
      const requested = (n: ArchNode) =>
        n.requirementIds.some((rid) => {
          const r = ctx.project.requirements.find((q) => q.id === rid);
          return (
            r !== undefined &&
            r.status === 'confirmed' &&
            (r.provenance === 'user' || r.provenance === 'clarification')
          );
        });
      return nodesOf(ctx, 'aws.ec2', 'aws.rds', 'aws.ecs', 'aws.eks')
        .filter((n) => !requested(n))
        .map((n) => ({
          ruleId: 'VR-019',
          severity: 'warning',
          nodeIds: [n.id],
          requirementIds: [TOGGLE_REQUIREMENT_IDS.serverlessFirst],
          explanation: `${n.label} is a server-based service that no stated requirement asks for, but serverless-first is enabled.`,
          remediation:
            'Use a serverless or fully managed alternative, or link the node to a requirement that needs it.',
        }));
    },
  },
  {
    id: 'VR-020',
    severity: 'warning',
    check: (ctx) =>
      !toggles(ctx).backups
        ? []
        : nodesOf(ctx, ...DATA_STORES)
            .filter((n) => !n.configuration?.backup)
            .map((n) => ({
              ruleId: 'VR-020',
              severity: 'warning',
              nodeIds: [n.id],
              requirementIds: [TOGGLE_REQUIREMENT_IDS.backups],
              explanation: `${n.label} has no stated backup configuration.`,
              remediation:
                'Enable automated backups or point-in-time recovery (versioning for S3).',
            })),
  },
  {
    id: 'VR-021',
    severity: 'warning',
    check: (ctx) =>
      toggles(ctx).disasterRecovery !== 'multi-az'
        ? []
        : nodesOf(ctx, ...DATABASES)
            .filter((n) => !n.configuration?.multiAz)
            .map((n) => ({
              ruleId: 'VR-021',
              severity: 'warning',
              nodeIds: [n.id],
              requirementIds: [TOGGLE_REQUIREMENT_IDS.disasterRecovery],
              explanation: `${n.label} is not configured Multi-AZ.`,
              remediation:
                'Enable Multi-AZ so the data store survives the loss of an Availability Zone.',
            })),
  },
  {
    id: 'VR-022',
    severity: 'warning',
    check: (ctx) => {
      if (toggles(ctx).disasterRecovery !== 'cross-region') return [];
      const out: Draft[] = [];
      const requirementIds = [TOGGLE_REQUIREMENT_IDS.disasterRecovery];
      const regions = ctx.project.containers.filter((c) => c.kind === 'region');
      if (regions.length < 2)
        out.push({
          ruleId: 'VR-022',
          severity: 'warning',
          containerIds: regions.map((c) => c.id),
          requirementIds,
          explanation:
            'Cross-region recovery is enabled but the design has fewer than two Regions.',
          remediation: 'Add a second Region container with the recovery stack.',
        });
      for (const n of nodesOf(ctx, ...DATA_STORES).filter(
        (x) =>
          !['aws.efs', 'aws.elasticache'].includes(svc(x) ?? '') && !x.configuration?.replication,
      ))
        out.push({
          ruleId: 'VR-022',
          severity: 'warning',
          nodeIds: [n.id],
          requirementIds,
          explanation: `${n.label} has no stated cross-region replication.`,
          remediation: 'Configure cross-region replication (global tables, replicas, CRR).',
        });
      return out;
    },
  },
  {
    id: 'VR-023',
    severity: 'warning',
    check: (ctx) => {
      const t = toggles(ctx);
      if (!t.highAvailability && !t.disasterRecovery) return [];
      const byVpc = new Map<string, { zones: Set<string>; nodeIds: string[] }>();
      for (const n of nodesOf(ctx, ...VPC_BOUND, 'aws.alb', 'aws.fargate', 'aws.nat-gateway')) {
        const vpc = enclosing(ctx, n.containerId, 'vpc');
        if (!vpc) continue;
        const entry = byVpc.get(vpc.id) ?? { zones: new Set(), nodeIds: [] };
        const az = enclosing(ctx, n.containerId, 'availability-zone');
        if (az) entry.zones.add(az.id);
        entry.nodeIds.push(n.id);
        byVpc.set(vpc.id, entry);
      }
      return [...byVpc.entries()]
        .filter(([, v]) => v.zones.size < 2)
        .map(([vpcId, v]) => ({
          ruleId: 'VR-023',
          severity: 'warning',
          nodeIds: v.nodeIds,
          containerIds: [vpcId],
          requirementIds: [
            t.highAvailability
              ? TOGGLE_REQUIREMENT_IDS.highAvailability
              : TOGGLE_REQUIREMENT_IDS.disasterRecovery,
          ],
          explanation: 'VPC resources are not spread across at least two Availability Zones.',
          remediation: 'Place the resources in subnets of two or more Availability Zones.',
        }));
    },
  },
  {
    id: 'VR-024',
    severity: 'info',
    check: (ctx) =>
      !toggles(ctx).costOptimized
        ? []
        : nodesOf(ctx, 'aws.dax', 'aws.nat-gateway', 'aws.ec2', 'aws.eks')
            .filter(
              (n) =>
                !n.requirementIds.some((rid) => {
                  const r = ctx.project.requirements.find((q) => q.id === rid);
                  return r !== undefined && r.provenance !== 'toggle';
                }),
            )
            .map((n) => ({
              ruleId: 'VR-024',
              severity: 'info',
              nodeIds: [n.id],
              requirementIds: [TOGGLE_REQUIREMENT_IDS.costOptimized],
              explanation: `${n.label} is a cost driver that no stated requirement asks for.`,
              remediation:
                'Remove it or replace it with a cheaper option, or link it to a requirement.',
            })),
  },
  {
    id: 'VR-025',
    severity: 'warning',
    check: (ctx) => {
      if (!toggles(ctx).securityHardening) return [];
      const requirementIds = [TOGGLE_REQUIREMENT_IDS.securityHardening];
      const unprotected = nodesOf(ctx, 'aws.apigateway', 'aws.alb', 'aws.cloudfront')
        .filter(
          (n) =>
            ctx.project.edges.some(
              (e) => e.target === n.id && ctx.nodes.get(e.source)?.external !== undefined,
            ) && !linkedToService(ctx, n.id, 'aws.waf'),
        )
        .map((n) => ({
          ruleId: 'VR-025',
          severity: 'warning' as const,
          nodeIds: [n.id],
          requirementIds,
          explanation: `${n.label} is a public entry point without AWS WAF.`,
          remediation:
            'Attach AWS WAF (for API Gateway use a REST API or put CloudFront in front).',
        }));
      const unencrypted = nodesOf(ctx, ...DATA_STORES)
        .filter((n) => n.configuration?.encryption !== 'KMS')
        .map((n) => ({
          ruleId: 'VR-025',
          severity: 'warning' as const,
          nodeIds: [n.id],
          requirementIds,
          explanation: `${n.label} is not encrypted at rest with a KMS key.`,
          remediation: 'Set encryption to KMS.',
        }));
      return [...unprotected, ...unencrypted];
    },
  },
];

/** Structural and catalog checks (TECHNICAL_ARCHITECTURE §10 layers 1–2). */
function structural(ctx: Ctx): Draft[] {
  const out: Draft[] = [];
  const seen = new Set<string>();
  for (const id of [
    ...ctx.project.nodes.map((n) => n.id),
    ...ctx.project.edges.map((e) => e.id),
    ...ctx.project.containers.map((c) => c.id),
  ]) {
    if (seen.has(id))
      out.push({
        ruleId: 'STRUCT-DUPLICATE-ID',
        severity: 'error',
        explanation: `Duplicate id "${id}".`,
      });
    seen.add(id);
  }
  for (const e of ctx.project.edges) {
    if (!ctx.nodes.has(e.source) || !ctx.nodes.has(e.target))
      out.push({
        ruleId: 'STRUCT-DANGLING-EDGE',
        severity: 'error',
        edgeIds: [e.id],
        explanation: `Edge "${e.id}" references a missing node.`,
      });
  }
  const allowed = new Map(ctx.catalog.containers.map((d) => [d.kind, d.allowedParents]));
  for (const c of ctx.project.containers) {
    const parent = c.parentId ? ctx.containers.get(c.parentId) : undefined;
    if (c.parentId && !parent) {
      out.push({
        ruleId: 'STRUCT-CONTAINER-PARENT',
        severity: 'error',
        containerIds: [c.id],
        explanation: `Container "${c.label}" references a missing parent.`,
      });
    } else if (parent && c.kind !== 'group' && !(allowed.get(c.kind) ?? []).includes(parent.kind)) {
      out.push({
        ruleId: 'STRUCT-CONTAINER-NESTING',
        severity: 'error',
        containerIds: [c.id],
        explanation: `A ${c.kind} cannot be placed inside a ${parent.kind}.`,
      });
    }
  }
  for (const n of ctx.project.nodes) {
    if (n.containerId && !ctx.containers.has(n.containerId))
      out.push({
        ruleId: 'STRUCT-NODE-CONTAINER',
        severity: 'error',
        nodeIds: [n.id],
        explanation: `Node "${n.label}" references a missing container.`,
      });
    if (n.serviceId && !ctx.services.has(n.serviceId))
      out.push({
        ruleId: 'CATALOG-UNKNOWN-SERVICE',
        severity: 'error',
        nodeIds: [n.id],
        explanation: `Service "${n.serviceId}" is not in catalog ${ctx.catalog.manifest.catalogVersion}.`,
      });
  }
  return out;
}

/** Runs all deterministic checks. Pure: same input → same findings, in a stable order. */
export function validateProject(project: Project, catalog: CatalogSnapshot): Finding[] {
  const ctx: Ctx = {
    project,
    catalog,
    services: new Map(catalog.services.map((s) => [s.id, s])),
    nodes: new Map(project.nodes.map((n) => [n.id, n])),
    containers: new Map(project.containers.map((c) => [c.id, c])),
  };
  const drafts = [...structural(ctx), ...RULES.flatMap((r) => r.check(ctx))];
  return drafts.map((d, i) => ({
    id: `f-${i + 1}`,
    class: 'rule' as const,
    nodeIds: [],
    edgeIds: [],
    containerIds: [],
    requirementIds: [],
    evidence: [],
    producerVersion: VALIDATOR_VERSION,
    ...d,
  }));
}

/** Rule IDs with an implementation; the catalog test checks these all have metadata. */
export const IMPLEMENTED_RULE_IDS = RULES.map((r) => r.id);

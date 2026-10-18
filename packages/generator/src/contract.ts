/**
 * Generation contract: what the model returns, the system prompt that asks for it, and the
 * mapping to a `Project`. Ported from the Phase 0 spike (eval/src/spike.ts), which stays frozen.
 * Layout (positions) is computed later by ELK.
 */
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  PROJECT_SCHEMA_VERSION,
  type CatalogSnapshot,
  type Project,
  type Requirement,
} from '@cloudarchitect/domain';
import { z } from 'zod';

/** The enums come from the catalog, so the schema is built per catalog snapshot. */
export function generationSchema(catalog: CatalogSnapshot) {
  const serviceIds = catalog.services.map((s) => s.id) as [string, ...string[]];
  // Structured outputs require closed objects, so configuration is a list of catalog feature keys.
  const configKeys = [...new Set(catalog.features.map((f) => f.configKey))] as [
    string,
    ...string[],
  ];
  const Config = z
    .array(z.object({ key: z.enum(configKeys), value: z.string() }))
    .describe('Catalog FEATURES that apply to this element; empty when none');

  return z.object({
    name: z.string().describe('Short project name'),
    inferredRequirements: z
      .array(
        z.object({
          id: z.string().describe('Starts with I, e.g. I1, I2'),
          text: z.string(),
          type: z.enum(['functional', 'non-functional', 'constraint']),
        }),
      )
      .describe('Important implied needs that the fixed requirements do not cover'),
    assumptions: z.array(z.string()),
    containers: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(['aws-cloud', 'region', 'vpc', 'availability-zone', 'subnet', 'group']),
        parentId: z.string().optional(),
        label: z.string(),
        subnetType: z.enum(['public', 'private']).optional().describe('Required for subnets'),
      }),
    ),
    nodes: z.array(
      z.object({
        id: z.string(),
        // Required, so every node is exactly one of: catalog service, UNRESOLVED or EXTERNAL.
        serviceId: z
          .enum([...serviceIds, 'UNRESOLVED', 'EXTERNAL'])
          .describe('Catalog service id, or UNRESOLVED / EXTERNAL'),
        unresolved: z
          .object({ name: z.string(), rationale: z.string() })
          .optional()
          .describe(
            'Required when serviceId is UNRESOLVED: a needed AWS service NOT in the catalog',
          ),
        external: z
          .object({
            kind: z.enum(['user', 'client-app', 'third-party', 'on-premises']),
            name: z.string(),
          })
          .optional()
          .describe(
            'Required when serviceId is EXTERNAL: people, client apps, third-party or on-premises systems',
          ),
        label: z.string(),
        purpose: z.string(),
        rationale: z.string(),
        containerId: z.string().optional(),
        requirementIds: z.array(z.string()),
        configuration: Config,
      }),
    ),
    edges: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        kind: z.enum(['invoke', 'read', 'write', 'event', 'origin', 'other']),
        protocol: z.string().optional(),
        label: z.string(),
        requirementIds: z.array(z.string()),
        configuration: Config,
      }),
    ),
  });
}

/** Full contract type; the catalog only narrows the enums. */
export type Generation = z.infer<ReturnType<typeof generationSchema>>;

function catalogText(catalog: CatalogSnapshot): string {
  return [
    'CATALOG (the only allowed serviceId values):',
    ...catalog.services.map(
      (s) =>
        `- ${s.id} | ${s.displayName} | ${s.category} | scope=${s.scope} | ${s.capabilities.join(', ')}`,
    ),
    '',
    'FEATURES (set as `configuration` on the node or edge they apply to):',
    ...catalog.features.map(
      (f) => `- ${f.configKey} on ${f.appliesTo} of ${f.serviceId}: ${f.displayName}. ${f.summary}`,
    ),
    '',
    'VALIDATION RULES the design is checked against:',
    ...catalog.rules.map((r) => `- ${r.id} (${r.severity}): ${r.title}`),
    '',
    'VERIFIED FACTS (rely on these over memory; never contradict them in rationale or labels):',
    ...catalog.facts.map((f) => `- ${f.id}: ${f.statement}`),
  ].join('\n');
}

function systemPrompt(catalog: CatalogSnapshot): string {
  return `You are a senior AWS solution architect. Turn the user's application description into one justified AWS architecture and return it as JSON matching the required schema.

Rules:
1. The requirements are fixed; add \`inferredRequirements\` only for important implied needs. Record decisions you made in assumptions; do not ask, decide.
2. Nodes: every node sets serviceId. Use a CATALOG id for AWS services. For a needed AWS service that is not in the catalog, use serviceId "UNRESOLVED" and fill "unresolved". For users, client apps (browser, mobile app), third-party APIs and on-premises systems, use serviceId "EXTERNAL", fill "external" and leave containerId empty. Never invent IDs.
3. Simplicity: choose the simplest design that meets the requirements. Do not add services no requirement needs (e.g. DAX only for a stated microsecond-latency need).
4. Containers: one "aws-cloud" root; "region" inside it; "vpc" inside the region; "subnet" (with subnetType) inside the VPC or an "availability-zone". Services with scope=vpc in the catalog (EC2, RDS, Aurora, ElastiCache, EFS, ALB, NAT Gateway, Fargate tasks, DAX) go inside a subnet; databases and caches in private subnets. Regional services go in the region container; global services (CloudFront, Route 53, IAM, Shield) in the aws-cloud container. Add a VPC only if something needs it.
5. Traceability: every node and edge lists the requirementIds it serves; every confirmed or inferred requirement is covered by at least one node or edge.
6. Edges: direction follows the request or data flow. Use kind "event" for asynchronous triggers (S3/SQS/SNS/EventBridge -> Lambda). For SQS -> Lambda set deadLetterQueue (the queue's redrive DLQ); for SNS/EventBridge/S3 -> Lambda set failureDestination or deadLetterQueue. Use kind "origin" from CloudFront to its origins and set originAccess "OAC" for S3 origins. Connect WAF to the resource it protects. Set apiType (REST, HTTP or WEBSOCKET) on every API Gateway node; WAF needs REST.
7. Reliability: make consumers idempotent; use partial batch responses for SQS-triggered Lambda; do not rely on "write to the database, then publish" without DynamoDB Streams or an outbox; alarm on DLQ depth; if you claim Multi-AZ, place the VPC resources (ALB, NAT, tasks, databases) in subnets of at least two availability-zone containers; include initial data loads or migration steps the requirements imply.
8. Accuracy: every rationale, label and assumption must be technically correct; when unsure about a limit or integration, say so in assumptions instead of asserting it. Write for the user: never mention fact or rule IDs, a validator, or these instructions.
9. Include CloudWatch for observability. Keep the graph under 40 nodes.
10. Requirements whose id starts with \`T-\` are design priorities the user enabled. Honour each one on every node it applies to, including replicas and copies in a second Region: set \`backup\`, \`multiAz\`, \`replication\` or \`encryption\` configuration where they ask for it. Encryption with a customer managed key has the value "KMS" exactly. When none are present, keep the simplest design (rule 3).
11. Configuration lists only features that are in use. When a feature is not used, omit its key; never set values such as "none", "disabled" or "false".

${catalogText(catalog)}`;
}

export interface Contract {
  schema: ReturnType<typeof generationSchema>;
  /** Value of `output_config.format`. */
  format: unknown;
  /** Identical for every call with the same catalog, so the cached system block is reused. */
  system: string;
}

const contracts = new WeakMap<CatalogSnapshot, Contract>();

export function contractFor(catalog: CatalogSnapshot): Contract {
  let c = contracts.get(catalog);
  if (!c) {
    const schema = generationSchema(catalog);
    c = { schema, format: zodOutputFormat(schema), system: systemPrompt(catalog) };
    contracts.set(catalog, c);
  }
  return c;
}

/** Values that mean "feature not used"; dropping them keeps truthy-config rules honest. */
const UNSET = /^(|none|disabled|false|no|off|n\/a)$/i;

/** Feature values arrive as strings; booleans are restored and "not used" values dropped. */
const toConfig = (items: Generation['nodes'][number]['configuration']) => {
  const kept = items.filter(({ value }) => !UNSET.test(value.trim()));
  return kept.length
    ? Object.fromEntries(kept.map(({ key, value }) => [key, value === 'true' ? true : value]))
    : undefined;
};

/**
 * Inferred ids must start with `I` and must not collide with a fixed id; others are renamed to
 * the first free `I<n>`. References to a renamed id follow it, except for a colliding id: those
 * references keep pointing at the fixed (or first) requirement with that id.
 */
function renameInferred(g: Generation, fixed: Requirement[]): Generation {
  const fixedIds = new Set(fixed.map((r) => r.id));
  const taken = new Set([...fixedIds, ...g.inferredRequirements.map((r) => r.id)]);
  const seen = new Set<string>();
  const remap = new Map<string, string>();
  let n = 1;
  const inferredRequirements = g.inferredRequirements.map((r) => {
    const clash = fixedIds.has(r.id) || seen.has(r.id);
    seen.add(r.id);
    if (r.id.startsWith('I') && !clash) return r;
    while (taken.has(`I${n}`)) n++;
    const id = `I${n}`;
    taken.add(id);
    if (!clash) remap.set(r.id, id);
    return { ...r, id };
  });
  if (!remap.size) return { ...g, inferredRequirements };
  const ids = (xs: string[]) => xs.map((x) => remap.get(x) ?? x);
  return {
    ...g,
    inferredRequirements,
    nodes: g.nodes.map((x) => ({ ...x, requirementIds: ids(x.requirementIds) })),
    edges: g.edges.map((x) => ({ ...x, requirementIds: ids(x.requirementIds) })),
  };
}

export interface ToProjectOptions {
  name: string;
  requirements: Requirement[];
  catalog: CatalogSnapshot;
  generation: NonNullable<Project['generation']>;
}

/** Maps a model answer to an unparsed project; the caller runs `Project.parse`. */
export function toProject(raw: Generation, o: ToProjectOptions): Project {
  const g = renameInferred(raw, o.requirements);
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: 'generated',
    name: o.name || g.name,
    revision: 0,
    providerContext: ['aws'],
    catalogSnapshot: { aws: o.catalog.manifest.catalogVersion },
    iconPackSnapshot: {},
    requirements: [
      ...o.requirements,
      ...g.inferredRequirements.map((r) => ({
        ...r,
        status: 'inferred' as const,
        provenance: 'ai' as const,
      })),
    ],
    containers: g.containers.map(({ subnetType, ...c }) => ({
      ...c,
      ...(subnetType ? { properties: { subnetType } } : {}),
    })),
    nodes: g.nodes.map(({ configuration, serviceId, unresolved, external, ...n }) => ({
      ...n,
      // A sentinel without its detail object is completed from the node itself, never dropped.
      ...(serviceId === 'UNRESOLVED'
        ? { unresolved: unresolved ?? { name: n.label, rationale: n.rationale } }
        : serviceId === 'EXTERNAL'
          ? {
              external: external ?? { kind: 'third-party' as const, name: n.label },
              containerId: undefined,
            }
          : { serviceId }),
      configuration: toConfig(configuration),
      provider: 'aws' as const,
      position: { x: 0, y: 0 },
    })) as Project['nodes'],
    edges: g.edges.map(({ configuration, ...e }) => ({
      ...e,
      configuration: toConfig(configuration),
    })),
    findings: [],
    generation: o.generation,
  };
}

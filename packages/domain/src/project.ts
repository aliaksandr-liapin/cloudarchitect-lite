import { z } from 'zod';
import { DesignToggles } from './toggles.js';
import { ModelChoice } from './models.js';

/** Current project schema version. Bump with a migration in `migrate.ts`. */
export const PROJECT_SCHEMA_VERSION = '1.4.0';

export const ProviderId = z.enum(['aws', 'azure', 'gcp']);
export type ProviderId = z.infer<typeof ProviderId>;

const Id = z.string().min(1).max(128);
const Position = z.object({ x: z.number(), y: z.number() });
const Size = z.object({ width: z.number().positive(), height: z.number().positive() });
/** Catalog-defined feature keys, e.g. `{ originAccess: 'OAC' }`. Values stay primitive. */
const Configuration = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const RequirementStatus = z.enum(['confirmed', 'inferred', 'open']);

export const Requirement = z.object({
  id: Id,
  text: z.string().min(1).max(2000),
  type: z.enum(['functional', 'non-functional', 'constraint']).default('functional'),
  status: RequirementStatus,
  provenance: z.enum(['user', 'ai', 'clarification', 'toggle']).optional(),
});
export type Requirement = z.infer<typeof Requirement>;

export const ContainerKind = z.enum([
  'aws-cloud',
  'region',
  'vpc',
  'availability-zone',
  'subnet',
  'group',
]);
export type ContainerKind = z.infer<typeof ContainerKind>;

export const Container = z.object({
  id: Id,
  kind: ContainerKind,
  parentId: Id.optional(),
  label: z.string().max(200),
  properties: z
    .object({
      subnetType: z.enum(['public', 'private']).optional(),
      cidr: z.string().optional(),
    })
    .optional(),
  position: Position.optional(),
  size: Size.optional(),
});
export type Container = z.infer<typeof Container>;

export const UnresolvedService = z.object({
  name: z.string().min(1).max(200),
  rationale: z.string().max(2000),
});

/** Actors outside the cloud account: people, client apps, third-party and on-premises systems. */
export const ExternalKind = z.enum(['user', 'client-app', 'third-party', 'on-premises']);
export const ExternalActor = z.object({
  kind: ExternalKind,
  name: z.string().min(1).max(200),
});

const NodeBase = z.object({
  id: Id,
  provider: ProviderId,
  label: z.string().max(200),
  purpose: z.string().max(2000).optional(),
  rationale: z.string().max(4000).optional(),
  requirementIds: z.array(Id).default([]),
  configuration: Configuration.optional(),
  containerId: Id.optional(),
  position: Position,
  size: Size.optional(),
});

/**
 * A node is exactly one of: a catalog service, an explicitly unresolved service (PRD FR-020),
 * or an external actor that is not part of the cloud architecture.
 */
export const ArchNode = z.union([
  NodeBase.extend({
    serviceId: Id,
    unresolved: z.undefined().optional(),
    external: z.undefined().optional(),
  }),
  NodeBase.extend({
    serviceId: z.undefined().optional(),
    unresolved: UnresolvedService,
    external: z.undefined().optional(),
  }),
  NodeBase.extend({
    serviceId: z.undefined().optional(),
    unresolved: z.undefined().optional(),
    external: ExternalActor,
  }),
]);
export type ArchNode = z.infer<typeof ArchNode>;

export const EdgeKind = z.enum(['invoke', 'read', 'write', 'event', 'origin', 'other']);

export const ArchEdge = z.object({
  id: Id,
  source: Id,
  target: Id,
  kind: EdgeKind,
  protocol: z.string().max(100).optional(),
  label: z.string().max(200).optional(),
  authNotes: z.string().max(2000).optional(),
  configuration: Configuration.optional(),
  requirementIds: z.array(Id).default([]),
});
export type ArchEdge = z.infer<typeof ArchEdge>;

export const Severity = z.enum(['error', 'warning', 'info']);
export type Severity = z.infer<typeof Severity>;

export const Finding = z.object({
  id: Id,
  class: z.enum(['rule', 'advisory']),
  ruleId: z.string().optional(),
  severity: Severity,
  nodeIds: z.array(Id).default([]),
  edgeIds: z.array(Id).default([]),
  containerIds: z.array(Id).default([]),
  requirementIds: z.array(Id).default([]),
  explanation: z.string(),
  remediation: z.string().optional(),
  evidence: z.array(z.url()).default([]),
  producerVersion: z.string(),
});
export type Finding = z.infer<typeof Finding>;

/** Hard limits shared by client and gateway (TECHNICAL_ARCHITECTURE §6). */
export const LIMITS = {
  maxPromptChars: 8000,
  maxNodes: 150,
  maxContainerDepth: 10,
} as const;

export const Project = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  projectId: Id,
  name: z.string().min(1).max(200),
  revision: z.number().int().nonnegative(),
  providerContext: z.array(ProviderId).min(1),
  catalogSnapshot: z.record(z.string(), z.string()),
  iconPackSnapshot: z.record(z.string(), z.string()).default({}),
  requirements: z.array(Requirement).default([]),
  containers: z.array(Container).default([]),
  nodes: z.array(ArchNode).max(LIMITS.maxNodes),
  edges: z.array(ArchEdge).default([]),
  findings: z.array(Finding).default([]),
  /** Set when the graph was produced by AI generation. `contentHash` detects later manual edits. */
  generation: z
    .object({
      toggles: DesignToggles,
      model: ModelChoice,
      generatedAt: z.iso.datetime(),
      contentHash: z.string(),
    })
    .optional(),
});
export type Project = z.infer<typeof Project>;

const stripLayout = (key: string, value: unknown) =>
  key === 'position' || key === 'size' ? undefined : value;

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k, v]) => stripLayout(k, v) !== undefined && v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
};

const byId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Synchronous FNV-1a 32-bit hex hash of the graph content (requirements, containers, nodes, edges).
 * Layout (`position`, `size`) is excluded and items are sorted by id, so only meaningful edits change it.
 */
export function graphContentHash(
  p: Pick<Project, 'requirements' | 'containers' | 'nodes' | 'edges'>,
): string {
  const json = JSON.stringify(
    canonical({
      requirements: byId(p.requirements),
      containers: byId(p.containers),
      nodes: byId(p.nodes),
      edges: byId(p.edges),
    }),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

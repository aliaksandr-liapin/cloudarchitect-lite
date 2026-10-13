import { z } from 'zod';
import { ContainerKind, ProviderId, Severity } from './project.js';

export const Lifecycle = z.enum(['active', 'preview', 'deprecated', 'retired', 'unknown']);
export const ReviewStatus = z.enum(['verified', 'needs_review']);

export const VerifiedEvidence = z.object({
  sourceUrl: z.url(),
  checkedAt: z.iso.datetime(),
  publishedAt: z.string().optional(),
  evidenceType: z.enum(['documentation', 'release-note', 'icon-pack', 'resource-spec', 'other']),
});

export const CloudService = z.object({
  id: z.string().regex(/^[a-z]+\.[a-z0-9-]+$/),
  provider: ProviderId,
  displayName: z.string(),
  category: z.string(),
  scope: z.enum(['global', 'regional', 'vpc']),
  capabilities: z.array(z.string()).default([]),
  lifecycle: Lifecycle,
  reviewStatus: ReviewStatus,
  cfnResourceTypes: z.array(z.string()).default([]),
  documentationUrl: z.url(),
  iconAssetId: z.string().optional(),
  features: z.array(z.string()).default([]),
  evidence: z.array(VerifiedEvidence).default([]),
});
export type CloudService = z.infer<typeof CloudService>;

export const ServiceFeature = z.object({
  id: z.string(),
  serviceId: z.string(),
  appliesTo: z.enum(['node', 'edge']),
  configKey: z.string(),
  displayName: z.string(),
  summary: z.string(),
  documentationUrl: z.url(),
});
export type ServiceFeature = z.infer<typeof ServiceFeature>;

export const ContainerDefinition = z.object({
  kind: ContainerKind,
  displayName: z.string(),
  allowedParents: z.array(ContainerKind),
});

export const ValidationRuleMeta = z.object({
  id: z.string().regex(/^VR-\d{3}$/),
  severity: Severity,
  title: z.string(),
  documentationUrl: z.url().optional(),
});

export const CatalogManifest = z.object({
  provider: ProviderId,
  catalogVersion: z.string(),
  schemaVersion: z.string(),
  generatedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
});

/** Everything the validator and generator need from a provider catalog. */
export interface CatalogSnapshot {
  manifest: z.infer<typeof CatalogManifest>;
  services: CloudService[];
  features: ServiceFeature[];
  containers: z.infer<typeof ContainerDefinition>[];
  rules: z.infer<typeof ValidationRuleMeta>[];
}

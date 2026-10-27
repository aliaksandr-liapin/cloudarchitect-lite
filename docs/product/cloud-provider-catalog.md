# Cloud Provider Knowledge & Assets Catalog

**Version:** 0.2 · **Date:** 2026-10-13 · **Scope:** AWS in MVP; Azure/GCP schemas reserved · **Aligned with:** PRD v0.2

## 1. Objective

The architecture generator must rely on verified **current services, lifecycle, supported runtimes/APIs where applicable, technical connections and official icons**. The LLM is not a source of truth about the current state of the cloud.

**Caveat:** cloud services have no single "version". Distinguish service identity, API/version, engine/runtime, region availability, icon pack release and the date a fact was checked.

## 2. Sources of truth

| Provider | Official icon source | Official cloud knowledge |
|---|---|---|
| AWS | https://aws.amazon.com/architecture/icons/ | https://docs.aws.amazon.com/ , https://aws.amazon.com/new/ , AWS CloudFormation resource specification / resource reference |
| Azure | https://learn.microsoft.com/en-us/azure/architecture/icons/ | https://learn.microsoft.com/en-us/azure/ |
| GCP | https://cloud.google.com/icons | https://cloud.google.com/docs |

Icons come **only** from these three sources.

**Icon terms of use** (recorded 2026-10-13; full text and product rules in PRD §12):

| Provider | Published terms | Current package | Format |
|---|---|---|---|
| AWS | "We allow customers and partners to use these toolkits and assets to create architecture diagrams." No separate redistribution terms on the page; the AWS Site Terms and trademark guidelines apply. | release 2026-07-31 | ZIP (icon package, PPTX toolkits) |
| Azure | Use is permitted in architectural diagrams, training materials and documentation; copying and distribution only for those purposes. Don't crop, flip, rotate or distort; don't use them to represent your own product. | V24 (July 2026) | SVG (ZIP) |
| GCP | No explicit terms on the page; the Google Cloud Site Terms and brand guidelines apply. | core product, category and legacy console icons | SVG + PNG (ZIP) |

**Brand/legal:** use the original images without distortion; never use provider icons in CloudArchitect Lite branding. When importing a pack, keep its README/LICENSE (if any) in the manifest. Until the AWS/GCP terms explicitly confirm embedding in a third-party tool, icons are never committed to the repository or shipped in published images (decision 2026-10-27, release 0.2 design Goal 1). The repository holds only the pack record `packages/catalog/data/icon-packs.json` (release, official URL, SHA-256, terms, serviceId → file mapping); the gateway downloads the pack from aws.amazon.com on first start, verifies the hash, keeps only the mapped SVGs in its data volume and serves them. On failure the app shows generic tiles with a Retry. The GitHub Pages demo includes the icons, fetched by its build workflow. Never present look-alike icons as official.

## 3. Provider-agnostic types

```ts
type ProviderId = 'aws' | 'azure' | 'gcp';
type Lifecycle = 'active' | 'preview' | 'deprecated' | 'retired' | 'unknown';
type ReviewStatus = 'verified' | 'needs_review';

type VerifiedEvidence = {
  sourceUrl: string;
  checkedAt: string;        // ISO 8601 timestamp
  publishedAt?: string;     // date supplied by source
  evidenceType: 'documentation' | 'release-note' | 'icon-pack' | 'resource-spec' | 'other';
};

type CloudService = {
  id: string;               // e.g. aws.lambda; stable
  provider: ProviderId;
  displayName: string;
  category: string;
  capabilities: string[];
  lifecycle: Lifecycle;
  reviewStatus: ReviewStatus;
  scope: 'global' | 'regional' | 'vpc';   // drives container placement + VR-009
  cfnResourceTypes?: string[];            // e.g. ['AWS::Lambda::Function']
  documentationUrl: string;
  iconAssetId?: string;
  features?: string[];                    // ServiceFeature ids
  evidence: VerifiedEvidence[];
  configurationDimensions?: string[];     // runtimes / API versions / regions
};

// Configuration options modelled on a node or edge, not as separate nodes
type ServiceFeature = {
  id: string;               // e.g. aws.cloudfront.oac, aws.s3.transfer-acceleration
  serviceId: string;
  appliesTo: 'node' | 'edge';
  displayName: string;
  summary: string;          // what it does, one sentence
  documentationUrl: string;
  evidence: VerifiedEvidence[];
};

type ContainerKind = 'aws-cloud' | 'region' | 'vpc' | 'availability-zone' | 'subnet' | 'group';
```

Other entities: `IntegrationPattern`, `ArchitecturePattern`, `ValidationRule`, `IconPackManifest`, `CatalogManifest`, `ContainerDefinition` (kind, allowed parents, icon asset).

## 4. Proposed file layout

```text
catalog/
  schema/
  aws/
    manifest.json
    services.json
    features.json            # OAC, Transfer Acceleration, S3 events, authorizers…
    containers.json          # container kinds, nesting, icons
    integration-patterns.json
    architecture-patterns.json
    validation-rules.json    # VR-001…VR-018 metadata (logic lives in shared package)
    facts.json               # verified integration facts with evidence (given to the generator)
    lifecycle.json
    icon-pack.json           # release id, source URL, terms text, SHA-256
  azure/
    manifest.json
    services.json
  gcp/
    manifest.json
    services.json
assets/                      # not in Git: icons are fetched on first start into the gateway data volume
  aws/<release-id>/…
```

Azure/GCP directories may initially contain only schema/sample test fixtures; **do not label them supported in production** until knowledge and icons are verified.

## 5. Initial AWS coverage (MVP, ~40 entries)

| Group | Services |
|---|---|
| Delivery / networking | CloudFront, Route 53, API Gateway, Application Load Balancer, NAT Gateway |
| Containers | AWS Cloud, Region, VPC, Availability Zone, Subnet (public/private), Group |
| Compute | Lambda, EC2, ECS, Fargate, EKS |
| Storage | S3, EFS |
| Data | DynamoDB, DynamoDB Accelerator (DAX), RDS, Aurora, RDS Proxy, ElastiCache, OpenSearch Service |
| Integration | SQS, SNS, EventBridge, Step Functions, Kinesis Data Streams, Data Firehose |
| Identity / security | IAM, Cognito, WAF, Shield, KMS, Secrets Manager, Certificate Manager |
| Operations | CloudWatch, X-Ray, CloudTrail |
| Email / AI / analytics | SES, Bedrock, Athena |

**Initial features (ServiceFeature):** CloudFront OAC, S3 Transfer Acceleration, S3 Event Notifications, S3 presigned upload, API Gateway Cognito / IAM / Lambda authorizer, Lambda failure destination, SQS dead-letter queue, encryption at rest (KMS) per data store.

Catalogue exact resource types and distinctions when needed; `S3 bucket` vs `S3 service`, `Lambda function` vs `Lambda service` must not be conflated. IDs and resource types are cross-checked against the CloudFormation resource specification. Anything outside this list appears as `unresolved` (PRD FR-020).

## 6. Update process

**MVP (manual, checklist-driven).** Maintainer runs the checklist before each catalog release and at least monthly:

1. Check AWS What's New and the CloudFormation resource specification for changes affecting curated services.
2. Check the icon page for a new release; if found, import, hash, record terms text, diff the serviceId → icon mapping.
3. Update lifecycle, features and evidence (`sourceUrl`, `checkedAt`); unverified items → `needs_review`.
4. Run schema validation, cross-reference checks, icon fixture tests and the eval harness.
5. Publish an immutable catalog version with checksums.

**Post-beta (automated pipeline).**

1. **Discover** changes via official updates, documentation and resource references; poll on schedule, observe provider rate limits.
2. **Diff** incoming information against current published manifest; track renamed/added/deprecated services and icon pack changes separately.
3. **Normalize** into schema; attach source URL and check date.
4. **Validate** schema, stable IDs, cross-references, icons, permissions and applicable provider constraints.
5. **Review** risky technical changes before publishing (human approval).
6. **Publish** immutable manifest and assets with checksums and semantic catalog version.
7. **Notify** opened projects when a newer catalog version is available; never silently rewrite project topology.

Target cadence for the automated pipeline: daily new-service/news and lifecycle checks for the curated set; icon pages checked monthly and on release; integration patterns reviewed on relevant documentation change.

## 7. Metadata and freshness

- Each fact: `sourceUrl`, `checkedAt`, optional `publishedAt`, `reviewStatus`.
- Each catalog: `catalogVersion`, `generatedAt`, `reviewedAt`, `schemaVersion`.
- Each icon pack: provider, official package release identifier, source URL, terms text as published, integrity hash.
- Missing/unverified evidence → lifecycle `unknown` and `needs_review`, **not** `active` by default.
- Region and runtime availability are contextual and must be checked at configuration level, not inferred from generic service existence.

## 8. Snapshots and backward compatibility

A project records `projectSchemaVersion`, `catalogVersion` per provider, `iconPackVersion` per provider. Old projects open with stored service IDs/legacy mappings; user may explicitly select **Review updates**. Icon-only update is distinct from architectural change. Preserve IDs and old diagrams even after services are renamed/deprecated.

## 9. Icons requirements

- Official SVG from the three sources in §2 only; no AI image generation, no look-alikes.
- Deterministic serviceId → icon asset mapping; render fallback for unresolved or unmapped nodes, visibly marked generic.
- Original colors, aspect ratios, silhouettes; no cropping, flipping, rotating or distortion.
- Service name always shown next to the icon.
- Attribution and source link for each pack in the app's About/Legal page.
- Served by the gateway from its data volume and cached by the browser; the pack is downloaded once, not per service.
- Sanitize SVG on import (no scripts, external references).
- Test light and dark canvas contrast without recoloring protected brand assets (use a neutral tile behind the icon if needed).

## 10. Validation and quality gates

- Reject AI suggestions referencing IDs not in selected catalog; out-of-catalog needs are returned as `unresolved` and never shown as verified official AWS services (VR-015).
- Match edges to integration patterns; indicate uncertain/unverified patterns.
- Check container placement against service `scope` (VR-009, VR-010).
- If runtime is selected, check deprecation/support timeline and evidence.
- Attach finding to node, edge or container with source and rule version.
- Run automated fixture tests for renamed IDs, removed icon assets and every VR rule (positive and negative).

## 11. Architecture Freshness (future)

Manual **Check for Updates** in early releases; later optional automatic notification when service/runtime is deprecated, configuration changes, or icon pack changes. Changes must be reviewable, reversible, and never auto-deployed.

import {
  CatalogManifest,
  CloudService,
  ContainerDefinition,
  IntegrationFact,
  ServiceFeature,
  ValidationRuleMeta,
  type CatalogSnapshot,
} from '@cloudarchitect/domain';
import { z } from 'zod';
import containers from '../data/aws/containers.json' with { type: 'json' };
import facts from '../data/aws/facts.json' with { type: 'json' };
import features from '../data/aws/features.json' with { type: 'json' };
import manifest from '../data/aws/manifest.json' with { type: 'json' };
import rules from '../data/aws/validation-rules.json' with { type: 'json' };
import services from '../data/aws/services.json' with { type: 'json' };
import myblog from '../samples/myblog.project.json' with { type: 'json' };

/** Parsed, schema-checked AWS catalog snapshot. Throws at import time if the data is invalid. */
export const awsCatalog: CatalogSnapshot = {
  manifest: CatalogManifest.parse(manifest),
  services: z.array(CloudService).parse(services),
  features: z.array(ServiceFeature).parse(features),
  containers: z.array(ContainerDefinition).parse(containers),
  rules: z.array(ValidationRuleMeta).parse(rules),
  facts: z.array(IntegrationFact).parse(facts),
};

/** Sample projects for demos, tests and the eval harness (unvalidated JSON; use migrateProject). */
export const samples = { myblog } as const;

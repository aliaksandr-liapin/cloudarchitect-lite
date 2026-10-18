import { z } from 'zod';
import type { Requirement } from './project.js';

/** One-click design preferences. Each enabled toggle becomes a confirmed requirement. */
export const DesignToggles = z
  .object({
    serverlessFirst: z.boolean().optional(),
    backups: z.boolean().optional(),
    highAvailability: z.boolean().optional(),
    costOptimized: z.boolean().optional(),
    securityHardening: z.boolean().optional(),
    disasterRecovery: z.enum(['multi-az', 'cross-region']).optional(),
  })
  .strict();
export type DesignToggles = z.infer<typeof DesignToggles>;

export const TOGGLE_REQUIREMENT_IDS = {
  serverlessFirst: 'T-serverless-first',
  backups: 'T-backups',
  disasterRecovery: 'T-dr',
  highAvailability: 'T-ha',
  costOptimized: 'T-cost',
  securityHardening: 'T-security',
} as const;

const TEXTS = {
  serverlessFirst:
    'Prefer serverless and fully managed services (Lambda, API Gateway, DynamoDB, Fargate, Step Functions) over servers to manage.',
  backups:
    'Every data store has automated backups or point-in-time recovery; S3 buckets use versioning.',
  'multi-az': 'Survive the loss of one Availability Zone: stateful services run Multi-AZ.',
  'cross-region':
    'Recover in a second AWS Region: data is replicated cross-region and the design can be restored there.',
  highAvailability:
    'No single point of failure: compute and data are spread across at least two Availability Zones.',
  costOptimized:
    'Minimize cost: choose the cheapest reasonable options and scale to zero where possible.',
  securityHardening:
    'Harden security: WAF on public entry points, KMS encryption at rest, private subnets for data, authenticated access on every public interface.',
} as const;

const LABELS = {
  serverlessFirst: 'Serverless-first',
  backups: 'Backups',
  'multi-az': 'DR: Multi-AZ',
  'cross-region': 'DR: cross-region',
  highAvailability: 'High availability',
  costOptimized: 'Cost-optimized',
  securityHardening: 'Security hardening',
} as const;

type Entry = { key: keyof typeof TOGGLE_REQUIREMENT_IDS; text: string; label: string };

/** Enabled toggles in the canonical order. */
function enabled(t: DesignToggles): Entry[] {
  const out: Entry[] = [];
  const flag = (key: Exclude<keyof typeof TOGGLE_REQUIREMENT_IDS, 'disasterRecovery'>) => {
    if (t[key]) out.push({ key, text: TEXTS[key], label: LABELS[key] });
  };
  flag('serverlessFirst');
  flag('backups');
  if (t.disasterRecovery) {
    out.push({
      key: 'disasterRecovery',
      text: TEXTS[t.disasterRecovery],
      label: LABELS[t.disasterRecovery],
    });
  }
  flag('highAvailability');
  flag('costOptimized');
  flag('securityHardening');
  return out;
}

export function toggleRequirements(t: DesignToggles): Requirement[] {
  return enabled(t).map((e) => ({
    id: TOGGLE_REQUIREMENT_IDS[e.key],
    text: e.text,
    type: 'non-functional',
    status: 'confirmed',
    provenance: 'toggle',
  }));
}

export function toggleLabels(t: DesignToggles): string[] {
  return enabled(t).map((e) => e.label);
}

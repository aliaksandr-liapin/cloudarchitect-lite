import {
  DATA_STORES,
  IMPLEMENTED_RULE_IDS,
  migrateProject,
  validateProject,
} from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { awsCatalog, samples } from './index.js';

describe('AWS catalog', () => {
  it('has unique service ids', () => {
    const ids = awsCatalog.services.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never marks a service active without evidence (CLOUD_PROVIDER_CATALOG §7)', () => {
    for (const s of awsCatalog.services) {
      if (s.lifecycle === 'active') expect(s.evidence.length, s.id).toBeGreaterThan(0);
    }
  });

  it('only references existing services from features', () => {
    const ids = new Set(awsCatalog.services.map((s) => s.id));
    for (const f of awsCatalog.features) expect(ids.has(f.serviceId), f.id).toBe(true);
  });

  it('has unique feature ids', () => {
    const ids = awsCatalog.features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers an encryption feature on every data store', () => {
    for (const id of DATA_STORES) {
      expect(
        awsCatalog.features.some((f) => f.serviceId === id && f.configKey === 'encryption'),
        id,
      ).toBe(true);
    }
  });

  it('has metadata for every implemented rule', () => {
    const meta = new Set(awsCatalog.rules.map((r) => r.id));
    for (const id of IMPLEMENTED_RULE_IDS) expect(meta.has(id), id).toBe(true);
  });
});

describe('MyBlog sample', () => {
  it('passes validation with no errors or warnings', () => {
    const findings = validateProject(migrateProject(samples.myblog), awsCatalog);
    expect(findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('flags DAX added without a justifying requirement (PRD §16)', () => {
    const p = migrateProject(samples.myblog);
    p.nodes.push({
      id: 'dax',
      provider: 'aws',
      serviceId: 'aws.dax',
      label: 'DAX',
      requirementIds: [],
      position: { x: 0, y: 0 },
    });
    expect(validateProject(p, awsCatalog).map((f) => f.ruleId)).toContain('VR-006');
  });
});

describe('feature values (settings editor)', () => {
  it('fixed choices: encryption and API type', () => {
    const enc = awsCatalog.features.filter((f) => f.configKey === 'encryption');
    expect(enc).toHaveLength(8);
    for (const f of enc) expect(f.values, f.id).toEqual(['KMS', 'AWS-managed']);
    expect(awsCatalog.features.find((f) => f.id === 'aws.apigateway.api-type')?.values).toEqual([
      'REST',
      'HTTP',
      'WEBSOCKET',
    ]);
    // VR-001 needs exactly "OAC".
    expect(awsCatalog.features.find((f) => f.id === 'aws.cloudfront.oac')?.values).toEqual(['OAC']);
    expect(awsCatalog.features.filter((f) => f.values).length).toBe(10);
  });

  it('KMS clears VR-025 and VR-008; AWS-managed clears VR-008', () => {
    const base = migrateProject(samples.myblog);
    const withTable = (encryption: string) => ({
      ...base,
      // VR-025 only applies with security hardening on.
      generation: { ...base.generation!, toggles: { securityHardening: true } },
      nodes: [
        ...base.nodes,
        {
          id: 'table',
          serviceId: 'aws.dynamodb',
          provider: 'aws' as const,
          label: 'Table',
          requirementIds: [],
          position: { x: 0, y: 0 },
          size: { width: 100, height: 60 },
          configuration: { encryption },
        },
      ],
    });
    const rules = (encryption: string) =>
      validateProject(withTable(encryption), awsCatalog)
        .filter((f) => f.nodeIds?.includes('table'))
        .map((f) => f.ruleId);
    expect(rules('KMS')).not.toContain('VR-008');
    expect(rules('KMS')).not.toContain('VR-025');
    expect(rules('AWS-managed')).not.toContain('VR-008');
    expect(rules('AWS-managed')).toContain('VR-025');
  });
});

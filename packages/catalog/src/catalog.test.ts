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

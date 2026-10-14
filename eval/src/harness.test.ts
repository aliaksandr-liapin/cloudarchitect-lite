import { readdirSync, readFileSync } from 'node:fs';
import { awsCatalog } from '@cloudarchitect/catalog';
import { describe, expect, it } from 'vitest';
import { Scenario, scoreCandidate } from './harness.js';

const load = (p: string) =>
  JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')) as unknown;
const scenario = Scenario.parse(load('scenarios/myblog.json'));
const reference = load('candidates/myblog.project.json') as { nodes: { serviceId?: string }[] };

describe('eval harness', () => {
  it('passes the reference MyBlog design', () => {
    expect(scoreCandidate(scenario, reference)).toMatchObject({
      passed: true,
      requirementRecall: 1,
    });
  });

  it('fails a design that adds DAX', () => {
    const withDax = structuredClone(reference) as Record<string, unknown> & { nodes: unknown[] };
    withDax.nodes.push({
      id: 'dax',
      provider: 'aws',
      serviceId: 'aws.dax',
      label: 'DAX',
      requirementIds: [],
      position: { x: 0, y: 0 },
    });
    expect(scoreCandidate(scenario, withDax)).toMatchObject({
      passed: false,
      forbiddenServices: ['aws.dax'],
    });
  });

  it('fails schema-invalid output', () => {
    expect(scoreCandidate(scenario, { nodes: 'nope' })).toMatchObject({
      schemaValid: false,
      passed: false,
    });
  });

  it('requires expected out-of-catalog needs as unresolved nodes', () => {
    const withNeed = Scenario.parse({
      ...scenario,
      expectedUnresolved: [{ id: 'model-hosting', keywords: ['sagemaker'] }],
    });
    expect(scoreCandidate(withNeed, reference)).toMatchObject({
      passed: false,
      missingUnresolved: ['model-hosting'],
    });
    const withNode = structuredClone(reference) as Record<string, unknown> & { nodes: unknown[] };
    withNode.nodes.push({
      id: 'sm',
      provider: 'aws',
      unresolved: { name: 'Amazon SageMaker endpoint', rationale: 'Not in the catalog' },
      label: 'Model endpoint',
      requirementIds: [],
      position: { x: 0, y: 0 },
    });
    expect(scoreCandidate(withNeed, withNode)).toMatchObject({ missingUnresolved: [] });
  });
});

describe('benchmark scenarios', () => {
  const dir = new URL('../scenarios/', import.meta.url);
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => Scenario.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));
  const known = new Set(awsCatalog.services.map((s) => s.id));

  it('has 10-15 scenarios for Phase 0 with unique ids', () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it.each(all.map((s) => [s.id, s] as const))('%s references only catalog services', (_, s) => {
    const ids = [
      ...s.expectedServices.required,
      ...s.expectedServices.anyOf.flat(),
      ...s.expectedServices.forbidden,
    ];
    expect(ids.filter((id) => !known.has(id))).toEqual([]);
  });
});

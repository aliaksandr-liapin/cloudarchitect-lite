import { readFileSync } from 'node:fs';
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
});

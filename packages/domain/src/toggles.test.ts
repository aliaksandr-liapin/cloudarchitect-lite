import { describe, expect, it } from 'vitest';
import {
  ContinueRequest,
  DesignToggles,
  graphContentHash,
  toggleLabels,
  toggleRequirements,
  type Project,
} from './index.js';

const req = (id: string) => ({
  id,
  text: 'text',
  type: 'functional' as const,
  status: 'open' as const,
});

describe('design toggles', () => {
  it('yields no requirements for empty toggles', () => {
    expect(toggleRequirements({})).toEqual([]);
  });

  it('yields one confirmed toggle requirement per enabled toggle, in order', () => {
    const reqs = toggleRequirements({ backups: true, disasterRecovery: 'cross-region' });
    expect(reqs.map((r) => r.id)).toEqual(['T-backups', 'T-dr']);
    expect(reqs[1]?.text.startsWith('Recover in a second AWS Region')).toBe(true);
    for (const r of reqs) {
      expect(r.provenance).toBe('toggle');
      expect(r.status).toBe('confirmed');
      expect(r.type).toBe('non-functional');
    }
  });

  it('labels enabled toggles in order', () => {
    expect(toggleLabels({ serverlessFirst: true, disasterRecovery: 'multi-az' })).toEqual([
      'Serverless-first',
      'DR: Multi-AZ',
    ]);
  });

  it('rejects unknown toggle keys', () => {
    expect(DesignToggles.safeParse({ fooBar: true }).success).toBe(false);
  });
});

describe('ContinueRequest', () => {
  const base = { operationId: '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b', operationToken: 'tok' };

  it('rejects duplicate requirement ids', () => {
    const r = ContinueRequest.safeParse({ ...base, requirements: [req('R1'), req('R1')] });
    expect(r.success).toBe(false);
  });

  it('rejects an empty requirements list', () => {
    expect(ContinueRequest.safeParse({ ...base, requirements: [] }).success).toBe(false);
  });

  it('accepts partial answers and defaults them', () => {
    const r = ContinueRequest.parse({ ...base, answers: { compliance: 'GDPR' } });
    expect(r.answers).toEqual({ compliance: 'GDPR' });
    expect(ContinueRequest.parse(base).answers).toEqual({});
  });
});

describe('graphContentHash', () => {
  const graph = (): Pick<Project, 'requirements' | 'containers' | 'nodes' | 'edges'> => ({
    requirements: [{ id: 'R1', text: 'x', type: 'functional', status: 'open' }],
    containers: [{ id: 'c', kind: 'aws-cloud', label: 'AWS', size: { width: 100, height: 100 } }],
    nodes: [
      {
        id: 'n',
        provider: 'aws',
        serviceId: 'aws.s3',
        label: 'S3',
        requirementIds: [],
        position: { x: 1, y: 2 },
      },
    ],
    edges: [],
  });

  it('ignores positions and sizes', () => {
    const moved = graph();
    moved.nodes[0]!.position = { x: 500, y: 600 };
    moved.containers[0]!.size = { width: 900, height: 900 };
    expect(graphContentHash(moved)).toBe(graphContentHash(graph()));
  });

  it('ignores ordering of ids', () => {
    const a = graph();
    a.nodes.push({ ...a.nodes[0]!, id: 'm' });
    const b = { ...a, nodes: [...a.nodes].reverse() };
    expect(graphContentHash(b)).toBe(graphContentHash(a));
  });

  it('changes when a node label changes', () => {
    const changed = graph();
    changed.nodes[0]!.label = 'Bucket';
    expect(graphContentHash(changed)).not.toBe(graphContentHash(graph()));
  });
});

import { awsCatalog } from '@cloudarchitect/catalog';
import { graphContentHash, YOU_DECIDE, type Requirement } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { buildRequirements, generateArchitecture, type GenerateInput } from './generate.js';
import { GenerationError, type LlmClient, type LlmRequest } from './llm.js';

const usage = { input: 2000, output: 800, cacheWrite: 0, cacheRead: 0 };
const given: Requirement[] = [
  { id: 'R1', text: 'Process orders asynchronously', type: 'functional', status: 'confirmed' },
];

/** A queue-triggered Lambda; `dlq` decides whether VR-004 fires. */
function graph(dlq: boolean) {
  return {
    name: 'Orders',
    inferredRequirements: [
      { id: 'I1', text: 'Observe the pipeline', type: 'non-functional' },
      // Not an I-id: renamed to the first free I<n>.
      { id: 'R9', text: 'Retry failed orders', type: 'non-functional' },
    ],
    assumptions: ['Single region'],
    containers: [
      { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
      { id: 'region', kind: 'region', parentId: 'cloud', label: 'eu-west-1' },
    ],
    nodes: [
      node('queue', 'aws.sqs', ['R1', 'R9']),
      node('fn', 'aws.lambda', ['R1']),
      node('logs', 'aws.cloudwatch', ['I1']),
    ],
    edges: [
      {
        id: 'e1',
        source: 'queue',
        target: 'fn',
        kind: 'event',
        label: 'orders',
        requirementIds: ['R1'],
        configuration: dlq
          ? [{ key: 'deadLetterQueue', value: 'orders-dlq' }]
          : [{ key: 'deadLetterQueue', value: 'none' }],
      },
      {
        id: 'e2',
        source: 'fn',
        target: 'logs',
        kind: 'write',
        label: 'logs',
        requirementIds: ['I1'],
        configuration: [],
      },
    ],
  };
}

function node(id: string, serviceId: string, requirementIds: string[]) {
  return {
    id,
    serviceId,
    label: id,
    purpose: `The ${id}`,
    rationale: `Needed for ${id}`,
    containerId: 'region',
    requirementIds,
    configuration: [],
  };
}

function fake(...bodies: unknown[]) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = async (req) => {
    const body = bodies[Math.min(requests.length, bodies.length - 1)];
    requests.push(req);
    return {
      text: typeof body === 'string' ? body : JSON.stringify(body),
      usage,
      stopReason: 'end_turn',
    };
  };
  return { llm, requests };
}

const input = (over: Partial<GenerateInput> = {}): GenerateInput => ({
  prompt: 'An order pipeline',
  toggles: {},
  model: 'haiku',
  name: 'Orders',
  requirements: given,
  assumptions: ['EU users'],
  questions: [],
  answers: {},
  now: new Date('2026-10-18T10:00:00.000Z'),
  ...over,
});

describe('buildRequirements', () => {
  it('maps answers, you-decide and toggles', () => {
    const q = (topic: 'auth-methods' | 'notifications' | 'user-scale') => ({
      topic,
      text: `What about ${topic}?`,
      suggestions: ['a', 'b'],
    });
    const reqs = buildRequirements({
      requirements: given,
      questions: [q('auth-methods'), q('notifications'), q('user-scale')],
      answers: { 'auth-methods': 'Email and Google', 'user-scale': YOU_DECIDE },
      toggles: { backups: true },
    });
    expect(reqs.map((r) => r.id)).toEqual([
      'R1',
      'C-auth-methods',
      'C-notifications',
      'C-user-scale',
      'T-backups',
    ]);
    expect(reqs.slice(1).map((r) => r.status)).toEqual([
      'confirmed',
      'inferred',
      'inferred',
      'confirmed',
    ]);
    expect(reqs[1]).toEqual({
      id: 'C-auth-methods',
      text: 'What about auth-methods? Email and Google',
      type: 'functional',
      status: 'confirmed',
      provenance: 'clarification',
    });
    expect(reqs[2]?.text).toBe('What about notifications? (decided by the architect)');
    expect(reqs[3]?.text).toBe('What about user-scale? (decided by the architect)');
  });
});

describe('generateArchitecture', () => {
  it('runs one repair turn for Haiku when warnings exist', async () => {
    const { llm, requests } = fake(graph(false), graph(true));
    const r = await generateArchitecture(llm, awsCatalog, input());
    expect(requests).toHaveLength(2);
    expect(requests[0]?.model).toBe('claude-haiku-5-5');
    expect(requests.map((q) => [q.maxTokens, q.effort])).toEqual([
      [32000, 'low'],
      [32000, 'low'],
    ]);
    expect(requests[1]?.messages).toHaveLength(3);
    expect(requests[1]?.messages[2]?.content).toContain('VR-004');
    expect(requests[1]?.system).toBe(requests[0]?.system);
    expect(r.usage).toHaveLength(2);
    const { validateProject } = await import('@cloudarchitect/domain');
    expect(validateProject(r.project, awsCatalog).map((f) => f.ruleId)).not.toContain('VR-004');
  });

  it('reports the first draft findings and the repair turns used', async () => {
    const repaired = await generateArchitecture(
      fake(graph(false), graph(true)).llm,
      awsCatalog,
      input(),
    );
    expect(repaired.repairTurnsUsed).toBe(1);
    expect(repaired.firstDraftFindings.map((f) => f.ruleId)).toContain('VR-004');

    const clean = await generateArchitecture(fake(graph(true)).llm, awsCatalog, input());
    expect(clean.repairTurnsUsed).toBe(0);
    expect(clean.firstDraftFindings.map((f) => f.ruleId)).not.toContain('VR-004');
  });

  it('names the offending node ids and the remediation in the repair turn', async () => {
    // Trimmed from Haiku product-search-cost #1: the database came back without containerId,
    // and a repair turn that named only the label ("... must run inside a VPC") did not fix it.
    const placed = (containerId: string | null) => {
      const g = graph(true);
      g.containers.push(
        { id: 'c-vpc', kind: 'vpc', parentId: 'region', label: 'VPC' },
        { id: 'c-priv-a', kind: 'subnet', parentId: 'c-vpc', label: 'Private A' },
      );
      return {
        ...g,
        nodes: [
          ...g.nodes,
          { ...node('n-rds', 'aws.rds', ['R1']), label: 'Product database', containerId },
        ],
      };
    };
    const { llm, requests } = fake(placed(null), placed('c-priv-a'));
    const r = await generateArchitecture(llm, awsCatalog, input());
    const repair = requests[1]?.messages[2]?.content ?? '';
    expect(repair).toContain('- [VR-009 error] Product database must run inside a VPC.');
    expect(repair).toContain('Fix: Move the node into a subnet of a VPC container.');
    expect(repair).toContain('(nodes: n-rds)');
    expect(r.project.nodes.find((n) => n.id === 'n-rds')?.containerId).toBe('c-priv-a');
  });

  it('does not repair for Sonnet', async () => {
    const { llm, requests } = fake(graph(false), graph(true));
    const r = await generateArchitecture(llm, awsCatalog, input({ model: 'sonnet' }));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe('claude-sonnet-5-5');
    expect(r.usage[0]?.model).toBe('claude-sonnet-5-5');
    // "none" is dropped, never treated as a configured feature.
    expect(r.project.edges[0]?.configuration).toBeUndefined();
  });

  it('lists the fixed requirements in the user message', async () => {
    const { llm, requests } = fake(graph(true));
    await generateArchitecture(llm, awsCatalog, input({ toggles: { backups: true } }));
    const msg = requests[0]?.messages[0]?.content ?? '';
    expect(msg).toContain('An order pipeline');
    expect(msg).toContain('R1: Process orders asynchronously');
    expect(msg).toContain('T-backups: ');
    expect(requests[0]?.system).not.toContain('T-backups:');
  });

  it('generated project carries generation metadata and a content hash equal to graphContentHash(project)', async () => {
    const { llm } = fake(graph(true));
    const { project } = await generateArchitecture(
      llm,
      awsCatalog,
      input({ toggles: { backups: true } }),
    );
    expect(project.projectId).toBe('generated');
    expect(project.revision).toBe(0);
    expect(project.name).toBe('Orders');
    expect(project.findings).toEqual([]);
    expect(project.nodes.every((n) => n.position.x === 0 && n.position.y === 0)).toBe(true);
    expect(project.generation).toEqual({
      toggles: { backups: true },
      model: 'haiku',
      generatedAt: '2026-10-18T10:00:00.000Z',
      contentHash: graphContentHash(project),
    });
    expect(project.requirements.map((r) => [r.id, r.status, r.provenance])).toEqual([
      ['R1', 'confirmed', undefined],
      ['T-backups', 'confirmed', 'toggle'],
      ['I1', 'inferred', 'ai'],
      ['I2', 'inferred', 'ai'],
    ]);
    // The renamed requirement keeps its references.
    expect(project.nodes[0]?.requirementIds).toEqual(['R1', 'I2']);
  });

  it('renames an inferred id that collides with a fixed id', async () => {
    const g = graph(true);
    g.inferredRequirements = [{ id: 'R1', text: 'Duplicate', type: 'functional' }];
    const { llm } = fake(g);
    const { project } = await generateArchitecture(llm, awsCatalog, input({ model: 'sonnet' }));
    expect(project.requirements.map((r) => r.id)).toEqual(['R1', 'I1']);
    // References to a colliding id keep pointing at the fixed requirement.
    expect(project.nodes[1]?.requirementIds).toEqual(['R1']);
  });

  it('throws GenerationError when the repaired output is still schema-invalid', async () => {
    const { llm, requests } = fake(graph(false), { name: 'broken' });
    const err = await generateArchitecture(llm, awsCatalog, input()).catch((e: unknown) => e);
    expect(requests).toHaveLength(2);
    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).code).toBe('schema_invalid');
    expect((err as GenerationError).usage).toHaveLength(2);
    expect((err as GenerationError).usage.every((u) => u.costMicroUsd > 0)).toBe(true);
  });

  it('throws GenerationError on non-JSON output', async () => {
    const { llm } = fake('not json');
    await expect(
      generateArchitecture(llm, awsCatalog, input({ model: 'sonnet' })),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});

import { describe, expect, it } from 'vitest';
import type { Scenario } from './harness.js';
import {
  aggregate,
  buildPackets,
  type DesignRun,
  type PanelReview,
  type ReviewOutput,
} from './packets.js';

const scenario = (id: string, extra: Partial<Scenario> = {}): Scenario =>
  ({
    id,
    title: id,
    class: 'static-web',
    prompt: `Build the ${id} system.`,
    expectedRequirements: [],
    expectedServices: { required: [], anyOf: [], forbidden: [] },
    expectedUnresolved: [],
    maxErrorFindings: 0,
    toggles: {},
    answers: {},
    forbiddenRules: [],
    ...extra,
  }) as Scenario;

const scenarios = [
  scenario('alpha', { toggles: { securityHardening: true } }),
  scenario('beta'),
  scenario('gamma'),
  scenario('delta'),
];

function design(model: string, scenarioId: string, repeat = 1): DesignRun {
  return {
    model,
    scenarioId,
    repeat,
    project: {
      // Fields that could identify the generator must never reach a packet.
      generation: { model, toggles: {}, generatedAt: '2026-11-04T00:00:00Z', contentHash: 'x' },
      name: `${model} project`,
      projectId: `${model}-id`,
      requirements: [
        { id: 'R1', text: `Serve ${scenarioId}`, type: 'functional', status: 'confirmed' },
      ],
      containers: [{ id: 'c1', kind: 'vpc', label: 'Main VPC' }],
      nodes: [
        {
          id: 'n-a',
          provider: 'aws',
          label: 'Storage',
          serviceId: 'aws.s3',
          requirementIds: ['R1'],
          containerId: 'c1',
          position: { x: 1, y: 2 },
          purpose: 'Keeps files',
          configuration: { encryption: 'KMS' },
        },
        {
          id: 'n-b',
          provider: 'aws',
          label: 'Users',
          external: { kind: 'user', name: 'People' },
          requirementIds: [],
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n-b',
          target: 'n-a',
          kind: 'write',
          protocol: 'HTTPS',
          label: 'Uploads',
          requirementIds: ['R1'],
        },
      ],
    },
  } as unknown as DesignRun;
}

const models = ['haiku', 'sonnet', 'gpt-luna', 'gpt-sol', 'gemini-flash-lite', 'gemini-argon'];
const runs = models.flatMap((m) => scenarios.map((s) => design(m, s.id)));

describe('buildPackets', () => {
  it('pairs each design with the same scenario design of the same-tier Claude model', () => {
    const { packets, key } = buildPackets({ runs, scenarios, seed: 1 });
    const pairs = new Set<string>();
    for (const p of packets)
      for (const [scenarioId, e] of Object.entries(key[p.id]!))
        pairs.add([scenarioId, ...[e.A.model, e.B.model].sort()].join('|'));
    expect(pairs.has('alpha|gpt-luna|haiku')).toBe(true);
    expect(pairs.has('alpha|gemini-flash-lite|haiku')).toBe(true);
    expect(pairs.has('alpha|gpt-sol|sonnet')).toBe(true);
    expect(pairs.has('alpha|gemini-argon|sonnet')).toBe(true);
    expect(pairs.has('alpha|haiku|sonnet')).toBe(true);
    expect(pairs.has('alpha|gpt-luna|gpt-sol')).toBe(false);
    // 5 distinct pairs per scenario (haiku-sonnet is shared), 4 scenarios.
    expect(pairs.size).toBe(20);
  });

  it('puts at most three distinct scenarios in a packet', () => {
    const { packets, key } = buildPackets({ runs, scenarios, seed: 1 });
    for (const p of packets) {
      const ids = Object.keys(key[p.id]!);
      expect(ids.length).toBeLessThanOrEqual(3);
      expect(p.scenarios).toEqual(ids);
    }
  });

  it('contains nothing that identifies a model or provider', () => {
    const { packets } = buildPackets({ runs, scenarios, seed: 7 });
    for (const p of packets) {
      for (const banned of [
        'haiku',
        'sonnet',
        'gpt',
        'gemini',
        'claude',
        'openai',
        'google',
        'anthropic',
      ])
        expect(p.markdown.toLowerCase()).not.toContain(banned);
      expect(p.markdown).not.toContain('n-a');
      expect(p.markdown).not.toContain('aws.s3');
      expect(p.markdown).not.toContain('contentHash');
    }
  });

  it('renders the prompt, toggles, design A and design B', () => {
    const { packets } = buildPackets({ runs, scenarios, seed: 3 });
    const md = packets.find((p) => p.scenarios.includes('alpha'))!.markdown;
    expect(md).toContain('Build the alpha system.');
    expect(md).toContain('Harden security');
    expect(md).toContain('### Design A');
    expect(md).toContain('### Design B');
    expect(md).toContain('Amazon S3');
    expect(md).toContain('EXTERNAL user: People');
  });

  it('maps every A and B back to a model, with all designs present', () => {
    const { packets, key } = buildPackets({ runs, scenarios, seed: 3 });
    for (const p of packets)
      for (const e of Object.values(key[p.id]!)) {
        expect(models).toContain(e.A.model);
        expect(models).toContain(e.B.model);
        expect(e.A.model).not.toBe(e.B.model);
      }
  });

  it('is deterministic for a seed and varies with it', () => {
    const a = buildPackets({ runs, scenarios, seed: 5 });
    const b = buildPackets({ runs, scenarios, seed: 5 });
    const c = buildPackets({ runs, scenarios, seed: 6 });
    expect(b).toEqual(a);
    expect(c.key).not.toEqual(a.key);
  });

  it('skips designs whose partner is missing', () => {
    const only = runs.filter((r) => !(r.model === 'haiku' && r.scenarioId === 'alpha'));
    const { key } = buildPackets({ runs: only, scenarios, seed: 1 });
    const models_ = Object.values(key).flatMap((k) =>
      Object.entries(k)
        .filter(([s]) => s === 'alpha')
        .flatMap(([, e]) => [e.A.model, e.B.model]),
    );
    expect(models_).not.toContain('haiku');
  });
});

describe('aggregate', () => {
  const dims = [
    'requirementCoverage',
    'serviceFitness',
    'connectionCorrectness',
    'securityBaseline',
    'reliabilityOperability',
    'costAwareness',
    'explanationAccuracy',
  ] as const;
  const score = (n: number) =>
    Object.fromEntries(dims.map((d) => [d, n])) as Record<string, number>;
  const rev = (
    scenarioId: string,
    a: { s: number; crit?: boolean; majors?: number },
    b: { s: number; crit?: boolean; majors?: number },
    better: 'A' | 'B' | 'tie',
  ): ReviewOutput =>
    ({
      reviews: [
        { scenario: scenarioId, design: 'A', a },
        { scenario: scenarioId, design: 'B', b },
      ].map((_, i) => {
        const x = i === 0 ? a : b;
        return {
          scenario: scenarioId,
          design: i === 0 ? 'A' : 'B',
          scores: score(x.s),
          criticalDefect: x.crit ?? false,
          defects: Array.from({ length: x.majors ?? 0 }, () => ({
            severity: 'major',
            description: 'd',
            evidence: 'https://docs.aws.amazon.com/x',
          })),
          summary: 's',
        };
      }),
      preference: [{ scenario: scenarioId, better, why: 'w' }],
    }) as unknown as ReviewOutput;

  const key = {
    g1: {
      alpha: { A: { model: 'gpt-sol', repeat: 1 }, B: { model: 'sonnet', repeat: 1 } },
      beta: { A: { model: 'sonnet', repeat: 1 }, B: { model: 'gpt-sol', repeat: 1 } },
    },
  };

  it('takes the median of three reviewers per design, then the median per model', () => {
    // alpha: gpt-sol scored 1, 3, 2 -> 2; sonnet 2, 2, 3 -> 2
    // beta:  gpt-sol scored 3, 0, 3 -> 3; sonnet 1, 1, 0 -> 1
    const reviews: PanelReview[] = [
      { reviewer: 'r1', packetId: 'g1', output: rev('alpha', { s: 1 }, { s: 2 }, 'B') },
      { reviewer: 'r2', packetId: 'g1', output: rev('alpha', { s: 3 }, { s: 2 }, 'A') },
      { reviewer: 'r3', packetId: 'g1', output: rev('alpha', { s: 2 }, { s: 3 }, 'tie') },
      { reviewer: 'r1', packetId: 'g1', output: rev('beta', { s: 1 }, { s: 3 }, 'B') },
      { reviewer: 'r2', packetId: 'g1', output: rev('beta', { s: 1 }, { s: 0, crit: true }, 'A') },
      { reviewer: 'r3', packetId: 'g1', output: rev('beta', { s: 0, crit: true }, { s: 3 }, 'B') },
    ];
    const s = aggregate(key, reviews);
    expect(s.models['gpt-sol']!.blindScore).toBe(2.5); // median of designs [2, 3]
    expect(s.models['sonnet']!.blindScore).toBe(1.5); // median of designs [2, 1]
    expect(s.models['gpt-sol']!.designs).toBe(2);
    // sonnet beta: 2 of 3 reviewers flagged critical? only r3 (design A is sonnet in beta) -> no
    expect(s.models['sonnet']!.criticalDefectRate).toBe(0);
    // gpt-sol beta: r2 flagged critical (1 of 3) -> not a majority
    expect(s.models['gpt-sol']!.criticalDefectRate).toBe(0);
  });

  it('counts critical defects by majority, major defects by median, preferences by majority', () => {
    const reviews: PanelReview[] = [
      {
        reviewer: 'r1',
        packetId: 'g1',
        output: rev('alpha', { s: 1, crit: true, majors: 4 }, { s: 3 }, 'B'),
      },
      {
        reviewer: 'r2',
        packetId: 'g1',
        output: rev('alpha', { s: 1, crit: true, majors: 2 }, { s: 3 }, 'B'),
      },
      { reviewer: 'r3', packetId: 'g1', output: rev('alpha', { s: 1, majors: 1 }, { s: 3 }, 'A') },
    ];
    const s = aggregate({ g1: { alpha: key.g1.alpha } }, reviews);
    expect(s.models['gpt-sol']!.criticalDefectRate).toBe(1);
    expect(s.models['gpt-sol']!.majorDefects).toBe(2);
    expect(s.models['sonnet']!.criticalDefectRate).toBe(0);
    expect(s.preferences['sonnet over gpt-sol']).toBe(1);
    expect(s.preferences['gpt-sol over sonnet'] ?? 0).toBe(0);
  });

  it('returns no models when there are no reviews', () => {
    const s = aggregate({ g1: { alpha: key.g1.alpha } }, []);
    expect(s.models).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import type { Scenario } from './harness.js';
import {
  acceptSaved,
  aggregate,
  missingCalls,
  normalizeReviewOutput,
  packetMismatches,
  buildPackets,
  estimateCallMicroUsd,
  validateReviewOutput,
  withinCap,
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

describe('review guards', () => {
  const dims = {
    requirementCoverage: 2,
    serviceFitness: 2,
    connectionCorrectness: 2,
    securityBaseline: 2,
    reliabilityOperability: 2,
    costAwareness: 2,
    explanationAccuracy: 2,
  };
  const one = (scenario: string, design: 'A' | 'B') => ({
    scenario,
    design,
    scores: dims,
    criticalDefect: false,
    defects: [],
    summary: 's',
  });
  const good: ReviewOutput = {
    reviews: [one('alpha', 'A'), one('alpha', 'B')],
    preference: [{ scenario: 'alpha', better: 'A', why: 'w' }],
  };

  it('does not point reviewers at ids that were renumbered', () => {
    const { packets } = buildPackets({
      runs,
      scenarios: [scenario('alpha', { answers: { 'auth-methods': 'Email only' } as never })],
      seed: 1,
    });
    expect(packets[0]!.markdown).not.toContain('starting with C-');
    const plain = buildPackets({ runs, scenarios, seed: 1 }).packets[0]!.markdown;
    expect(plain).not.toContain('starting with C-');
  });

  it('accepts a complete answer and rejects duplicate, missing or foreign entries', () => {
    expect(() => validateReviewOutput(good, ['alpha'])).not.toThrow();
    const dup = { ...good, reviews: [...good.reviews, one('alpha', 'A')] };
    expect(() => validateReviewOutput(dup, ['alpha'])).toThrow(/duplicate review alpha\/A/);
    expect(() =>
      validateReviewOutput({ ...good, reviews: [one('alpha', 'A')] }, ['alpha']),
    ).toThrow(/missing review alpha\/B/);
    expect(() => validateReviewOutput(good, ['beta'])).toThrow(/unexpected/);
    const dupPref = { ...good, preference: [...good.preference, ...good.preference] };
    expect(() => validateReviewOutput(dupPref, ['alpha'])).toThrow(/duplicate preference/);
  });

  it('reserves worst-case cost and blocks a call that could cross the cap', () => {
    // 3000 chars -> 1000 input tokens; sonnet $2/$10 per MTok: 1000*2 + 24000*10 micro-USD.
    const est = estimateCallMicroUsd(
      'claude-sonnet-5-5',
      'x'.repeat(1000),
      'y'.repeat(2000),
      24000,
    );
    expect(est).toBe(1000 * 2 + 24000 * 10);
    expect(withinCap(0, 0, est, est)).toBe(true);
    // Another call in flight: the second may not start although nothing is spent yet.
    expect(withinCap(0, est, est, est * 1.5)).toBe(false);
    expect(withinCap(est, 0, 1, est)).toBe(false);
    expect(() => estimateCallMicroUsd('nope', '', '', 1)).toThrow();
  });

  it('marks a partial panel and records the reviewer count per design', () => {
    const key = {
      g1: { alpha: { A: { model: 'gpt-sol', repeat: 1 }, B: { model: 'sonnet', repeat: 1 } } },
    };
    const two: PanelReview[] = ['r1', 'r2'].map((reviewer) => ({
      reviewer,
      packetId: 'g1',
      output: good,
    }));
    const partial = aggregate(key, two);
    expect(partial.complete).toBe(false);
    expect(partial.reviewersPerDesign['gpt-sol#1@alpha']).toBe(2);
    expect(partial.models['sonnet']!.minReviewers).toBe(2);
    const full = aggregate(key, [...two, { reviewer: 'r3', packetId: 'g1', output: good }]);
    expect(full.complete).toBe(true);
    expect(full.reviewersPerDesign['sonnet#1@alpha']).toBe(3);
  });
});

describe('buildPackets filters', () => {
  const keyPairs = (r: ReturnType<typeof buildPackets>) =>
    Object.values(r.key).flatMap((k) =>
      Object.entries(k).map(([sc, e]) =>
        [sc, ...[`${e.A.model}#${e.A.repeat}`, `${e.B.model}#${e.B.repeat}`].sort()].join('|'),
      ),
    );
  const twice = [...runs, ...models.flatMap((m) => scenarios.map((s) => design(m, s.id, 2)))];

  it('keeps only designs of the requested repeat and never pairs Haiku repeats with each other', () => {
    const r = buildPackets({ runs: twice, scenarios, seed: 1, repeat: 2 });
    const pairs = keyPairs(r);
    expect(pairs).toHaveLength(20);
    expect(pairs.every((p) => !p.includes('#1'))).toBe(true);
    expect(pairs.some((p) => p.includes('haiku#1|haiku#2') || p.includes('haiku#2|haiku#2'))).toBe(
      false,
    );
  });

  it('limits economical pairs to --scenarios and best-quality pairs to --base-scenarios', () => {
    const r = buildPackets({
      runs,
      scenarios,
      seed: 1,
      onlyScenarios: ['alpha', 'beta'],
      baseScenarios: ['alpha'],
    });
    const pairs = keyPairs(r);
    expect(pairs.filter((p) => p.includes('gpt-luna')).map((p) => p.split('|')[0])).toEqual(
      expect.arrayContaining(['alpha', 'beta']),
    );
    expect(pairs.filter((p) => p.includes('gpt-luna'))).toHaveLength(2);
    expect(pairs.filter((p) => p.includes('gemini-flash-lite'))).toHaveLength(2);
    // best-quality: gpt-sol, gemini-argon and haiku-sonnet, alpha only
    expect(pairs.filter((p) => p.includes('gpt-sol'))).toHaveLength(1);
    expect(pairs.filter((p) => p.includes('gemini-argon'))).toHaveLength(1);
    expect(pairs.filter((p) => p.includes('haiku#1|sonnet#1'))).toEqual(['alpha|haiku#1|sonnet#1']);
    expect(pairs).toHaveLength(7);
  });

  it('uses --scenarios for every pair when --base-scenarios is absent', () => {
    const pairs = keyPairs(buildPackets({ runs, scenarios, seed: 1, onlyScenarios: ['gamma'] }));
    expect(pairs).toHaveLength(5);
    expect(pairs.every((p) => p.startsWith('gamma|'))).toBe(true);
  });

  it('changes nothing without filters and rejects unknown scenario ids', () => {
    expect(buildPackets({ runs, scenarios, seed: 1 })).toEqual(
      buildPackets({ runs, scenarios, seed: 1, onlyScenarios: undefined }),
    );
    expect(() => buildPackets({ runs, scenarios, seed: 1, onlyScenarios: ['nope'] })).toThrow(
      /Unknown scenarios: nope/,
    );
    expect(() =>
      buildPackets({ runs, scenarios, seed: 1, baseScenarios: ['alpha', 'zzz'] }),
    ).toThrow(/Unknown scenarios: zzz/);
  });
});

describe('score range and resume', () => {
  const dims = {
    requirementCoverage: 2,
    serviceFitness: 2,
    connectionCorrectness: 2,
    securityBaseline: 2,
    reliabilityOperability: 2,
    costAwareness: 2,
    explanationAccuracy: 2,
  };
  const mk = (scores: Record<string, number>): ReviewOutput =>
    ({
      reviews: ['A', 'B'].map((design) => ({
        scenario: 'alpha',
        design,
        scores,
        criticalDefect: false,
        defects: [],
        summary: 's',
      })),
      preference: [{ scenario: 'alpha', better: 'A', why: 'w' }],
    }) as unknown as ReviewOutput;

  it('sends no minimum/maximum for scores to providers', async () => {
    const { jsonOutputFormat } = await import('@cloudarchitect/generator');
    const { ReviewOutput: schema } = await import('./packets.js');
    const json = JSON.stringify(jsonOutputFormat(schema));
    expect(json).not.toContain('"minimum"');
    expect(json).not.toContain('"maximum"');
  });

  it('rejects scores outside 0-3 or not integers in validation', () => {
    expect(() => validateReviewOutput(mk(dims), ['alpha'])).not.toThrow();
    expect(() => validateReviewOutput(mk({ ...dims, costAwareness: 4 }), ['alpha'])).toThrow(
      /out of range/,
    );
    expect(() => validateReviewOutput(mk({ ...dims, costAwareness: -1 }), ['alpha'])).toThrow(
      /out of range/,
    );
    expect(() => validateReviewOutput(mk({ ...dims, costAwareness: 1.5 }), ['alpha'])).toThrow(
      /out of range/,
    );
  });

  it('accepts only valid saved reviews', () => {
    expect(acceptSaved(JSON.stringify(mk(dims)), ['alpha'])).toBeDefined();
    expect(
      acceptSaved(JSON.stringify(mk({ ...dims, serviceFitness: 9 })), ['alpha']),
    ).toBeUndefined();
    expect(acceptSaved(JSON.stringify(mk(dims)), ['beta'])).toBeUndefined();
    expect(acceptSaved('{not json', ['alpha'])).toBeUndefined();
    expect(acceptSaved('{}', ['alpha'])).toBeUndefined();
  });

  it('selects only the missing (reviewer, packet) pairs', () => {
    const have = new Set(['openai/g1', 'google/g1', 'google/g2']);
    expect(missingCalls(['openai', 'google'], ['g1', 'g2'], have)).toEqual([
      { reviewer: 'openai', packetId: 'g2' },
    ]);
    expect(missingCalls(['anthropic'], ['g1', 'g2'], have)).toHaveLength(2);
    expect(missingCalls([], ['g1'], have)).toEqual([]);
  });

  it('detects changed, missing and extra packets', () => {
    const built = [
      { id: 'g1', scenarios: ['a'], markdown: 'one' },
      { id: 'g2', scenarios: ['b'], markdown: 'two' },
    ];
    expect(packetMismatches({ g1: 'one', g2: 'two' }, built)).toEqual([]);
    expect(packetMismatches({ g1: 'one', g2: 'TWO' }, built)).toEqual(['g2']);
    expect(packetMismatches({ g1: 'one' }, built)).toEqual(['g2']);
    expect(packetMismatches({ g1: 'one', g2: 'two', g3: 'x' }, built)).toEqual(['g3']);
  });
});

describe('normalizeReviewOutput', () => {
  const dims = {
    requirementCoverage: 2,
    serviceFitness: 2,
    connectionCorrectness: 2,
    securityBaseline: 2,
    reliabilityOperability: 2,
    costAwareness: 2,
    explanationAccuracy: 2,
  };
  const rv = (design: 'A' | 'B', summary: string, scores = dims) => ({
    scenario: 'alpha',
    design,
    scores,
    criticalDefect: false,
    defects: [],
    summary,
  });
  const base = (): ReviewOutput => ({
    reviews: [rv('A', 'first'), rv('B', 'b')],
    preference: [{ scenario: 'alpha', better: 'A', why: 'first' }],
  });

  it('keeps the first of repeated entries and warns', () => {
    const o = base();
    o.reviews.push(rv('A', 'second', { ...dims, costAwareness: 0 }));
    o.preference.push({ scenario: 'alpha', better: 'B', why: 'second' });
    const { output, warnings } = normalizeReviewOutput(o, ['alpha']);
    expect(output.reviews.map((r) => r.summary)).toEqual(['first', 'b']);
    expect(output.preference).toEqual([{ scenario: 'alpha', better: 'A', why: 'first' }]);
    expect(warnings).toEqual(['duplicate review alpha/A', 'duplicate preference alpha']);
  });

  it('has no warnings for a clean answer and still rejects bad ones', () => {
    expect(normalizeReviewOutput(base(), ['alpha']).warnings).toEqual([]);
    const missing = { ...base(), reviews: [rv('A', 'x'), rv('A', 'dup')] };
    expect(() => normalizeReviewOutput(missing, ['alpha'])).toThrow(/missing review alpha\/B/);
    expect(() => normalizeReviewOutput(base(), ['beta'])).toThrow(/unexpected/);
    const bad = { ...base(), reviews: [rv('A', 'x', { ...dims, costAwareness: 5 }), rv('B', 'b')] };
    expect(() => normalizeReviewOutput(bad, ['alpha'])).toThrow(/out of range/);
  });

  it('accepts a saved answer with a repeated design as its normalized form', () => {
    const o = base();
    o.reviews.push(rv('B', 'again'));
    expect(acceptSaved(JSON.stringify(o), ['alpha'])!.reviews).toHaveLength(2);
  });
});

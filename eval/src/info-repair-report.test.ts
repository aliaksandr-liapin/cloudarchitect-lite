import { describe, expect, it } from 'vitest';
import type { ArmResult, InfoRepairRecord } from './info-repair-job.js';
import { renderReport } from './info-repair-report.js';

const arm = (over: Partial<ArmResult> = {}): ArmResult => ({
  ok: true,
  repaired: true,
  findingsByRule: {},
  targeted: 1,
  collateral: 0,
  changesByKind: {},
  regressions: 0,
  costUsd: 0.01,
  latencyMs: 1000,
  score: { passed: true } as ArmResult['score'],
  ...over,
});

function rec(
  i: number,
  over: Partial<InfoRepairRecord> & { W?: Partial<ArmResult>; I?: Partial<ArmResult> } = {},
): InfoRepairRecord {
  const { W, I, ...rest } = over;
  return {
    scenarioId: `s${i}`,
    model: 'haiku',
    repeat: 1,
    ok: true,
    infoSent: 1,
    sameRequest: false,
    differ: true,
    armsDiff: 2,
    arms: {
      W: arm({ findingsByRule: { 'VR-005:info': 2, 'VR-015:info': 1 }, ...W }),
      I: arm({ findingsByRule: { 'VR-005:info': 0, 'VR-015:info': 1 }, ...I }),
    },
    costUsd: 0.03,
    latencyMs: 1,
    calls: [],
    ...rest,
  } as InfoRepairRecord;
}

const records = Array.from({ length: 12 }, (_, i) => rec(i));
const complete = { cutShort: false, spentUsd: 1.2 };

describe('renderReport', () => {
  it('prints the criteria and a recommendation per model', () => {
    const md = renderReport({
      records,
      summary: complete,
      blind: { 'haiku~W': { blindScore: 3 }, 'haiku~I': { blindScore: 4 } },
      seed: 1,
    });
    expect(md).toContain('## haiku');
    expect(md).toContain('Criterion 1');
    expect(md).toContain('Criterion 6');
    expect(md).toContain('Recommendation: adopt arm I');
    expect(md).toContain('collateral I−W lower bound vs noise floor');
    expect(md).toContain('VR-005');
  });

  it('refuses a recommendation for a partial run', () => {
    const md = renderReport({
      records,
      summary: { cutShort: true, spentUsd: 2.5 },
      blind: { 'haiku~W': { blindScore: 3 }, 'haiku~I': { blindScore: 4 } },
      seed: 1,
    });
    expect(md).toContain('partial run: no recommendation');
    expect(md).not.toContain('adopt arm I');
  });

  it('shows "no blind data" for criterion 5 when no review is given', () => {
    const md = renderReport({ records, summary: complete, seed: 1 });
    expect(md).toContain('no blind review data');
    expect(md).toContain('Recommendation: undecided (criterion 5 has no data)');
    expect(md).not.toContain('Recommendation: adopt arm I');
  });

  it('prints job counts and whether the noise floor was pooled', () => {
    const md = renderReport({
      records: [...records, rec(99, { sameRequest: true, W: { repaired: true } })],
      summary: complete,
      seed: 1,
    });
    expect(md).toMatch(/sameRequest jobs: 1/);
    expect(md).toMatch(/pooled/);
    expect(md).toMatch(/failed arms \(W\/I\): 0\/0/);
  });

  it('prints per-arm median latency', () => {
    const md = renderReport({
      // W: 1 s, 2 s, 60 s (median 2 s); I: 3 s, 4 s, 5 s (median 4 s).
      records: [1, 2, 60].map((sec, i) =>
        rec(i, { W: { latencyMs: sec * 1000 }, I: { latencyMs: (3 + i) * 1000 } }),
      ),
      summary: complete,
      seed: 1,
    });
    expect(md).toContain('| Median latency per design (s) | 2.0 | 4.0 | — |');
  });

  it('prints "Costs: none clearly above zero" when no cost interval is above zero', () => {
    const md = renderReport({ records, summary: complete, seed: 1 });
    const section = md.slice(md.indexOf('## haiku'));
    expect(section.indexOf('Costs: none clearly above zero')).toBeGreaterThan(-1);
    expect(section.indexOf('Costs:')).toBeLessThan(section.indexOf('| Metric'));
  });

  it('names each cost whose I−W interval is clearly above zero', () => {
    const md = renderReport({
      records: Array.from({ length: 12 }, (_, i) =>
        rec(i, {
          I: {
            collateral: 2,
            regressions: 1,
            findingsByRule: { 'VR-005:info': 0, 'VR-004:warning': 1 },
          },
        }),
      ),
      summary: complete,
      seed: 1,
    });
    expect(md).toContain(
      'Costs: collateral 2.00 [2.00, 2.00] *; regressions 1.00 [1.00, 1.00] *; errors+warnings 1.00 [1.00, 1.00] *',
    );
  });

  it('breaks down per-arm means for both-repaired and info-only jobs', () => {
    const md = renderReport({
      records: [
        rec(1, { W: { collateral: 1 }, I: { collateral: 3, targeted: 2 } }),
        rec(2, { W: { collateral: 3 }, I: { collateral: 1, targeted: 4 } }),
        rec(3, { W: { repaired: false, targeted: 0 }, I: { collateral: 5, regressions: 1 } }),
      ],
      summary: complete,
      seed: 1,
    });
    expect(md).toContain('Breakdown by repair (means only');
    expect(md).toContain(
      '| Jobs | n | Info W | Info I | Collateral W | Collateral I | Targeted W | Targeted I | Regressions W | Regressions I |',
    );
    expect(md).toContain(
      '| Both arms repaired | 2 | 2.00 | 0.00 | 2.00 | 2.00 | 1.00 | 3.00 | 0.00 | 0.00 |',
    );
    expect(md).toContain(
      '| Info-only (I repaired, W not) | 1 | 2.00 | 0.00 | 0.00 | 5.00 | 0.00 | 1.00 | 0.00 | 1.00 |',
    );
  });

  it('prints head-to-head preferences under criterion 5 as supporting data', () => {
    const md = renderReport({
      records,
      summary: complete,
      blind: { 'haiku~W': { blindScore: 3 }, 'haiku~I': { blindScore: 4 } },
      preferences: { 'haiku~I over haiku~W': 6, 'haiku~W over haiku~I': 3 },
      seed: 1,
    });
    const c5 = md.indexOf('Criterion 5');
    const line = md.indexOf('head-to-head preferences');
    expect(line).toBeGreaterThan(c5);
    expect(line).toBeLessThan(md.indexOf('Criterion 6'));
    expect(md).toContain('I over W 6, W over I 3');
    expect(md).toContain('Recommendation: adopt arm I');
  });

  it('ends with a caveats section', () => {
    const md = renderReport({ records, summary: complete, seed: 1 });
    const caveats = md.slice(md.indexOf('## Caveats'));
    expect(md.indexOf('## Caveats')).toBeGreaterThan(md.indexOf('## haiku'));
    expect(caveats).toContain('VR-008');
    expect(caveats).toContain('removal plus an addition');
    expect(caveats).toContain('rule, severity, node ids, edge ids');
    expect(caveats).toContain('one run');
    expect(caveats).toContain('R7');
  });

  it('treats criterion 5 as undecided when the review panel was partial', () => {
    const md = renderReport({
      records,
      summary: complete,
      blind: { 'haiku~W': { blindScore: 3 }, 'haiku~I': { blindScore: 4 } },
      blindComplete: false,
      seed: 1,
    });
    expect(md).toContain('partial review panel');
    expect(md).toContain('Recommendation: undecided (criterion 5 has no data)');
    expect(md).not.toContain('adopt arm I');
  });
});

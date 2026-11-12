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
});

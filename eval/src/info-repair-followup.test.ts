import { describe, expect, it } from 'vitest';
import type { ArmResult, InfoRepairRecord } from './info-repair-job.js';
import { followupCriteria, ruleFixCounts } from './info-repair-followup.js';

function arm(over: Partial<ArmResult> = {}): ArmResult {
  return {
    ok: true,
    repaired: true,
    findingsByRule: {},
    targeted: 0,
    collateral: 0,
    changesByKind: {},
    regressions: 0,
    unfixed: 0,
    costUsd: 0.01,
    latencyMs: 1000,
    score: { passed: true } as ArmResult['score'],
    ...over,
  };
}

function rec(
  over: Partial<InfoRepairRecord> & { W?: Partial<ArmResult>; I?: Partial<ArmResult> } = {},
): InfoRepairRecord {
  const { W, I, ...rest } = over;
  return {
    scenarioId: 's',
    model: 'gpt-luna',
    repeat: 1,
    infoMessage: 'prioritized',
    ok: true,
    firstDraftFindingsByRule: { 'VR-018:warning': 1, 'VR-008:info': 2 },
    infoSent: 2,
    sameRequest: false,
    differ: true,
    armsDiff: 2,
    arms: { W: arm(W), I: arm(I) },
    costUsd: 0.02,
    latencyMs: 1,
    calls: [],
    ...rest,
  };
}

describe('ruleFixCounts', () => {
  it('counts, per arm, drafts with the rule and info sent where the final design lost the rule', () => {
    const records = [
      rec({ W: { findingsByRule: {} }, I: { findingsByRule: { 'VR-018:warning': 1 } } }),
      rec({ W: { findingsByRule: {} }, I: { findingsByRule: {} } }),
      // No info sent: not counted.
      rec({ infoSent: 0, W: { findingsByRule: {} }, I: { findingsByRule: {} } }),
      // Draft without the rule: not counted.
      rec({ firstDraftFindingsByRule: { 'VR-008:info': 1 } }),
      // A failed arm: not counted.
      rec({ I: { ok: false } }),
    ];
    expect(ruleFixCounts(records, 'gpt-luna', 'VR-018')).toEqual({ drafts: 2, W: 2, I: 1 });
  });
});

describe('followupCriteria', () => {
  // Arm I (prioritized) clears the info finding and keeps warnings level with W.
  const good = Array.from({ length: 12 }, (_, i) =>
    rec({
      repeat: i,
      W: { findingsByRule: { 'VR-008:info': 2 } },
      I: { findingsByRule: {}, costUsd: 0.011 },
    }),
  );

  it('passes when info drops, warnings are not higher and VR-018 is fixed as often', () => {
    const c = followupCriteria(good, 'gpt-luna', 1);
    expect(c.map((x) => [x.id, x.met])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
      [5, true],
    ]);
  });

  it('fails criterion 2 when warnings are higher on average, even if not clearly', () => {
    const worse = good.map((r, i) =>
      i === 0
        ? { ...r, arms: { ...r.arms!, I: arm({ findingsByRule: { 'VR-003:warning': 1 } }) } }
        : r,
    );
    const c = followupCriteria(worse, 'gpt-luna', 1);
    expect(c.find((x) => x.id === 2)?.met).toBe(false);
  });

  it('fails criterion 3 when arm I fixes VR-018 less often than W', () => {
    const left = good.map((r, i) =>
      i < 2
        ? {
            ...r,
            arms: {
              W: r.arms!.W,
              I: arm({ findingsByRule: { 'VR-018:warning': 1 } }),
            },
          }
        : r,
    );
    const c = followupCriteria(left, 'gpt-luna', 1);
    expect(c.find((x) => x.id === 3)?.met).toBe(false);
  });
});

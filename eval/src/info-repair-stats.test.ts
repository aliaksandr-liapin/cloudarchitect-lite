import type { ModelChoice } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import type { ArmResult, InfoRepairRecord } from './info-repair-job.js';
import {
  evaluateCriteria,
  isClear,
  jobMetrics,
  noiseFloor,
  pairedBootstrap,
  recommend,
  summarizeModel,
  type ModelArmSummary,
} from './info-repair-stats.js';

function arm(over: Partial<ArmResult> = {}): ArmResult {
  return {
    ok: true,
    repaired: true,
    findingsByRule: {},
    targeted: 0,
    collateral: 0,
    changesByKind: {},
    regressions: 0,
    costUsd: 0.01,
    score: { passed: true } as ArmResult['score'],
    ...over,
  };
}

function rec(
  over: Partial<InfoRepairRecord> & { W?: Partial<ArmResult>; I?: Partial<ArmResult> } = {},
) {
  const { W, I, ...rest } = over;
  return {
    scenarioId: 's',
    model: 'haiku',
    repeat: 0,
    ok: true,
    infoSent: 1,
    sameRequest: false,
    differ: true,
    armsDiff: 2,
    arms: { W: arm(W), I: arm(I) },
    costUsd: 0.02,
    latencyMs: 1,
    calls: [],
    ...rest,
  } as InfoRepairRecord;
}

describe('pairedBootstrap', () => {
  it('is deterministic for a seed and brackets the mean', () => {
    const d = [-3, -1, -2, 0, -4, -1, -2, 1];
    const a = pairedBootstrap(d, 7);
    expect(pairedBootstrap(d, 7)).toEqual(a);
    expect(a.mean).toBeCloseTo(-1.5);
    expect(a.lo).toBeLessThanOrEqual(a.mean);
    expect(a.hi).toBeGreaterThanOrEqual(a.mean);
    expect(a.lo).toBeLessThan(a.hi);
  });
  it('returns zeros for no data', () => {
    expect(pairedBootstrap([], 1)).toEqual({ mean: 0, lo: 0, hi: 0 });
  });
});

describe('isClear', () => {
  it('needs the interval to exclude zero', () => {
    expect(isClear({ lo: 0.1, hi: 2 })).toBe(true);
    expect(isClear({ lo: -2, hi: -0.1 })).toBe(true);
    expect(isClear({ lo: -1, hi: 1 })).toBe(false);
    expect(isClear({ lo: 0, hi: 1 })).toBe(false);
  });
});

describe('jobMetrics', () => {
  it('counts info without VR-015 and errors plus warnings', () => {
    const r = rec({
      I: {
        findingsByRule: {
          'VR-008:info': 2,
          'VR-015:info': 3,
          'VR-003:warning': 1,
          'structural:error': 1,
          'VR-001:error': 1,
        },
        collateral: 4,
        targeted: 2,
        regressions: 1,
      },
    });
    expect(jobMetrics(r, 'I')).toMatchObject({
      info: 2,
      vr015: 3,
      errorsWarnings: 3,
      passed: 1,
      collateral: 4,
      targeted: 2,
      regressions: 1,
    });
  });
  it('counts a failed arm or job as not passed', () => {
    expect(jobMetrics(rec({ I: { ok: false } }), 'I').passed).toBe(0);
    expect(jobMetrics(rec({ ok: false, arms: undefined }), 'W').passed).toBe(0);
  });
});

describe('summarizeModel', () => {
  it('counts failed jobs and failed arms', () => {
    const records = [
      rec(),
      rec({ I: { ok: false } }),
      rec({ W: { ok: false } }),
      rec({ ok: false, arms: undefined }),
      rec({ model: 'gpt-luna' }),
    ];
    const s = summarizeModel(records, 'haiku', 1);
    expect(s.jobs).toBe(4);
    expect(s.pairedJobs).toBe(1);
    expect(s.failedJobs).toBe(1);
    expect(s.failedArms).toEqual({ W: 1, I: 1 });
    // pass rate is over all jobs: only the first job passed in both arms
    expect(s.meanW.passed).toBeCloseTo(2 / 4);
    expect(s.meanI.passed).toBeCloseTo(2 / 4);
  });
});

describe('noiseFloor', () => {
  const same = (model: ModelChoice, w: number, i: number) =>
    rec({ model, sameRequest: true, W: { collateral: w }, I: { collateral: i } });
  it('uses the model when it has at least 10 same-request jobs', () => {
    const rs = [...Array.from({ length: 10 }, () => same('haiku', 0, 2)), same('gpt-luna', 0, 20)];
    expect(noiseFloor(rs, 'haiku')).toEqual({ value: 2, pooled: false, jobs: 10 });
  });
  it('pools across models below 10 same-request jobs', () => {
    const rs = [same('haiku', 0, 2), same('gpt-luna', 3, 0), rec({ model: 'haiku' })];
    expect(noiseFloor(rs, 'haiku')).toEqual({ value: 2.5, pooled: true, jobs: 2 });
  });
  it('ignores same-request jobs with a failed arm', () => {
    const rs = [same('haiku', 0, 2), rec({ sameRequest: true, I: { ok: false } })];
    expect(noiseFloor(rs, 'haiku').jobs).toBe(1);
  });
  it('is undefined when no same-request jobs exist', () => {
    expect(noiseFloor([rec()], 'haiku')).toEqual({ value: undefined, pooled: true, jobs: 0 });
  });
});

describe('evaluateCriteria', () => {
  const ci = (mean: number, lo = mean, hi = mean) => ({ mean, lo, hi });
  function summary(over: Partial<ModelArmSummary> = {}): ModelArmSummary {
    const zero = {
      info: 0,
      vr015: 0,
      errorsWarnings: 0,
      passed: 0,
      collateral: 0,
      targeted: 0,
      regressions: 0,
      costUsd: 0,
    };
    return {
      model: 'haiku',
      jobs: 44,
      pairedJobs: 44,
      failedJobs: 0,
      failedArms: { W: 0, I: 0 },
      meanW: { ...zero, info: 3, passed: 1 },
      meanI: { ...zero, info: 1, passed: 1 },
      diff: {
        info: ci(-2, -3, -1),
        errorsWarnings: ci(0, -0.5, 0.5),
        passed: ci(0, -0.1, 0.1),
        collateral: ci(1, -1, 3),
        regressions: ci(0, -0.2, 0.2),
        costUsd: ci(0.004),
      },
      noiseFloor: { value: 2, pooled: false, jobs: 12 },
      ...over,
    };
  }
  const met = (cs: ReturnType<typeof evaluateCriteria>, id: number) =>
    cs.find((c) => c.id === id)!.met;

  it('passes everything for a clean win', () => {
    const cs = evaluateCriteria(summary(), { W: 3, I: 4 });
    expect(cs.map((c) => c.met)).toEqual([true, true, true, true, true, true]);
    expect(recommend(cs)).toBe(true);
  });
  it('fails criterion 1 when info drops by less than a third', () => {
    const s = summary({
      meanI: { ...summary().meanI, info: 2.5 },
      diff: { ...summary().diff, info: ci(-0.5, -0.9, -0.1) },
    });
    expect(met(evaluateCriteria(s), 1)).toBe(false);
  });
  it('fails criterion 1 when the drop is not clear or W has no info', () => {
    const unclear = summary({ diff: { ...summary().diff, info: ci(-2, -3, 0.5) } });
    expect(met(evaluateCriteria(unclear), 1)).toBe(false);
    const none = summary({ meanW: { ...summary().meanW, info: 0 } });
    const c1 = evaluateCriteria(none).find((c) => c.id === 1)!;
    expect(c1.met).toBe(false);
    expect(c1.detail).toMatch(/nothing to reduce/);
  });
  it('fails criterion 2 when errors or passes are clearly worse', () => {
    const worse = summary({ diff: { ...summary().diff, errorsWarnings: ci(1, 0.2, 2) } });
    expect(met(evaluateCriteria(worse), 2)).toBe(false);
    const fewer = summary({ diff: { ...summary().diff, passed: ci(-0.2, -0.3, -0.1) } });
    expect(met(evaluateCriteria(fewer), 2)).toBe(false);
  });
  it('fails criterion 3 when collateral rises beyond the noise floor', () => {
    const s = summary({ diff: { ...summary().diff, collateral: ci(4, 3, 5) } });
    expect(met(evaluateCriteria(s), 3)).toBe(false);
  });
  it('without a noise floor, criterion 3 fails on clearly higher collateral', () => {
    const base = summary({ noiseFloor: { value: undefined, pooled: true, jobs: 0 } });
    expect(met(evaluateCriteria(base), 3)).toBe(true);
    const high = { ...base, diff: { ...base.diff, collateral: ci(1, 0.1, 2) } };
    expect(met(evaluateCriteria(high), 3)).toBe(false);
  });
  it('fails criterion 4 on clearly more regressions', () => {
    const s = summary({ diff: { ...summary().diff, regressions: ci(1, 0.1, 2) } });
    expect(met(evaluateCriteria(s), 4)).toBe(false);
  });
  it('criterion 5 follows blind data and is undefined without it', () => {
    expect(met(evaluateCriteria(summary()), 5)).toBeUndefined();
    expect(met(evaluateCriteria(summary(), { W: 5, I: 4 }), 5)).toBe(false);
    expect(met(evaluateCriteria(summary(), { W: 4, I: 4 }), 5)).toBe(true);
  });
  it('criterion 6 reports the extra cost and is always met', () => {
    const c6 = evaluateCriteria(summary()).find((c) => c.id === 6)!;
    expect(c6.met).toBe(true);
    expect(c6.detail).toContain('0.0040');
  });
  it('recommend needs criteria 1-5', () => {
    const ok = evaluateCriteria(summary(), { W: 3, I: 3 });
    expect(recommend(ok)).toBe(true);
    expect(recommend(evaluateCriteria(summary()))).toBe(false); // criterion 5 undefined
    const bad = ok.map((c) => (c.id === 4 ? { ...c, met: false } : c));
    expect(recommend(bad)).toBe(false);
    expect(recommend(ok.map((c) => (c.id === 6 ? { ...c, met: false } : c)))).toBe(true);
  });
});

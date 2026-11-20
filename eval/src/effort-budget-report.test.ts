import { describe, expect, it } from 'vitest';
import type { EbArm } from './effort-budget-arms.js';
import type { EbArmResult, EffortBudgetRecord } from './effort-budget-job.js';
import {
  doseCounts,
  doseVerdict,
  separateTurnCriteria,
  separateTurnPasses,
} from './effort-budget-report.js';

function arm(over: Partial<EbArmResult> = {}): EbArmResult {
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
    score: { passed: true } as EbArmResult['score'],
    turns: 1,
    infoSent: 0,
    request: ['m'],
    finalHash: 'h',
    ...over,
  };
}

let n = 0;
function mk(
  over: Partial<Omit<EffortBudgetRecord, 'arms'>> & {
    arms?: Partial<Record<EbArm, Partial<EbArmResult>>>;
  } = {},
): EffortBudgetRecord {
  const { arms = {}, ...rest } = over;
  return {
    scenarioId: `s${n}`,
    model: 'gpt-luna',
    repeat: ++n,
    ok: true,
    firstDraftFindingsByRule: { 'VR-018:warning': 1, 'VR-008:info': 2 },
    eligibleInfo: 2,
    hasVr018: true,
    sameRequestAs: { '0': '0', '1': '1', '2': '2', S: 'S' },
    arms: {
      '0': arm(arms['0']),
      '1': arm(arms['1']),
      '2': arm(arms['2']),
      S: arm(arms.S),
    },
    costUsd: 0.04,
    latencyMs: 1,
    calls: [],
    ...rest,
  };
}

const crit = (cs: ReturnType<typeof separateTurnCriteria>, id: number) =>
  cs.find((c) => c.id === id)!;

describe('separateTurnCriteria', () => {
  it('criterion 3 compares VR-018 fixes on VR-018 drafts only', () => {
    const fixes = (zero: boolean[], s: boolean[]) =>
      zero.map((z, i) => mk({ arms: { '0': { vr018Fixed: z }, S: { vr018Fixed: s[i] } } }));
    // A non-VR-018 draft must not count, whatever its flags say.
    const noise = mk({ hasVr018: false, arms: { '0': { vr018Fixed: true } } });
    const better = [...fixes([true, true, false], [true, true, true]), noise];
    expect(crit(separateTurnCriteria(better, 'gpt-luna', 1), 3).met).toBe(true);
    expect(crit(separateTurnCriteria(better, 'gpt-luna', 1), 3).detail).toContain('3 drafts');
    const worse = fixes([true, true, true], [true, true, false]);
    expect(crit(separateTurnCriteria(worse, 'gpt-luna', 1), 3).met).toBe(false);
  });

  it('criterion 4 fails when S leaves more unfixed', () => {
    const rs = [mk({ arms: { S: { unfixed: 1 } } }), mk()];
    expect(crit(separateTurnCriteria(rs, 'gpt-luna', 1), 4).met).toBe(false);
    const ok = [mk({ arms: { '0': { unfixed: 1 } } }), mk()];
    expect(crit(separateTurnCriteria(ok, 'gpt-luna', 1), 4).met).toBe(true);
  });

  it('criterion 2 needs errors + warnings not higher', () => {
    const rs = [mk({ arms: { S: { findingsByRule: { 'VR-004:warning': 1 } } } }), mk()];
    expect(crit(separateTurnCriteria(rs, 'gpt-luna', 1), 2).met).toBe(false);
  });

  it('criterion 6 states the share of jobs where S took two turns', () => {
    const rs = [mk({ arms: { S: { turns: 2 } } }), mk()];
    expect(crit(separateTurnCriteria(rs, 'gpt-luna', 1), 6).detail).toContain('1 of 2');
  });

  it('failed arms are excluded from pairs and do not throw', () => {
    const rs = [
      mk({ arms: { S: { ok: false, vr018Fixed: undefined } } }),
      mk({ ok: false, arms: undefined }),
      mk(),
    ];
    // mk always builds arms; strip them from the failed job explicitly.
    delete (rs[1] as { arms?: unknown }).arms;
    const cs = separateTurnCriteria(rs, 'gpt-luna', 1);
    expect(cs.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
    // The VR-018 draft where S failed stays in criterion 3's pool and counts as not fixed.
    expect(crit(cs, 3).detail).toContain('2 drafts');
    expect(crit(cs, 3).detail).toContain('S failed 1');
  });

  it('criterion 3 counts a failed S arm as not fixed', () => {
    const rs = [
      mk({ arms: { '0': { vr018Fixed: true }, S: { vr018Fixed: true } } }),
      mk({ arms: { '0': { vr018Fixed: true }, S: { ok: false, vr018Fixed: undefined } } }),
    ];
    const c = crit(separateTurnCriteria(rs, 'gpt-luna', 1), 3);
    expect(c.met).toBe(false);
    expect(c.detail).toContain('arm 0 2, S 1');
  });

  it('separateTurnPasses ignores criterion 6', () => {
    const base = [1, 2, 3, 4, 5].map((id) => ({ id: id as 1, met: true, detail: '' }));
    expect(separateTurnPasses([...base, { id: 6, met: false, detail: '' }])).toBe(true);
    expect(separateTurnPasses([{ ...base[0]!, met: false }, ...base.slice(1)])).toBe(false);
  });
});

describe('dose', () => {
  it('dose subset needs VR-018, at least 2 eligible info findings and arms 0-2 ok', () => {
    const rs = [
      mk({ arms: { '0': { vr018Fixed: true }, '1': { vr018Fixed: true } } }),
      mk({ eligibleInfo: 1 }),
      mk({ hasVr018: false }),
      mk({ arms: { '2': { ok: false } } }),
    ];
    const c = doseCounts(rs, 'gpt-luna');
    expect(c.drafts).toBe(1);
    expect(c.fixed).toEqual({ '0': 1, '1': 1, '2': 0 });
  });

  it.each([
    [{ '0': 10, '1': 8, '2': 6 }, 'supported'],
    [{ '0': 10, '1': 11, '2': 8 }, 'partly supported'],
    [{ '0': 6, '1': 7, '2': 6 }, 'not supported'],
    [{ '0': 7, '1': 6, '2': 5 }, 'partly supported'],
  ] as const)('doseVerdict %o is %s', (fixed, verdict) => {
    expect(doseVerdict({ drafts: 12, fixed })).toBe(verdict);
  });
});

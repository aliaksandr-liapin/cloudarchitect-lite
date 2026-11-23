import { describe, expect, it } from 'vitest';
import type { CleanTurnRecord, CtArm } from './clean-turn-job.js';
import {
  chooseCandidate,
  contextCounts,
  contextVerdict,
  armsIn,
  evaluateCandidates,
  PRIOR_NOISE,
  replicaNoise,
  type CandidateResult,
} from './clean-turn-report.js';
import type { EbArmResult } from './effort-budget-job.js';

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
  over: Partial<Omit<CleanTurnRecord, 'arms'>> & {
    arms?: Partial<Record<CtArm, Partial<EbArmResult>>>;
  } = {},
): CleanTurnRecord {
  const { arms = {}, ...rest } = over;
  return {
    scenarioId: `s${n}`,
    model: 'gpt-luna',
    repeat: ++n,
    ok: true,
    firstDraftFindingsByRule: { 'VR-018:warning': 1, 'VR-008:info': 2 },
    eligibleInfo: 2,
    hasVr018: true,
    kSplit: true,
    sSplit: true,
    sameRequestAs: { '0': '0', R: '0', KC: 'KC', KF: 'KF', SC: 'SC', SF: 'SF' },
    arms: {
      '0': arm(arms['0']),
      R: arm(arms.R),
      KC: arm(arms.KC),
      KF: arm(arms.KF),
      SC: arm(arms.SC),
      SF: arm(arms.SF),
    },
    costUsd: 0.06,
    latencyMs: 1,
    calls: [],
    ...rest,
  };
}

describe('contextVerdict', () => {
  it('needs the fresh turn to leave at least 3 fewer unfixed', () => {
    expect(contextVerdict({ jobs: 40, continued: 7, fresh: 4 })).toBe('supported');
    expect(contextVerdict({ jobs: 40, continued: 7, fresh: 5 })).toBe('partly supported');
    expect(contextVerdict({ jobs: 40, continued: 7, fresh: 7 })).toBe('not supported');
    expect(contextVerdict({ jobs: 40, continued: 3, fresh: 6 })).toBe('not supported');
  });
});

describe('contextCounts', () => {
  it('counts only split jobs where both modes succeeded (S: VR-018 drafts only)', () => {
    const rs = [
      mk({ arms: { SC: { unfixed: 2 }, SF: { unfixed: 0 }, KC: { unfixed: 1 } } }),
      mk({ sSplit: false, arms: { SC: { unfixed: 5 } } }),
      mk({ hasVr018: false, arms: { SC: { unfixed: 5 } } }),
      mk({ arms: { SF: { ok: false }, SC: { unfixed: 5 } } }),
      mk({ kSplit: false, arms: { KC: { unfixed: 9 } } }),
    ];
    expect(contextCounts(rs, 'gpt-luna', 'S')).toEqual({ jobs: 2, continued: 2, fresh: 0 });
    // K needs neither VR-018 nor a split S; only its own split and both K arms ok.
    expect(contextCounts(rs, 'gpt-luna', 'K')).toEqual({ jobs: 4, continued: 1, fresh: 0 });
  });
});

describe('replicaNoise', () => {
  it('measures arm 0 against R on jobs where arm 0 made a call', () => {
    const rs = [
      mk({ arms: { '0': { collateral: 1 }, R: { collateral: 3 } } }),
      mk({ arms: { '0': { collateral: 2 }, R: { collateral: 2 } } }),
      mk({ arms: { '0': { request: [] }, R: { collateral: 9 } } }),
      mk({
        sameRequestAs: { '0': '0', R: 'R', KC: 'KC', KF: 'KF', SC: 'SC', SF: 'SF' },
        arms: { R: { collateral: 9 } },
      }),
    ];
    const noise = replicaNoise(rs, 'gpt-luna');
    expect(noise.jobs).toBe(2);
    expect(noise.value).toBe(1);
  });
});

describe('evaluateCandidates', () => {
  it('checks KC, KF and SF against arm 0, never SC', () => {
    const rs = Array.from({ length: 6 }, () =>
      mk({
        arms: {
          '0': { findingsByRule: { 'VR-008:info': 1 } },
          KF: { findingsByRule: {} },
          KC: { findingsByRule: { 'VR-003:warning': 1, 'VR-008:info': 1 } },
          SF: { findingsByRule: { 'VR-008:info': 1 } },
        },
      }),
    );
    const out = evaluateCandidates(rs, 'gpt-luna', 1);
    expect(out.map((c) => c.arm)).toEqual(['KC', 'KF', 'SF']);
    expect(out.find((c) => c.arm === 'KF')!.passes).toBe(true);
    // KC: errors + warnings up (criterion 2).
    expect(out.find((c) => c.arm === 'KC')!.passes).toBe(false);
    // SF: info findings not down (criterion 1).
    expect(out.find((c) => c.arm === 'SF')!.passes).toBe(false);
  });
});

describe('chooseCandidate', () => {
  const c = (arm: CandidateResult['arm'], passes: boolean, ew: number, cost: number) =>
    ({ arm, passes, errorsWarnings: ew, costUsd: cost, criteria: [] }) as CandidateResult;

  it('picks the passing candidate with fewer errors + warnings, then the cheaper', () => {
    expect(chooseCandidate([c('KC', false, 0, 0), c('KF', false, 0, 0)])).toBeUndefined();
    expect(chooseCandidate([c('KC', true, 0.3, 0.004), c('KF', true, 0.2, 0.005)])).toBe('KF');
    expect(chooseCandidate([c('KC', true, 0.3, 0.004), c('SF', true, 0.3, 0.003)])).toBe('SF');
    expect(chooseCandidate([c('KC', false, 0.1, 0.001), c('KF', true, 0.3, 0.005)])).toBe('KF');
  });
});

describe('a confirmation run with arms 0 and SF only', () => {
  const only = (over: Parameters<typeof mk>[0] = {}) => {
    const r = mk(over);
    const { '0': zero, SF } = r.arms!;
    return { ...r, arms: { '0': zero, SF }, sameRequestAs: { '0': '0', SF: 'SF' } } as never;
  };

  it('finds the arms present and checks SF alone, with the prior noise floor', () => {
    const rs: CleanTurnRecord[] = Array.from({ length: 6 }, () =>
      only({
        arms: {
          '0': { findingsByRule: { 'VR-008:info': 1 }, collateral: 0 },
          SF: { findingsByRule: {}, collateral: 3 },
        },
      }),
    );
    expect(armsIn(rs)).toEqual(['0', 'SF']);
    const out = evaluateCandidates(rs, 'gpt-luna', 1);
    expect(out.map((c) => c.arm)).toEqual(['SF']);
    const c5 = out[0]!.criteria.find((c) => c.id === 5)!;
    expect(c5.detail).toContain(`noise floor ${PRIOR_NOISE.value!.toFixed(2)}`);
    // A collateral rise of 3 stays under the prior floor of 3.78.
    expect(out[0]!.passes).toBe(true);
  });
});

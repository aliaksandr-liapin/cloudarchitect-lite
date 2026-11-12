/**
 * Statistics and the six pre-registered decision criteria of the info-repair experiment.
 * Every comparison is paired by job (the two arms share one extraction and one first draft),
 * and a difference counts as "clear" only when its 90% bootstrap interval excludes zero.
 */
import type { Arm } from './info-repair-arms.js';
import type { InfoRepairRecord } from './info-repair-job.js';
import { rng } from './packets.js';

export interface Interval {
  mean: number;
  /** 5th percentile of the resampled means. */
  lo: number;
  /** 95th percentile of the resampled means. */
  hi: number;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** 90% percentile interval of the mean of `diffs`, from seeded resampling. No data gives zeros. */
export function pairedBootstrap(diffs: number[], seed: number, resamples = 2000): Interval {
  if (diffs.length === 0) return { mean: 0, lo: 0, hi: 0 };
  const rand = rng(seed);
  const n = diffs.length;
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rand() * n)]!;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    mean: mean(diffs),
    lo: means[Math.floor(0.05 * means.length)]!,
    hi: means[Math.ceil(0.95 * means.length) - 1]!,
  };
}

/** The interval excludes zero. */
export const isClear = (ci: { lo: number; hi: number }): boolean => ci.lo > 0 || ci.hi < 0;

export interface JobMetrics {
  /** Info findings in the arm's final design, VR-015 excluded. */
  info: number;
  /** VR-015 info findings in the final design (reported separately, never sent). */
  vr015: number;
  /** Error and warning findings in the final design. */
  errorsWarnings: number;
  /** 1 when the arm produced a design that passed its scenario; 0 otherwise, failures included. */
  passed: 0 | 1;
  /** Changes versus the first draft that no sent finding asked for. */
  collateral: number;
  /** Changes versus the first draft that target a sent finding. */
  targeted: number;
  /** New findings the repair introduced. */
  regressions: number;
  /** Extraction + draft + this arm's repair, in USD. */
  costUsd: number;
}

/** Metrics of one arm. A failed job or failed arm is all zeros and not passed; filter before diffing. */
export function jobMetrics(r: InfoRepairRecord, arm: Arm): JobMetrics {
  const a = r.arms?.[arm];
  const zero = { info: 0, vr015: 0, errorsWarnings: 0, collateral: 0, targeted: 0, regressions: 0 };
  if (!r.ok || !a) return { ...zero, passed: 0, costUsd: r.costUsd };
  if (!a.ok) return { ...zero, passed: 0, costUsd: a.costUsd };
  let info = 0;
  let vr015 = 0;
  let errorsWarnings = 0;
  for (const [key, n] of Object.entries(a.findingsByRule ?? {})) {
    if (key.endsWith(':error') || key.endsWith(':warning')) errorsWarnings += n;
    else if (key.endsWith(':info')) {
      if (key.startsWith('VR-015:')) vr015 += n;
      else info += n;
    }
  }
  return {
    info,
    vr015,
    errorsWarnings,
    passed: a.score?.passed ? 1 : 0,
    collateral: a.collateral,
    targeted: a.targeted,
    regressions: a.regressions,
    costUsd: a.costUsd,
  };
}

const bothOk = (r: InfoRepairRecord) => r.ok && !!r.arms && r.arms.W.ok && r.arms.I.ok;

export interface NoiseFloor {
  /** Mean |collateral(I) - collateral(W)| over same-request jobs; undefined when none exist. */
  value?: number;
  /** The value pools all models because this model had fewer than 10 such jobs. */
  pooled: boolean;
  /** Same-request jobs (both arms ok) the value rests on. */
  jobs: number;
}

/**
 * How much collateral differs between two arms that sent the identical request, i.e. pure
 * run-to-run noise, in the same unit as criterion 3.
 */
export function noiseFloor(records: InfoRepairRecord[], model: string): NoiseFloor {
  const noise = (rs: InfoRepairRecord[]) =>
    rs
      .filter((r) => r.sameRequest && bothOk(r))
      .map((r) => Math.abs(jobMetrics(r, 'I').collateral - jobMetrics(r, 'W').collateral));
  const own = noise(records.filter((r) => r.model === model));
  if (own.length >= 10) return { value: mean(own), pooled: false, jobs: own.length };
  const all = noise(records);
  return { value: all.length ? mean(all) : undefined, pooled: true, jobs: all.length };
}

export type MetricKey = keyof JobMetrics;

/** Per-model results for Task 6's report. */
export interface ModelArmSummary {
  model: string;
  /** All of the model's jobs, failed ones included. */
  jobs: number;
  /** Jobs where both arms succeeded; every diff, and every mean except `passed`, uses exactly these. */
  pairedJobs: number;
  /** Jobs where extraction or the draft failed (no arms ran). */
  failedJobs: number;
  /** Jobs that got as far as the arms but where that arm's repair failed. */
  failedArms: { W: number; I: number };
  /**
   * Arm W means. Every field except `passed` is over the paired jobs; `passed` is a pass rate
   * over all `jobs`, counting failed jobs and failed arms as not passed.
   */
  meanW: JobMetrics;
  /** Arm I means, over the same sets as `meanW`. */
  meanI: JobMetrics;
  /** Paired bootstrap of I minus W over the paired jobs (for `passed`, the difference of 0/1 flags). */
  diff: Record<
    'info' | 'errorsWarnings' | 'passed' | 'collateral' | 'regressions' | 'costUsd',
    Interval
  >;
  noiseFloor: NoiseFloor;
}

const METRICS: MetricKey[] = [
  'info',
  'vr015',
  'errorsWarnings',
  'passed',
  'collateral',
  'targeted',
  'regressions',
  'costUsd',
];

export function summarizeModel(
  records: InfoRepairRecord[],
  model: string,
  seed: number,
): ModelArmSummary {
  const mine = records.filter((r) => r.model === model);
  const paired = mine.filter(bothOk);
  const means = (arm: Arm): JobMetrics => {
    const out = {} as Record<MetricKey, number>;
    for (const k of METRICS) {
      const pool = k === 'passed' ? mine : paired;
      out[k] = mean(pool.map((r) => jobMetrics(r, arm)[k]));
    }
    return out as unknown as JobMetrics;
  };
  const diffOf = (k: MetricKey) =>
    pairedBootstrap(
      paired.map((r) => jobMetrics(r, 'I')[k] - jobMetrics(r, 'W')[k]),
      seed,
    );
  return {
    model,
    jobs: mine.length,
    pairedJobs: paired.length,
    failedJobs: mine.filter((r) => !r.ok).length,
    failedArms: {
      W: mine.filter((r) => r.ok && r.arms && !r.arms.W.ok).length,
      I: mine.filter((r) => r.ok && r.arms && !r.arms.I.ok).length,
    },
    meanW: means('W'),
    meanI: means('I'),
    diff: {
      info: diffOf('info'),
      errorsWarnings: diffOf('errorsWarnings'),
      passed: diffOf('passed'),
      collateral: diffOf('collateral'),
      regressions: diffOf('regressions'),
      costUsd: diffOf('costUsd'),
    },
    noiseFloor: noiseFloor(records, model),
  };
}

export interface CriterionResult {
  id: 1 | 2 | 3 | 4 | 5 | 6;
  /** undefined when the data to decide is missing. */
  met: boolean | undefined;
  detail: string;
}

const f = (n: number, d = 2) => n.toFixed(d);
const range = (ci: Interval) => `${f(ci.mean)} [${f(ci.lo)}, ${f(ci.hi)}]`;

/** The six pre-registered criteria for one model. `blind` holds blind-review wins for W and I. */
export function evaluateCriteria(
  s: ModelArmSummary,
  blind?: { W: number; I: number },
): CriterionResult[] {
  const noData = s.pairedJobs === 0;
  const none = (id: CriterionResult['id']): CriterionResult => ({
    id,
    met: undefined,
    detail: 'no jobs where both arms succeeded',
  });

  let c1: CriterionResult;
  if (s.meanW.info === 0) {
    c1 = { id: 1, met: false, detail: 'arm W has no info findings left: nothing to reduce' };
  } else {
    const ratio = s.meanI.info / s.meanW.info;
    const clear = isClear(s.diff.info) && s.diff.info.mean < 0;
    c1 = {
      id: 1,
      met: ratio <= 2 / 3 && clear,
      detail: `info I/W = ${f(ratio)} (need <= 0.67); diff ${range(s.diff.info)}${clear ? '' : ' is not clearly negative'}`,
    };
  }

  const ewWorse = s.diff.errorsWarnings.lo > 0;
  const passWorse = s.diff.passed.hi < 0;
  const c2: CriterionResult = noData
    ? none(2)
    : {
        id: 2,
        met: !ewWorse && !passWorse,
        detail: `errors+warnings diff ${range(s.diff.errorsWarnings)}${ewWorse ? ' (clearly worse)' : ''}; passed diff ${range(s.diff.passed)}${passWorse ? ' (clearly worse)' : ''}`,
      };

  const floor = s.noiseFloor.value;
  const c3: CriterionResult = noData
    ? none(3)
    : {
        id: 3,
        met: !(s.diff.collateral.lo > (floor ?? 0)),
        detail:
          floor === undefined
            ? `collateral diff ${range(s.diff.collateral)}; no noise floor, so any clear rise fails`
            : `collateral diff ${range(s.diff.collateral)} vs noise floor ${f(floor)}${s.noiseFloor.pooled ? ' (pooled)' : ''} from ${s.noiseFloor.jobs} jobs`,
      };

  const c4: CriterionResult = noData
    ? none(4)
    : {
        id: 4,
        met: !(s.diff.regressions.lo > 0),
        detail: `regressions diff ${range(s.diff.regressions)}`,
      };

  const c5: CriterionResult = blind
    ? {
        id: 5,
        met: blind.I >= blind.W,
        detail: `blind review: I ${blind.I}, W ${blind.W}`,
      }
    : { id: 5, met: undefined, detail: 'no blind review data' };

  const c6: CriterionResult = {
    id: 6,
    met: true,
    detail: `extra cost per design: ${f(s.diff.costUsd.mean, 4)} USD`,
  };

  return [c1, c2, c3, c4, c5, c6];
}

/** Recommend the change only when criteria 1-5 are all met (criterion 6 is informational). */
export const recommend = (criteria: CriterionResult[]): boolean =>
  [1, 2, 3, 4, 5].every((id) => criteria.find((c) => c.id === id)?.met === true);

/**
 * The effort-budget experiment's pre-registered bar and dose verdict
 * (docs/superpowers/specs/2026-11-20-effort-budget-experiment-design.md). Arm S is compared with
 * arm 0 through the info-repair statistics (W = arm 0, I = arm S). Free: reads saved records only.
 *
 * Usage: pnpm --filter @cloudarchitect/eval effort-budget-report <absolute run dir> [--model gpt-luna] [--seed 1]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { EB_ARMS, type EbArm } from './effort-budget-arms.js';
import { toPairRecord, type ArmJobRecord, type EffortBudgetRecord } from './effort-budget-job.js';
import {
  evaluateCriteria,
  pairedBootstrap,
  summarizeModel,
  type CriterionResult,
  type NoiseFloor,
} from './info-repair-stats.js';

const f = (n: number, d = 2) => n.toFixed(d);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const pairOk = <A extends string>(r: ArmJobRecord<A>, a: A, b: A) =>
  r.ok && !!r.arms && r.arms[a].ok && r.arms[b].ok;

/**
 * The six criteria for candidate `arm` against arm 0; the candidate replaces today's repair only
 * if 1-5 are all met. `noise` replaces the noise floor computed from same-request pairs.
 */
export function candidateCriteria<A extends string>(
  records: ArmJobRecord<A>[],
  model: string,
  seed: number,
  arm: A,
  noise?: NoiseFloor,
): CriterionResult[] {
  const zero = '0' as A;
  const mine = records.filter((r) => r.model === model);
  const summary = summarizeModel(
    mine.map((r) => toPairRecord(r as ArmJobRecord<string>, arm, zero)),
    model,
    seed,
  );
  const s = noise ? { ...summary, noiseFloor: noise } : summary;
  const base = evaluateCriteria(s);
  const pick = (id: CriterionResult['id']) => base.find((c) => c.id === id)!;
  const paired = mine.filter((r) => pairOk(r, zero, arm));
  const ew = s.diff.errorsWarnings;

  // Every VR-018 draft counts; an arm that failed counts as not fixed (the user would get the draft back).
  const vrPool = mine.filter((r) => r.ok && !!r.arms && r.hasVr018);
  const fixed0 = vrPool.filter((r) => r.arms![zero].vr018Fixed === true).length;
  const fixedArm = vrPool.filter((r) => r.arms![arm].vr018Fixed === true).length;
  const failed0 = vrPool.filter((r) => !r.arms![zero].ok).length;
  const failedArm = vrPool.filter((r) => !r.arms![arm].ok).length;

  const unfixedDiffs = paired.map(
    (r) => (r.arms![arm].unfixed ?? 0) - (r.arms![zero].unfixed ?? 0),
  );
  const unfixed = unfixedDiffs.length ? pairedBootstrap(unfixedDiffs, seed) : undefined;

  const c3 = pick(3);
  const c4 = pick(4);
  const twoTurns = paired.filter((r) => r.arms![arm].turns === 2).length;
  return [
    pick(1),
    {
      id: 2,
      met: s.pairedJobs > 0 && ew.mean <= 0,
      detail: `errors+warnings per design 0 ${f(s.meanW.errorsWarnings)} -> ${arm} ${f(s.meanI.errorsWarnings)}; diff ${f(ew.mean)} [${f(ew.lo)}, ${f(ew.hi)}] (need mean <= 0)`,
    },
    {
      id: 3,
      met: vrPool.length > 0 && fixedArm >= fixed0,
      detail: `VR-018 fixed on ${vrPool.length} drafts with VR-018: arm 0 ${fixed0}, ${arm} ${fixedArm} (failed arms count as not fixed: arm 0 failed ${failed0}, ${arm} failed ${failedArm})`,
    },
    {
      id: 4,
      met: unfixed !== undefined && unfixed.mean <= 0,
      detail: unfixed
        ? `left unfixed per design 0 ${f(mean(paired.map((r) => r.arms![zero].unfixed ?? 0)))} -> ${arm} ${f(mean(paired.map((r) => r.arms![arm].unfixed ?? 0)))}; diff ${f(unfixed.mean)} [${f(unfixed.lo)}, ${f(unfixed.hi)}] (need mean <= 0)`
        : 'no jobs where both arms succeeded',
    },
    { id: 5, met: c3.met === true && c4.met === true, detail: `${c3.detail}; ${c4.detail}` },
    {
      id: 6,
      met: true,
      detail: `extra cost per design: ${f(s.diff.costUsd.mean, 4)} USD; ${arm} took two turns in ${twoTurns} of ${paired.length} jobs`,
    },
  ];
}

/** The six criteria for arm S of the effort-budget run. */
export const separateTurnCriteria = (
  records: EffortBudgetRecord[],
  model: string,
  seed: number,
): CriterionResult[] => candidateCriteria<EbArm>(records, model, seed, 'S');

export const separateTurnPasses = (criteria: CriterionResult[]): boolean =>
  [1, 2, 3, 4, 5].every((id) => criteria.find((c) => c.id === id)?.met === true);

export interface DoseCounts {
  drafts: number;
  fixed: Record<'0' | '1' | '2', number>;
}

/** VR-018 fixes per dose arm on drafts with VR-018 and at least 2 eligible info findings. */
export function doseCounts(records: EffortBudgetRecord[], model: string): DoseCounts {
  const pool = records.filter(
    (r) =>
      r.model === model &&
      r.ok &&
      r.hasVr018 &&
      r.eligibleInfo >= 2 &&
      !!r.arms &&
      r.arms['0'].ok &&
      r.arms['1'].ok &&
      r.arms['2'].ok,
  );
  const fixed = (a: '0' | '1' | '2') => pool.filter((r) => r.arms![a].vr018Fixed).length;
  return { drafts: pool.length, fixed: { '0': fixed('0'), '1': fixed('1'), '2': fixed('2') } };
}

/** The prediction written before the run: the fix rate falls at each step, 0 above 2 by >= 3. */
export function doseVerdict(c: DoseCounts): 'supported' | 'partly supported' | 'not supported' {
  const { '0': z, '1': one, '2': two } = c.fixed;
  if (z <= two) return 'not supported';
  return z >= one && one >= two && z - two >= 3 ? 'supported' : 'partly supported';
}

const hasRule = (byRule: Record<string, number> | undefined, rule: string) =>
  Object.keys(byRule ?? {}).some((k) => k.startsWith(`${rule}:`));

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values, positionals } = parseArgs({
    options: {
      model: { type: 'string', default: 'gpt-luna' },
      seed: { type: 'string', default: '1' },
    },
    allowPositionals: true,
  });
  const dir = positionals[0];
  if (!dir)
    throw new Error('Usage: effort-budget-report <absolute run dir> [--model m] [--seed 1]');
  const records = JSON.parse(
    readFileSync(join(dir, 'records.json'), 'utf8'),
  ) as EffortBudgetRecord[];
  const model = values.model;
  const mine = records.filter((r) => r.model === model);
  const ok = mine.filter((r) => r.ok && r.arms);
  console.log(
    `${model}: ${mine.length} jobs, ${ok.length} ok, ${mine.length - ok.length} failed; ` +
      `failed arms: ${EB_ARMS.map((a) => `${a} ${ok.filter((r) => !r.arms![a].ok).length}`).join(', ')}`,
  );
  for (const a of EB_ARMS) {
    const rs = ok.filter((r) => r.arms![a].ok);
    const m = (pick: (r: EffortBudgetRecord) => number) => f(mean(rs.map(pick)));
    const sev = (r: EffortBudgetRecord, suffix: string) =>
      Object.entries(r.arms![a].findingsByRule ?? {})
        .filter(([k]) => k.endsWith(suffix) && !(suffix === ':info' && k.startsWith('VR-015:')))
        .reduce((x, [, v]) => x + v, 0);
    const vr = ok.filter((r) => r.hasVr018 && r.arms![a].ok);
    console.log(
      `arm ${a}: errors+warnings ${m((r) => sev(r, ':error') + sev(r, ':warning'))}, info ${m((r) => sev(r, ':info'))}, ` +
        `unfixed ${m((r) => r.arms![a].unfixed ?? 0)} per design; ` +
        `VR-008 in ${rs.filter((r) => hasRule(r.arms![a].findingsByRule, 'VR-008')).length}/${rs.length}, ` +
        `VR-018 in ${rs.filter((r) => hasRule(r.arms![a].findingsByRule, 'VR-018')).length}/${rs.length}; ` +
        `VR-018 fixed ${vr.filter((r) => r.arms![a].vr018Fixed).length}/${vr.length} drafts; ` +
        `$${f(mean(rs.map((r) => r.arms![a].costUsd)), 4)} per design`,
    );
  }
  const dose = doseCounts(records, model);
  console.log(
    `dose subset (VR-018 + >= 2 eligible info): ${dose.drafts} drafts; VR-018 fixed 0 ${dose.fixed['0']}, 1 ${dose.fixed['1']}, 2 ${dose.fixed['2']} -> ${doseVerdict(dose)}`,
  );
  const criteria = separateTurnCriteria(records, model, Number(values.seed));
  for (const c of criteria) console.log(`${c.id}. ${c.met ? 'met' : 'NOT met'}: ${c.detail}`);
  console.log(
    separateTurnPasses(criteria)
      ? "Result: S replaces today's repair for Luna."
      : 'Result: S fails; Luna keeps errors and warnings only.',
  );
}

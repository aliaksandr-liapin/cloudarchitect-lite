/**
 * The clean-turn experiment's pre-registered bar and context verdict
 * (docs/superpowers/specs/2026-11-23-clean-turn-experiment-design.md). Candidates KC, KF and SF
 * are each compared with arm 0 on the effort-budget criteria; the collateral noise floor comes from
 * arm R (an independent second call of arm 0's request). Free: reads saved records only.
 *
 * Usage: pnpm --filter @cloudarchitect/eval clean-turn-report <absolute run dir> [--model gpt-luna] [--seed 1]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CT_ARMS, CT_CANDIDATES, type CleanTurnRecord, type CtArm } from './clean-turn-job.js';
import { toPairRecord } from './effort-budget-job.js';
import { candidateCriteria, separateTurnPasses } from './effort-budget-report.js';
import { noiseFloor, type CriterionResult, type NoiseFloor } from './info-repair-stats.js';

type Candidate = (typeof CT_CANDIDATES)[number];

const f = (n: number, d = 2) => n.toFixed(d);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const sev = (byRule: Record<string, number> | undefined, suffix: string) =>
  Object.entries(byRule ?? {})
    .filter(([k]) => k.endsWith(suffix) && !(suffix === ':info' && k.startsWith('VR-015:')))
    .reduce((x, [, v]) => x + v, 0);
const errorsWarnings = (byRule: Record<string, number> | undefined) =>
  sev(byRule, ':error') + sev(byRule, ':warning');

/** Collateral noise: arm 0 vs its independent replica R, on jobs where arm 0 made a call. */
export const replicaNoise = (records: CleanTurnRecord[], model: string): NoiseFloor =>
  noiseFloor(
    records.map((r) => toPairRecord(r, 'R')),
    model,
  );

/**
 * The noise floor of run 2026-11-23T17-42-38-611Z (arm 0 vs R, 89 jobs), used by a confirmation
 * run that skips R (fixed before that run; see the spec's "Confirmation run").
 */
export const PRIOR_NOISE: NoiseFloor = { value: 3.7752808988764044, pooled: false, jobs: 89 };

/** The arms present in a run's records (a confirmation run has only some). */
export const armsIn = (records: CleanTurnRecord[]): CtArm[] =>
  CT_ARMS.filter((a) => records.some((r) => r.arms && a in r.arms));

export interface ContextCounts {
  /** Jobs where both modes made their own turn 2 and both succeeded. */
  jobs: number;
  /** First-draft errors and warnings left unfixed, summed over those jobs. */
  continued: number;
  fresh: number;
}

/** Left-unfixed sums for the S pair (VR-018 drafts) or the K pair, on jobs where turn 2 split. */
export function contextCounts(
  records: CleanTurnRecord[],
  model: string,
  pair: 'S' | 'K',
): ContextCounts {
  const [c, fr]: [CtArm, CtArm] = pair === 'S' ? ['SC', 'SF'] : ['KC', 'KF'];
  const pool = records.filter(
    (r) =>
      r.model === model &&
      r.ok &&
      !!r.arms &&
      (pair === 'S' ? r.hasVr018 && r.sSplit : r.kSplit) &&
      r.arms[c].ok &&
      r.arms[fr].ok,
  );
  const sum = (a: CtArm) => pool.reduce((x, r) => x + (r.arms![a].unfixed ?? 0), 0);
  return { jobs: pool.length, continued: sum(c), fresh: sum(fr) };
}

/** The prediction written before the run: a fresh turn 2 leaves at least 3 fewer unfixed. */
export function contextVerdict(
  c: ContextCounts,
): 'supported' | 'partly supported' | 'not supported' {
  if (c.fresh >= c.continued) return 'not supported';
  return c.continued - c.fresh >= 3 ? 'supported' : 'partly supported';
}

export interface CandidateResult {
  arm: Candidate;
  criteria: CriterionResult[];
  passes: boolean;
  /** Means over the jobs where the arm succeeded, for the tie-break. */
  errorsWarnings: number;
  costUsd: number;
}

export function evaluateCandidates(
  records: CleanTurnRecord[],
  model: string,
  seed: number,
): CandidateResult[] {
  const present = armsIn(records);
  const noise = present.includes('R') ? replicaNoise(records, model) : PRIOR_NOISE;
  const mine = records.filter((r) => r.model === model && r.ok && r.arms);
  return CT_CANDIDATES.filter((a) => present.includes(a)).map((arm) => {
    const criteria = candidateCriteria<CtArm>(records, model, seed, arm, noise);
    const ok = mine.filter((r) => r.arms![arm].ok);
    return {
      arm,
      criteria,
      passes: separateTurnPasses(criteria),
      errorsWarnings: mean(ok.map((r) => errorsWarnings(r.arms![arm].findingsByRule))),
      costUsd: mean(ok.map((r) => r.arms![arm].costUsd)),
    };
  });
}

/** The fixed choice: among passing candidates, fewer errors + warnings, then the cheaper. */
export function chooseCandidate(results: CandidateResult[]): Candidate | undefined {
  return results
    .filter((r) => r.passes)
    .sort((a, b) => a.errorsWarnings - b.errorsWarnings || a.costUsd - b.costUsd)[0]?.arm;
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
  if (!dir) throw new Error('Usage: clean-turn-report <absolute run dir> [--model m] [--seed 1]');
  const records = JSON.parse(readFileSync(join(dir, 'records.json'), 'utf8')) as CleanTurnRecord[];
  const model = values.model;
  const mine = records.filter((r) => r.model === model);
  const ok = mine.filter((r) => r.ok && r.arms);
  const present = armsIn(records);
  console.log(
    `${model}: ${mine.length} jobs, ${ok.length} ok, ${mine.length - ok.length} failed; ` +
      `failed arms: ${present.map((a) => `${a} ${ok.filter((r) => !r.arms![a].ok).length}`).join(', ')}; ` +
      `turn 2 split: K ${ok.filter((r) => r.kSplit).length}, S ${ok.filter((r) => r.sSplit).length}`,
  );
  for (const a of present) {
    const rs = ok.filter((r) => r.arms![a].ok);
    const m = (pick: (r: CleanTurnRecord) => number) => f(mean(rs.map(pick)));
    const vr = ok.filter((r) => r.hasVr018 && r.arms![a].ok);
    console.log(
      `arm ${a}: errors+warnings ${m((r) => errorsWarnings(r.arms![a].findingsByRule))}, ` +
        `info ${m((r) => sev(r.arms![a].findingsByRule, ':info'))}, ` +
        `unfixed ${m((r) => r.arms![a].unfixed ?? 0)}, collateral ${m((r) => r.arms![a].collateral)} per design; ` +
        `VR-008 in ${rs.filter((r) => hasRule(r.arms![a].findingsByRule, 'VR-008')).length}/${rs.length}, ` +
        `VR-018 in ${rs.filter((r) => hasRule(r.arms![a].findingsByRule, 'VR-018')).length}/${rs.length}, ` +
        `VR-003 in ${rs.filter((r) => hasRule(r.arms![a].findingsByRule, 'VR-003')).length}/${rs.length}; ` +
        `VR-018 fixed ${vr.filter((r) => r.arms![a].vr018Fixed).length}/${vr.length} drafts; ` +
        `$${f(mean(rs.map((r) => r.arms![a].costUsd)), 4)} per design`,
    );
  }
  const noise = present.includes('R') ? replicaNoise(records, model) : PRIOR_NOISE;
  console.log(
    `noise floor${present.includes('R') ? ' (arm 0 vs replica R)' : ' (prior run, fixed in advance)'}: ${noise.value === undefined ? 'none' : f(noise.value)} from ${noise.jobs} jobs`,
  );
  if (present.includes('SC') && present.includes('SF')) {
    const s = contextCounts(records, model, 'S');
    console.log(
      `context, S pair (VR-018 drafts, turn 2 split): ${s.jobs} jobs; left unfixed continued ${s.continued}, fresh ${s.fresh} -> ${contextVerdict(s)}`,
    );
  }
  if (present.includes('KC') && present.includes('KF')) {
    const k = contextCounts(records, model, 'K');
    console.log(
      `context, K pair (turn 2 split, no verdict): ${k.jobs} jobs; left unfixed continued ${k.continued}, fresh ${k.fresh}`,
    );
  }
  const results = evaluateCandidates(records, model, Number(values.seed));
  for (const r of results) {
    console.log(`candidate ${r.arm}: ${r.passes ? 'PASSES' : 'fails'}`);
    for (const c of r.criteria) console.log(`  ${c.id}. ${c.met ? 'met' : 'NOT met'}: ${c.detail}`);
  }
  const chosen = chooseCandidate(results);
  console.log(
    chosen
      ? `Result: ${chosen} becomes the proposal for Luna (its own PR).`
      : 'Result: no candidate passes; Luna keeps errors and warnings only.',
  );
}

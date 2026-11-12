/**
 * Info-repair experiment report: renders saved records (and, optionally, blind-review results) as
 * Markdown. No API calls.
 * Usage: pnpm --filter @cloudarchitect/eval info-repair-report <runId-or-dir> [--review <dir>] [--seed 1]
 * --review is the eval/reviews/info-repair-<date> folder written by `review --arms`; without it
 * criterion 5 is undecided and no model gets a recommendation.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { InfoRepairRecord } from './info-repair-job.js';
import {
  evaluateCriteria,
  isClear,
  jobMetrics,
  pairedBootstrap,
  recommend,
  summarizeModel,
  type Interval,
  type MetricKey,
} from './info-repair-stats.js';
import { ruleHitTable } from './rule-hits.js';

export interface ReportInput {
  records: InfoRepairRecord[];
  summary: { cutShort: boolean; spentUsd: number };
  /** Blind-review model summaries, keyed `<model>~W` / `<model>~I`. */
  blind?: Record<string, { blindScore: number }>;
  /** False when the review panel was cut short: criterion 5 is then undecided. Default true. */
  blindComplete?: boolean;
  seed: number;
}

const f = (n: number, d = 2) => n.toFixed(d);
const ci = (x: Interval, d = 2) =>
  `${f(x.mean, d)} [${f(x.lo, d)}, ${f(x.hi, d)}]${isClear(x) ? ' *' : ''}`;

const ROWS: { key: MetricKey; label: string; digits?: number }[] = [
  { key: 'info', label: 'Info findings (excl. VR-015)' },
  { key: 'vr015', label: 'VR-015 info findings' },
  { key: 'errorsWarnings', label: 'Errors + warnings' },
  { key: 'passed', label: 'Pass rate' },
  { key: 'targeted', label: 'Targeted changes' },
  { key: 'collateral', label: 'Collateral changes' },
  { key: 'regressions', label: 'Regressions' },
  { key: 'costUsd', label: 'Cost per design (USD)', digits: 4 },
];

export function renderReport(input: ReportInput): string {
  const { records, summary, blind, blindComplete = true, seed } = input;
  const models = [...new Set(records.map((r) => r.model))];
  const out: string[] = [
    '# Info-repair experiment report',
    '',
    `Spent: ${f(summary.spentUsd, 4)} USD${summary.cutShort ? ' (run stopped at its cap)' : ''}. Seed ${seed}. Intervals are 90% paired bootstrap over jobs; * marks an interval that excludes zero.`,
    '',
  ];
  for (const model of models) {
    const mine = records.filter((r) => r.model === model);
    const s = summarizeModel(records, model, seed);
    const paired = mine.filter((r) => r.ok && r.arms?.W.ok && r.arms.I.ok);
    const withArms = mine.filter((r) => r.ok && r.arms);
    const sameRequest = mine.filter((r) => r.sameRequest).length;
    const infoOnly = withArms.filter((r) => !r.arms!.W.repaired && r.arms!.I.repaired).length;
    const nothing = withArms.filter((r) => !r.arms!.W.repaired && !r.arms!.I.repaired).length;
    out.push(
      `## ${model}`,
      '',
      `- Jobs: ${s.jobs}; failed jobs: ${s.failedJobs}; failed arms (W/I): ${s.failedArms.W}/${s.failedArms.I}; paired jobs: ${s.pairedJobs}`,
      `- sameRequest jobs: ${sameRequest}; info-only jobs (W not repaired): ${infoOnly}; nothing-to-repair jobs: ${nothing}`,
      '',
      '| Metric | Arm W | Arm I | I−W (90% interval) |',
      '| --- | --- | --- | --- |',
    );
    for (const row of ROWS) {
      const d = row.digits ?? 2;
      // summarizeModel owns the pool rule; only the two metrics it does not diff are bootstrapped here.
      const diff =
        row.key in s.diff
          ? s.diff[row.key as keyof typeof s.diff]
          : pairedBootstrap(
              paired.map((r) => jobMetrics(r, 'I')[row.key] - jobMetrics(r, 'W')[row.key]),
              seed,
            );
      out.push(
        `| ${row.label} | ${f(s.meanW[row.key], d)} | ${f(s.meanI[row.key], d)} | ${ci(diff, d)} |`,
      );
    }
    const nf = s.noiseFloor;
    out.push(
      '',
      `Noise floor (mean per-job |difference| between two identical repairs): ${nf.value === undefined ? 'n/a' : f(nf.value)}; ${nf.pooled ? 'pooled across models' : 'not pooled (this model alone)'}; rests on ${nf.jobs} jobs.`,
      '',
      'Rule hits, final design, arm W:',
      '',
      ruleHitTable(
        withArms.map((r) => ({
          model: r.model,
          ok: r.arms!.W.ok,
          findingsByRule: r.arms!.W.findingsByRule,
        })),
        'findingsByRule',
        [model],
      ),
      '',
      'Rule hits, final design, arm I:',
      '',
      ruleHitTable(
        withArms.map((r) => ({
          model: r.model,
          ok: r.arms!.I.ok,
          findingsByRule: r.arms!.I.findingsByRule,
        })),
        'findingsByRule',
        [model],
      ),
      '',
    );
    const w = blind?.[`${model}~W`]?.blindScore;
    const i = blind?.[`${model}~I`]?.blindScore;
    const criteria = evaluateCriteria(
      s,
      blindComplete && w !== undefined && i !== undefined ? { W: w, I: i } : undefined,
    ).map((c) =>
      c.id === 5 && !blindComplete ? { ...c, met: undefined, detail: 'partial review panel' } : c,
    );
    const undecided = criteria.filter((c) => c.id <= 5 && c.met === undefined).map((c) => c.id);
    for (const c of criteria) {
      out.push(
        `- Criterion ${c.id}: ${c.met === undefined ? 'undecided' : c.met ? 'met' : 'not met'}. ${c.detail}`,
      );
      if (c.id === 3 && s.pairedJobs > 0)
        out.push(
          `  - collateral I−W lower bound vs noise floor (mean per-job |difference| between two identical repairs): ${f(s.diff.collateral.lo)} vs ${nf.value === undefined ? 'n/a' : f(nf.value)}; noise floor ${nf.pooled ? 'pooled' : 'not pooled'}, ${nf.jobs} jobs`,
        );
    }
    out.push(
      '',
      summary.cutShort
        ? 'Recommendation: partial run: no recommendation.'
        : undecided.length
          ? `Recommendation: undecided (criterion ${undecided.join(', ')} has no data).`
          : recommend(criteria)
            ? 'Recommendation: adopt arm I (criteria 1-5 met).'
            : 'Recommendation: keep arm W (criteria 1-5 not all met).',
      '',
    );
  }
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = new URL('..', import.meta.url).pathname;
  const { values, positionals } = parseArgs({
    options: { review: { type: 'string' }, seed: { type: 'string', default: '1' } },
    allowPositionals: true,
  });
  const run = positionals[0];
  if (!run) {
    console.error(
      'Usage: pnpm --filter @cloudarchitect/eval info-repair-report <runId-or-dir> [--review <dir>] [--seed 1]',
    );
    process.exit(1);
  }
  const seed = Number(values.seed);
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  const dir =
    isAbsolute(run) || run.includes('/') ? resolve(run) : join(root, 'results', 'live', run);
  const read = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;
  const records = read<InfoRepairRecord[]>(join(dir, 'records.json'));
  const summary = read<{ cutShort: boolean; spentUsd: number }>(join(dir, 'summary.json'));
  const review = values.review
    ? read<{ models: Record<string, { blindScore: number }>; complete?: boolean }>(
        join(resolve(values.review), 'summary.json'),
      )
    : undefined;
  console.log(
    renderReport({
      records,
      summary,
      blind: review?.models,
      blindComplete: review ? review.complete !== false : undefined,
      seed,
    }),
  );
}

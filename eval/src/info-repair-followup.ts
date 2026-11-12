/**
 * The Luna follow-up's pre-registered bar (docs/superpowers/specs/2026-11-12-info-repair-followup-design.md):
 * arm I carries the prioritized ("warnings first") message and is compared with arm W.
 *
 * Usage: pnpm --filter @cloudarchitect/eval info-repair-followup <absolute run dir> [--model gpt-luna] [--seed 1]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { InfoRepairRecord } from './info-repair-job.js';
import { evaluateCriteria, summarizeModel, type CriterionResult } from './info-repair-stats.js';

const hasRule = (byRule: Record<string, number> | undefined, rule: string) =>
  Object.keys(byRule ?? {}).some((k) => k.startsWith(`${rule}:`));

/**
 * Drafts where `rule` fired and info findings were sent (both arms ok), and in how many of them
 * each arm's final design no longer has the rule.
 */
export function ruleFixCounts(
  records: InfoRepairRecord[],
  model: string,
  rule: string,
): { drafts: number; W: number; I: number } {
  const pool = records.filter(
    (r) =>
      r.model === model &&
      r.ok &&
      r.infoSent > 0 &&
      r.arms?.W.ok &&
      r.arms.I.ok &&
      hasRule(r.firstDraftFindingsByRule, rule),
  );
  return {
    drafts: pool.length,
    W: pool.filter((r) => !hasRule(r.arms!.W.findingsByRule, rule)).length,
    I: pool.filter((r) => !hasRule(r.arms!.I.findingsByRule, rule)).length,
  };
}

const f = (n: number, d = 2) => n.toFixed(d);

/** The five follow-up criteria; P (arm I) replaces the adopted message only if 1-4 are all met. */
export function followupCriteria(
  records: InfoRepairRecord[],
  model: string,
  seed: number,
): CriterionResult[] {
  const s = summarizeModel(records, model, seed);
  const first = evaluateCriteria(s);
  const pick = (id: CriterionResult['id']) => first.find((c) => c.id === id)!;
  const ew = s.diff.errorsWarnings;
  const vr018 = ruleFixCounts(records, model, 'VR-018');
  const c3 = pick(3);
  const c4 = pick(4);
  return [
    pick(1),
    {
      id: 2,
      met: s.pairedJobs > 0 && ew.mean <= 0,
      detail: `errors+warnings per design W ${f(s.meanW.errorsWarnings)} -> P ${f(s.meanI.errorsWarnings)}; diff ${f(ew.mean)} [${f(ew.lo)}, ${f(ew.hi)}] (need mean <= 0)`,
    },
    {
      id: 3,
      met: vr018.I >= vr018.W,
      detail: `VR-018 fixed on ${vr018.drafts} drafts with VR-018 and info sent: W ${vr018.W}, P ${vr018.I}`,
    },
    {
      id: 4,
      met: c3.met === true && c4.met === true,
      detail: `${c3.detail}; ${c4.detail}`,
    },
    { ...pick(6), id: 5 },
  ];
}

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
    throw new Error('Usage: info-repair-followup <absolute run dir> [--model m] [--seed 1]');
  const records = JSON.parse(readFileSync(join(dir, 'records.json'), 'utf8')) as InfoRepairRecord[];
  const model = values.model;
  const mine = records.filter((r) => r.model === model);
  const paired = mine.filter((r) => r.ok && r.arms?.W.ok && r.arms.I.ok);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(
    `${model}: ${mine.length} jobs, ${paired.length} paired, message ${mine[0]?.infoMessage ?? 'plain'}`,
  );
  console.log(
    `left unfixed per design: W ${f(mean(paired.map((r) => r.arms!.W.unfixed ?? 0)))}, P ${f(mean(paired.map((r) => r.arms!.I.unfixed ?? 0)))}`,
  );
  const count = (arm: 'W' | 'I', rule: string) =>
    paired.filter((r) => hasRule(r.arms![arm].findingsByRule, rule)).length;
  for (const rule of ['VR-008', 'VR-018'])
    console.log(
      `${rule} in final designs: W ${count('W', rule)}/${paired.length}, P ${count('I', rule)}/${paired.length}`,
    );
  const criteria = followupCriteria(records, model, Number(values.seed));
  for (const c of criteria) console.log(`${c.id}. ${c.met ? 'met' : 'NOT met'}: ${c.detail}`);
  const pass = [1, 2, 3, 4].every((id) => criteria.find((c) => c.id === id)?.met === true);
  console.log(
    pass
      ? 'Result: P replaces the adopted message.'
      : "Result: P fails; Luna returns to today's message.",
  );
}

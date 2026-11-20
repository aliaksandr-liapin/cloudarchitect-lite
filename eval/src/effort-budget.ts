/**
 * Effort-budget experiment, generation step
 * (docs/superpowers/specs/2026-11-20-effort-budget-experiment-design.md): for each model x scenario
 * x repeat, one extraction and first draft, then four repairs from that draft (arms 0, 1, 2 send 0/1/2
 * info findings; arm S sends VR-018 alone first). Makes PAID API calls.
 *
 * Usage: pnpm --filter @cloudarchitect/eval effort-budget --max-usd <n>
 *        [--models gpt-luna] [--repeats 5] [--scenarios id,id] [--concurrency 4]
 * --max-usd is required: one shared cap, so a run can never start uncapped. A requested model whose
 * provider key is missing fails the run before any call. Results go to
 * eval/results/live/<runId>/. Console output carries ids, counts, cost and latency only.
 */
import { awsCatalog } from '@cloudarchitect/catalog';
import { modelOption } from '@cloudarchitect/domain';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { EB_ARMS } from './effort-budget-arms.js';
import { runEffortBudgetJob, type EffortBudgetRecord } from './effort-budget-job.js';
import { modelsWithKeys } from './gate.js';
import {
  Budget,
  evalRoot as root,
  loadClients,
  loadScenarios,
  meteredClient,
  parseModels,
  positiveInt,
} from './live-common.js';

const { values: args } = parseArgs({
  options: {
    models: { type: 'string', default: 'gpt-luna' },
    repeats: { type: 'string', default: '5' },
    scenarios: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'max-usd': { type: 'string' },
  },
});

// Checked before any client or key is loaded: an uncapped run never gets that far.
if (args['max-usd'] === undefined) throw new Error('--max-usd is required');
const maxUsd = Number(args['max-usd']);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd must be a positive number');
const repeats = positiveInt('repeats', args.repeats);
const concurrency = positiveInt('concurrency', args.concurrency);

const clients = loadClients();
// Every requested model must have its key: a run that silently drops a model is not the experiment.
const keyed = modelsWithKeys(parseModels(args.models), (p) => Boolean(clients[p]), true);
if (keyed.failures.length) {
  for (const f of keyed.failures) console.error(f);
  process.exit(1);
}
const { models } = keyed;
const scenarios = loadScenarios(args.scenarios);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'results', 'live', runId);
mkdirSync(join(outDir, 'outputs'), { recursive: true });

const budget = new Budget(maxUsd);
const jobs = models.flatMap((model) =>
  scenarios.flatMap((s) =>
    Array.from({ length: repeats }, (_, i) => ({ s, model, repeat: i + 1 })),
  ),
);
const records: EffortBudgetRecord[] = [];
let next = 0;

const pass = (a?: { ok: boolean; score?: { passed: boolean } }) =>
  a ? (a.ok ? (a.score?.passed ? 'PASS' : 'fail') : 'ERROR') : '-';

async function worker() {
  while (next < jobs.length) {
    if (budget.exhausted) {
      budget.cutShort = true;
      return;
    }
    const { s, model, repeat } = jobs[next++]!;
    const file = (suffix: string) =>
      join(outDir, 'outputs', `${model}-${s.id}-${repeat}.${suffix}`);
    const r = await runEffortBudgetJob(
      meteredClient(clients[modelOption(model).provider]!, budget).llm,
      awsCatalog,
      s,
      model,
      repeat,
      (name, project) =>
        writeFileSync(file(`${name}.project.json`), JSON.stringify(project, null, 2)),
      // The rejected answer stays in the local, git-ignored results folder for diagnosis.
      (text) => writeFileSync(file('rejected.txt'), text),
    );
    records.push(r);
    console.log(
      `${r.model.padEnd(17)} ${r.scenarioId.padEnd(28)} #${r.repeat} ` +
        (r.ok && r.arms
          ? `${EB_ARMS.map((a) => `${a} ${pass(r.arms![a])}`).join(' ')} S turns ${r.arms.S.turns} ` +
            `info eligible ${r.eligibleInfo} VR-018 ${r.hasVr018 ? 'yes' : 'no'}`
          : `ERROR ${r.error}`) +
        ` $${r.costUsd.toFixed(4)} ${(r.latencyMs / 1000).toFixed(1)}s`,
    );
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

writeFileSync(join(outDir, 'records.json'), JSON.stringify(records, null, 2));
writeFileSync(
  join(outDir, 'summary.json'),
  JSON.stringify(
    {
      runId,
      experiment: 'effort-budget',
      repeats,
      scenarios: scenarios.length,
      models,
      maxUsd,
      spentUsd: budget.spentMicro / 1e6,
      cutShort: budget.cutShort,
    },
    null,
    2,
  ),
);
console.log(
  `total spent: $${(budget.spentMicro / 1e6).toFixed(4)}${budget.cutShort ? ' (stopped at --max-usd)' : ''}; results: ${outDir}`,
);

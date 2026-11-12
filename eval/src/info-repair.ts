/**
 * Info-repair experiment, generation step: for each model x scenario x repeat, one extraction and
 * first draft, then two repairs from that draft (arm W: errors and warnings; arm I: also five info
 * rules). Makes PAID API calls.
 *
 * Usage: pnpm --filter @cloudarchitect/eval info-repair --max-usd <n>
 *        [--models haiku,gpt-luna,gemini-flash-lite] [--repeats 2] [--scenarios id,id] [--concurrency 4]
 *        [--info-message plain|prioritized]
 * --info-message prioritized words arm I warnings first, info findings after (the Luna follow-up).
 * --max-usd is required: one shared cap, so a run can never start uncapped. A requested model whose
 * provider key is missing fails the run before any call. Results go to
 * eval/results/live/<runId>/. Console output carries ids, counts, cost and latency only.
 */
import { awsCatalog } from '@cloudarchitect/catalog';
import { modelOption } from '@cloudarchitect/domain';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { modelsWithKeys } from './gate.js';
import type { InfoMessage } from './info-repair-arms.js';
import { runInfoRepairJob, type InfoRepairRecord } from './info-repair-job.js';
import {
  Budget,
  evalRoot as root,
  loadClients,
  loadScenarios,
  meteredClient,
  parseModels,
  positiveInt,
} from './live-common.js';

const clients = loadClients();

const { values: args } = parseArgs({
  options: {
    models: { type: 'string', default: 'haiku,gpt-luna,gemini-flash-lite' },
    repeats: { type: 'string', default: '2' },
    scenarios: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'max-usd': { type: 'string' },
    'info-message': { type: 'string', default: 'plain' },
  },
});

if (args['max-usd'] === undefined) throw new Error('--max-usd is required');
const maxUsd = Number(args['max-usd']);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd must be a positive number');
const repeats = positiveInt('repeats', args.repeats);
const infoMessageArg = args['info-message'];
if (infoMessageArg !== 'plain' && infoMessageArg !== 'prioritized')
  throw new Error('--info-message must be plain or prioritized');
const infoMessage: InfoMessage = infoMessageArg;
const concurrency = positiveInt('concurrency', args.concurrency);

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
const records: InfoRepairRecord[] = [];
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
    const r = await runInfoRepairJob(
      meteredClient(clients[modelOption(model).provider]!, budget).llm,
      awsCatalog,
      s,
      model,
      repeat,
      (name, project) =>
        writeFileSync(file(`${name}.project.json`), JSON.stringify(project, null, 2)),
      // The rejected answer stays in the local, git-ignored results folder for diagnosis.
      (text) => writeFileSync(file('rejected.txt'), text),
      infoMessage,
    );
    records.push(r);
    console.log(
      `${r.model.padEnd(17)} ${r.scenarioId.padEnd(28)} #${r.repeat} ` +
        (r.ok
          ? `W ${pass(r.arms?.W)} I ${pass(r.arms?.I)} info ${r.infoSent}`
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
      repeats,
      infoMessage,
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

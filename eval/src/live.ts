/**
 * Live eval: the production generator (extraction, clarification answers, generation with repair)
 * on every benchmark scenario, scored by the harness and checked by the regression gate.
 *
 * Usage: pnpm eval:live [--models haiku,gpt-luna,gemini-flash-lite] [--repeats 1]
 *        [--scenarios id,id] [--concurrency 4] [--max-usd 0.50] [--gate]
 * Reads ANTHROPIC_API_KEY, OPENAI_API_KEY and GEMINI_API_KEY from the environment or the
 * repo-root .env; a model whose provider key is missing is skipped, or with --gate fails the run before
 * any call. --max-usd is one shared cap. Results go to
 * eval/results/live/<runId>/. Console output carries ids, scores, cost and latency only.
 */
import { awsCatalog } from '@cloudarchitect/catalog';
import { type ModelChoice, modelOption, validateProject } from '@cloudarchitect/domain';
import { generateArchitecture, GenerationError } from '@cloudarchitect/generator';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { evaluateGate, modelsWithKeys, type LiveSummary } from './gate.js';
import { scoreCandidate, type Scenario, type ScenarioResult } from './harness.js';
import {
  Budget,
  evalRoot as root,
  extractWithAnswers,
  loadClients,
  loadScenarios,
  meteredClient,
  parseModels,
  positiveInt,
  type CallRecord,
} from './live-common.js';
import { countByRule, type FindingsByRule } from './rule-hits.js';

const clients = loadClients();

const { values: args } = parseArgs({
  options: {
    models: { type: 'string', default: 'haiku' },
    repeats: { type: 'string', default: '1' },
    scenarios: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'max-usd': { type: 'string', default: '0.50' },
    gate: { type: 'boolean', default: false },
  },
});

const requested = parseModels(args.models);
const keyed = modelsWithKeys(requested, (p) => Boolean(clients[p]), args.gate);
for (const w of keyed.warnings) console.log(w);
if (keyed.failures.length) {
  for (const f of keyed.failures) console.error(f);
  process.exit(1);
}
const { models } = keyed;
if (models.length === 0) {
  console.log('No requested model has a provider key — live eval skipped');
  process.exit(0);
}
const repeats = positiveInt('repeats', args.repeats);
const concurrency = positiveInt('concurrency', args.concurrency);
const maxUsd = Number(args['max-usd']);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd must be a positive number');

const scenarios = loadScenarios(args.scenarios);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'results', 'live', runId);
mkdirSync(join(outDir, 'outputs'), { recursive: true });

interface LiveRecord {
  scenarioId: string;
  model: ModelChoice;
  repeat: number;
  ok: boolean;
  error?: string;
  questionTopics: string[];
  /** Per model call: stop reason and tokens only, never content. */
  calls: CallRecord[];
  costUsd: number;
  latencyMs: number;
  findingsByRule?: FindingsByRule;
  /** Findings on the first draft, before any repair turn. */
  firstDraftFindingsByRule?: FindingsByRule;
  repairTurnsUsed?: number;
  score?: ScenarioResult;
}

const budget = new Budget(maxUsd);

async function runJob(s: Scenario, model: ModelChoice, repeat: number): Promise<LiveRecord> {
  const started = Date.now();
  const { llm, meter } = meteredClient(clients[modelOption(model).provider]!, budget);
  const { calls } = meter;
  let questionTopics: string[] = [];
  const base = { scenarioId: s.id, model, repeat };
  const done = () => ({
    questionTopics,
    calls,
    costUsd: meter.jobMicro / 1e6,
    latencyMs: Date.now() - started,
  });
  try {
    const step = await extractWithAnswers(llm, s, model);
    questionTopics = step.questionTopics;
    const r = await generateArchitecture(llm, awsCatalog, step.input);
    writeFileSync(
      join(outDir, 'outputs', `${model}-${s.id}-${repeat}.project.json`),
      JSON.stringify(r.project, null, 2),
    );
    return {
      ...base,
      ok: true,
      ...done(),
      findingsByRule: countByRule(validateProject(r.project, awsCatalog)),
      firstDraftFindingsByRule: countByRule(r.firstDraftFindings),
      repairTurnsUsed: r.repairTurnsUsed,
      score: scoreCandidate(s, r.project),
    };
  } catch (err) {
    // The rejected answer stays in the local, git-ignored results folder for diagnosis.
    if (err instanceof GenerationError)
      writeFileSync(
        join(outDir, 'outputs', `${model}-${s.id}-${repeat}.rejected.txt`),
        meter.lastText,
      );
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...done(),
      // A schema-invalid answer is a scored failure; transport errors and the cap are not scored.
      ...(err instanceof GenerationError ? { score: scoreCandidate(s, null) } : {}),
    };
  }
}

const jobs = models.flatMap((model) =>
  scenarios.flatMap((s) =>
    Array.from({ length: repeats }, (_, i) => ({ s, model, repeat: i + 1 })),
  ),
);
const records: LiveRecord[] = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    if (budget.exhausted) {
      budget.cutShort = true;
      return;
    }
    const { s, model, repeat } = jobs[next++]!;
    const r = await runJob(s, model, repeat);
    records.push(r);
    const status = r.ok ? (r.score?.passed ? 'PASS' : 'fail') : `ERROR ${r.error}`;
    console.log(
      `${r.model.padEnd(17)} ${r.scenarioId.padEnd(28)} #${r.repeat} ${status} $${r.costUsd.toFixed(4)} ${(r.latencyMs / 1000).toFixed(1)}s`,
    );
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

// --- Summary per model ---

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s.length % 2
      ? s[(s.length - 1) / 2]!
      : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
    : 0;
};
// Every run counts: an unscored run (transport error, cap) is neither schema-valid nor passed.
const summary: LiveSummary[] = models.map((model) => {
  const rs = records.filter((r) => r.model === model);
  return {
    model,
    runs: rs.length,
    schemaValidRate: mean(rs.map((r) => (r.score?.schemaValid ? 1 : 0))),
    passRate: mean(rs.map((r) => (r.score?.passed ? 1 : 0))),
    forbiddenServiceHits: rs.reduce((a, r) => a + (r.score?.forbiddenServices.length ?? 0), 0),
    meanCostUsd: mean(rs.map((r) => r.costUsd)),
    medianLatencyS: median(rs.map((r) => r.latencyMs / 1000)),
    totalCostUsd: rs.reduce((a, r) => a + r.costUsd, 0),
  };
});

const gate = models.map((model, i) => {
  const expected = scenarios.length * repeats;
  const result = evaluateGate(summary[i]!, modelOption(model).benchmark?.costPerOperationUsd);
  const failures = [...result.failures];
  if (budget.cutShort || summary[i]!.runs < expected)
    failures.push(
      `${model}: run cut short by --max-usd ${maxUsd} (${summary[i]!.runs}/${expected} runs)`,
    );
  return { model, passed: failures.length === 0, failures };
});

writeFileSync(join(outDir, 'records.json'), JSON.stringify(records, null, 2));
writeFileSync(
  join(outDir, 'summary.json'),
  JSON.stringify(
    {
      runId,
      repeats,
      scenarios: scenarios.length,
      maxUsd,
      spentUsd: budget.spentMicro / 1e6,
      cutShort: budget.cutShort,
      summary,
      gate,
    },
    null,
    2,
  ),
);

console.table(
  [...records]
    .sort((a, b) => a.model.localeCompare(b.model) || a.scenarioId.localeCompare(b.scenarioId))
    .map((r) => ({
      model: r.model,
      scenario: r.scenarioId,
      repeat: r.repeat,
      status: r.ok ? (r.score?.passed ? 'PASS' : 'fail') : 'ERROR',
      recall: r.score?.requirementRecall.toFixed(2) ?? '',
      missing: r.score?.missingServices.join(', ') ?? '',
      forbidden: r.score?.forbiddenServices.join(', ') ?? '',
      rules: r.score?.forbiddenRuleHits.join(', ') ?? '',
      errors: r.score?.errorFindings ?? '',
      costUsd: r.costUsd.toFixed(4),
      latencyS: (r.latencyMs / 1000).toFixed(1),
    })),
);
console.table(summary);
console.log(
  `total spent: $${(budget.spentMicro / 1e6).toFixed(4)}${budget.cutShort ? ' (stopped at --max-usd)' : ''}; results: ${outDir}`,
);

if (args.gate) {
  for (const g of gate) {
    console.log(`gate ${g.model}: ${g.passed ? 'PASS' : 'FAIL'}`);
    for (const f of g.failures) console.log(`  - ${f}`);
  }
  if (gate.some((g) => !g.passed)) process.exit(1);
}

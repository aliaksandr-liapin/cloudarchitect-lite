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
import {
  ModelChoice,
  modelOption,
  validateProject,
  YOU_DECIDE,
  type Provider,
} from '@cloudarchitect/domain';
import {
  anthropicClient,
  costMicroUsd,
  extract,
  extractionModel,
  generateArchitecture,
  GenerationError,
  googleClient,
  openaiClient,
  type LlmClient,
} from '@cloudarchitect/generator';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { evaluateGate, KEY_VAR, modelsWithKeys, type LiveSummary } from './gate.js';
import { Scenario, scoreCandidate, type ScenarioResult } from './harness.js';
import { countByRule, type FindingsByRule } from './rule-hits.js';

const root = new URL('..', import.meta.url).pathname;
const envFile = join(root, '..', '.env');
const PROVIDER_CLIENT: Record<Provider, (apiKey: string) => LlmClient> = {
  anthropic: anthropicClient,
  openai: openaiClient,
  google: googleClient,
};
if (Object.values(KEY_VAR).some((v) => !process.env[v]) && existsSync(envFile))
  process.loadEnvFile(envFile);

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

const positiveInt = (name: string, v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
};
const requested = args.models.split(',').map((m) => ModelChoice.parse(m));
// One client per provider that has a key; a model without its provider key is skipped (gate: fails).
const clients: Partial<Record<Provider, LlmClient>> = {};
for (const p of Object.keys(KEY_VAR) as Provider[]) {
  const key = process.env[KEY_VAR[p]];
  if (key) clients[p] = PROVIDER_CLIENT[p](key);
}
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

const all = readdirSync(join(root, 'scenarios'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => Scenario.parse(JSON.parse(readFileSync(join(root, 'scenarios', f), 'utf8'))));
const wanted = args.scenarios?.split(',');
const unknown = wanted?.filter((id) => !all.some((s) => s.id === id)) ?? [];
if (unknown.length) throw new Error(`Unknown scenarios: ${unknown.join(', ')}`);
const scenarios = wanted ? all.filter((s) => wanted.includes(s.id)) : all;

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
  calls: { model: string; stopReason: string | null; outputTokens: number; costUsd: number }[];
  costUsd: number;
  latencyMs: number;
  findingsByRule?: FindingsByRule;
  /** Findings on the first draft, before any repair turn. */
  firstDraftFindingsByRule?: FindingsByRule;
  repairTurnsUsed?: number;
  score?: ScenarioResult;
}

class SpendCapReached extends Error {}

let spentMicro = 0;
const capMicro = maxUsd * 1e6;
/** Set when the cap stopped a call or left jobs unscheduled; such a run fails the gate. */
let cutShort = false;

async function runJob(s: Scenario, model: ModelChoice, repeat: number): Promise<LiveRecord> {
  const started = Date.now();
  let jobMicro = 0;
  const calls: LiveRecord['calls'] = [];
  let lastText = '';
  let questionTopics: string[] = [];
  // Each call's cost is counted as soon as it returns; the cap is checked before every call.
  const real = clients[modelOption(model).provider]!;
  const llm: LlmClient = async (req) => {
    if (spentMicro >= capMicro) throw new SpendCapReached(`--max-usd ${maxUsd} reached`);
    const res = await real(req);
    const cost = costMicroUsd(req.model, res.usage);
    spentMicro += cost;
    jobMicro += cost;
    calls.push({
      model: req.model,
      stopReason: res.stopReason,
      outputTokens: res.usage.output,
      costUsd: cost / 1e6,
    });
    lastText = res.text;
    return res;
  };
  const base = { scenarioId: s.id, model, repeat };
  const done = () => ({
    questionTopics,
    calls,
    costUsd: jobMicro / 1e6,
    latencyMs: Date.now() - started,
  });
  try {
    const ex = await extract(
      llm,
      { prompt: s.prompt, toggles: s.toggles },
      extractionModel(modelOption(model).provider),
    );
    questionTopics = ex.questions.map((q) => q.topic);
    const answers = Object.fromEntries(
      ex.questions.map((q) => [q.topic, s.answers[q.topic] ?? YOU_DECIDE]),
    );
    const r = await generateArchitecture(llm, awsCatalog, {
      prompt: s.prompt,
      toggles: s.toggles,
      model,
      name: ex.name,
      requirements: ex.requirements,
      assumptions: ex.assumptions,
      questions: ex.questions,
      answers,
    });
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
    if (err instanceof SpendCapReached) cutShort = true;
    // The rejected answer stays in the local, git-ignored results folder for diagnosis.
    if (err instanceof GenerationError)
      writeFileSync(join(outDir, 'outputs', `${model}-${s.id}-${repeat}.rejected.txt`), lastText);
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
    if (spentMicro >= capMicro) {
      cutShort = true;
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
  if (cutShort || summary[i]!.runs < expected)
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
      spentUsd: spentMicro / 1e6,
      cutShort,
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
  `total spent: $${(spentMicro / 1e6).toFixed(4)}${cutShort ? ' (stopped at --max-usd)' : ''}; results: ${outDir}`,
);

if (args.gate) {
  for (const g of gate) {
    console.log(`gate ${g.model}: ${g.passed ? 'PASS' : 'FAIL'}`);
    for (const f of g.failures) console.log(`  - ${f}`);
  }
  if (gate.some((g) => !g.passed)) process.exit(1);
}

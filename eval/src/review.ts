/**
 * Blind review panel: builds anonymous A/B packets from live run directories and sends each to three
 * reviewers (one Claude, one OpenAI, one Gemini model) through the production adapters.
 *
 * Usage: pnpm --filter @cloudarchitect/eval review --runs <id,id,...> --max-usd <n> [--seed 1]
 *        [--reviewers anthropic,openai,google] [--repeat n] [--scenarios id,id] [--base-scenarios id,id] [--packets-only]
 * Arms mode: pnpm --filter @cloudarchitect/eval review --arms <runId-or-dir> --max-usd <n> [--per-model 10]
 * [--seed 1] [--packets-only] reviews the two repair arms of an info-repair run: per model,
 * sampleReviewJobs picks the jobs whose final designs differ; the designs are named <model>~W and
 * <model>~I and paired with each other. Writes eval/reviews/info-repair-<date>/ (same layout).
 * Resume: when today's output folder already has a key.json, packets are rebuilt and must match the
 * saved ones byte for byte; valid saved reviews are kept and only missing (reviewer, packet) calls run.
 * --packets-only then prints how many calls a resume would make per reviewer.
 * --repeat keeps one repeat number; --scenarios limits economical pairs (and best-quality pairs when
 * --base-scenarios is absent); --base-scenarios limits best-quality pairs (gpt-sol and gemini-argon
 * vs sonnet, haiku vs sonnet).
 * Reads ANTHROPIC_API_KEY, OPENAI_API_KEY and GEMINI_API_KEY from the environment or the repo-root
 * .env. --max-usd is one cap over all reviewer calls. Writes eval/reviews/phase3-<date>/
 * {packets/, key.json, review-<provider>-g<N>.json, summary.json}. Console output carries ids,
 * scores and cost only. --packets-only builds packets and the key without any provider call.
 */
import type { Project, Provider } from '@cloudarchitect/domain';
import {
  anthropicClient,
  costMicroUsd,
  GenerationError,
  googleClient,
  jsonOutputFormat,
  openaiClient,
  parseOutput,
  redactKey,
  type CallUsage,
  type LlmClient,
} from '@cloudarchitect/generator';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Scenario } from './harness.js';
import { sampleReviewJobs } from './info-repair-arms.js';
import type { InfoRepairRecord } from './info-repair-job.js';
import {
  aggregate,
  buildPackets,
  estimateCallMicroUsd,
  findLeaks,
  withinCap,
  ReviewOutput,
  acceptSaved,
  missingCalls,
  normalizeReviewOutput,
  packetMismatches,
  type DesignRun,
  type PanelReview,
} from './packets.js';

const root = new URL('..', import.meta.url).pathname;
const envFile = join(root, '..', '.env');

const REVIEWERS: { provider: Provider; model: string; keyVar: string }[] = [
  { provider: 'anthropic', model: 'claude-sonnet-5-5', keyVar: 'ANTHROPIC_API_KEY' },
  { provider: 'openai', model: 'gpt-6.1-sol', keyVar: 'OPENAI_API_KEY' },
  { provider: 'google', model: 'gemini-4-argon', keyVar: 'GEMINI_API_KEY' },
];
const CLIENT: Record<Provider, (apiKey: string) => LlmClient> = {
  anthropic: anthropicClient,
  openai: openaiClient,
  google: googleClient,
};
const MAX_TOKENS = 24000;

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string' },
    arms: { type: 'string' },
    'per-model': { type: 'string', default: '10' },
    'max-usd': { type: 'string' },
    seed: { type: 'string', default: '1' },
    repeat: { type: 'string' },
    scenarios: { type: 'string' },
    'base-scenarios': { type: 'string' },
    reviewers: { type: 'string' },
    'packets-only': { type: 'boolean', default: false },
  },
});
if (!args.runs && !args.arms) throw new Error('--runs <id,id,...> or --arms <runId> is required');
if (args.runs && args.arms) throw new Error('--runs and --arms cannot be combined');
const perModel = Number(args['per-model']);
if (!Number.isInteger(perModel) || perModel < 1)
  throw new Error('--per-model must be a positive integer');
const packetsOnly = args['packets-only'];
const maxUsd = Number(args['max-usd']);
if (!packetsOnly && (!Number.isFinite(maxUsd) || maxUsd <= 0))
  throw new Error('--max-usd must be a positive number');
const seed = Number(args.seed);
if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');

// --- Inputs: designs of the listed live runs, and the scenarios ---

const scenarios = readdirSync(join(root, 'scenarios'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => Scenario.parse(JSON.parse(readFileSync(join(root, 'scenarios', f), 'utf8'))));

const runs: DesignRun[] = [];
/** Arms mode: partner model per arm name, e.g. haiku~W <-> haiku~I. */
let armPairs: Record<string, string> | undefined;
if (args.arms) {
  const dir =
    isAbsolute(args.arms) || args.arms.includes('/')
      ? resolve(args.arms)
      : join(root, 'results', 'live', args.arms);
  if (!existsSync(join(dir, 'records.json'))) throw new Error(`Unknown run ${args.arms}`);
  const records = JSON.parse(readFileSync(join(dir, 'records.json'), 'utf8')) as InfoRepairRecord[];
  armPairs = {};
  for (const r of sampleReviewJobs(records, perModel, seed)) {
    const file = (arm: 'W' | 'I') =>
      join(dir, 'outputs', `${r.model}-${r.scenarioId}-${r.repeat}.${arm}.project.json`);
    if (!existsSync(file('W')) || !existsSync(file('I'))) continue;
    for (const arm of ['W', 'I'] as const) {
      runs.push({
        model: `${r.model}~${arm}`,
        scenarioId: r.scenarioId,
        repeat: r.repeat,
        project: JSON.parse(readFileSync(file(arm), 'utf8')) as Project,
      });
    }
    armPairs[`${r.model}~W`] = `${r.model}~I`;
    armPairs[`${r.model}~I`] = `${r.model}~W`;
  }
} else {
  for (const runId of args.runs!.split(',')) {
    const dir = join(root, 'results', 'live', runId);
    if (!existsSync(join(dir, 'records.json'))) throw new Error(`Unknown run ${runId}`);
    const records = JSON.parse(readFileSync(join(dir, 'records.json'), 'utf8')) as {
      scenarioId: string;
      model: string;
      repeat: number;
      ok: boolean;
    }[];
    for (const r of records) {
      const file = join(dir, 'outputs', `${r.model}-${r.scenarioId}-${r.repeat}.project.json`);
      if (!r.ok || !existsSync(file)) continue;
      runs.push({
        model: r.model,
        scenarioId: r.scenarioId,
        repeat: r.repeat,
        project: JSON.parse(readFileSync(file, 'utf8')) as Project,
      });
    }
  }
}

const repeat = args.repeat === undefined ? undefined : Number(args.repeat);
if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1))
  throw new Error('--repeat must be a positive integer');
const { packets, key } = buildPackets({
  runs,
  scenarios,
  seed,
  pairs: armPairs,
  repeat,
  onlyScenarios: args.scenarios?.split(','),
  baseScenarios: args['base-scenarios']?.split(','),
});
if (packets.length === 0) throw new Error('No design pairs found in the given runs');
// A scenario prompt may legitimately name a vendor (e.g. "sign up with Google"); such mentions come
// from the user's request, not from the generator, so they are reported rather than blocking.
for (const p of packets) {
  const leaks = findLeaks(p.markdown);
  if (leaks.length)
    console.log(`warning: ${p.id} mentions ${leaks.join(', ')}; check the packet text`);
}

const outDir = join(
  root,
  'reviews',
  `${args.arms ? 'info-repair' : 'phase3'}-${new Date().toISOString().slice(0, 10)}`,
);
mkdirSync(join(outDir, 'packets'), { recursive: true });
const instructionsSrc = join(
  root,
  'reviews',
  'phase2-gate-a-2026-10-18',
  'packets',
  'reviewer-instructions.md',
);
const resuming = existsSync(join(outDir, 'key.json'));
if (resuming) {
  const dir = join(outDir, 'packets');
  const saved: Record<string, string> = {};
  for (const f of readdirSync(dir))
    if (/^g\d+\.md$/.test(f)) saved[f.slice(0, -3)] = readFileSync(join(dir, f), 'utf8');
  const bad = packetMismatches(saved, packets);
  // Compared as data: a formatter may have reflowed the saved key.json.
  const keyChanged =
    JSON.stringify(JSON.parse(readFileSync(join(outDir, 'key.json'), 'utf8'))) !==
    JSON.stringify(key);
  if (bad.length || keyChanged)
    throw new Error(
      `Cannot resume: rebuilt packets differ from ${outDir} (${bad.length ? `packets ${bad.join(', ')}` : 'key.json'}). Use the same --runs, --seed, --repeat and scenario filters, or move the folder away.`,
    );
} else {
  copyFileSync(instructionsSrc, join(outDir, 'packets', 'reviewer-instructions.md'));
  for (const p of packets) writeFileSync(join(outDir, 'packets', `${p.id}.md`), p.markdown);
  writeFileSync(join(outDir, 'key.json'), JSON.stringify(key, null, 2));
}
console.log(
  `${packets.length} packets, ${runs.length} designs; ${resuming ? 'resuming' : 'written to'} ${outDir}`,
);

// Saved reviews that pass validation are kept; everything else is (re)requested.
const panel: PanelReview[] = [];
const have = new Set<string>();
for (const r of REVIEWERS)
  for (const p of packets) {
    const file = join(outDir, `review-${r.provider}-${p.id}.json`);
    if (!existsSync(file)) continue;
    const output = acceptSaved(readFileSync(file, 'utf8'), p.scenarios);
    if (!output) {
      console.log(`${r.provider} ${p.id}: saved review is invalid, will be requested again`);
      continue;
    }
    panel.push({ reviewer: r.provider, packetId: p.id, output });
    have.add(`${r.provider}/${p.id}`);
  }
const selected = args.reviewers
  ? args.reviewers.split(',').map((name) => {
      const r = REVIEWERS.find((x) => x.provider === name);
      if (!r) throw new Error(`Unknown reviewer ${name} (anthropic, openai, google)`);
      return r;
    })
  : REVIEWERS;
const todo = missingCalls(
  selected.map((r) => r.provider),
  packets.map((p) => p.id),
  have,
);
console.log(
  `saved reviews kept: ${panel.length}; calls to make: ${todo.length} (${selected
    .map((r) => `${r.provider} ${todo.filter((t) => t.reviewer === r.provider).length}`)
    .join(', ')})`,
);
if (packetsOnly) process.exit(0);

// --- Reviewer calls ---

if (selected.some((r) => !process.env[r.keyVar]) && existsSync(envFile))
  process.loadEnvFile(envFile);
const missing = selected.filter((r) => !process.env[r.keyVar]);
if (missing.length) {
  console.log(`${missing.map((r) => r.keyVar).join(', ')} not set`);
  process.exit(1);
}

const system = readFileSync(instructionsSrc, 'utf8');
const format = jsonOutputFormat(ReviewOutput);
const capMicro = maxUsd * 1e6;
let spentMicro = 0;
/** Worst-case cost of calls in flight, so parallel reviewers cannot overshoot the cap. */
let reservedMicro = 0;
let cutShort = false;
const failures: { reviewer: string; packetId: string; error: string }[] = [];

async function review(r: (typeof REVIEWERS)[number], client: LlmClient, packetId: string) {
  const packet = packets.find((p) => p.id === packetId)!;
  const estimate = estimateCallMicroUsd(r.model, system, packet.markdown, MAX_TOKENS);
  if (!withinCap(spentMicro, reservedMicro, estimate, capMicro)) {
    cutShort = true;
    return;
  }
  reservedMicro += estimate;
  try {
    const res = await client({
      model: r.model,
      system,
      maxTokens: MAX_TOKENS,
      format,
      effort: 'high',
      messages: [{ role: 'user', content: packet.markdown }],
    });
    // Spend is counted as soon as the call returns, even if the answer is then rejected.
    const cost = costMicroUsd(r.model, res.usage);
    spentMicro += cost;
    const usage: CallUsage[] = [{ model: r.model, usage: res.usage, costMicroUsd: cost }];
    const output = parseOutput(res.text, ReviewOutput, usage);
    // The raw answer is kept for audit; duplicates are dropped (first entry wins) with a warning.
    writeFileSync(
      join(outDir, `review-${r.provider}-${packetId}.raw.json`),
      JSON.stringify(output, null, 2),
    );
    const normalized = normalizeReviewOutput(output, packet.scenarios);
    for (const w of normalized.warnings)
      console.log(`warning: ${r.provider} ${packetId}: ${w} (first entry kept)`);
    writeFileSync(
      join(outDir, `review-${r.provider}-${packetId}.json`),
      JSON.stringify(normalized.output, null, 2),
    );
    panel.push({ reviewer: r.provider, packetId, output: normalized.output });
    console.log(`${r.provider.padEnd(9)} ${packetId} ok $${(cost / 1e6).toFixed(4)}`);
  } catch (err) {
    // The message is logged with the key masked, so a failure can be diagnosed.
    const clean = redactKey(err, process.env[r.keyVar] ?? '');
    const error =
      err instanceof GenerationError
        ? 'schema_invalid'
        : clean instanceof Error
          ? `${clean.name}: ${clean.message}`.slice(0, 500)
          : 'error';
    failures.push({ reviewer: r.provider, packetId, error });
    console.log(`${r.provider.padEnd(9)} ${packetId} FAILED ${error}`);
  } finally {
    reservedMicro -= estimate;
  }
}

// Reviewers run in parallel (each sees only its packet); one reviewer's packets run in order.
await Promise.all(
  selected.map(async (r) => {
    const client = CLIENT[r.provider](process.env[r.keyVar]!);
    for (const t of todo.filter((x) => x.reviewer === r.provider))
      await review(r, client, t.packetId);
  }),
);

const summary = {
  seed,
  maxUsd,
  spentUsd: spentMicro / 1e6,
  cutShort,
  reviewers: REVIEWERS.map((r) => r.provider),
  failures,
  ...aggregate(key, panel, REVIEWERS.length),
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.table(summary.models);
console.log(
  `total spent: $${(spentMicro / 1e6).toFixed(4)}${cutShort ? ' (stopped at --max-usd)' : ''}; results: ${outDir}`,
);
if (!summary.complete) console.log('warning: partial panel; summary.json has complete: false');
if (cutShort || failures.length) process.exit(1);

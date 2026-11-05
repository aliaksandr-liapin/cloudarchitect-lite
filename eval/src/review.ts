/**
 * Blind review panel: builds anonymous A/B packets from live run directories and sends each to three
 * reviewers (one Claude, one OpenAI, one Gemini model) through the production adapters.
 *
 * Usage: pnpm --filter @cloudarchitect/eval review --runs <id,id,...> --max-usd <n> [--seed 1]
 *        [--packets-only]
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
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Scenario } from './harness.js';
import {
  aggregate,
  buildPackets,
  findLeaks,
  ReviewOutput,
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
    'max-usd': { type: 'string' },
    seed: { type: 'string', default: '1' },
    'packets-only': { type: 'boolean', default: false },
  },
});
if (!args.runs) throw new Error('--runs <id,id,...> is required');
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
for (const runId of args.runs.split(',')) {
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

const { packets, key } = buildPackets({ runs, scenarios, seed });
if (packets.length === 0) throw new Error('No design pairs found in the given runs');
// A scenario prompt may legitimately name a vendor (e.g. "sign up with Google"); such mentions come
// from the user's request, not from the generator, so they are reported rather than blocking.
for (const p of packets) {
  const leaks = findLeaks(p.markdown);
  if (leaks.length)
    console.log(`warning: ${p.id} mentions ${leaks.join(', ')}; check the packet text`);
}

const outDir = join(root, 'reviews', `phase3-${new Date().toISOString().slice(0, 10)}`);
mkdirSync(join(outDir, 'packets'), { recursive: true });
const instructionsSrc = join(
  root,
  'reviews',
  'phase2-gate-a-2026-10-18',
  'packets',
  'reviewer-instructions.md',
);
copyFileSync(instructionsSrc, join(outDir, 'packets', 'reviewer-instructions.md'));
for (const p of packets) writeFileSync(join(outDir, 'packets', `${p.id}.md`), p.markdown);
writeFileSync(join(outDir, 'key.json'), JSON.stringify(key, null, 2));
console.log(`${packets.length} packets, ${runs.length} designs; written to ${outDir}`);
if (packetsOnly) process.exit(0);

// --- Reviewer calls ---

if (REVIEWERS.some((r) => !process.env[r.keyVar]) && existsSync(envFile))
  process.loadEnvFile(envFile);
const missing = REVIEWERS.filter((r) => !process.env[r.keyVar]);
if (missing.length) {
  // A panel of fewer than three reviewers would not match the published method.
  console.log(
    `${missing.map((r) => r.keyVar).join(', ')} not set; the review panel needs all three`,
  );
  process.exit(1);
}

const system = readFileSync(instructionsSrc, 'utf8');
const format = jsonOutputFormat(ReviewOutput);
const capMicro = maxUsd * 1e6;
let spentMicro = 0;
let cutShort = false;
const panel: PanelReview[] = [];
const failures: { reviewer: string; packetId: string; error: string }[] = [];

async function review(r: (typeof REVIEWERS)[number], client: LlmClient, packetId: string) {
  const packet = packets.find((p) => p.id === packetId)!;
  if (spentMicro >= capMicro) {
    cutShort = true;
    return;
  }
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
    const got = new Set(output.reviews.map((x) => `${x.scenario}/${x.design}`));
    for (const s of packet.scenarios)
      for (const d of ['A', 'B'])
        if (!got.has(`${s}/${d}`)) throw new Error(`missing review ${s}/${d}`);
    writeFileSync(
      join(outDir, `review-${r.provider}-${packetId}.json`),
      JSON.stringify(output, null, 2),
    );
    panel.push({ reviewer: r.provider, packetId, output });
    console.log(`${r.provider.padEnd(9)} ${packetId} ok $${(cost / 1e6).toFixed(4)}`);
  } catch (err) {
    // Only an error class is logged: provider messages may echo request details.
    const error =
      err instanceof GenerationError ? 'schema_invalid' : err instanceof Error ? err.name : 'error';
    failures.push({ reviewer: r.provider, packetId, error });
    console.log(`${r.provider.padEnd(9)} ${packetId} FAILED ${error}`);
  }
}

// Reviewers run in parallel (each sees only its packet); one reviewer's packets run in order.
await Promise.all(
  REVIEWERS.map(async (r) => {
    const client = CLIENT[r.provider](process.env[r.keyVar]!);
    for (const p of packets) await review(r, client, p.id);
  }),
);

const summary = {
  seed,
  maxUsd,
  spentUsd: spentMicro / 1e6,
  cutShort,
  reviewers: REVIEWERS.map((r) => r.provider),
  failures,
  ...aggregate(key, panel),
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.table(summary.models);
console.log(
  `total spent: $${(spentMicro / 1e6).toFixed(4)}${cutShort ? ' (stopped at --max-usd)' : ''}; results: ${outDir}`,
);
if (cutShort || failures.length) process.exit(1);

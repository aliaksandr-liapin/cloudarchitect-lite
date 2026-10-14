/**
 * Phase 0 AI quality spike (ROADMAP §2): one-shot generation for every benchmark scenario,
 * scored by the eval harness, with token usage and cost per operation.
 *
 * Usage: pnpm --filter @cloudarchitect/eval spike [--models haiku,sonnet,opus] [--repeats 1]
 *        [--scenarios id,id] [--concurrency 4] [--max-usd 15]
 * Reads ANTHROPIC_API_KEY from the environment or the repo-root .env. Results go to eval/results/spike/.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { awsCatalog } from '@cloudarchitect/catalog';
import { PROJECT_SCHEMA_VERSION, validateProject, type Project } from '@cloudarchitect/domain';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { Scenario, scoreCandidate, type ScenarioResult } from './harness.js';

const root = new URL('..', import.meta.url).pathname;
const envFile = join(root, '..', '.env');
if (!process.env.ANTHROPIC_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);

/** USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing (2026-10-13). */
const MODELS = {
  haiku: { id: 'claude-haiku-5-5', input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  sonnet: { id: 'claude-sonnet-5-5', input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  opus: { id: 'claude-opus-5-5', input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
} as const;
type ModelKey = keyof typeof MODELS;

const { values: args } = parseArgs({
  options: {
    models: { type: 'string', default: 'haiku,sonnet,opus' },
    repeats: { type: 'string', default: '1' },
    scenarios: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'max-usd': { type: 'string', default: '15' },
  },
});

// --- Generation contract: what the model returns. Layout (positions) is computed later by ELK. ---

const serviceIds = awsCatalog.services.map((s) => s.id) as [string, ...string[]];
// Structured outputs require closed objects, so configuration is a list of catalog feature keys.
const configKeys = awsCatalog.features.map((f) => f.configKey) as [string, ...string[]];
const Config = z
  .array(z.object({ key: z.enum(configKeys), value: z.string() }))
  .describe('Catalog FEATURES that apply to this element; empty when none');

const Generation = z.object({
  name: z.string().describe('Short project name'),
  requirements: z.array(
    z.object({
      id: z.string().describe('e.g. R1'),
      text: z.string(),
      type: z.enum(['functional', 'non-functional', 'constraint']),
      status: z
        .enum(['confirmed', 'inferred', 'open'])
        .describe(
          'confirmed = stated by the user; inferred = your assumption; open = needs an answer',
        ),
    }),
  ),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  containers: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['aws-cloud', 'region', 'vpc', 'availability-zone', 'subnet', 'group']),
      parentId: z.string().optional(),
      label: z.string(),
      subnetType: z.enum(['public', 'private']).optional().describe('Required for subnets'),
    }),
  ),
  nodes: z.array(
    z.object({
      id: z.string(),
      serviceId: z.enum(serviceIds).optional().describe('Catalog service. Omit when unresolved.'),
      unresolved: z
        .object({ name: z.string(), rationale: z.string() })
        .optional()
        .describe('Only for a needed service that is NOT in the catalog'),
      label: z.string(),
      purpose: z.string(),
      rationale: z.string(),
      containerId: z.string().optional(),
      requirementIds: z.array(z.string()),
      configuration: Config,
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      kind: z.enum(['invoke', 'read', 'write', 'event', 'origin', 'other']),
      protocol: z.string().optional(),
      label: z.string(),
      requirementIds: z.array(z.string()),
      configuration: Config,
    }),
  ),
});
type Generation = z.infer<typeof Generation>;

const catalogText = [
  'CATALOG (the only allowed serviceId values):',
  ...awsCatalog.services.map(
    (s) =>
      `- ${s.id} | ${s.displayName} | ${s.category} | scope=${s.scope} | ${s.capabilities.join(', ')}`,
  ),
  '',
  'FEATURES (set as `configuration` on the node or edge they apply to):',
  ...awsCatalog.features.map(
    (f) => `- ${f.configKey} on ${f.appliesTo} of ${f.serviceId}: ${f.displayName}. ${f.summary}`,
  ),
  '',
  'VALIDATION RULES the design is checked against:',
  ...awsCatalog.rules.map((r) => `- ${r.id} (${r.severity}): ${r.title}`),
].join('\n');

const SYSTEM = `You are a senior AWS solution architect. Turn the user's application description into one justified AWS architecture and return it as JSON matching the required schema.

Rules:
1. Requirements: extract every explicit need as status "confirmed"; add important implied needs as "inferred". Keep each requirement text close to the user's wording. Put unclear points in openQuestions and decisions you made in assumptions; do not ask, decide.
2. Services: use only serviceId values from the CATALOG. If a needed service is not in the catalog, add a node with "unresolved" {name, rationale} and no serviceId. Never invent IDs.
3. Simplicity: choose the simplest design that meets the requirements. Do not add services no requirement needs (e.g. DAX only for a stated microsecond-latency need).
4. Containers: one "aws-cloud" root; "region" inside it; "vpc" inside the region; "subnet" (with subnetType) inside the VPC or an "availability-zone". Services with scope=vpc in the catalog (EC2, RDS, Aurora, ElastiCache, EFS, ALB, NAT Gateway, Fargate tasks, DAX) go inside a subnet; databases and caches in private subnets. Regional services go in the region container; global services (CloudFront, Route 53, IAM, Shield) in the aws-cloud container. Add a VPC only if something needs it.
5. Traceability: every node and edge lists the requirementIds it serves; every confirmed or inferred requirement is covered by at least one node or edge.
6. Edges: direction follows the request or data flow. Use kind "event" for asynchronous triggers (S3/SQS/SNS/EventBridge -> Lambda) and give them a deadLetterQueue or failureDestination configuration. Use kind "origin" from CloudFront to its origins and set originAccess "OAC" for S3 origins.
7. Include CloudWatch for observability. Keep the graph under 40 nodes.

${catalogText}`;

const outputFormat = zodOutputFormat(Generation);

/** Feature values arrive as strings; booleans are restored for the project format. */
const toConfig = (items: Generation['nodes'][number]['configuration']) =>
  items.length
    ? Object.fromEntries(
        items.map(({ key, value }) => [
          key,
          value === 'true' ? true : value === 'false' ? false : value,
        ]),
      )
    : undefined;

function toProject(g: Generation, scenarioId: string): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: `spike-${scenarioId}`,
    name: g.name,
    revision: 0,
    providerContext: ['aws'],
    catalogSnapshot: { aws: awsCatalog.manifest.catalogVersion },
    iconPackSnapshot: {},
    requirements: g.requirements.map((r) => ({ ...r, provenance: 'ai' as const })),
    containers: g.containers.map(({ subnetType, ...c }) => ({
      ...c,
      ...(subnetType ? { properties: { subnetType } } : {}),
    })),
    nodes: g.nodes.map(({ configuration, ...n }) => ({
      ...n,
      configuration: toConfig(configuration),
      provider: 'aws' as const,
      position: { x: 0, y: 0 },
    })) as Project['nodes'],
    edges: g.edges.map(({ configuration, ...e }) => ({
      ...e,
      configuration: toConfig(configuration),
    })),
    findings: [],
  };
}

// --- Run ---

interface RunRecord {
  scenarioId: string;
  model: ModelKey;
  repeat: number;
  ok: boolean;
  error?: string;
  latencyMs: number;
  usage?: { input: number; output: number; cacheWrite: number; cacheRead: number };
  costUsd: number;
  nodes?: number;
  unresolved?: string[];
  findingsByRule?: Record<string, number>;
  score?: ScenarioResult;
}

const scenarios = readdirSync(join(root, 'scenarios'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => Scenario.parse(JSON.parse(readFileSync(join(root, 'scenarios', f), 'utf8'))))
  .filter((s) => !args.scenarios || args.scenarios.split(',').includes(s.id));
const models = args.models.split(',') as ModelKey[];
for (const m of models) if (!(m in MODELS)) throw new Error(`Unknown model ${m}`);
const repeats = Number(args.repeats);
const maxUsd = Number(args['max-usd']);

if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
const client = new Anthropic({ maxRetries: 4 });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'results', 'spike', runId);
mkdirSync(join(outDir, 'outputs'), { recursive: true });

const jobs = models.flatMap((model) =>
  scenarios.flatMap((s) =>
    Array.from({ length: repeats }, (_, i) => ({ s, model, repeat: i + 1 })),
  ),
);
let spent = 0;
const records: RunRecord[] = [];

async function runJob({ s, model, repeat }: (typeof jobs)[number]): Promise<RunRecord> {
  const m = MODELS[model];
  const started = Date.now();
  const base = { scenarioId: s.id, model, repeat };
  try {
    const res = await client.messages.create({
      model: m.id,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: outputFormat },
      messages: [{ role: 'user', content: s.prompt }],
    });
    const u = res.usage;
    const usage = {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    };
    const costUsd =
      (usage.input * m.input +
        usage.output * m.output +
        usage.cacheWrite * m.cacheWrite +
        usage.cacheRead * m.cacheRead) /
      1e6;
    spent += costUsd;
    const text = res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = { unparsedText: text.slice(0, 2000) };
    }
    const file = join(outDir, 'outputs', `${model}-${s.id}-${repeat}.json`);
    writeFileSync(file, JSON.stringify({ stopReason: res.stop_reason, raw }, null, 2));
    const latencyMs = Date.now() - started;
    const parsed = Generation.safeParse(raw);
    if (!parsed.success) {
      return {
        ...base,
        ok: false,
        error: `generation schema (stop=${res.stop_reason}): ${parsed.error.issues
          .slice(0, 2)
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
        latencyMs,
        usage,
        costUsd,
        score: scoreCandidate(s, null),
      };
    }
    const project = toProject(parsed.data, s.id);
    writeFileSync(file.replace(/\.json$/, '.project.json'), JSON.stringify(project, null, 2));
    const score = scoreCandidate(s, project);
    const findingsByRule: Record<string, number> = {};
    if (score.schemaValid) {
      for (const f of validateProject(project, awsCatalog)) {
        const key = `${f.ruleId ?? 'structural'}:${f.severity}`;
        findingsByRule[key] = (findingsByRule[key] ?? 0) + 1;
      }
    }
    return {
      ...base,
      ok: true,
      latencyMs,
      usage,
      costUsd,
      nodes: project.nodes.length,
      unresolved: parsed.data.nodes.flatMap((n) => (n.unresolved ? [n.unresolved.name] : [])),
      findingsByRule,
      score,
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
      costUsd: 0,
    };
  }
}

let next = 0;
async function worker() {
  while (next < jobs.length) {
    if (spent >= maxUsd) return;
    const job = jobs[next++]!;
    const r = await runJob(job);
    records.push(r);
    const status = r.ok ? (r.score?.passed ? 'PASS' : 'fail') : `ERROR ${r.error}`;
    console.log(
      `${r.model.padEnd(6)} ${r.scenarioId.padEnd(26)} #${r.repeat} ${status} $${r.costUsd.toFixed(4)} ${(r.latencyMs / 1000).toFixed(1)}s`,
    );
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));

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
const summary = models.map((model) => {
  const rs = records.filter((r) => r.model === model);
  const scored = rs.filter((r) => r.score);
  return {
    model: MODELS[model].id,
    runs: rs.length,
    errors: rs.filter((r) => !r.ok).length,
    schemaValidRate: mean(scored.map((r) => (r.score!.schemaValid ? 1 : 0))),
    passRate: mean(scored.map((r) => (r.score!.passed ? 1 : 0))),
    meanRecall: mean(scored.map((r) => r.score!.requirementRecall)),
    errorFindingsTotal: scored.reduce((a, r) => a + r.score!.errorFindings, 0),
    meanInputTokens: Math.round(
      mean(
        rs
          .filter((r) => r.usage)
          .map((r) => r.usage!.input + r.usage!.cacheWrite + r.usage!.cacheRead),
      ),
    ),
    meanOutputTokens: Math.round(mean(rs.filter((r) => r.usage).map((r) => r.usage!.output))),
    meanCostUsd: mean(rs.map((r) => r.costUsd)),
    medianLatencyS: median(rs.map((r) => r.latencyMs / 1000)),
    totalCostUsd: rs.reduce((a, r) => a + r.costUsd, 0),
  };
});

writeFileSync(join(outDir, 'records.json'), JSON.stringify(records, null, 2));
writeFileSync(
  join(outDir, 'summary.json'),
  JSON.stringify({ runId, repeats, scenarios: scenarios.length, summary }, null, 2),
);
console.table(summary);
console.log(
  `total spent: $${spent.toFixed(2)}${spent >= maxUsd ? ' (stopped at --max-usd)' : ''}; results: ${outDir}`,
);

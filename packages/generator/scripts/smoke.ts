/**
 * Live smoke test: extraction plus generation for the myblog prompt with backups enabled.
 * Prints only question topics, node count, findings by rule and cost (never prompts or graphs).
 *
 * Usage: pnpm --filter @cloudarchitect/generator smoke [--model haiku|sonnet] [--max-usd 0.1]
 * Reads ANTHROPIC_API_KEY from the environment or the repo-root .env.
 */
import { awsCatalog } from '@cloudarchitect/catalog';
import { ModelChoice, validateProject, type DesignToggles } from '@cloudarchitect/domain';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  anthropicClient,
  extract,
  GenerationError,
  generateArchitecture,
  PRICES,
  type CallUsage,
  type LlmClient,
} from '../src/index.js';

const repo = new URL('../../..', import.meta.url).pathname;
const envFile = join(repo, '.env');
if (!process.env.ANTHROPIC_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

const { values: args } = parseArgs({
  options: {
    model: { type: 'string', default: 'haiku' },
    'max-usd': { type: 'string', default: '0.1' },
  },
});
const model = ModelChoice.parse(args.model);
const maxUsd = Number(args['max-usd']);
const toggles: DesignToggles = { backups: true };
const { prompt } = JSON.parse(readFileSync(join(repo, 'eval/scenarios/myblog.json'), 'utf8')) as {
  prompt: string;
};

let spentMicro = 0;
const real = anthropicClient(process.env.ANTHROPIC_API_KEY);
/** Refuses any call whose worst case (all input uncached, full output) would pass --max-usd. */
const llm: LlmClient = async (req) => {
  const p = PRICES[req.model as keyof typeof PRICES];
  const inputTokens = (req.system.length + JSON.stringify(req.messages).length) / 3;
  const worst = inputTokens * p.cacheWrite + req.maxTokens * p.output;
  if (spentMicro + worst > maxUsd * 1e6)
    throw new Error(`Stopped: the next call could pass --max-usd ${maxUsd}`);
  return real(req);
};
const total = (usage: CallUsage[]) => usage.reduce((a, u) => a + u.costMicroUsd, 0);

const ex = await extract(llm, { prompt, toggles });
spentMicro += total(ex.usage);
console.log(`questions: ${ex.questions.map((q) => q.topic).join(', ') || '(none)'}`);
try {
  const r = await generateArchitecture(llm, awsCatalog, {
    prompt,
    toggles,
    model,
    name: ex.name,
    requirements: ex.requirements,
    assumptions: ex.assumptions,
    questions: ex.questions,
    answers: {},
  });
  spentMicro += total(r.usage);
  const byRule: Record<string, number> = {};
  for (const f of validateProject(r.project, awsCatalog)) {
    const key = `${f.ruleId ?? 'structural'}:${f.severity}`;
    byRule[key] = (byRule[key] ?? 0) + 1;
  }
  console.log(`generation calls: ${r.usage.length}; nodes: ${r.project.nodes.length}`);
  console.log('findings by rule:', byRule);
} catch (err) {
  if (err instanceof GenerationError) spentMicro += total(err.usage);
  console.log(`generation failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  console.log(`total cost: $${(spentMicro / 1e6).toFixed(6)}`);
}

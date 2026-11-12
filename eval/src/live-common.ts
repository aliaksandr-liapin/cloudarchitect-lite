/**
 * Shared by the live eval CLIs (`live.ts`, `info-repair.ts`): provider clients from the
 * environment or the repo-root .env, scenario loading, the cap-checked LLM wrapper and the
 * extraction/answers step. Nothing here prints model text.
 */
import { ModelChoice, modelOption, YOU_DECIDE, type Provider } from '@cloudarchitect/domain';
import {
  anthropicClient,
  costMicroUsd,
  extract,
  extractionModel,
  googleClient,
  openaiClient,
  type GenerateInput,
  type LlmClient,
} from '@cloudarchitect/generator';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_VAR } from './gate.js';
import { Scenario } from './harness.js';

/** The eval package directory. */
export const evalRoot = new URL('..', import.meta.url).pathname;

const PROVIDER_CLIENT: Record<Provider, (apiKey: string) => LlmClient> = {
  anthropic: anthropicClient,
  openai: openaiClient,
  google: googleClient,
};

/** One client per provider that has a key (loading the repo-root .env when a key is missing). */
export function loadClients(): Partial<Record<Provider, LlmClient>> {
  const envFile = join(evalRoot, '..', '.env');
  if (Object.values(KEY_VAR).some((v) => !process.env[v]) && existsSync(envFile))
    process.loadEnvFile(envFile);
  const clients: Partial<Record<Provider, LlmClient>> = {};
  for (const p of Object.keys(KEY_VAR) as Provider[]) {
    const key = process.env[KEY_VAR[p]];
    if (key) clients[p] = PROVIDER_CLIENT[p](key);
  }
  return clients;
}

export const positiveInt = (name: string, v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
};

export function parseModels(list: string): ModelChoice[] {
  return list.split(',').map((m) => ModelChoice.parse(m));
}

/** All benchmark scenarios, or the ones named in the comma-separated `wanted` list. */
export function loadScenarios(wanted?: string): Scenario[] {
  const dir = join(evalRoot, 'scenarios');
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => Scenario.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
  const ids = wanted?.split(',');
  const unknown = ids?.filter((id) => !all.some((s) => s.id === id)) ?? [];
  if (unknown.length) throw new Error(`Unknown scenarios: ${unknown.join(', ')}`);
  return ids ? all.filter((s) => ids.includes(s.id)) : all;
}

export class SpendCapReached extends Error {}

/** One shared spend cap across all jobs of a run. */
export class Budget {
  spentMicro = 0;
  /** Set when the cap stopped a call or left jobs unscheduled. */
  cutShort = false;
  readonly capMicro: number;
  constructor(readonly maxUsd: number) {
    this.capMicro = maxUsd * 1e6;
  }
  get exhausted() {
    return this.spentMicro >= this.capMicro;
  }
}

export type CallRecord = {
  model: string;
  stopReason: string | null;
  outputTokens: number;
  costUsd: number;
};

/**
 * Wraps a real client for one job: the cap is checked before every call and each call's cost is
 * counted as soon as it returns. Records stop reason and tokens only, never content.
 */
export function meteredClient(real: LlmClient, budget: Budget) {
  const meter = { jobMicro: 0, lastText: '', calls: [] as CallRecord[] };
  const llm: LlmClient = async (req) => {
    if (budget.exhausted) {
      budget.cutShort = true;
      throw new SpendCapReached(`--max-usd ${budget.maxUsd} reached`);
    }
    const res = await real(req);
    const cost = costMicroUsd(req.model, res.usage);
    budget.spentMicro += cost;
    meter.jobMicro += cost;
    meter.calls.push({
      model: req.model,
      stopReason: res.stopReason,
      outputTokens: res.usage.output,
      costUsd: cost / 1e6,
    });
    meter.lastText = res.text;
    return res;
  };
  return { llm, meter };
}

/** Extraction, then the scenario's answers (or You decide) for each question asked. */
export async function extractWithAnswers(llm: LlmClient, s: Scenario, model: ModelChoice) {
  const ex = await extract(
    llm,
    { prompt: s.prompt, toggles: s.toggles },
    extractionModel(modelOption(model).provider),
  );
  const answers = Object.fromEntries(
    ex.questions.map((q) => [q.topic, s.answers[q.topic] ?? YOU_DECIDE]),
  );
  const input: GenerateInput = {
    prompt: s.prompt,
    toggles: s.toggles,
    model,
    name: ex.name,
    requirements: ex.requirements,
    assumptions: ex.assumptions,
    questions: ex.questions,
    answers,
  };
  return { input, questionTopics: ex.questions.map((q) => q.topic), usage: ex.usage };
}

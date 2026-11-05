import { z } from 'zod';

/**
 * AI model options (ADR-0011), shared by the gateway, the setup wizard and the editor.
 * Benchmarks come from the Phase 2 Gate A live runs and blind review (docs/product/phase2-gate-a.md);
 * update them only from a new eval run.
 */
export const ModelChoice = z.enum([
  'haiku',
  'sonnet',
  'gpt-luna',
  'gpt-sol',
  'gemini-flash-lite',
  'gemini-argon',
]);
export type ModelChoice = z.infer<typeof ModelChoice>;

export type Provider = 'anthropic' | 'openai' | 'google';
export const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google'];
export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Gemini',
};

export interface ModelBenchmark {
  measuredAt: string;
  runId: string;
  /** Live-eval generations scored by the eval harness (scenarios × repeats), not the number of blind-reviewed designs. */
  runs: number;
  schemaValidRate: number;
  /** Share of runs passing all automated checks (eval harness). */
  passRate: number;
  /** Median blind rubric score, 0–3 (PRD §14). Absent until a blind review has run. */
  blindMedianScore?: number;
  /**
   * Share of blind-reviewed scenarios without a critical defect. Not the same population per model:
   * Haiku's covers 12 scenarios including 3 toggle scenarios, Sonnet's the 9 base scenarios.
   */
  noCriticalDefectRate?: number;
  majorDefects?: number;
  /** Mean cost of one generation in USD, at the provider price list of the measurement date. */
  costPerOperationUsd: number;
  medianLatencySeconds: number;
}

export interface ModelOption {
  id: ModelChoice;
  provider: Provider;
  model: string;
  label: string;
  summary: string;
  /** Validator-driven repair turns after the first draft. */
  repairTurns: number;
  /** Absent until a live eval run exists; such a model is not listed (`listedModels`). */
  benchmark?: ModelBenchmark;
}

const GATE_A = { measuredAt: '2026-10-18' };

export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: 'haiku',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    summary: 'Fast and economical. Meets the quality bar; designs need more review.',
    repairTurns: 1,
    benchmark: {
      ...GATE_A,
      runId: '2026-10-18T22-11-01-773Z',
      runs: 44,
      schemaValidRate: 1,
      passRate: 0.932,
      blindMedianScore: 2.29,
      noCriticalDefectRate: 0.917,
      majorDefects: 10,
      costPerOperationUsd: 0.0067,
      medianLatencySeconds: 49,
    },
  },
  {
    id: 'sonnet',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    summary: 'Best quality: preferred in 7 of 9 blind comparisons, about 7× the cost.',
    repairTurns: 0,
    benchmark: {
      ...GATE_A,
      runId: '2026-10-18T22-24-06-777Z',
      runs: 15,
      schemaValidRate: 1,
      passRate: 0.933,
      blindMedianScore: 2.57,
      noCriticalDefectRate: 1,
      majorDefects: 3,
      costPerOperationUsd: 0.0454,
      medianLatencySeconds: 27,
    },
  },
  {
    id: 'gpt-luna',
    provider: 'openai',
    model: 'gpt-6-luna',
    label: 'GPT-6 Luna',
    summary: 'Economical OpenAI model.',
    repairTurns: 1,
  },
  {
    id: 'gpt-sol',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    summary: 'Best-quality OpenAI model.',
    repairTurns: 0,
  },
  {
    id: 'gemini-flash-lite',
    provider: 'google',
    model: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    summary: 'Economical Gemini model.',
    repairTurns: 1,
  },
  {
    id: 'gemini-argon',
    provider: 'google',
    model: 'gemini-4-argon',
    label: 'Gemini 4 Argon (December price; $2/$10 until 2026-11-30)',
    summary: 'Best-quality Gemini model.',
    repairTurns: 0,
  },
];

export const modelOption = (id: ModelChoice) => MODEL_OPTIONS.find((m) => m.id === id)!;

/** Options with a measured benchmark; a model with no run is not shown (spec §6). */
export const listedModels = (): ModelOption[] => MODEL_OPTIONS.filter((m) => m.benchmark);

/** Defaults: Haiku is enabled and the default model until the setup wizard changes it. */
export const MODEL_POLICY = {
  defaultEnabledModels: ['haiku'],
  defaultModel: 'haiku',
} as const satisfies {
  defaultEnabledModels: readonly ModelChoice[];
  defaultModel: ModelChoice;
};

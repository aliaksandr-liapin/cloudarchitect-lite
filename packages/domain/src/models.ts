import { z } from 'zod';

/**
 * AI model options (ADR-0011), shared by the gateway, the setup wizard and the editor.
 * Benchmarks come from the 0.3 live runs and three-provider blind review of 2026-11-05
 * (docs/product/phase3-provider-benchmark.md); update them only from a new eval run. A model is
 * listed only if it meets the listing bar (`LISTING_BAR` in eval/src/gate.ts).
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
   * Share of blind-reviewed designs without a critical defect (majority of reviewers). Not the same
   * population per tier: economical models cover 12 scenarios (9 base + 3 toggle scenarios),
   * best-quality models the 9 base scenarios.
   */
  noCriticalDefectRate?: number;
  /** Major defects summed over the blind-reviewed designs (median over reviewers per design). */
  majorDefects?: number;
  /** Mean cost of one generation in USD, at the provider price list in force on the release date (Argon: December price). */
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

const MEASURED = { measuredAt: '2026-11-05' };

export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: 'haiku',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    summary:
      'Cheapest listed model, about 7× cheaper than Sonnet. No critical defects; preferred over the economical GPT and Gemini models in 23 of 24 blind pairs.',
    repairTurns: 1,
    benchmark: {
      ...MEASURED,
      runId: '2026-11-05T07-56-51-552Z',
      runs: 44,
      schemaValidRate: 1,
      passRate: 0.864,
      blindMedianScore: 2.52,
      noCriticalDefectRate: 1,
      majorDefects: 8,
      costPerOperationUsd: 0.0071,
      medianLatencySeconds: 53,
    },
  },
  {
    id: 'sonnet',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    summary:
      'Passed every automated check and is the fastest best-quality model. GPT-6.1 Sol was preferred over it in 9 of 9 blind pairs.',
    repairTurns: 0,
    benchmark: {
      ...MEASURED,
      runId: '2026-11-05T08-14-50-217Z',
      runs: 15,
      schemaValidRate: 1,
      passRate: 1,
      blindMedianScore: 2.55,
      noCriticalDefectRate: 1,
      majorDefects: 9,
      costPerOperationUsd: 0.049,
      medianLatencySeconds: 30,
    },
  },
  {
    id: 'gpt-luna',
    provider: 'openai',
    model: 'gpt-6-luna',
    label: 'GPT-6 Luna',
    summary: 'Economical OpenAI model. Not listed: below the listing bar in the 0.3 benchmark.',
    repairTurns: 1,
  },
  {
    id: 'gpt-sol',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    summary:
      'Highest blind score, preferred over Sonnet in 9 of 9 blind pairs, one major defect. Slowest of the listed models; passed 87% of automated checks.',
    repairTurns: 0,
    benchmark: {
      ...MEASURED,
      runId: '2026-11-05T08-10-20-537Z',
      runs: 15,
      schemaValidRate: 1,
      passRate: 0.867,
      blindMedianScore: 2.86,
      noCriticalDefectRate: 1,
      majorDefects: 1,
      costPerOperationUsd: 0.044,
      medianLatencySeconds: 65,
    },
  },
  {
    id: 'gemini-flash-lite',
    provider: 'google',
    model: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    summary: 'Economical Gemini model. Not listed: below the listing bar in the 0.3 benchmark.',
    repairTurns: 1,
  },
  {
    id: 'gemini-argon',
    provider: 'google',
    model: 'gemini-4-argon',
    label: 'Gemini 4 Argon',
    summary:
      'Passed every automated check; one critical defect in 9 reviewed designs. Highest cost, about 2.4× Sonnet at the December price ($4/$20; $2/$10 until 2026-11-30).',
    repairTurns: 0,
    benchmark: {
      ...MEASURED,
      runId: '2026-11-05T08-06-49-090Z',
      runs: 15,
      schemaValidRate: 1,
      passRate: 1,
      blindMedianScore: 2.43,
      noCriticalDefectRate: 0.889,
      majorDefects: 11,
      costPerOperationUsd: 0.1197,
      medianLatencySeconds: 50,
    },
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

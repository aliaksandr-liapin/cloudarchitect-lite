import { z } from 'zod';

/**
 * AI model options (ADR-0011), shared by the gateway, the setup wizard and the editor.
 * Benchmarks come from the Phase 0 round 3 run and blind review (docs/product/PHASE0_SPIKE.md);
 * update them only from a new eval run.
 */
export const ModelChoice = z.enum(['haiku', 'sonnet']);
export type ModelChoice = z.infer<typeof ModelChoice>;

export interface ModelBenchmark {
  measuredAt: string;
  runId: string;
  /** Generations scored by the eval harness (15 scenarios × 3 repeats). */
  runs: number;
  schemaValidRate: number;
  /** Share of runs passing all automated checks (eval harness). */
  passRate: number;
  /** Median blind rubric score, 0–3 (PRD §14). */
  blindMedianScore: number;
  /** Share of reviewed scenarios without a critical defect. */
  noCriticalDefectRate: number;
  majorDefects: number;
  /** Mean cost of one generation in USD, at the provider price list of the measurement date. */
  costPerOperationUsd: number;
  medianLatencySeconds: number;
}

export interface ModelOption {
  id: ModelChoice;
  provider: 'anthropic';
  model: string;
  label: string;
  summary: string;
  /** Validator-driven repair turns after the first draft. */
  repairTurns: number;
  benchmark: ModelBenchmark;
}

const ROUND_3 = { measuredAt: '2026-10-14', runId: '2026-10-14T05-14-37-270Z', runs: 45 };

export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: 'haiku',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    summary: 'Fast and economical. Meets the quality bar; designs need more review.',
    repairTurns: 1,
    benchmark: {
      ...ROUND_3,
      schemaValidRate: 1,
      passRate: 0.956,
      blindMedianScore: 2.29,
      noCriticalDefectRate: 1,
      majorDefects: 13,
      costPerOperationUsd: 0.0061,
      medianLatencySeconds: 44,
    },
  },
  {
    id: 'sonnet',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    summary: 'Best quality: preferred in every blind comparison, about 13× the cost.',
    repairTurns: 0,
    benchmark: {
      ...ROUND_3,
      schemaValidRate: 1,
      passRate: 0.933,
      blindMedianScore: 2.86,
      noCriticalDefectRate: 1,
      majorDefects: 4,
      costPerOperationUsd: 0.08,
      medianLatencySeconds: 51,
    },
  },
];

export const modelOption = (id: ModelChoice) => MODEL_OPTIONS.find((m) => m.id === id)!;

/** Defaults: the instance's own key serves Haiku (free tier); Sonnet is the own-key default. */
export const MODEL_POLICY = {
  freeTierModels: ['haiku'],
  defaultModel: 'haiku',
  byokDefault: 'sonnet',
} as const satisfies {
  freeTierModels: readonly ModelChoice[];
  defaultModel: ModelChoice;
  byokDefault: ModelChoice;
};

import { z } from 'zod';

/**
 * AI model options (ADR-0011), shared by the gateway, the setup wizard and the editor.
 * Benchmarks come from the Phase 2 Gate A live runs and blind review (docs/product/phase2-gate-a.md);
 * update them only from a new eval run.
 */
export const ModelChoice = z.enum(['haiku', 'sonnet']);
export type ModelChoice = z.infer<typeof ModelChoice>;

export interface ModelBenchmark {
  measuredAt: string;
  runId: string;
  /** Live-eval generations scored by the eval harness (scenarios × repeats), not the number of blind-reviewed designs. */
  runs: number;
  schemaValidRate: number;
  /** Share of runs passing all automated checks (eval harness). */
  passRate: number;
  /** Median blind rubric score, 0–3 (PRD §14). */
  blindMedianScore: number;
  /**
   * Share of blind-reviewed scenarios without a critical defect. Not the same population per model:
   * Haiku's covers 12 scenarios including 3 toggle scenarios, Sonnet's the 9 base scenarios.
   */
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

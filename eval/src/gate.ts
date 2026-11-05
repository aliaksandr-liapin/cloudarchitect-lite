import { modelOption, type ModelChoice, type Provider } from '@cloudarchitect/domain';

/** Env var holding each provider's API key. */
export const KEY_VAR: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
};

/**
 * The requested models whose provider has a key. A missing key is a warning, except with `--gate`:
 * there it fails the run, so a missing CI secret can never produce a green gate.
 */
export function modelsWithKeys(
  requested: readonly ModelChoice[],
  hasKey: (p: Provider) => boolean,
  gate: boolean,
): { models: ModelChoice[]; warnings: string[]; failures: string[] } {
  const models: ModelChoice[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  for (const m of requested) {
    const provider = modelOption(m).provider;
    if (hasKey(provider)) models.push(m);
    else if (gate) failures.push(`${m}: ${KEY_VAR[provider]} not set — gate failed`);
    else warnings.push(`${m}: ${KEY_VAR[provider]} not set — skipped`);
  }
  return { models, warnings, failures };
}

/** Summary of one model's live generator runs, as written to `summary.json`. */
export interface LiveSummary {
  model: string;
  runs: number;
  schemaValidRate: number;
  passRate: number;
  /** Forbidden services used, summed over all runs. */
  forbiddenServiceHits: number;
  meanCostUsd: number;
  medianLatencyS: number;
  totalCostUsd: number;
}

/** Regression gate for the live generator: quality floors and a cost ceiling relative to the benchmark. */
export const LIVE_GATE = {
  schemaValidRate: 1,
  passRate: 0.85,
  forbiddenServiceHits: 0,
  maxCostFactor: 1.5,
} as const;

/**
 * Bar a model must meet to be listed in `MODEL_OPTIONS` with a benchmark (product owner, 2026-11-05;
 * docs/product/phase3-provider-benchmark.md). The same absolute bar for both tiers.
 */
export const LISTING_BAR = {
  schemaValidRate: 1,
  passRate: 0.85,
  noCriticalDefectRate: 0.85,
  blindMedianScore: 2.0,
} as const;

/** `benchmarkCostUsd` is the model's `benchmark.costPerOperationUsd`; the cost check is skipped when undefined. Every failed check is listed. */
export function evaluateGate(
  s: LiveSummary,
  benchmarkCostUsd: number | undefined,
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (s.schemaValidRate < LIVE_GATE.schemaValidRate)
    failures.push(
      `${s.model}: schema-valid rate ${s.schemaValidRate.toFixed(3)} < ${LIVE_GATE.schemaValidRate}`,
    );
  if (s.passRate < LIVE_GATE.passRate)
    failures.push(`${s.model}: pass rate ${s.passRate.toFixed(3)} < ${LIVE_GATE.passRate}`);
  if (s.forbiddenServiceHits > LIVE_GATE.forbiddenServiceHits)
    failures.push(
      `${s.model}: ${s.forbiddenServiceHits} forbidden service hits > ${LIVE_GATE.forbiddenServiceHits}`,
    );
  if (benchmarkCostUsd !== undefined) {
    const maxCost = benchmarkCostUsd * LIVE_GATE.maxCostFactor;
    if (s.meanCostUsd > maxCost)
      failures.push(
        `${s.model}: mean cost $${s.meanCostUsd.toFixed(4)} > $${maxCost.toFixed(4)} (${LIVE_GATE.maxCostFactor}x benchmark)`,
      );
  }
  return { passed: failures.length === 0, failures };
}

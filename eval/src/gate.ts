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
  passRate: 0.9,
  forbiddenServiceHits: 0,
  maxCostFactor: 1.5,
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

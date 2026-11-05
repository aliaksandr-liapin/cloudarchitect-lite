import { modelOption } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { evaluateGate, type LiveSummary } from './gate.js';

const benchmark = modelOption('haiku').benchmark!.costPerOperationUsd;
const ok: LiveSummary = {
  model: 'haiku',
  runs: 22,
  schemaValidRate: 1,
  passRate: 0.91,
  forbiddenServiceHits: 0,
  meanCostUsd: 0.009,
  medianLatencyS: 40,
  totalCostUsd: 0.2,
};

describe('live regression gate', () => {
  it('passes at schema 1, pass rate 0.91 and cost 0.009', () => {
    expect(evaluateGate(ok, benchmark)).toEqual({ passed: true, failures: [] });
  });

  it('skips the cost check when the model has no benchmark cost', () => {
    const r = evaluateGate({ ...ok, meanCostUsd: 5 }, undefined);
    expect(r).toEqual({ passed: true, failures: [] });
  });

  it('fails below the schema-valid rate', () => {
    const r = evaluateGate({ ...ok, schemaValidRate: 0.95 }, benchmark);
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
  });

  it('fails below the pass rate', () => {
    const r = evaluateGate({ ...ok, passRate: 0.85 }, benchmark);
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
  });

  it('fails above 1.5x the benchmark cost', () => {
    const r = evaluateGate({ ...ok, meanCostUsd: benchmark * 1.5 + 0.0001 }, benchmark);
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
  });

  it('lists every failure', () => {
    const r = evaluateGate(
      {
        ...ok,
        schemaValidRate: 0.95,
        passRate: 0.85,
        forbiddenServiceHits: 2,
        meanCostUsd: 0.02,
      },
      benchmark,
    );
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(4);
  });
});

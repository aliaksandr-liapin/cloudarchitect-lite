import { listedModels, modelOption } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { evaluateGate, LISTING_BAR, LIVE_GATE, modelsWithKeys, type LiveSummary } from './gate.js';

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
    const r = evaluateGate({ ...ok, passRate: 0.84 }, benchmark);
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
        passRate: 0.84,
        forbiddenServiceHits: 2,
        meanCostUsd: 0.02,
      },
      benchmark,
    );
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(4);
  });
});

describe('listed models', () => {
  it('match the live gate pass-rate floor', () => {
    expect(LIVE_GATE.passRate).toBe(LISTING_BAR.passRate);
  });

  it.each(listedModels().map((o) => [o.id, o.benchmark!] as const))(
    '%s meets the listing bar',
    (_id, b) => {
      expect(b.schemaValidRate).toBe(LISTING_BAR.schemaValidRate);
      expect(b.passRate).toBeGreaterThanOrEqual(LISTING_BAR.passRate);
      if (b.noCriticalDefectRate !== undefined)
        expect(b.noCriticalDefectRate).toBeGreaterThanOrEqual(LISTING_BAR.noCriticalDefectRate);
      if (b.blindMedianScore !== undefined)
        expect(b.blindMedianScore).toBeGreaterThanOrEqual(LISTING_BAR.blindMedianScore);
    },
  );
});

describe('models without a provider key', () => {
  const has = (p: string) => p === 'anthropic';

  it('are skipped with a warning without --gate', () => {
    const r = modelsWithKeys(['haiku', 'gpt-sol'], has, false);
    expect(r.models).toEqual(['haiku']);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual(['gpt-sol: OPENAI_API_KEY not set — skipped']);
  });

  it('fail the gate, so a missing CI secret cannot pass', () => {
    const r = modelsWithKeys(['haiku', 'gemini-argon'], has, true);
    expect(r.models).toEqual(['haiku']);
    expect(r.failures).toEqual(['gemini-argon: GEMINI_API_KEY not set — gate failed']);
    expect(modelsWithKeys(['gpt-sol'], () => false, true).failures).toHaveLength(1);
    expect(modelsWithKeys(['haiku'], has, true)).toEqual({
      models: ['haiku'],
      warnings: [],
      failures: [],
    });
  });
});

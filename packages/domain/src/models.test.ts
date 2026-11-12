import { describe, expect, it } from 'vitest';
import { ModelChoice, MODEL_OPTIONS, PROVIDERS, listedModels, modelOption } from './models.js';

describe('model options', () => {
  it('has exactly one option per model choice', () => {
    for (const id of ModelChoice.options) {
      expect(MODEL_OPTIONS.filter((o) => o.id === id)).toHaveLength(1);
    }
    expect(MODEL_OPTIONS).toHaveLength(ModelChoice.options.length);
  });

  it('maps gpt-sol to OpenAI gpt-6.1-sol', () => {
    expect(modelOption('gpt-sol').provider).toBe('openai');
    expect(modelOption('gpt-sol').model).toBe('gpt-6.1-sol');
  });

  it('lists providers in order and only uses known ones', () => {
    expect(PROVIDERS).toEqual(['anthropic', 'openai', 'google']);
    for (const o of MODEL_OPTIONS) expect(PROVIDERS).toContain(o.provider);
  });

  it('lists only models with a benchmark', () => {
    expect(listedModels().map((o) => o.id)).toEqual(['haiku', 'sonnet', 'gpt-sol', 'gemini-argon']);
  });

  it('sends info findings to repair only for GPT Luna, never VR-015', () => {
    const withInfo = MODEL_OPTIONS.filter((o) => o.repairInfoRules?.length);
    expect(withInfo.map((o) => o.id)).toEqual(['gpt-luna']);
    expect(modelOption('gpt-luna').repairInfoRules).toEqual([
      'VR-005',
      'VR-007',
      'VR-008',
      'VR-013',
      'VR-024',
    ]);
  });
});

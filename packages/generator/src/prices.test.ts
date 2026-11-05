import { describe, expect, it } from 'vitest';
import { costMicroUsd, extractionModel } from './prices.js';

const zero = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

describe('costMicroUsd', () => {
  it('prices one million Haiku input tokens at $0.10', () => {
    expect(costMicroUsd('claude-haiku-5-5', { ...zero, input: 1e6 })).toBe(100000);
  });
  it('rounds up to a whole micro-dollar', () => {
    expect(costMicroUsd('claude-haiku-5-5', { ...zero, cacheRead: 1 })).toBe(1);
  });
  it('throws for an unknown model', () => {
    expect(() => costMicroUsd('gpt-x', zero)).toThrow(/Unknown model/);
  });
});

describe('provider prices', () => {
  it('prices one million GPT-6 Luna input tokens at $0.10', () => {
    expect(costMicroUsd('gpt-6-luna', { ...zero, input: 1e6 })).toBe(100_000);
  });
  it('prices one million Gemini 4 Argon output tokens at $20', () => {
    expect(costMicroUsd('gemini-4-argon', { ...zero, output: 1e6 })).toBe(20_000_000);
  });
  it('picks the economical extraction model per provider', () => {
    expect(extractionModel('anthropic')).toBe('claude-haiku-5-5');
    expect(extractionModel('openai')).toBe('gpt-6-luna');
    expect(extractionModel('google')).toBe('gemini-3.5-flash-lite');
  });
});

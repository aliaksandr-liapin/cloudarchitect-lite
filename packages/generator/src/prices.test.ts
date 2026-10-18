import { describe, expect, it } from 'vitest';
import { costMicroUsd } from './prices.js';

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

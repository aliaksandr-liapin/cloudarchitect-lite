import type { TokenUsage } from './llm.js';

/** USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing (2026-10-13). */
export const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
} as const;

export const EXTRACTION_MODEL = 'claude-haiku-5-5';

/** Cost of one call in millionths of a USD (USD per MTok equals micro-USD per token), rounded up. */
export function costMicroUsd(model: string, u: TokenUsage): number {
  const p = (PRICES as Record<string, (typeof PRICES)[keyof typeof PRICES]>)[model];
  if (!p) throw new Error(`Unknown model ${model}`);
  return Math.ceil(
    u.input * p.input +
      u.output * p.output +
      u.cacheWrite * p.cacheWrite +
      u.cacheRead * p.cacheRead,
  );
}

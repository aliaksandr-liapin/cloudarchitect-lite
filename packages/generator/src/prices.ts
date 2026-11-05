import type { Provider } from '@cloudarchitect/domain';
import type { CallUsage, TokenUsage } from './llm.js';

/**
 * USD per million tokens. Claude: https://platform.claude.com/docs/en/about-claude/pricing (2026-10-13).
 * OpenAI: https://developers.openai.com/api/docs/pricing, Gemini: https://aistudio.google.com/docs/pricing (2026-11-04).
 * For OpenAI and Gemini, `cacheWrite` is the plain input price (no separate write fee) and `cacheRead` the cached input price.
 */
export const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'gpt-6-luna': { input: 0.1, output: 0.5, cacheWrite: 0.1, cacheRead: 0.01 },
  'gpt-6.1-sol': { input: 2, output: 10, cacheWrite: 2, cacheRead: 0.1 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.03 },
  'gemini-4-argon': { input: 4, output: 20, cacheWrite: 4, cacheRead: 0.2 },
} as const;

const EXTRACTION_MODELS: Record<Provider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-6-luna',
  google: 'gemini-3.5-flash-lite',
};

/** The economical model that runs the extraction step for a provider. */
export const extractionModel = (provider: Provider): string => EXTRACTION_MODELS[provider];

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

/** Usage record of one call, priced for the spend counters. */
export function callUsage(model: string, usage: TokenUsage): CallUsage {
  return { model, usage, costMicroUsd: costMicroUsd(model, usage) };
}

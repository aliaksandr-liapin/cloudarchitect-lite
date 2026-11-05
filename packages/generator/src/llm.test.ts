import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicClient, jsonOutputFormat, type AnthropicLike } from './llm.js';

const baseReq = {
  model: 'claude-haiku-5-5',
  system: 'SYS',
  maxTokens: 500,
  format: jsonOutputFormat(z.object({ name: z.string() })),
  messages: [{ role: 'user' as const, content: 'hi' }],
};

const fakeSdk = (finalMessage: () => Promise<unknown>): AnthropicLike => ({
  messages: { stream: () => ({ finalMessage }) as never },
});

describe('anthropicClient', () => {
  it('maps the response text and usage', async () => {
    const res = await anthropicClient(
      'k',
      fakeSdk(async () => ({
        content: [{ type: 'text', text: '{"name":"x"}' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2 },
        stop_reason: 'end_turn',
      })),
    )(baseReq);
    expect(res).toEqual({
      text: '{"name":"x"}',
      usage: { input: 10, output: 5, cacheWrite: 2, cacheRead: 0 },
      stopReason: 'end_turn',
    });
  });

  it('keeps the key out of error messages', async () => {
    const sdk = fakeSdk(async () => {
      throw Object.assign(new Error('401 invalid x-api-key: sk-ant-test-SECRET'), { status: 401 });
    });
    const err = await anthropicClient('sk-ant-test-SECRET', sdk)(baseReq).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('SECRET');
    expect((err as { status?: number }).status).toBe(401);
  });
});

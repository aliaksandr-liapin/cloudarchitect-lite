/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { geminiSdk, googleClient, geminiSchema } from './google.js';
import { jsonOutputFormat } from './llm.js';

const schema = z.object({
  kind: z.enum(['a', 'b']),
  containerId: z.string().nullable(),
  note: z.string().optional(),
  items: z.array(z.object({ k: z.enum(['x', 'y']) })),
  more: z.array(z.object({ k: z.enum(['x', 'y']) })),
});
const baseReq = {
  model: 'gemini-3.5-flash-lite',
  system: 'SYS',
  maxTokens: 500,
  format: jsonOutputFormat(schema),
  messages: [
    { role: 'user' as const, content: 'hi' },
    { role: 'assistant' as const, content: 'yo' },
    { role: 'user' as const, content: 'again' },
  ],
};

function fakeSdk(impl: (params: any) => AsyncGenerator<any>) {
  const calls: any[] = [];
  return {
    calls,
    sdk: {
      models: {
        generateContentStream: async (params: any) => {
          calls.push(params);
          return impl(params);
        },
      },
    },
  };
}

function chunks(...cs: any[]) {
  return async function* () {
    for (const c of cs) yield c;
  };
}

describe('geminiSchema', () => {
  it('inlines $ref/$defs, keeps enum, drops unsupported keywords, does not mutate', () => {
    const json = (baseReq.format as any).schema;
    const copy = structuredClone(json);
    const s = geminiSchema(json);
    const text = JSON.stringify(s);
    expect(text).not.toContain('$ref');
    expect(text).not.toContain('$defs');
    expect(text).not.toContain('$schema');
    expect(text.match(/"enum":\["x","y"\]/g)?.length).toBe(2);
    expect(text).toContain('"enum":["a","b"]');
    expect(json).toEqual(copy);
  });
  it('removes unsupported keywords but keeps property names', () => {
    const s = geminiSchema({
      type: 'object',
      properties: { default: { type: 'string', pattern: '^a', default: 'a' }, c: { const: 'q' } },
      required: ['c'],
      additionalProperties: false,
    }) as any;
    expect(s.properties.default).toEqual({ type: 'string' });
    expect(s.properties.c).toEqual({ enum: ['q'] });
    expect(s.required).toEqual(['c']);
    expect(s.additionalProperties).toBe(false);
  });
});

describe('googleClient', () => {
  it('maps request and response', async () => {
    const f = fakeSdk(
      chunks(
        { candidates: [{ content: { parts: [{ text: '{"kind":' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'x', thought: true }, { text: '"a"}' }] } }] },
        {
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: {
            promptTokenCount: 100,
            cachedContentTokenCount: 40,
            candidatesTokenCount: 7,
            thoughtsTokenCount: 3,
          },
        },
      ),
    );
    const res = await googleClient('k', f.sdk)({ ...baseReq, effort: 'medium' });
    const p = f.calls[0];
    expect(p.model).toBe('gemini-3.5-flash-lite');
    expect(p.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'yo' }] },
      { role: 'user', parts: [{ text: 'again' }] },
    ]);
    expect(p.config.systemInstruction).toBe('SYS');
    expect(p.config.maxOutputTokens).toBe(500);
    expect(p.config.responseMimeType).toBe('application/json');
    expect(p.config.responseJsonSchema).toEqual(geminiSchema((baseReq.format as any).schema));
    expect(p.config.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    expect(res.text).toBe('{"kind":"a"}');
    expect(res.usage).toEqual({ input: 60, cacheRead: 40, cacheWrite: 0, output: 10 });
    expect(res.stopReason).toBe('end_turn');
  });
  it.each([
    ['low', 'LOW'],
    ['high', 'HIGH'],
  ] as const)('maps effort %s to %s', async (effort, level) => {
    const f = fakeSdk(chunks({ candidates: [{ finishReason: 'STOP' }] }));
    await googleClient('k', f.sdk)({ ...baseReq, effort });
    expect(f.calls[0].config.thinkingConfig).toEqual({ thinkingLevel: level });
  });
  it('omits thinkingConfig without effort and maps MAX_TOKENS', async () => {
    const f = fakeSdk(
      chunks({
        candidates: [{ content: { parts: [{ text: '{"ki' }] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
      }),
    );
    const res = await googleClient('k', f.sdk)(baseReq);
    expect(f.calls[0].config.thinkingConfig).toBeUndefined();
    expect(res.stopReason).toBe('max_tokens');
    expect(res.text).toBe('{"ki');
    expect(res.usage).toEqual({ input: 1, cacheRead: 0, cacheWrite: 0, output: 2 });
  });
  it('rejects when aborted', async () => {
    const ctl = new AbortController();
    const f = fakeSdk(async function* (params) {
      const signal: AbortSignal = params.config.abortSignal;
      await new Promise((_r, rej) => {
        const fail = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail);
      });
      yield {};
    });
    const p = googleClient('k', f.sdk)({ ...baseReq, signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toThrow('aborted');
  });
  it('keeps the key out of error messages', async () => {
    // eslint-disable-next-line require-yield
    const f = fakeSdk(async function* () {
      throw Object.assign(new Error('400 API key not valid: AIza-SECRET.'), { status: 400 });
    });
    const err = await googleClient('AIza-SECRET', f.sdk)(baseReq).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('SECRET');
    expect((err as { status?: number }).status).toBe(400);
  });
});

describe('geminiSdk retries (real SDK, fake fetch, no network)', () => {
  const sse = (body: unknown) =>
    new Response(`data: ${JSON.stringify(body)}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  const error = (status: number) =>
    new Response(JSON.stringify({ error: { code: status, message: `status ${status}` } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fakeFetch = (...responses: Response[]) => {
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(String(url));
      return responses.shift() ?? error(599);
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetch };
  };
  const ok = () =>
    sse({
      candidates: [{ content: { parts: [{ text: '{"kind":"a"}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
    });

  it('calls the v1beta API, whatever the SDK default is', async () => {
    // @google/genai 3 defaults to v1; structured output was built and benchmarked on v1beta.
    const f = fakeFetch(ok());
    await googleClient('k', geminiSdk('k', { fetch: f.fetch, initialDelay: 0.001 }))(baseReq);
    expect(f.calls[0]).toContain('/v1beta/models/');
  });

  it('retries once after a 503 and returns the answer', async () => {
    const f = fakeFetch(error(503), ok());
    const sdk = geminiSdk('AIza-SECRET', { fetch: f.fetch, initialDelay: 0.001 });
    const res = await googleClient('AIza-SECRET', sdk)(baseReq);
    expect(f.calls).toHaveLength(2);
    expect(res.text).toBe('{"kind":"a"}');
  });

  it('retries a 429', async () => {
    const f = fakeFetch(error(429), ok());
    const sdk = geminiSdk('k', { fetch: f.fetch, initialDelay: 0.001 });
    await googleClient('k', sdk)(baseReq);
    expect(f.calls).toHaveLength(2);
  });

  it('does not retry a 400 and keeps the key out of the error', async () => {
    const f = fakeFetch(error(400), ok());
    const sdk = geminiSdk('AIza-SECRET', { fetch: f.fetch, initialDelay: 0.001 });
    const err = await googleClient('AIza-SECRET', sdk)(baseReq).catch((e: unknown) => e);
    expect(f.calls).toHaveLength(1);
    expect((err as { status?: number }).status).toBe(400);
    expect((err as Error).message).not.toContain('SECRET');
  });

  it('gives up after 2 retries', async () => {
    const f = fakeFetch(error(503), error(503), error(503), ok());
    const sdk = geminiSdk('k', { fetch: f.fetch, initialDelay: 0.001 });
    const err = await googleClient('k', sdk)(baseReq).catch((e: unknown) => e);
    expect(f.calls).toHaveLength(3);
    expect((err as { status?: number }).status).toBe(503);
  });
});

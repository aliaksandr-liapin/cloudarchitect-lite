/* eslint-disable @typescript-eslint/no-explicit-any */
import { APIUserAbortError } from 'openai';
import { describe, expect, it } from 'vitest';
import { jsonOutputFormat } from './llm.js';
import { openaiClient, restoreOptional, strictSchema, type JsonSchema } from './openai.js';
import { z } from 'zod';
import { awsCatalog } from '@cloudarchitect/catalog';
import { generationSchema } from './contract.js';

const original: JsonSchema = {
  type: 'object',
  properties: {
    a: { type: 'string' },
    containerId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    items: { type: 'array', items: { $ref: '#/$defs/item' } },
  },
  required: ['containerId'],
  $defs: {
    item: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'string' } },
      required: ['x'],
    },
  },
};

describe('strictSchema', () => {
  it('closes objects, requires every property, makes optional ones nullable, walks $defs', () => {
    const s = strictSchema(original) as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['a', 'containerId', 'items']);
    expect(s.properties.a).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(s.properties.containerId).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(s.properties.items.anyOf[0].items.$ref).toBe('#/$defs/item');
    expect(s.$defs.item.additionalProperties).toBe(false);
    expect(s.$defs.item.required).toEqual(['x', 'y']);
    expect(s.$defs.item.properties.y.anyOf[1]).toEqual({ type: 'null' });
    expect(s.$defs.item.properties.x).toEqual({ type: 'number' });
  });
  it('does not mutate the input', () => {
    const copy = structuredClone(original);
    strictSchema(original);
    expect(original).toEqual(copy);
  });
});

describe('restoreOptional', () => {
  it('drops null for an optional property', () => {
    expect(restoreOptional({ a: null, containerId: 'c' }, original)).toEqual({ containerId: 'c' });
  });
  it('keeps null for a required nullable property', () => {
    expect(restoreOptional({ containerId: null }, original)).toEqual({ containerId: null });
  });
  it('handles arrays of objects through $ref', () => {
    expect(
      restoreOptional(
        {
          containerId: null,
          items: [
            { x: 1, y: null },
            { x: 2, y: 'k' },
          ],
        },
        original,
      ),
    ).toEqual({ containerId: null, items: [{ x: 1 }, { x: 2, y: 'k' }] });
  });
});

function fakeSdk(impl: (body: any, opts: any) => Promise<any>) {
  const calls: { body: any; opts: any }[] = [];
  return {
    calls,
    sdk: {
      responses: {
        stream: (body: any, opts: any) => {
          calls.push({ body, opts });
          return { finalResponse: () => impl(body, opts) };
        },
      },
    },
  };
}

const schema = z.object({ name: z.string(), note: z.string().optional() });
const baseReq = {
  model: 'gpt-6-luna',
  system: 'SYS',
  maxTokens: 500,
  format: jsonOutputFormat(schema),
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('openaiClient', () => {
  it('maps request and response', async () => {
    const f = fakeSdk(async () => ({
      status: 'completed',
      incomplete_details: null,
      output_text: '{"name":"n","note":null}',
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 7 },
    }));
    const res = await openaiClient('sk-test-SECRET', f.sdk)({ ...baseReq, effort: 'low' });
    const { body } = f.calls[0]!;
    expect(body.model).toBe('gpt-6-luna');
    expect(body.instructions).toBe('SYS');
    expect(body.input).toEqual(baseReq.messages);
    expect(body.max_output_tokens).toBe(500);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(body.text.format.schema).toEqual(strictSchema((baseReq.format as any).schema));
    expect(JSON.parse(res.text)).toEqual({ name: 'n' });
    expect(res.usage).toEqual({ input: 60, cacheRead: 40, cacheWrite: 0, output: 7 });
    expect(res.stopReason).toBe('end_turn');
  });
  it('omits reasoning without effort and maps incomplete to max_tokens', async () => {
    const f = fakeSdk(async () => ({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_text: '{"na',
      usage: { input_tokens: 1, output_tokens: 2 },
    }));
    const res = await openaiClient('k', f.sdk)(baseReq);
    expect(f.calls[0]!.body.reasoning).toBeUndefined();
    expect(res.stopReason).toBe('max_tokens');
    expect(res.text).toBe('{"na');
    expect(res.usage.cacheRead).toBe(0);
  });
  it('rejects with the SDK abort error when aborted', async () => {
    const ctl = new AbortController();
    const f = fakeSdk(
      (_b, o) =>
        new Promise((_res, rej) => {
          o.signal.addEventListener('abort', () => rej(new APIUserAbortError()));
        }),
    );
    const p = openaiClient('k', f.sdk)({ ...baseReq, signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(APIUserAbortError);
  });
  it('keeps the key out of error messages', async () => {
    const f = fakeSdk(async () => {
      throw Object.assign(new Error('401 Incorrect API key provided: sk-test-SECRET.'), {
        status: 401,
      });
    });
    const err = await openaiClient('sk-test-SECRET', f.sdk)(baseReq).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('SECRET');
    expect((err as { status?: number }).status).toBe(401);
  });
});

describe('strictSchema and $ref', () => {
  function refsWithSiblings(node: unknown, path = ''): string[] {
    if (Array.isArray(node)) return node.flatMap((n, i) => refsWithSiblings(n, `${path}/${i}`));
    if (typeof node !== 'object' || node === null) return [];
    const o = node as Record<string, unknown>;
    const here = '$ref' in o && Object.keys(o).length > 1 ? [path] : [];
    return here.concat(Object.entries(o).flatMap(([k, v]) => refsWithSiblings(v, `${path}/${k}`)));
  }
  it('keeps $ref bare and hoists the description of an optional ref property', () => {
    const s = strictSchema({
      type: 'object',
      properties: { t: { $ref: '#/$defs/e', description: 'kind' } },
      $defs: { e: { type: 'string' } },
    }) as any;
    expect(s.properties.t).toEqual({
      description: 'kind',
      anyOf: [{ $ref: '#/$defs/e' }, { type: 'null' }],
    });
  });
  it('leaves no keyword beside $ref in the real generation schema', () => {
    const fmt = jsonOutputFormat(generationSchema(awsCatalog)) as { schema: JsonSchema };
    expect(refsWithSiblings(fmt.schema)).not.toEqual([]); // the premise: the input does have them
    expect(refsWithSiblings(strictSchema(fmt.schema))).toEqual([]);
  });
});

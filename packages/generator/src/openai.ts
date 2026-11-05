import OpenAI from 'openai';
import type { LlmClient } from './llm.js';
import { redactKey } from './redact.js';

export type JsonSchema = { [key: string]: unknown };

const NULL_SCHEMA: JsonSchema = { type: 'null' };

function isObj(v: unknown): v is JsonSchema {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isObjectSchema(s: JsonSchema): boolean {
  return s.type === 'object' || isObj(s.properties);
}

/** Strict mode allows no keywords beside `$ref`; returns the bare ref and the description to hoist. */
function bareRef(p: unknown): { node: unknown; description?: unknown } {
  if (!isObj(p) || typeof p.$ref !== 'string') return { node: p };
  return { node: { $ref: p.$ref }, description: p.description };
}

function walk(s: unknown, keepRefSiblings = false): unknown {
  if (Array.isArray(s)) return s.map((x) => walk(x));
  if (!isObj(s)) return s;
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'properties' && isObj(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([n, p]) => [n, walk(p, true)]));
    } else if (k === '$defs' || k === 'definitions') {
      out[k] = isObj(v) ? Object.fromEntries(Object.entries(v).map(([n, p]) => [n, walk(p)])) : v;
    } else if (k === 'enum' || k === 'const' || k === 'default' || k === 'required') {
      out[k] = v;
    } else {
      out[k] = walk(v);
    }
  }
  if (!keepRefSiblings && typeof out.$ref === 'string' && Object.keys(out).length > 1)
    return { $ref: out.$ref };
  if (isObjectSchema(out)) {
    const props = isObj(out.properties) ? out.properties : {};
    const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
    const next: JsonSchema = {};
    for (const [n, p] of Object.entries(props)) {
      const { node, description } = bareRef(p);
      next[n] = required.has(n)
        ? node
        : { ...(description !== undefined ? { description } : {}), anyOf: [node, NULL_SCHEMA] };
    }
    out.properties = next;
    out.required = Object.keys(next);
    out.additionalProperties = false;
  }
  return out;
}

/**
 * Converts a JSON Schema to OpenAI strict mode: every object is closed and lists all of its
 * properties as required; a property that was optional becomes nullable.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
  return walk(schema) as JsonSchema;
}

function deref(s: JsonSchema, root: JsonSchema): JsonSchema {
  let cur = s;
  for (let i = 0; i < 20 && typeof cur.$ref === 'string'; i++) {
    const path = cur.$ref.replace(/^#\/?/, '').split('/').filter(Boolean);
    let node: unknown = root;
    for (const seg of path) node = isObj(node) ? node[seg] : undefined;
    if (!isObj(node)) return cur;
    cur = node;
  }
  return cur;
}

function restore(value: unknown, schema: unknown, root: JsonSchema): unknown {
  if (!isObj(schema) || value === null || typeof value !== 'object') return value;
  const s = deref(schema, root);
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = s[key];
    if (Array.isArray(branches)) {
      for (const b of branches) {
        const r = deref(isObj(b) ? b : {}, root);
        const fits = Array.isArray(value) ? r.type === 'array' || 'items' in r : isObjectSchema(r);
        if (fits) return restore(value, b, root);
      }
      return value;
    }
  }
  if (Array.isArray(value)) {
    return isObj(s.items) ? value.map((v) => restore(v, s.items, root)) : value;
  }
  if (!isObjectSchema(s)) return value;
  const props = isObj(s.properties) ? s.properties : {};
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null && k in props && !required.has(k)) continue;
    out[k] = k in props ? restore(v, props[k], root) : v;
  }
  return out;
}

/** Turns the `null` OpenAI strict mode returns for optional properties back into absent ones. */
export function restoreOptional(value: unknown, original: JsonSchema): unknown {
  return restore(value, original, original);
}

interface OpenAIResponse {
  status?: string | null;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

/** The slice of the OpenAI SDK this adapter uses; lets tests inject a fake. */
export interface OpenAIish {
  responses: {
    stream(
      body: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ): { finalResponse(): Promise<OpenAIResponse> };
  };
}

export function openaiClient(apiKey: string, sdk?: OpenAIish): LlmClient {
  const client: OpenAIish = sdk ?? (new OpenAI({ apiKey, maxRetries: 2 }) as unknown as OpenAIish);
  return async (req) => {
    const original = (req.format as { schema: JsonSchema }).schema;
    let res: OpenAIResponse;
    try {
      // Streaming, so a large max_output_tokens (room for reasoning) stays clear of HTTP timeouts.
      res = await client.responses
        .stream(
          {
            model: req.model,
            instructions: req.system,
            input: req.messages,
            max_output_tokens: req.maxTokens,
            ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
            text: {
              format: {
                type: 'json_schema',
                name: 'result',
                strict: true,
                schema: strictSchema(original),
              },
            },
            store: false,
          },
          { signal: req.signal },
        )
        .finalResponse();
    } catch (err) {
      throw redactKey(err, apiKey);
    }
    const u = res.usage ?? {};
    const cached: number = u.input_tokens_details?.cached_tokens ?? 0;
    const raw: string =
      typeof res.output_text === 'string'
        ? res.output_text
        : (res.output ?? [])
            .flatMap((o) => (o.type === 'message' ? (o.content ?? []) : []))
            .flatMap((c) => (c.type === 'output_text' && c.text ? [c.text] : []))
            .join('');
    let text = raw;
    try {
      text = JSON.stringify(restoreOptional(JSON.parse(raw), original));
    } catch {
      // Not JSON (e.g. cut off); parseOutput reports it as schema_invalid.
    }
    return {
      text,
      usage: {
        input: (u.input_tokens ?? 0) - cached,
        output: u.output_tokens ?? 0,
        cacheWrite: 0,
        cacheRead: cached,
      },
      stopReason:
        res.status === 'incomplete' && res.incomplete_details?.reason === 'max_output_tokens'
          ? 'max_tokens'
          : res.status === 'completed'
            ? 'end_turn'
            : (res.incomplete_details?.reason ?? res.status ?? null),
    };
  };
}

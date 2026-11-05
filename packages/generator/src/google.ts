import { GoogleGenAI } from '@google/genai';
import type { LlmClient } from './llm.js';
import type { JsonSchema } from './openai.js';
import { redactKey } from './redact.js';

function isObj(v: unknown): v is JsonSchema {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keywords the Gemini `responseJsonSchema` accepts (minus `$ref`/`$defs`, which are inlined). */
const SUPPORTED = new Set([
  'type',
  'format',
  'title',
  'description',
  'enum',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'properties',
  'additionalProperties',
  'required',
  'propertyOrdering',
]);

function resolve(ref: string, root: JsonSchema): unknown {
  let node: unknown = root;
  for (const seg of ref.replace(/^#\/?/, '').split('/').filter(Boolean)) {
    node = isObj(node) ? node[seg] : undefined;
  }
  return node;
}

function convert(s: unknown, root: JsonSchema, depth: number): unknown {
  if (Array.isArray(s)) return s.map((v) => convert(v, root, depth));
  if (!isObj(s)) return s;
  if (typeof s.$ref === 'string') {
    const target = resolve(s.$ref, root);
    if (!isObj(target) || depth > 20) return {};
    return convert(target, root, depth + 1);
  }
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'properties' && isObj(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([n, p]) => [n, convert(p, root, depth)]));
    } else if (k === 'const') {
      if (!('enum' in s)) out.enum = [v];
    } else if (k === 'enum' || k === 'required') {
      out[k] = v;
    } else if (SUPPORTED.has(k)) {
      out[k] = convert(v, root, depth);
    }
  }
  return out;
}

/**
 * Converts a JSON Schema for Gemini's `responseJsonSchema`: inlines `$ref`/`$defs` and drops
 * keywords the API does not support. `enum` is kept.
 */
export function geminiSchema(schema: JsonSchema): JsonSchema {
  return convert(schema, schema, 0) as JsonSchema;
}

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

/** The slice of the Google GenAI SDK this adapter uses; lets tests inject a fake. */
export interface GenAIish {
  models: {
    generateContentStream(params: {
      model: string;
      contents: { role: string; parts: { text: string }[] }[];
      config: Record<string, unknown>;
    }): Promise<AsyncIterable<GeminiChunk>>;
  };
}

const THINKING_LEVEL = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' } as const;

export function googleClient(apiKey: string, sdk?: GenAIish): LlmClient {
  const client: GenAIish = sdk ?? (new GoogleGenAI({ apiKey }) as unknown as GenAIish);
  return async (req) => {
    const original = (req.format as { schema: JsonSchema }).schema;
    let text = '';
    let finish: string | null = null;
    let usage: NonNullable<GeminiChunk['usageMetadata']> = {};
    try {
      // Streaming, so a large maxOutputTokens (room for thinking) stays clear of HTTP timeouts.
      const stream = await client.models.generateContentStream({
        model: req.model,
        contents: req.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: geminiSchema(original),
          ...(req.effort ? { thinkingConfig: { thinkingLevel: THINKING_LEVEL[req.effort] } } : {}),
          ...(req.signal ? { abortSignal: req.signal } : {}),
        },
      });
      for await (const chunk of stream) {
        const cand = chunk.candidates?.[0];
        for (const part of cand?.content?.parts ?? []) {
          if (part.text && !part.thought) text += part.text;
        }
        if (cand?.finishReason) finish = cand.finishReason;
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      }
    } catch (err) {
      throw redactKey(err, apiKey);
    }
    const cached = usage.cachedContentTokenCount ?? 0;
    return {
      text,
      usage: {
        input: (usage.promptTokenCount ?? 0) - cached,
        output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        cacheWrite: 0,
        cacheRead: cached,
      },
      stopReason: finish === 'STOP' ? 'end_turn' : finish === 'MAX_TOKENS' ? 'max_tokens' : finish,
    };
  };
}

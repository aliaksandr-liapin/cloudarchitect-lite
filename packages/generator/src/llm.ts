import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface LlmRequest {
  model: string;
  system: string;
  maxTokens: number;
  /** Value of `output_config.format`. */
  format: unknown;
  /** Value of `output_config.effort`; adaptive thinking depth. Omitted means the model default. */
  effort?: 'low' | 'medium' | 'high';
  messages: { role: 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  usage: TokenUsage;
  stopReason: string | null;
}

export type LlmClient = (req: LlmRequest) => Promise<LlmResponse>;

export interface CallUsage {
  model: string;
  usage: TokenUsage;
  costMicroUsd: number;
}

/** The model answered, but not with a schema-valid result. Carries the spend so it can still be counted. */
export class GenerationError extends Error {
  constructor(
    readonly code: 'schema_invalid',
    readonly usage: CallUsage[],
  ) {
    super(code);
    this.name = 'GenerationError';
  }
}

export function anthropicClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return async (req) => {
    // Streaming, so a large max_tokens (room for adaptive thinking) stays clear of HTTP timeouts.
    const res = await client.messages
      .stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          output_config: {
            format: req.format as never,
            ...(req.effort ? { effort: req.effort } : {}),
          },
          messages: req.messages,
        },
        { signal: req.signal },
      )
      .finalMessage();
    const u = res.usage;
    return {
      text: res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join(''),
      usage: {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
      },
      stopReason: res.stop_reason,
    };
  };
}

/**
 * Value of `output_config.format` for a Zod schema. Unlike the SDK's `zodOutputFormat`, it keeps
 * `enum` in the JSON schema (that helper moves it into the description, so the decoder never
 * enforced it) and has no `parse` hook (with one, the SDK stream throws its own error on a
 * mismatch, before `parseOutput` and without the usage).
 */
export function jsonOutputFormat(schema: z.ZodType) {
  const json: Record<string, unknown> = z.toJSONSchema(schema, { reused: 'ref' });
  delete json.$schema;
  return { type: 'json_schema' as const, schema: json };
}

/** Parses a model answer against `schema`; throws `GenerationError` carrying `usage` otherwise. */
export function parseOutput<T>(text: string, schema: z.ZodType<T>, usage: CallUsage[]): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new GenerationError('schema_invalid', usage);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new GenerationError('schema_invalid', usage);
  return parsed.data;
}

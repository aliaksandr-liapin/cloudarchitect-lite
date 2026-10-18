import Anthropic from '@anthropic-ai/sdk';

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
    const res = await client.messages.create(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        output_config: { format: req.format as never },
        messages: req.messages,
      },
      { signal: req.signal },
    );
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

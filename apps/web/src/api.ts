import type { IconSet } from '@cloudarchitect/catalog';
import { DEMO } from './demo';
import type { IconState } from './icons';
import type {
  ContinueRequest,
  GenerateRequest,
  GenerateResponse,
  ModelChoice,
  ModelOption,
  Provider,
} from '@cloudarchitect/domain';

/** Same origin by default (nginx and the Vite dev server proxy /api); set VITE_API_BASE for split hosting. */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

/** Request bodies before schema defaults apply (zod input types, so the web package needs no direct zod dependency). */
export type GenerateRequestInput = (typeof GenerateRequest)['_zod']['input'];
export type ContinueRequestInput = (typeof ContinueRequest)['_zod']['input'];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (DEMO) throw new ApiError(0, 'demo_mode'); // the static demo has no backend
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `http_${res.status}`);
  return body as T;
}

export const api = {
  /** The wire body carries the id → SVG map; it is wrapped back into an `IconSet` for `loadIcons`. */
  icons: async (): Promise<{ state: IconState; icons?: IconSet }> => {
    const body = await request<{
      state: IconState;
      release: string;
      icons?: IconSet['icons'];
    }>('/api/icons');
    return {
      state: body.state,
      ...(body.icons
        ? { icons: { provider: 'aws', release: body.release, icons: body.icons } }
        : {}),
    };
  },
  retryIcons: () => request<{ state: string }>('/api/icons/retry', { method: 'POST' }),
  setupStatus: () =>
    request<{
      available: boolean;
      configured: boolean;
      /** Where each provider's key comes from; no key values. Absent on 0.2 servers. */
      providers?: Record<Provider, KeySource>;
      keyFromEnvironment?: boolean;
      lockedByEnvironment?: string[];
      current?: Omit<SetupRequest, 'code' | 'apiKey' | 'apiKeys'>;
    }>('/api/setup/status'),
  verifyKey: (code: string, provider: Provider, apiKey: string) =>
    request<{ result: 'valid' | 'invalid' | 'unreachable' }>('/api/setup/verify-key', {
      method: 'POST',
      body: JSON.stringify({ code, provider, apiKey }),
    }),
  completeSetup: (input: SetupRequest) =>
    request<{ ok: true }>('/api/setup/complete', { method: 'POST', body: JSON.stringify(input) }),
  models: () =>
    request<{
      /** Absent when no enabled model has a key. */
      defaultModel?: ModelChoice;
      enabled: ModelChoice[];
      options: ModelOption[];
      /** Whether the model's provider has a key. */
      available?: Partial<Record<ModelChoice, boolean>>;
    }>('/api/models'),
  generate: (body: GenerateRequestInput, signal?: AbortSignal) =>
    request<GenerateResponse>('/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
  continueGenerate: (body: ContinueRequestInput, signal?: AbortSignal) =>
    request<GenerateResponse>('/api/ai/generate/continue', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
};

export interface SetupRequest {
  code: string;
  /** Keys newly entered in the wizard; saved and environment keys are not sent. */
  apiKeys?: Partial<Record<Provider, string>>;
  models: ModelChoice[];
  defaultModel: ModelChoice;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  rateLimitPerMinute: number;
}

export type KeySource = 'environment' | 'saved' | 'none';

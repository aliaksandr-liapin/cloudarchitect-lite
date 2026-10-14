import type { ModelChoice, ModelOption } from '@cloudarchitect/domain';

/** Same origin by default (nginx and the Vite dev server proxy /api); set VITE_API_BASE for split hosting. */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `http_${res.status}`);
  return body as T;
}

export const api = {
  setupStatus: () =>
    request<{
      available: boolean;
      configured: boolean;
      keyFromEnvironment?: boolean;
      lockedByEnvironment?: string[];
      current?: Omit<SetupRequest, 'code' | 'apiKey'>;
    }>('/api/setup/status'),
  verifyKey: (code: string, apiKey: string) =>
    request<{ result: 'valid' | 'invalid' | 'unreachable' }>('/api/setup/verify-key', {
      method: 'POST',
      body: JSON.stringify({ code, apiKey }),
    }),
  completeSetup: (input: SetupRequest) =>
    request<{ ok: true }>('/api/setup/complete', { method: 'POST', body: JSON.stringify(input) }),
  models: () =>
    request<{ defaultModel: ModelChoice; enabled: ModelChoice[]; options: ModelOption[] }>(
      '/api/models',
    ),
};

export interface SetupRequest {
  code: string;
  apiKey?: string;
  models: ModelChoice[];
  defaultModel: ModelChoice;
  freeCredits: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  rateLimitPerMinute: number;
}

import { ApiError } from './api';

/** Plain messages for gateway error codes (spec §5); manual editing stays available for all of them. */
const ERROR_MESSAGES: Record<string, string> = {
  model_not_enabled: 'This model is not enabled. Re-run setup to enable it.',
  ai_unavailable:
    'AI generation is paused: the daily or monthly spending limit is reached. Manual editing still works.',
  setup_required: 'AI features are not set up yet — see the setup notice above.',
  generation_failed: 'Generation failed. Try again.',
  provider_error: 'Generation failed. Try again.',
  rate_limited: 'Too many requests — wait a minute and try again.',
  operation_expired: 'The questions expired. Generate again.',
  invalid_operation: 'These questions are no longer valid — generate again.',
  catalog_mismatch: 'Reload the page to get the latest service catalog.',
};
const GENERIC_ERROR = 'Something went wrong — try again';

/** Gateway codes a retry of the same request can fix. */
const TRANSIENT = new Set(['provider_error', 'generation_failed', 'rate_limited']);

export const errorCode = (err: unknown) => (err instanceof ApiError ? err.code : undefined);

export function errorMessage(err: unknown): string {
  const code = errorCode(err);
  return (code && ERROR_MESSAGES[code]) ?? GENERIC_ERROR;
}

/** A retry can succeed: a transient gateway error, or the request never reached it (network). */
export function isTransient(err: unknown): boolean {
  const code = errorCode(err);
  return code === undefined || TRANSIENT.has(code);
}

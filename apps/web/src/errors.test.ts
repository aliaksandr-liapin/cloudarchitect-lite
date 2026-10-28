import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { errorMessage, isTransient } from './errors';

const api = (code: string) => new ApiError(400, code);

describe('errorMessage', () => {
  it('maps invalid_operation and rate_limited to plain messages', () => {
    expect(errorMessage(api('invalid_operation'))).toBe(
      'These questions are no longer valid — generate again.',
    );
    expect(errorMessage(api('rate_limited'))).toBe(
      'Too many requests — wait a minute and try again.',
    );
  });

  it('explains ai_unavailable as a reached spending limit', () => {
    expect(errorMessage(new ApiError(503, 'ai_unavailable'))).toBe(
      'AI generation is paused: the daily or monthly spending limit is reached. Manual editing still works.',
    );
  });

  it('falls back to a generic message for unknown codes and network errors', () => {
    expect(errorMessage(api('weird'))).toBe('Something went wrong — try again');
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('Something went wrong — try again');
  });
});

describe('isTransient', () => {
  it('keeps the clarification for errors a retry can fix', () => {
    for (const code of ['provider_error', 'generation_failed', 'rate_limited'])
      expect(isTransient(api(code))).toBe(true);
    expect(isTransient(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('drops it when the operation itself is no longer usable', () => {
    for (const code of ['invalid_operation', 'operation_expired', 'invalid_request'])
      expect(isTransient(api(code))).toBe(false);
  });
});

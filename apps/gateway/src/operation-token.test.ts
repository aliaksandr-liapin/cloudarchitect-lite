import type { Question, Requirement } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import {
  OPERATION_TTL_MS,
  OperationTokenError,
  signOperation,
  verifyOperation,
  type OperationState,
} from './operation-token.js';

const SECRET = 'operation-token:salt';
const NOW = 1_700_000_000_000;

const state: OperationState = {
  operationId: 'op-1',
  clientKey: 'client-1',
  model: 'sonnet',
  toggles: {} as OperationState['toggles'],
  prompt: 'A web shop with “unicode” – ü',
  name: 'Shop',
  requirements: [] as Requirement[],
  assumptions: ['one region'],
  questions: [] as Question[],
  exp: NOW + OPERATION_TTL_MS,
};

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(OperationTokenError);
    return (e as OperationTokenError).code;
  }
  return 'none';
}

describe('operation token', () => {
  it('round-trips the state', async () => {
    const token = await signOperation(state, SECRET);
    expect(await verifyOperation(token, SECRET, NOW)).toEqual(state);
  });

  it('rejects a tampered payload', async () => {
    const token = await signOperation(state, SECRET);
    const [p, s] = token.split('.');
    const flipped = (p![0] === 'A' ? 'B' : 'A') + p!.slice(1);
    expect(await code(verifyOperation(`${flipped}.${s}`, SECRET, NOW))).toBe('invalid');
  });

  it('rejects an expired token', async () => {
    const token = await signOperation(state, SECRET);
    expect(await code(verifyOperation(token, SECRET, state.exp + 1))).toBe('expired');
  });

  it('rejects a different secret', async () => {
    const token = await signOperation(state, SECRET);
    expect(await code(verifyOperation(token, 'other', NOW))).toBe('invalid');
  });

  it.each(['nodot', '', 'a.b.c', '!!!.???', '.', 'abc.'])('rejects malformed %j', async (t) => {
    expect(await code(verifyOperation(t, SECRET, NOW))).toBe('invalid');
  });

  it('rejects a correctly signed payload that is not valid state', async () => {
    for (const body of ['{}', 'not json']) {
      const payload = new TextEncoder().encode(body);
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
      const b64 = (b: Uint8Array) =>
        btoa(String.fromCharCode(...b))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      expect(await code(verifyOperation(`${b64(payload)}.${b64(sig)}`, SECRET, NOW))).toBe(
        'invalid',
      );
    }
  });
});

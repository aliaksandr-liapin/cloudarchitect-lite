import type { DesignToggles, ModelChoice, Question, Requirement } from '@cloudarchitect/domain';

/** State carried between /generate (clarification) and /continue, so the server stays stateless. */
export interface OperationState {
  operationId: string;
  clientKey: string;
  model: ModelChoice;
  toggles: DesignToggles;
  prompt: string;
  name: string;
  requirements: Requirement[];
  assumptions: string[];
  questions: Question[];
  /** Expiry, epoch ms. */
  exp: number;
}

export const OPERATION_TTL_MS = 15 * 60_000;

export class OperationTokenError extends Error {
  constructor(readonly code: 'invalid' | 'expired') {
    super(`operation token ${code}`);
    this.name = 'OperationTokenError';
  }
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new OperationTokenError('invalid');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    throw new OperationTokenError('invalid');
  }
}

function hmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

/** Returns `base64url(JSON) + '.' + base64url(HMAC-SHA256)`. */
export async function signOperation(state: OperationState, secret: string): Promise<string> {
  const payload = encoder.encode(JSON.stringify(state));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), payload);
  return `${toBase64Url(payload)}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Throws OperationTokenError('invalid' | 'expired'); never any other error for bad input. */
export async function verifyOperation(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<OperationState> {
  const parts = token.split('.');
  if (parts.length !== 2) throw new OperationTokenError('invalid');
  const payload = fromBase64Url(parts[0]!);
  const sig = fromBase64Url(parts[1]!);
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, payload);
  if (!ok) throw new OperationTokenError('invalid');
  let state: OperationState;
  try {
    state = JSON.parse(new TextDecoder().decode(payload)) as OperationState;
  } catch {
    throw new OperationTokenError('invalid');
  }
  if (
    typeof state !== 'object' ||
    state === null ||
    typeof state.exp !== 'number' ||
    typeof state.operationId !== 'string' ||
    typeof state.clientKey !== 'string'
  ) {
    throw new OperationTokenError('invalid');
  }
  if (now > state.exp) throw new OperationTokenError('expired');
  return state;
}

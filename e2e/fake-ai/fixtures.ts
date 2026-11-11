/**
 * Recorded provider responses the fake AI server replays. Imports only `node:` builtins, so the
 * e2e container can run it with plain `node` and no node_modules.
 */
import { readFileSync } from 'node:fs';

export type Provider = 'anthropic' | 'openai' | 'google';

export const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google'];

export interface RecordedResponse {
  status: number;
  /** Only `content-type`; nothing else is stored. */
  headers: Record<string, string>;
  /** The raw response text, SSE included. */
  body: string;
  /** Request path and query, without any key. */
  path: string;
}

export interface FixtureSet {
  recordedAt: string;
  prompts: string[];
  responses: Record<Provider, RecordedResponse[]>;
}

export const DEFAULT_FIXTURES = new URL('../fixtures/fixtures.json', import.meta.url);

export function loadFixtures(path: string | URL = DEFAULT_FIXTURES): FixtureSet {
  const set = JSON.parse(readFileSync(path, 'utf8')) as FixtureSet;
  for (const p of PROVIDERS) {
    if (!Array.isArray(set.responses?.[p])) {
      throw new Error(`${String(path)}: responses.${p} is missing`);
    }
  }
  return set;
}

/**
 * Fixture freshness: replays the recorded provider responses through the current generator.
 * When a catalog, schema or prompt change makes them stop fitting, this fails with a clear
 * "re-record" message instead of the browser test failing later with "Generation failed".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Project } from '@cloudarchitect/domain';
import {
  anthropicClient,
  GenerationError,
  googleClient,
  openaiClient,
} from '@cloudarchitect/generator';
import type { LlmClient } from '@cloudarchitect/generator';
import { loadFixtures, PROVIDERS } from '../fake-ai/fixtures.ts';
import type { Provider } from '../fake-ai/fixtures.ts';
import { startFakeAi, type FakeAi } from '../fake-ai/server.ts';
import { design, PROMPTS } from './prompts.ts';

const STALE = 'fixtures are out of date: re-record with pnpm --filter @cloudarchitect/e2e record';

const CLIENT: Record<Provider, (key: string) => LlmClient> = {
  anthropic: anthropicClient,
  openai: openaiClient,
  google: googleClient,
};

const ENV = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'GOOGLE_GEMINI_BASE_URL'] as const;
const savedEnv: Partial<Record<(typeof ENV)[number], string>> = {};
let server: FakeAi | undefined;
let control = '';

beforeEach(async () => {
  for (const k of ENV) savedEnv[k] = process.env[k];
  server = await startFakeAi({ fixtures: loadFixtures(), port: 0, controlPort: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  control = `http://127.0.0.1:${server.controlPort}`;
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.OPENAI_BASE_URL = `${base}/v1`;
  process.env.GOOGLE_GEMINI_BASE_URL = base;
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Runs every prompt of `p` against the replay; a schema failure means stale fixtures. */
async function replay(p: Provider): Promise<Project[]> {
  const llm = CLIENT[p]('fake-key');
  const projects: Project[] = [];
  for (const prompt of PROMPTS[p]) {
    try {
      projects.push(Project.parse(await design(llm, p, prompt)));
    } catch (err) {
      if (err instanceof GenerationError) throw new Error(STALE, { cause: err });
      throw err;
    }
  }
  // Every recorded response used exactly once: more or fewer calls also mean stale fixtures.
  const log = (await (await fetch(`${control}/log`)).json()) as { provider: Provider }[];
  const calls = log.filter((e) => e.provider === p).length;
  const recorded = loadFixtures().responses[p].length;
  if (calls !== recorded) throw new Error(`${STALE} (${p}: ${calls} calls, ${recorded} recorded)`);
  return projects;
}

describe('recorded fixtures', () => {
  it.each(PROVIDERS)('still fit the current generator (%s)', async (p) => {
    const projects = await replay(p);
    expect(projects).toHaveLength(PROMPTS[p].length);
  });

  it('give two different Anthropic designs', async () => {
    const [a, b] = await replay('anthropic');
    const ids = (x: Project) => new Set(x.nodes.map((n) => n.id));
    expect(ids(a!)).not.toEqual(ids(b!));
  });
});

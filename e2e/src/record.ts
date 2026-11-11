/**
 * Records the fixtures the fake AI server replays: runs every prompt in `prompts.ts` through
 * the real generator against the real providers, with the fake server in record mode in
 * between, and writes `e2e/fixtures/fixtures.json`. Paid (about $0.20) — run it by hand only
 * after a catalog, schema or prompt change makes the freshness test fail.
 *
 *   pnpm --filter @cloudarchitect/e2e record
 *
 * Needs ANTHROPIC_API_KEY, OPENAI_API_KEY and GEMINI_API_KEY (environment or repo-root .env).
 * Writes nothing if any provider answer is not 2xx. Never prints keys.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  anthropicClient,
  costMicroUsd,
  googleClient,
  openaiClient,
} from '@cloudarchitect/generator';
import type { LlmClient } from '@cloudarchitect/generator';
import { DEFAULT_FIXTURES, PROVIDERS } from '../fake-ai/fixtures.ts';
import type { FixtureSet, Provider, RecordedResponse } from '../fake-ai/fixtures.ts';
import { startFakeAi } from '../fake-ai/server.ts';
import { ALL_PROMPTS, design, PROMPTS } from './prompts.ts';

const KEY_VAR: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
};

const CLIENT: Record<Provider, (key: string) => LlmClient> = {
  anthropic: anthropicClient,
  openai: openaiClient,
  google: googleClient,
};

const UPSTREAM: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  google: 'https://generativelanguage.googleapis.com',
};

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (Object.values(KEY_VAR).some((v) => !process.env[v]) && existsSync(envFile))
  process.loadEnvFile(envFile);

const missing = PROVIDERS.filter((p) => !process.env[KEY_VAR[p]]).map((p) => KEY_VAR[p]);
if (missing.length) {
  console.error(`record: missing ${missing.join(', ')} — all three keys are needed`);
  process.exit(1);
}

const responses: Record<Provider, RecordedResponse[]> = { anthropic: [], openai: [], google: [] };
const failures: string[] = [];

const fake = await startFakeAi({
  fixtures: { recordedAt: '', prompts: [], responses: { anthropic: [], openai: [], google: [] } },
  port: 0,
  controlPort: 0,
  upstream: UPSTREAM,
  record: (p, r) => {
    // A recorded 429 or 401 would be replayed as a fixture: refuse the whole recording.
    if (r.status < 200 || r.status > 299) failures.push(`${p}: ${r.status} on ${r.path}`);
    responses[p].push(r);
  },
});

const base = `http://127.0.0.1:${fake.port}`;
process.env.ANTHROPIC_BASE_URL = base;
process.env.OPENAI_BASE_URL = `${base}/v1`;
process.env.GOOGLE_GEMINI_BASE_URL = base;

let spentMicro = 0;
let error: unknown;
try {
  for (const p of PROVIDERS) {
    const real = CLIENT[p](process.env[KEY_VAR[p]]!);
    const llm: LlmClient = async (req) => {
      const res = await real(req);
      spentMicro += costMicroUsd(req.model, res.usage);
      return res;
    };
    for (const [i, prompt] of PROMPTS[p].entries()) {
      const project = await design(llm, p, prompt);
      console.log(`${p} prompt ${i + 1}: ${project.nodes.length} nodes`);
    }
  }
} catch (err) {
  error = err;
} finally {
  await fake.close();
}

console.log(`total spent: $${(spentMicro / 1e6).toFixed(4)}`);
if (failures.length) {
  console.error('record: a provider answered non-2xx; nothing written:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
if (error) {
  console.error(
    `record: ${error instanceof Error ? error.message : String(error)}; nothing written`,
  );
  process.exit(1);
}

const set: FixtureSet = { recordedAt: new Date().toISOString(), prompts: ALL_PROMPTS, responses };
mkdirSync(new URL('.', DEFAULT_FIXTURES), { recursive: true });
writeFileSync(DEFAULT_FIXTURES, `${JSON.stringify(set, null, 2)}\n`);
for (const p of PROVIDERS) console.log(`${p}: ${responses[p].length} responses`);
console.log(`wrote ${fileURLToPath(DEFAULT_FIXTURES)}`);

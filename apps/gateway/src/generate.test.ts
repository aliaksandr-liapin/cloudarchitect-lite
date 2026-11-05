import { awsCatalog } from '@cloudarchitect/catalog';
import type { Project, Provider } from '@cloudarchitect/domain';
import type { LlmClient, LlmRequest } from '@cloudarchitect/generator';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { effectiveModels, loadConfig, type Settings } from './config.js';
import { SetupService } from './setup.js';
import { OPERATION_TTL_MS } from './operation-token.js';
import { MemorySpendStore } from './store.js';

const catalogVersion = awsCatalog.manifest.catalogVersion;
const PROMPT = 'A secret-sauce order pipeline for llamas';
const R1_TEXT = 'Process llama orders asynchronously';
const usage = { input: 2000, output: 800, cacheWrite: 0, cacheRead: 0 };

const question = {
  topic: 'auth-methods',
  text: 'How do users sign in?',
  suggestions: ['Email', 'Google'],
};

const extraction = (questions: unknown[]) => ({
  name: 'Orders',
  requirements: [{ id: 'R1', text: R1_TEXT, type: 'functional', status: 'confirmed' }],
  assumptions: ['EU users'],
  questions,
});

const node = (id: string, serviceId: string, requirementIds: string[]) => ({
  id,
  serviceId,
  label: id,
  purpose: `The ${id}`,
  rationale: `Needed for ${id}`,
  containerId: 'region',
  requirementIds,
  configuration: [],
});

const graph = {
  name: 'Orders',
  inferredRequirements: [{ id: 'I1', text: 'Observe the pipeline', type: 'non-functional' }],
  assumptions: ['Single region'],
  containers: [
    { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
    { id: 'region', kind: 'region', parentId: 'cloud', label: 'eu-west-1' },
  ],
  nodes: [
    node('queue', 'aws.sqs', ['R1']),
    node('fn', 'aws.lambda', ['R1']),
    node('logs', 'aws.cloudwatch', ['I1']),
  ],
  edges: [
    {
      id: 'e1',
      source: 'queue',
      target: 'fn',
      kind: 'event',
      label: 'orders',
      requirementIds: ['R1'],
      configuration: [{ key: 'deadLetterQueue', value: 'orders-dlq' }],
    },
    {
      id: 'e2',
      source: 'fn',
      target: 'logs',
      kind: 'write',
      label: 'logs',
      requirementIds: ['I1'],
      configuration: [],
    },
  ],
};

interface FakeOptions {
  questions?: unknown[];
  extraction?: unknown;
  graphText?: string;
  onCall?: (req: LlmRequest) => void;
}

/** Extraction calls use 4000 max tokens; everything else is architecture generation. */
function fakeLlm(opts: FakeOptions = {}) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = async (req) => {
    requests.push(req);
    await new Promise((r) => setTimeout(r, 1));
    opts.onCall?.(req);
    // Like the SDK: a call whose signal fires while in flight throws and reports no usage.
    if (req.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const text =
      req.maxTokens === 4000
        ? JSON.stringify(opts.extraction ?? extraction(opts.questions ?? []))
        : (opts.graphText ?? JSON.stringify(graph));
    return { text, usage, stopReason: 'end_turn' };
  };
  const factoryCalls: [Provider, string][] = [];
  const factory = (provider: Provider, apiKey: string) => {
    factoryCalls.push([provider, apiKey]);
    return llm;
  };
  return { factory, requests, factoryCalls };
}

function setup(opts: FakeOptions & { env?: Record<string, string> } = {}) {
  const config = loadConfig({
    CLIENT_KEY_SALT: 'test-salt-0123456789',
    ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key',
    ...opts.env,
  });
  const store = new MemorySpendStore();
  const logs: Record<string, unknown>[] = [];
  const clock = { t: Date.parse('2026-10-18T10:00:00.000Z') };
  const fake = fakeLlm(opts);
  const app = createApp({
    config,
    store,
    log: (e) => logs.push(e),
    llm: fake.factory,
    now: () => clock.t,
  });
  return { app, store, logs, clock, requests: fake.requests, factoryCalls: fake.factoryCalls };
}

const post = (body: unknown, ip = '203.0.113.7', signal?: AbortSignal) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});

type Questions = {
  status: 'questions';
  operationId: string;
  operationToken: string;
  requirements: { id: string; text: string }[];
  questions: { topic: string }[];
};
type Done = { status: 'done'; project: Project; usage: { costUsd: number } };

async function startWithQuestions(s: ReturnType<typeof setup>) {
  const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as Questions;
  expect(body.status).toBe('questions');
  return body;
}

describe('/api/ai/generate', () => {
  it('generate without questions returns a project', async () => {
    const s = setup();
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Done;
    expect(body.status).toBe('done');
    expect(body.project.nodes.map((n) => n.id)).toEqual(['queue', 'fn', 'logs']);
    expect(body.usage.costUsd).toBeGreaterThan(0);
    expect((await s.store.spend()).dayMicroUsd).toBeGreaterThan(0);
    expect(s.requests[0]?.model).toBe('claude-haiku-5-5');
  });

  it('generate with questions returns a token; continue returns the project', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    expect(q.questions.map((x) => x.topic)).toEqual(['auth-methods']);
    expect(q.requirements.map((r) => r.id)).toEqual(['R1']);
    const afterExtract = (await s.store.spend()).dayMicroUsd;
    expect(afterExtract).toBeGreaterThan(0);

    const res = await s.app.request(
      '/api/ai/generate/continue',
      post({
        operationId: q.operationId,
        operationToken: q.operationToken,
        answers: { 'auth-methods': 'Email' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Done;
    expect(body.status).toBe('done');
    expect(body.project.requirements.map((r) => r.id)).toContain('C-auth-methods');
    expect((await s.store.spend()).dayMicroUsd).toBeGreaterThan(afterExtract);
  });

  it('reviewRequirements returns the requirements for review even without questions', async () => {
    const s = setup();
    const res = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion, reviewRequirements: true }),
    );
    const body = (await res.json()) as Questions;
    expect(body.status).toBe('questions');
    expect(body.questions).toEqual([]);
  });

  it('an untidy extraction is normalised so continue with the returned requirements succeeds', async () => {
    const req = (id: string, text: string) => ({
      id,
      text,
      type: 'functional',
      status: 'confirmed',
    });
    const s = setup({
      extraction: {
        name: 'Orders',
        requirements: [req('R1', R1_TEXT), req('R2', ''), req('R1', 'Keep an audit trail')],
        assumptions: [],
        questions: [
          {
            topic: 'auth-methods',
            text: 'How do users sign in?',
            suggestions: ['Email', 'Google', 'GitHub', 'Passkeys', 'SAML', 'x'.repeat(150)],
          },
          { topic: 'user-scale', text: 'How many?', suggestions: ['1', 'y'.repeat(150)] },
        ],
      },
    });
    const q = await startWithQuestions(s);
    expect(q.requirements.map((r) => r.id)).toEqual(['R1', 'R2']);
    const res = await s.app.request(
      '/api/ai/generate/continue',
      post({
        operationId: q.operationId,
        operationToken: q.operationToken,
        answers: { 'auth-methods': 'Email' },
        requirements: q.requirements,
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Done).status).toBe('done');
  });

  it('continue with edited requirements uses them and marks changed ones as user provenance', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    const res = await s.app.request(
      '/api/ai/generate/continue',
      post({
        operationId: q.operationId,
        operationToken: q.operationToken,
        requirements: [
          { id: 'R1', text: 'Process llama orders within a minute', status: 'confirmed' },
          { id: 'R2', text: 'Keep an audit trail', status: 'confirmed' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Done;
    const byId = new Map(body.project.requirements.map((r) => [r.id, r]));
    expect(byId.get('R1')).toMatchObject({
      text: 'Process llama orders within a minute',
      provenance: 'user',
    });
    expect(byId.get('R2')?.provenance).toBe('user');
    const message = s.requests.at(-1)?.messages[0]?.content ?? '';
    expect(message).toContain('R1: Process llama orders within a minute');
    expect(message).not.toContain(R1_TEXT);
  });

  it('continue keeps the token provenance for unchanged requirements', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    const res = await s.app.request(
      '/api/ai/generate/continue',
      post({
        operationId: q.operationId,
        operationToken: q.operationToken,
        requirements: [{ id: 'R1', text: R1_TEXT, status: 'confirmed', provenance: 'user' }],
      }),
    );
    const body = (await res.json()) as Done;
    expect(body.project.requirements.find((r) => r.id === 'R1')?.provenance).toBe('ai');
  });

  it('continue rejects a token from another client', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    const calls = s.requests.length;
    const res = await s.app.request(
      '/api/ai/generate/continue',
      post({ operationId: q.operationId, operationToken: q.operationToken }, '198.51.100.9'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_operation' });
    expect(s.requests.length).toBe(calls);
  });

  it('continue rejects a token for another operation id or a tampered token', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    const calls = s.requests.length;
    const other = await s.app.request(
      '/api/ai/generate/continue',
      post({ operationId: crypto.randomUUID(), operationToken: q.operationToken }),
    );
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: 'invalid_operation' });
    const tampered = await s.app.request(
      '/api/ai/generate/continue',
      post({ operationId: q.operationId, operationToken: `x${q.operationToken}` }),
    );
    expect(tampered.status).toBe(400);
    expect(s.requests.length).toBe(calls);
  });

  it('continue rejects an expired token', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    const calls = s.requests.length;
    s.clock.t += OPERATION_TTL_MS + 1;
    const res = await s.app.request(
      '/api/ai/generate/continue',
      post({ operationId: q.operationId, operationToken: q.operationToken }),
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'operation_expired' });
    expect(s.requests.length).toBe(calls);
  });

  it('continue rejects edited requirement ids reserved for clarification and toggle requirements', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    const calls = s.requests.length;
    for (const id of ['C-auth-methods', 'T-backups']) {
      const res = await s.app.request(
        '/api/ai/generate/continue',
        post({
          operationId: q.operationId,
          operationToken: q.operationToken,
          requirements: [{ id, text: 'Collides with a generated id', status: 'confirmed' }],
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request', issues: ['requirements'] });
    }
    expect(s.requests.length).toBe(calls);
  });

  it('continue rejects duplicate, empty or oversized edited requirements', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    const calls = s.requests.length;
    const bad = [
      [
        { id: 'R1', text: 'One', status: 'confirmed' },
        { id: 'R1', text: 'Two', status: 'confirmed' },
      ],
      [],
      [{ id: 'R1', text: '', status: 'confirmed' }],
      [{ id: 'R1', text: 'x'.repeat(2001), status: 'confirmed' }],
    ];
    for (const requirements of bad) {
      const res = await s.app.request(
        '/api/ai/generate/continue',
        post({ operationId: q.operationId, operationToken: q.operationToken, requirements }),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_request');
    }
    expect(s.requests.length).toBe(calls);
  });

  it('repeated generations from one client are not limited', async () => {
    const s = setup();
    for (let i = 0; i < 4; i++) {
      const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
      expect(res.status).toBe(200);
    }
  });

  it('returns ai_unavailable once the daily limit is reached', async () => {
    const s = setup({ env: { DAILY_BUDGET_MICRO_USD: '100' } });
    await s.store.addSpend(100);
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_unavailable' });
    expect(s.requests.length).toBe(0);
  });

  it('returns ai_unavailable once the monthly limit is reached', async () => {
    const s = setup({ env: { MONTHLY_BUDGET_MICRO_USD: '100' } });
    await s.store.addSpend(100);
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_unavailable' });
  });

  it('returns setup_required when no API key is configured', async () => {
    const s = setup({ env: { ANTHROPIC_API_KEY: '' } });
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'setup_required' });
    expect(s.requests.length).toBe(0);
  });

  it('aborted request is not delivered', async () => {
    const controller = new AbortController();
    const s = setup({ onCall: (req) => req.maxTokens !== 4000 && controller.abort() });
    await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion }, undefined, controller.signal),
    );
    expect((await s.store.spend()).dayMicroUsd).toBeGreaterThan(0);
    expect(s.logs.find((l) => l.event === 'ai_generate')?.outcome).toBe('aborted');
  });

  it('a disconnect while a model call is in flight still records its spend', async () => {
    const controller = new AbortController();
    const s = setup({ onCall: (req) => req.maxTokens === 4000 && controller.abort() });
    const res = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion }, undefined, controller.signal),
    );
    expect(res.status).toBe(499);
    expect(await res.json()).toEqual({ error: 'client_closed' });
    const event = s.logs.find((l) => l.event === 'ai_generate')!;
    expect(event.outcome).toBe('aborted');
    // Every call ran to completion and was priced, including the one in flight at the disconnect.
    expect(event.calls).toBe(s.requests.length);
    expect(event.costMicroUsd).toBeGreaterThan(0);
    expect((await s.store.spend()).dayMicroUsd).toBe(event.costMicroUsd);
    expect(s.requests.every((r) => r.signal === undefined)).toBe(true);
    // The disconnect came during extraction: no generation call starts after it.
    expect(s.requests).toHaveLength(1);
    expect(event.calls).toBe(1);
  });

  it('continue after a disconnect during the first generation call starts no repair call', async () => {
    const controller = new AbortController();
    const s = setup({
      questions: [question],
      // Without the DLQ the graph has a warning, so the generator would start a repair call.
      graphText: JSON.stringify({
        ...graph,
        edges: graph.edges.map((e) => ({ ...e, configuration: [] })),
      }),
      onCall: (req) => req.maxTokens !== 4000 && controller.abort(),
    });
    const q = await startWithQuestions(s);
    const before = s.requests.length;
    const res = await s.app.request(
      '/api/ai/generate/continue',
      post(
        { operationId: q.operationId, operationToken: q.operationToken },
        undefined,
        controller.signal,
      ),
    );
    expect(res.status).toBe(499);
    expect(s.requests.length).toBe(before + 1);
    expect(s.logs.find((l) => l.event === 'ai_continue')?.outcome).toBe('aborted');
  });

  it('runs model calls, spend writes and the log step under waitUntil when the runtime has one', async () => {
    const s = setup();
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException: () => undefined,
      props: {},
    };
    const res = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion }),
      undefined,
      ctx,
    );
    expect(res.status).toBe(200);
    // One per model call (call + spend write) plus one for the delivery and log step.
    expect(pending).toHaveLength(s.requests.length + 1);
    await Promise.all(pending);
  });

  it('schema-invalid output returns 502 generation_failed', async () => {
    const s = setup({ graphText: '{"not":"a graph"}' });
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'generation_failed' });
    expect((await s.store.spend()).dayMicroUsd).toBeGreaterThan(0);
  });

  it('provider errors return 502 provider_error', async () => {
    const s = setup({
      onCall: () => {
        throw new Error('overloaded');
      },
    });
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'provider_error' });
  });

  it('rejects a catalog version mismatch before any model call', async () => {
    const s = setup();
    const res = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion: 'aws-0000' }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'catalog_mismatch' });
    expect(s.requests).toHaveLength(0);
  });

  it('logs contain no prompt text', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    await s.app.request(
      '/api/ai/generate/continue',
      post({
        operationId: q.operationId,
        operationToken: q.operationToken,
        answers: { 'auth-methods': 'Passkeys only' },
        requirements: [{ id: 'R1', text: 'Edited llama requirement', status: 'confirmed' }],
      }),
    );
    const text = JSON.stringify(s.logs);
    for (const secret of [PROMPT, R1_TEXT, 'Edited llama requirement', 'Passkeys only', 'EU users'])
      expect(text).not.toContain(secret);
    const events = s.logs.filter((l) => l.event);
    expect(events.map((l) => l.event)).toEqual(['ai_generate', 'ai_continue']);
    for (const e of events)
      expect(Object.keys(e).sort()).toEqual(
        [
          'calls',
          'costMicroUsd',
          'event',
          'inputTokens',
          'model',
          'outcome',
          'outputTokens',
          'requestId',
        ].sort(),
      );
    expect(events.map((l) => l.outcome)).toEqual(['questions', 'done']);
  });
});

describe('multiple providers', () => {
  const OPENAI_KEY = 'sk-openai-test-not-a-real-key';
  const GEMINI_KEY = 'gemini-test-not-a-real-key';
  const ANTHROPIC_KEY = 'sk-ant-saved-not-a-real-key';

  it('a 0.2 install (Anthropic key and Haiku saved) starts and generates as before', async () => {
    const settings: Settings = {
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      AI_MODELS: 'haiku',
      DEFAULT_MODEL: 'haiku',
      CLIENT_KEY_SALT: 'saved-salt-0123456789',
      setupCompletedAt: '2026-10-20T10:00:00.000Z',
    };
    const service = new SetupService({
      env: {},
      persistence: { read: () => settings, write: () => undefined },
      setupCode: 'c',
      generateSalt: () => 'unused-salt-0123456789',
    });
    expect(effectiveModels(service.config())).toEqual({
      enabled: ['haiku'],
      defaultModel: 'haiku',
    });
    expect(service.status()).toMatchObject({
      configured: true,
      providers: { anthropic: 'saved', openai: 'none', google: 'none' },
    });
    const fake = fakeLlm();
    const app = createApp({
      config: () => service.config(),
      setup: service,
      store: new MemorySpendStore(),
      llm: fake.factory,
    });
    // The browser saved `haiku` in 0.2 and sends it.
    const res = await app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion, model: 'haiku' }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Done).status).toBe('done');
    expect(fake.factoryCalls.every(([p, k]) => p === 'anthropic' && k === ANTHROPIC_KEY)).toBe(
      true,
    );
    expect(fake.requests.map((r) => r.model)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
  });

  it('routes a gpt-sol generation to the OpenAI client for both calls', async () => {
    const s = setup({
      env: {
        OPENAI_API_KEY: OPENAI_KEY,
        AI_MODELS: 'haiku,gpt-sol',
      },
    });
    const res = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion, model: 'gpt-sol' }),
    );
    expect(res.status).toBe(200);
    expect(s.factoryCalls.length).toBeGreaterThan(0);
    expect(s.factoryCalls.every(([p, k]) => p === 'openai' && k === OPENAI_KEY)).toBe(true);
    expect(s.requests.map((r) => r.model)).toEqual(['gpt-6-luna', 'gpt-6.1-sol']);
    expect((await s.store.spend()).dayMicroUsd).toBeGreaterThan(0);
  });

  it('routes continue to the provider of the model in the token', async () => {
    const s = setup({
      questions: [question],
      env: { GEMINI_API_KEY: GEMINI_KEY, AI_MODELS: 'haiku,gemini-argon' },
    });
    const start = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion, model: 'gemini-argon' }),
    );
    const q = (await start.json()) as Questions;
    const res = await s.app.request(
      '/api/ai/generate/continue',
      post({ operationId: q.operationId, operationToken: q.operationToken }),
    );
    expect(res.status).toBe(200);
    expect(s.factoryCalls.every(([p, k]) => p === 'google' && k === GEMINI_KEY)).toBe(true);
    expect(s.requests.map((r) => r.model)).toEqual(['gemini-3.5-flash-lite', 'gemini-4-argon']);
  });

  it('a model whose provider has no key answers setup_required; the default falls back', async () => {
    const s = setup({ env: { AI_MODELS: 'haiku,gpt-luna', DEFAULT_MODEL: 'gpt-luna' } });
    const models = (await (await s.app.request('/api/models')).json()) as {
      defaultModel: string;
      enabled: string[];
      available: Record<string, boolean>;
    };
    expect(models.enabled).toEqual(['haiku']);
    expect(models.defaultModel).toBe('haiku');
    expect(models.available).toMatchObject({ haiku: true, sonnet: true, 'gpt-luna': false });

    const missing = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion, model: 'gpt-luna' }),
    );
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: 'setup_required' });
    expect(s.requests).toHaveLength(0);

    const fallback = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion }),
    );
    expect(fallback.status).toBe(200);
    expect(s.factoryCalls.every(([p]) => p === 'anthropic')).toBe(true);
    expect(s.requests.map((r) => r.model)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);

    const none = setup({ env: { AI_MODELS: 'gpt-luna', DEFAULT_MODEL: 'gpt-luna' } });
    const res = await none.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'setup_required' });
    expect(none.requests).toHaveLength(0);
  });

  it('spending limits count OpenAI and Gemini spend together and block every provider', async () => {
    // One generation is two calls: 2000 in / 800 out each.
    const luna = 2 * Math.ceil(2000 * 0.1 + 800 * 0.5);
    const flash = 2 * Math.ceil(2000 * 0.3 + 800 * 2.5);
    const s = setup({
      env: {
        OPENAI_API_KEY: OPENAI_KEY,
        GEMINI_API_KEY: GEMINI_KEY,
        AI_MODELS: 'haiku,gpt-luna,gemini-flash-lite',
        DAILY_BUDGET_MICRO_USD: String(luna + flash),
      },
    });
    for (const model of ['gpt-luna', 'gemini-flash-lite']) {
      const res = await s.app.request(
        '/api/ai/generate',
        post({ prompt: PROMPT, catalogVersion, model }),
      );
      expect(res.status).toBe(200);
    }
    expect((await s.store.spend()).dayMicroUsd).toBe(luna + flash);
    const calls = s.requests.length;
    for (const model of ['haiku', 'gpt-luna', 'gemini-flash-lite']) {
      const res = await s.app.request(
        '/api/ai/generate',
        post({ prompt: PROMPT, catalogVersion, model }),
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'ai_unavailable' });
    }
    expect(s.requests.length).toBe(calls);
  });

  it('a provider error that contains the key returns provider_error and never logs the key', async () => {
    const s = setup({
      env: { OPENAI_API_KEY: OPENAI_KEY, AI_MODELS: 'haiku,gpt-luna' },
      onCall: () => {
        throw Object.assign(new Error(`401 Incorrect API key provided: ${OPENAI_KEY}`), {
          status: 401,
        });
      },
    });
    const res = await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion, model: 'gpt-luna' }),
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'provider_error' });
    expect(text).not.toContain(OPENAI_KEY);
    expect(s.logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(s.logs)).not.toContain(OPENAI_KEY);
  });
});

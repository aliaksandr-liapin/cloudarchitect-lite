import { awsCatalog } from '@cloudarchitect/catalog';
import type { Project } from '@cloudarchitect/domain';
import type { LlmClient, LlmRequest } from '@cloudarchitect/generator';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { OPERATION_TTL_MS } from './operation-token.js';
import { MemoryCreditStore } from './store.js';

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
    const text =
      req.maxTokens === 4000
        ? JSON.stringify(extraction(opts.questions ?? []))
        : (opts.graphText ?? JSON.stringify(graph));
    return { text, usage, stopReason: 'end_turn' };
  };
  return { factory: (_apiKey: string) => llm, requests };
}

function setup(opts: FakeOptions & { credits?: string } = {}) {
  const config = loadConfig({
    CLIENT_KEY_SALT: 'test-salt-0123456789',
    ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key',
    FREE_CREDITS: opts.credits ?? '3',
  });
  const store = new MemoryCreditStore(config.FREE_CREDITS);
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
  return { app, store, logs, clock, requests: fake.requests };
}

const post = (body: unknown, ip = '203.0.113.7', signal?: AbortSignal) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});

const remaining = async (app: ReturnType<typeof setup>['app'], ip = '203.0.113.7') =>
  (
    (await (
      await app.request('/api/credits/status', { headers: { 'x-forwarded-for': ip } })
    ).json()) as {
      remaining: number;
    }
  ).remaining;

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
  it('generate without questions returns a project and charges one credit', async () => {
    const s = setup();
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Done;
    expect(body.status).toBe('done');
    expect(body.project.nodes.map((n) => n.id)).toEqual(['queue', 'fn', 'logs']);
    expect(body.usage.costUsd).toBeGreaterThan(0);
    expect(await remaining(s.app)).toBe(2);
    expect((await s.store.spend()).dayMicroUsd).toBeGreaterThan(0);
    expect(s.requests[0]?.model).toBe('claude-haiku-5-5');
  });

  it('generate with questions returns a token and charges nothing; continue returns the project and charges once', async () => {
    const s = setup({ questions: [question] });
    const q = await startWithQuestions(s);
    expect(q.questions.map((x) => x.topic)).toEqual(['auth-methods']);
    expect(q.requirements.map((r) => r.id)).toEqual(['R1']);
    expect(await remaining(s.app)).toBe(3);
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
    expect(await remaining(s.app)).toBe(2);
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
    expect(await remaining(s.app)).toBe(3);
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
    expect(await remaining(s.app, '198.51.100.9')).toBe(3);
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
    expect(await remaining(s.app)).toBe(3);
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
    expect(await remaining(s.app)).toBe(3);
  });

  it('two parallel generates with one credit: exactly one 200 done, one 402 without a project', async () => {
    const s = setup({ credits: '1' });
    const [a, b] = await Promise.all([
      s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion })),
      s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion })),
    ]);
    const bodies = [await a!.json(), await b!.json()] as Record<string, unknown>[];
    expect([a!.status, b!.status].sort()).toEqual([200, 402]);
    const rejected = bodies[a!.status === 402 ? 0 : 1]!;
    expect(rejected).toEqual({ error: 'no_credits', byok: true });
    expect(rejected).not.toHaveProperty('project');
    expect(await remaining(s.app)).toBe(0);
    // Both requests made the same calls, so the spend is an even multiple of one request's cost.
    const done = bodies[a!.status === 200 ? 0 : 1] as Done;
    expect((await s.store.spend()).dayMicroUsd).toBe(Math.round(done.usage.costUsd * 2e6));
  });

  it('aborted request is not charged', async () => {
    const controller = new AbortController();
    const s = setup({ onCall: (req) => req.maxTokens !== 4000 && controller.abort() });
    await s.app.request(
      '/api/ai/generate',
      post({ prompt: PROMPT, catalogVersion }, undefined, controller.signal),
    );
    expect(await remaining(s.app)).toBe(3);
    expect((await s.store.spend()).dayMicroUsd).toBeGreaterThan(0);
    expect(s.logs.find((l) => l.event === 'ai_generate')?.outcome).toBe('aborted');
  });

  it('schema-invalid output returns 502 generation_failed and no charge', async () => {
    const s = setup({ graphText: '{"not":"a graph"}' });
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'generation_failed' });
    expect(await remaining(s.app)).toBe(3);
    expect((await s.store.spend()).dayMicroUsd).toBeGreaterThan(0);
  });

  it('provider errors return 502 provider_error and no charge', async () => {
    const s = setup({
      onCall: () => {
        throw new Error('overloaded');
      },
    });
    const res = await s.app.request('/api/ai/generate', post({ prompt: PROMPT, catalogVersion }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'provider_error' });
    expect(await remaining(s.app)).toBe(3);
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

import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { anthropicClient, googleClient, openaiClient } from '@cloudarchitect/generator';
import type { LlmClient, LlmRequest } from '@cloudarchitect/generator';
import type { FixtureSet, Provider, RecordedResponse } from './fixtures.ts';
import { startFakeAi } from './server.ts';

const SCHEMA = {
  type: 'object',
  properties: { n: { type: 'string' } },
  required: ['n'],
  additionalProperties: false,
};

const REQ: LlmRequest = {
  model: 'test-model',
  system: 'system',
  maxTokens: 100,
  format: { type: 'json_schema', schema: SCHEMA },
  messages: [{ role: 'user', content: 'hello' }],
};

function sse(events: [string | null, unknown][]): string {
  return events
    .map(([event, data]) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`)
    .join('');
}

/** Minimal valid Anthropic Messages stream answering `text`. */
function anthropicBody(text: string): string {
  return sse([
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'test-model',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]);
}

/** Minimal valid OpenAI Responses stream answering `text`. */
function openaiBody(text: string): string {
  const base = { id: 'resp_1', object: 'response', created_at: 0, model: 'test-model' };
  return sse([
    [
      'response.created',
      {
        type: 'response.created',
        sequence_number: 0,
        response: { ...base, status: 'in_progress', output: [] },
      },
    ],
    [
      'response.completed',
      {
        type: 'response.completed',
        sequence_number: 1,
        response: {
          ...base,
          status: 'completed',
          output: [
            {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text, annotations: [] }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
        },
      },
    ],
  ]);
}

/** Minimal valid Gemini streamGenerateContent (alt=sse) stream answering `text`. */
function googleBody(text: string): string {
  return sse([
    [
      null,
      {
        candidates: [
          { content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
    ],
  ]);
}

const BODY: Record<Provider, (text: string) => string> = {
  anthropic: anthropicBody,
  openai: openaiBody,
  google: googleBody,
};

const PATH: Record<Provider, string> = {
  anthropic: '/v1/messages',
  openai: '/v1/responses',
  google: '/v1beta/models/test-model:streamGenerateContent?alt=sse',
};

function response(p: Provider, n: string): RecordedResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: BODY[p](JSON.stringify({ n })),
    path: PATH[p],
  };
}

const FIXTURES: FixtureSet = {
  recordedAt: '2026-11-07T00:00:00.000Z',
  prompts: ['a prompt'],
  responses: {
    anthropic: [response('anthropic', 'a1'), response('anthropic', 'a2')],
    openai: [response('openai', 'o1'), response('openai', 'o2')],
    google: [response('google', 'g1'), response('google', 'g2')],
  },
};

const CLIENT: Record<Provider, (key: string) => LlmClient> = {
  anthropic: anthropicClient,
  openai: openaiClient,
  google: googleClient,
};

const ENV = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'GOOGLE_GEMINI_BASE_URL'] as const;
const PROVIDERS: Provider[] = ['anthropic', 'openai', 'google'];

let server: Awaited<ReturnType<typeof startFakeAi>> | undefined;
let base = '';
let control = '';
const savedEnv: Partial<Record<(typeof ENV)[number], string>> = {};

async function start(fixtures: FixtureSet = FIXTURES, extra = {}) {
  server = await startFakeAi({ fixtures, port: 0, controlPort: 0, ...extra });
  base = `http://127.0.0.1:${server.port}`;
  control = `http://127.0.0.1:${server.controlPort}`;
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.OPENAI_BASE_URL = `${base}/v1`;
  process.env.GOOGLE_GEMINI_BASE_URL = base;
}

async function ask(p: Provider): Promise<string> {
  const res = await CLIENT[p]('fake-key')(REQ);
  return (JSON.parse(res.text) as { n: string }).n;
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function log(): Promise<{ provider: Provider; path: string; status: number }[]> {
  return (await (await fetch(`${control}/log`)).json()) as never;
}

/** The provider's list-models key check, as `keyCheckRequest` in apps/gateway/src/setup.ts sends it. */
function keyCheck(p: Provider, key: string): Promise<Response> {
  switch (p) {
    case 'anthropic':
      return fetch(`${base}/v1/models?limit=1`, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
    case 'openai':
      return fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
    case 'google':
      return fetch(`${base}/v1beta/models`, { headers: { 'x-goog-api-key': key } });
  }
}

beforeEach(() => {
  for (const k of ENV) savedEnv[k] = process.env[k];
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('fake AI server', () => {
  it("replays each provider's responses in order", async () => {
    await start();
    expect(await ask('anthropic')).toBe('a1');
    expect(await ask('anthropic')).toBe('a2');
    expect(await ask('openai')).toBe('o1');
    expect(await ask('google')).toBe('g1');
    expect(await ask('openai')).toBe('o2');
    expect(await ask('google')).toBe('g2');
  });

  it('wraps past the end', async () => {
    await start();
    expect(await ask('anthropic')).toBe('a1');
    expect(await ask('anthropic')).toBe('a2');
    expect(await ask('anthropic')).toBe('a1');
  });

  it.each(PROVIDERS)(
    'fail-next answers 429 once and the SDK retry gets the replay (%s)',
    async (p) => {
      await start();
      expect((await post('/fail-next', { provider: p, status: 429 })).status).toBe(200);
      expect(await ask(p)).toBe(`${p[0]}1`);
      expect((await log()).map((e) => [e.provider, e.status])).toEqual([
        [p, 429],
        [p, 200],
      ]);
      // The 429 did not advance the cursor: the next call gets the second response.
      expect(await ask(p)).toBe(`${p[0]}2`);
    },
    15_000,
  );

  it('reject-key makes the key check fail', async () => {
    await start();
    expect((await post('/reject-key', { key: 'bad-key' })).status).toBe(200);

    const anthropic = await keyCheck('anthropic', 'bad-key');
    expect(anthropic.status).toBe(401);
    const openai = await keyCheck('openai', 'bad-key');
    expect(openai.status).toBe(401);
    const google = await keyCheck('google', 'bad-key');
    expect(google.status).toBe(400);
    expect(await google.text()).toContain('API_KEY_INVALID');

    for (const p of PROVIDERS) {
      const ok = await keyCheck(p, 'fake-key');
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual(p === 'google' ? { models: [] } : { data: [] });
    }
  });

  it('reset clears cursors, faults and rejected keys', async () => {
    await start();
    expect(await ask('anthropic')).toBe('a1');
    await post('/fail-next', { provider: 'anthropic', status: 429 });
    await post('/reject-key', { key: 'bad-key' });

    expect((await post('/reset')).status).toBe(200);
    expect(await log()).toEqual([]);
    expect((await keyCheck('anthropic', 'bad-key')).status).toBe(200);
    expect(await ask('anthropic')).toBe('a1');
    expect(await log()).toEqual([
      { provider: 'anthropic', path: '/v1/models?limit=1', status: 200 },
      { provider: 'anthropic', path: '/v1/messages', status: 200 },
    ]);
  });

  it('control port is a separate listener', async () => {
    await start();
    expect((await fetch(`${base}/reset`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${control}/v1/messages`, { method: 'POST' })).status).toBe(404);
  });

  it('record mode forwards upstream and records without keys', async () => {
    // A replaying fake server stands in for the real providers.
    const upstream = await startFakeAi({ fixtures: FIXTURES, port: 0, controlPort: 0 });
    try {
      const origin = `http://127.0.0.1:${upstream.port}`;
      const recorded: [Provider, RecordedResponse][] = [];
      await start(
        { recordedAt: '', prompts: [], responses: { anthropic: [], openai: [], google: [] } },
        {
          upstream: { anthropic: origin, openai: origin, google: origin },
          record: (p: Provider, r: RecordedResponse) => recorded.push([p, r]),
        },
      );
      for (const p of PROVIDERS) expect(await ask(p)).toBe(`${p[0]}1`);
      expect((await keyCheck('openai', 'fake-key')).status).toBe(200);

      expect(recorded.map(([p, r]) => [p, r.path, r.status])).toEqual([
        ['anthropic', '/v1/messages', 200],
        ['openai', '/v1/responses', 200],
        ['google', PATH.google, 200],
      ]);
      for (const [p, r] of recorded) {
        expect(r.headers).toEqual({ 'content-type': 'text/event-stream' });
        expect(r.body).toBe(FIXTURES.responses[p][0]!.body);
        expect(JSON.stringify(r)).not.toContain('fake-key');
      }
    } finally {
      await upstream.close();
    }
  });

  it('runs under plain node with no node_modules', async () => {
    // The e2e container mounts only e2e/: server.ts may import nothing but node: builtins.
    const dir = await mkdtemp(join(tmpdir(), 'fake-ai-'));
    try {
      for (const f of ['server.ts', 'fixtures.ts']) {
        await copyFile(new URL(f, import.meta.url), join(dir, f));
      }
      await writeFile(join(dir, 'fixtures.json'), JSON.stringify(FIXTURES));
      const child = spawn(process.execPath, ['server.ts'], {
        cwd: dir,
        env: { PATH: process.env.PATH, PORT: '0', CONTROL_PORT: '0', FIXTURES: 'fixtures.json' },
      });
      try {
        const line = await new Promise<string>((resolve, reject) => {
          let out = '';
          child.stdout.on('data', (d: Buffer) => {
            out += d.toString();
            if (out.includes('\n')) resolve(out);
          });
          child.stderr.on('data', (d: Buffer) => (out += d.toString()));
          child.on('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
        });
        const port = /providers on :(\d+)/.exec(line)?.[1];
        expect(port).toBeDefined();
        process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
        expect(await ask('anthropic')).toBe('a1');
      } finally {
        child.kill('SIGTERM');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

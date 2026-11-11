/**
 * Fake AI provider server for the end-to-end test. The gateway reaches it through
 * ANTHROPIC_BASE_URL, OPENAI_BASE_URL (with `/v1`) and GOOGLE_GEMINI_BASE_URL.
 *
 * Replay mode answers each provider's requests with its recorded responses in order (wrapping
 * past the end); record mode forwards them to the real provider and hands each answer to
 * `record`. A control API on a separate port resets state and injects faults.
 *
 *   PORT=4010 CONTROL_PORT=4011 FIXTURES=e2e/fixtures/fixtures.json node e2e/fake-ai/server.ts
 *
 * Imports only `node:` builtins and uses erasable TypeScript only, so plain `node` runs it.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadFixtures, PROVIDERS } from './fixtures.ts';
import type { FixtureSet, Provider, RecordedResponse } from './fixtures.ts';

export interface FakeAiOptions {
  fixtures: FixtureSet;
  /** Provider port; 0 picks a free one. */
  port: number;
  /** Control API port; 0 picks a free one. */
  controlPort: number;
  /** Record mode: provider origins (no path) to forward to. */
  upstream?: Record<Provider, string>;
  record?: (p: Provider, r: RecordedResponse) => void;
}

export interface FakeAi {
  port: number;
  controlPort: number;
  close(): Promise<void>;
}

interface LogEntry {
  provider: Provider;
  path: string;
  status: number;
}

interface Route {
  provider: Provider;
  /** The read-only list-models call the gateway's key check makes. */
  models: boolean;
}

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_TYPE = { 'content-type': 'application/json' };

/** Request headers never forwarded as-is: hop-by-hop, or set again by `fetch`. */
const DROP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
]);

function route(method: string, url: URL, req: IncomingMessage): Route | null {
  const path = url.pathname;
  if (path === '/v1/messages') return { provider: 'anthropic', models: false };
  if (path === '/v1/responses') return { provider: 'openai', models: false };
  if (path === '/v1/models' && method === 'GET') {
    if (req.headers['x-api-key'] !== undefined) return { provider: 'anthropic', models: true };
    if (req.headers.authorization !== undefined) return { provider: 'openai', models: true };
    return null;
  }
  if (path === '/v1beta/models' && method === 'GET') return { provider: 'google', models: true };
  if (path.startsWith('/v1beta/models/')) return { provider: 'google', models: false };
  return null;
}

function apiKey(provider: Provider, url: URL, req: IncomingMessage): string | undefined {
  const h = (name: string) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  switch (provider) {
    case 'anthropic':
      return h('x-api-key');
    case 'openai':
      return h('authorization')?.replace(/^Bearer\s+/i, '');
    case 'google':
      return h('x-goog-api-key') ?? url.searchParams.get('key') ?? undefined;
  }
}

function json(status: number, body: unknown): Answer {
  return { status, headers: JSON_TYPE, body: JSON.stringify(body) };
}

/** The answer each provider gives a bad key (what the gateway's `verifyKey` maps to "invalid"). */
function invalidKey(provider: Provider): Answer {
  switch (provider) {
    case 'anthropic':
      return json(401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      });
    case 'openai':
      return json(401, {
        error: {
          message: 'Incorrect API key provided.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_api_key',
        },
      });
    case 'google':
      return json(400, {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'API_KEY_INVALID',
              domain: 'googleapis.com',
            },
          ],
        },
      });
  }
}

function fault(provider: Provider, status: number): Answer {
  const message = `fake-ai: injected ${status}`;
  const body =
    provider === 'anthropic'
      ? { type: 'error', error: { type: 'rate_limit_error', message } }
      : provider === 'openai'
        ? { error: { message, type: 'requests', param: null, code: 'rate_limit_exceeded' } }
        : { error: { code: status, message, status: 'RESOURCE_EXHAUSTED' } };
  return { status, headers: { ...JSON_TYPE, 'retry-after': '0' }, body: JSON.stringify(body) };
}

function modelsList(provider: Provider): Answer {
  return json(200, provider === 'google' ? { models: [] } : { data: [] });
}

/** Path and query as recorded: any `key` query parameter is dropped. */
function recordedPath(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete('key');
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, a: Answer): void {
  res.writeHead(a.status, a.headers);
  res.end(a.body);
}

async function forward(
  origin: string,
  url: URL,
  req: IncomingMessage,
  body: Buffer,
): Promise<Answer> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || DROP_HEADERS.has(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  const upstream = await fetch(`${origin.replace(/\/+$/, '')}${url.pathname}${url.search}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: new Uint8Array(body) }),
  });
  const type = upstream.headers.get('content-type');
  return {
    status: upstream.status,
    headers: type ? { 'content-type': type } : {},
    body: await upstream.text(),
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function shut(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });
}

export async function startFakeAi(opts: FakeAiOptions): Promise<FakeAi> {
  const { fixtures, upstream, record } = opts;
  const cursor: Record<Provider, number> = { anthropic: 0, openai: 0, google: 0 };
  const faults = new Map<Provider, number>();
  const rejected = new Set<string>();
  let log: LogEntry[] = [];

  function replay(provider: Provider): Answer {
    const list = fixtures.responses[provider];
    if (list.length === 0) {
      return json(500, { error: `fake-ai: no recorded ${provider} responses` });
    }
    const i = cursor[provider] % list.length;
    cursor[provider] = i + 1;
    const r = list[i]!;
    return { status: r.status, headers: r.headers, body: r.body };
  }

  async function answer(r: Route, url: URL, req: IncomingMessage, body: Buffer): Promise<Answer> {
    if (r.models) {
      const key = apiKey(r.provider, url, req);
      if (key !== undefined && rejected.has(key)) return invalidKey(r.provider);
      return upstream ? forward(upstream[r.provider], url, req, body) : modelsList(r.provider);
    }
    const status = faults.get(r.provider);
    if (status !== undefined) {
      faults.delete(r.provider);
      return fault(r.provider, status);
    }
    if (!upstream) return replay(r.provider);
    const a = await forward(upstream[r.provider], url, req, body);
    record?.(r.provider, { ...a, path: recordedPath(url) });
    return a;
  }

  const providers = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://fake-ai');
      const body = await readBody(req);
      const r = route(req.method ?? 'GET', url, req);
      if (!r) return send(res, json(404, { error: 'fake-ai: unknown route' }));
      const a = await answer(r, url, req, body);
      log.push({ provider: r.provider, path: recordedPath(url), status: a.status });
      send(res, a);
    } catch (err) {
      send(res, json(502, { error: `fake-ai: ${(err as Error).message}` }));
    }
  });

  const control = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://fake-ai').pathname;
      const raw = (await readBody(req)).toString('utf8');
      const input = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      const key = `${req.method} ${path}`;
      if (key === 'POST /reset') {
        for (const p of PROVIDERS) cursor[p] = 0;
        faults.clear();
        rejected.clear();
        log = [];
        return send(res, json(200, { ok: true }));
      }
      if (key === 'POST /fail-next') {
        const provider = input.provider as Provider;
        const status = typeof input.status === 'number' ? input.status : 429;
        if (!PROVIDERS.includes(provider)) return send(res, json(400, { error: 'bad provider' }));
        faults.set(provider, status);
        return send(res, json(200, { ok: true }));
      }
      if (key === 'POST /reject-key') {
        if (typeof input.key !== 'string') return send(res, json(400, { error: 'key required' }));
        rejected.add(input.key);
        return send(res, json(200, { ok: true }));
      }
      if (key === 'GET /log') return send(res, json(200, log));
      send(res, json(404, { error: 'fake-ai: unknown control route' }));
    } catch (err) {
      send(res, json(400, { error: `fake-ai: ${(err as Error).message}` }));
    }
  });

  const port = await listen(providers, opts.port);
  let controlPort: number;
  try {
    controlPort = await listen(control, opts.controlPort);
  } catch (err) {
    await shut(providers);
    throw err;
  }
  return {
    port,
    controlPort,
    close: async () => {
      await Promise.all([shut(providers), shut(control)]);
    },
  };
}

if (import.meta.main) {
  const fixtures = loadFixtures(process.env.FIXTURES || undefined);
  const fake = await startFakeAi({
    fixtures,
    port: Number(process.env.PORT ?? 4010),
    controlPort: Number(process.env.CONTROL_PORT ?? 4011),
  });
  console.log(`fake-ai: providers on :${fake.port}, control on :${fake.controlPort}`);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void fake.close().then(() => process.exit(0)));
  }
}

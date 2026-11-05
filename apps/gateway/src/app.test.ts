import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { awsIconPack, type AwsIconPack } from '@cloudarchitect/catalog';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import {
  effectiveModels,
  loadConfig,
  providerKey,
  resolveConfig,
  type Settings,
} from './config.js';
import { IconStore } from './icons.js';
import { SetupService, verifyKey, type KeyCheck } from './setup.js';
import { MemorySpendStore } from './store.js';

const setup = (env: Record<string, string | undefined> = {}) => {
  const config = loadConfig({
    CLIENT_KEY_SALT: 'test-salt-0123456789',
    ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key',
    ...env,
  });
  const store = new MemorySpendStore();
  const logs: Record<string, unknown>[] = [];
  return { app: createApp({ config, store, log: (e) => logs.push(e) }), store, logs };
};

const post = (path: string, body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
  body: JSON.stringify(body),
});

describe('gateway', () => {
  it('serves health and security headers', async () => {
    const res = await setup().app.request('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('defaults to Haiku and lists the models with benchmarks', async () => {
    const res = await setup().app.request('/api/models');
    const body = (await res.json()) as {
      defaultModel: string;
      enabled: string[];
      options: { id: string; benchmark: { costPerOperationUsd: number } }[];
      available: Record<string, boolean>;
    };
    expect(body.defaultModel).toBe('haiku');
    expect(body.enabled).toEqual(['haiku']);
    expect(body.available).toEqual({
      haiku: true,
      sonnet: true,
      'gpt-luna': false,
      'gpt-sol': false,
      'gemini-flash-lite': false,
      'gemini-argon': false,
    });
    expect(body.options.map((o) => o.id)).toEqual(['haiku', 'sonnet', 'gpt-sol', 'gemini-argon']);
    expect(body.options[1]!.benchmark.costPerOperationUsd).toBeGreaterThan(
      body.options[0]!.benchmark.costPerOperationUsd,
    );
  });

  it('rejects a model that is not enabled', async () => {
    const { app } = setup();
    const res = await app.request(
      '/api/ai/generate',
      post('/api/ai/generate', { prompt: 'x', catalogVersion: 'v', model: 'sonnet' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'model_not_enabled', model: 'sonnet' });
    const both = setup({ AI_MODELS: 'haiku,sonnet' }).app;
    const ok = await both.request(
      '/api/ai/generate',
      post('/api/ai/generate', { prompt: 'x', catalogVersion: 'v', model: 'sonnet' }),
    );
    // Past the model check; stops at the catalog check before any model call.
    expect(ok.status).toBe(409);
  });

  it('rejects a default model outside the enabled list', () => {
    expect(() =>
      loadConfig({ CLIENT_KEY_SALT: 'test-salt-0123456789', DEFAULT_MODEL: 'sonnet' }),
    ).toThrow(/DEFAULT_MODEL/);
  });

  it('refuses to start without a salt', () => {
    expect(() => loadConfig({})).toThrow(/CLIENT_KEY_SALT/);
  });

  it('has no credits endpoint', async () => {
    const res = await setup().app.request('/api/credits/status');
    expect(res.status).toBe(404);
  });

  it('validates AI requests and enforces the prompt limit', async () => {
    const { app } = setup();
    expect((await app.request('/api/ai/generate', post('/api/ai/generate', {}))).status).toBe(400);
    const tooLong = { prompt: 'x'.repeat(8001), catalogVersion: 'v' };
    expect((await app.request('/api/ai/generate', post('/api/ai/generate', tooLong))).status).toBe(
      400,
    );
  });

  it('answers 501 for unimplemented operations', async () => {
    const { app } = setup();
    const res = await app.request('/api/ai/review', post('/api/ai/review', { project: {} }));
    expect(res.status).toBe(501);
  });

  it('spending limits: a reached daily or monthly limit returns ai_unavailable', async () => {
    for (const env of [{ DAILY_BUDGET_MICRO_USD: '100' }, { MONTHLY_BUDGET_MICRO_USD: '100' }]) {
      const capped = setup(env);
      await capped.store.addSpend(100);
      const res = await capped.app.request(
        '/api/ai/review',
        post('/api/ai/review', { project: {} }),
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'ai_unavailable' });
    }
  });

  it('without an API key, AI routes return setup_required, not ai_unavailable', async () => {
    const { app } = setup({ ANTHROPIC_API_KEY: '' });
    const res = await app.request('/api/ai/review', post('/api/ai/review', { project: {} }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'setup_required' });
  });

  it('rate limits per client', async () => {
    const { app } = setup({ RATE_LIMIT_PER_MINUTE: '2' });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.request('/api/models')).status);
    expect(codes).toEqual([200, 200, 429]);
  });

  it('never logs request bodies or IPs', async () => {
    const { app, logs } = setup();
    await app.request(
      '/api/ai/generate',
      post('/api/ai/generate', { prompt: 'secret design', catalogVersion: 'v' }),
    );
    const text = JSON.stringify(logs);
    expect(text).not.toContain('secret design');
    expect(text).not.toContain('203.0.113.7');
  });
});

describe('setup wizard', () => {
  const wizard = (
    env: Record<string, string> = {},
    check: KeyCheck = 'valid',
    initial: Settings = {},
  ) => {
    let saved: Settings = initial;
    const checked: [string, string][] = [];
    const service = new SetupService({
      env,
      persistence: { read: () => saved, write: (s) => (saved = structuredClone(s)) },
      setupCode: 'code-1234',
      verifyKey: async (provider, key) => (checked.push([provider, key]), check),
      generateSalt: () => 'generated-salt-0123456789',
    });
    const app = createApp({
      config: () => service.config(),
      setup: service,
      store: new MemorySpendStore(),
    });
    return { app, saved: () => saved, checked, service };
  };
  const input = {
    code: 'code-1234',
    apiKey: 'sk-ant-test-0123456789abcdef',
    models: ['haiku', 'sonnet'],
    defaultModel: 'sonnet',
    dailyBudgetUsd: 2,
    monthlyBudgetUsd: 20,
    rateLimitPerMinute: 30,
  };

  it('starts unconfigured, generates a salt and blocks AI until setup is done', async () => {
    const { app, saved } = wizard();
    expect(await (await app.request('/api/setup/status')).json()).toMatchObject({
      available: true,
      configured: false,
    });
    expect(saved().CLIENT_KEY_SALT).toBe('generated-salt-0123456789');
    const res = await app.request(
      '/api/ai/generate',
      post('/api/ai/generate', { prompt: 'x', catalogVersion: 'v' }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'setup_required' });
  });

  it('rejects a wrong setup code and an invalid key', async () => {
    expect(
      (await wizard().app.request('/api/setup/complete', post('', { ...input, code: 'nope' })))
        .status,
    ).toBe(403);
    const bad = await wizard({}, 'invalid').app.request('/api/setup/complete', post('', input));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_api_key' });
  });

  it('saves settings, applies them live and locks itself', async () => {
    const { app, saved } = wizard();
    expect((await app.request('/api/setup/complete', post('', input))).status).toBe(200);
    expect(saved()).toMatchObject({
      AI_MODELS: 'haiku,sonnet',
      DEFAULT_MODEL: 'sonnet',
      MONTHLY_BUDGET_MICRO_USD: '20000000',
    });
    expect(await (await app.request('/api/models')).json()).toMatchObject({
      defaultModel: 'sonnet',
      enabled: ['haiku', 'sonnet'],
    });
    expect((await app.request('/api/setup/complete', post('', input))).status).toBe(409);
  });

  it('reset re-opens the wizard and keeps saved values as its starting point', async () => {
    const { app, saved } = wizard();
    await app.request('/api/setup/complete', post('', input));
    const service = new SetupService({
      env: {},
      persistence: { read: () => saved(), write: () => undefined },
      setupCode: 'c',
      generateSalt: () => 'unused-salt-0123456789',
    });
    service.reset();
    expect(service.status()).toMatchObject({
      configured: false,
      current: {
        models: ['haiku', 'sonnet'],
        defaultModel: 'sonnet',
        monthlyBudgetUsd: 20,
      },
    });
  });

  it('uses a key from the environment without storing it', async () => {
    const { app, saved } = wizard({ ANTHROPIC_API_KEY: 'sk-ant-env-0123456789abcdef' });
    expect(await (await app.request('/api/setup/status')).json()).toMatchObject({
      keyFromEnvironment: true,
    });
    const { apiKey: _omit, ...withoutKey } = input;
    void _omit;
    expect((await app.request('/api/setup/complete', post('', withoutKey))).status).toBe(200);
    expect(saved().ANTHROPIC_API_KEY).toBeUndefined();
  });

  const ANT = 'sk-ant-test-0123456789abcdef';
  const OAI = 'sk-openai-test-0123456789abcdef';
  const GEM = 'gemini-test-0123456789abcdef';

  it('reports each provider key source without returning any key', async () => {
    const { app } = wizard({ OPENAI_API_KEY: OAI }, 'valid', { GEMINI_API_KEY: GEM });
    const res = await app.request('/api/setup/status');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      providers: { anthropic: 'none', openai: 'environment', google: 'saved' },
      keyFromEnvironment: false,
    });
    expect(JSON.parse(text).lockedByEnvironment).toEqual([]);
    for (const key of [OAI, GEM]) expect(text).not.toContain(key);
    const models = await (await app.request('/api/models')).text();
    for (const key of [OAI, GEM]) expect(models).not.toContain(key);
  });

  it('verify-key checks the named provider and defaults to Anthropic', async () => {
    const { app, checked } = wizard();
    const google = await app.request(
      '/api/setup/verify-key',
      post('', { code: 'code-1234', provider: 'google', apiKey: GEM }),
    );
    expect(await google.json()).toEqual({ result: 'valid' });
    await app.request('/api/setup/verify-key', post('', { code: 'code-1234', apiKey: ANT }));
    expect(checked).toEqual([
      ['google', GEM],
      ['anthropic', ANT],
    ]);
    const unknown = await app.request(
      '/api/setup/verify-key',
      post('', { code: 'code-1234', provider: 'mistral', apiKey: GEM }),
    );
    expect(unknown.status).toBe(400);
    const wrongCode = await app.request(
      '/api/setup/verify-key',
      post('', { code: 'nope', provider: 'openai', apiKey: OAI }),
    );
    expect(wrongCode.status).toBe(403);
  });

  it('completes with only a Gemini key and saves it as GEMINI_API_KEY', async () => {
    const { app, saved, checked } = wizard();
    const { apiKey: _omit, ...rest } = input;
    void _omit;
    const res = await app.request(
      '/api/setup/complete',
      post('', {
        ...rest,
        apiKeys: { google: GEM },
        models: ['gemini-flash-lite'],
        defaultModel: 'gemini-flash-lite',
      }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(GEM);
    expect(checked).toEqual([['google', GEM]]);
    expect(saved()).toMatchObject({ GEMINI_API_KEY: GEM, AI_MODELS: 'gemini-flash-lite' });
    expect(saved().ANTHROPIC_API_KEY).toBeUndefined();
    const models = await (await app.request('/api/models')).text();
    expect(JSON.parse(models)).toMatchObject({
      enabled: ['gemini-flash-lite'],
      defaultModel: 'gemini-flash-lite',
      available: { haiku: false, 'gemini-flash-lite': true, 'gemini-argon': true },
    });
    expect(models).not.toContain(GEM);
  });

  it('complete needs at least one key and only models whose provider has a key', async () => {
    const { apiKey: _omit, ...noKey } = input;
    void _omit;
    const none = await wizard().app.request('/api/setup/complete', post('', noKey));
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: 'invalid_api_key' });

    const { app, saved } = wizard();
    const res = await app.request(
      '/api/setup/complete',
      post('', {
        ...noKey,
        apiKeys: { openai: OAI },
        models: ['gpt-luna', 'haiku'],
        defaultModel: 'gpt-luna',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_settings' });
    expect(saved().OPENAI_API_KEY).toBeUndefined();
  });

  it('verifies each newly entered key and keeps saved keys that are not re-entered', async () => {
    const { app, saved, checked, service } = wizard({}, 'valid', {
      ANTHROPIC_API_KEY: ANT,
      CLIENT_KEY_SALT: 'saved-salt-0123456789',
    });
    const { apiKey: _omit, ...noKey } = input;
    void _omit;
    const res = await app.request(
      '/api/setup/complete',
      post('', {
        ...noKey,
        apiKeys: { openai: OAI },
        models: ['haiku', 'gpt-sol'],
        defaultModel: 'gpt-sol',
      }),
    );
    expect(res.status).toBe(200);
    expect(checked).toEqual([['openai', OAI]]);
    expect(saved()).toMatchObject({ ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: OAI });
    expect(service.status().providers).toEqual({
      anthropic: 'saved',
      openai: 'saved',
      google: 'none',
    });
  });

  it('rejects a newly entered key that fails its check', async () => {
    const { apiKey: _omit, ...noKey } = input;
    void _omit;
    const body = {
      ...noKey,
      apiKeys: { openai: OAI },
      models: ['gpt-luna'],
      defaultModel: 'gpt-luna',
    };
    const bad = wizard({}, 'invalid');
    expect(await (await bad.app.request('/api/setup/complete', post('', body))).json()).toEqual({
      error: 'invalid_api_key',
    });
    const down = wizard({}, 'unreachable');
    const res = await down.app.request('/api/setup/complete', post('', body));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'key_check_failed' });
    expect(down.saved().OPENAI_API_KEY).toBeUndefined();
  });

  it('removes a saved key, drops nothing else and keeps at least one key', async () => {
    const { app, saved, checked, service } = wizard({}, 'valid', {
      ANTHROPIC_API_KEY: ANT,
      OPENAI_API_KEY: OAI,
    });
    const { apiKey: _omit, ...noKey } = input;
    void _omit;
    const res = await app.request(
      '/api/setup/complete',
      post('', { ...noKey, removeKeys: ['openai'], models: ['haiku'], defaultModel: 'haiku' }),
    );
    expect(res.status).toBe(200);
    expect(checked).toEqual([]);
    expect(saved().OPENAI_API_KEY).toBeUndefined();
    expect(saved().ANTHROPIC_API_KEY).toBe(ANT);
    expect(service.status().providers).toEqual({
      anthropic: 'saved',
      openai: 'none',
      google: 'none',
    });
  });

  it('rejects removing the last key and models of a removed provider', async () => {
    const { apiKey: _omit, ...noKey } = input;
    void _omit;
    const last = wizard({}, 'valid', { OPENAI_API_KEY: OAI });
    const none = await last.app.request(
      '/api/setup/complete',
      post('', { ...noKey, removeKeys: ['openai'], models: ['gpt-sol'], defaultModel: 'gpt-sol' }),
    );
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: 'invalid_api_key' });
    expect(last.saved().OPENAI_API_KEY).toBe(OAI);

    const two = wizard({}, 'valid', { ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: OAI });
    const res = await two.app.request(
      '/api/setup/complete',
      post('', {
        ...noKey,
        removeKeys: ['openai'],
        models: ['haiku', 'gpt-sol'],
        defaultModel: 'haiku',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_settings' });
    expect(two.saved().OPENAI_API_KEY).toBe(OAI);
  });

  it('ignores removing an environment key, and a new key wins over removal', async () => {
    const { apiKey: _omit, ...noKey } = input;
    void _omit;
    const env = wizard({ OPENAI_API_KEY: OAI });
    const res = await env.app.request(
      '/api/setup/complete',
      post('', { ...noKey, removeKeys: ['openai'], models: ['gpt-sol'], defaultModel: 'gpt-sol' }),
    );
    expect(res.status).toBe(200);
    expect(env.service.status().providers.openai).toBe('environment');
    expect(env.saved().OPENAI_API_KEY).toBeUndefined();

    const NEW = 'sk-openai-new-0123456789abcdef';
    const both = wizard({}, 'valid', { OPENAI_API_KEY: OAI });
    const replaced = await both.app.request(
      '/api/setup/complete',
      post('', {
        ...noKey,
        apiKeys: { openai: NEW },
        removeKeys: ['openai'],
        models: ['gpt-sol'],
        defaultModel: 'gpt-sol',
      }),
    );
    expect(replaced.status).toBe(200);
    expect(both.checked).toEqual([['openai', NEW]]);
    expect(both.saved().OPENAI_API_KEY).toBe(NEW);
  });

  it('rejects an unknown provider in removeKeys', async () => {
    const res = await wizard().app.request(
      '/api/setup/complete',
      post('', { ...input, removeKeys: ['mistral'] }),
    );
    expect(res.status).toBe(400);
  });

  it('is absent when the gateway runs without a wizard', async () => {
    const res = await setup().app.request('/api/setup/complete', post('', input));
    expect(res.status).toBe(404);
  });
});

describe('verifyKey', () => {
  const KEY = 'test-key-not-real-0123456789';
  const fakeFetch = (status: number, body = '') => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body, { status });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  };

  it('calls each provider read-only on its own host with its auth header and a timeout', async () => {
    const cases = [
      ['anthropic', 'https://api.anthropic.com/v1/models?limit=1', 'x-api-key', KEY],
      ['openai', 'https://api.openai.com/v1/models', 'authorization', `Bearer ${KEY}`],
      ['google', 'https://generativelanguage.googleapis.com/v1beta/models', 'x-goog-api-key', KEY],
    ] as const;
    for (const [provider, url, header, value] of cases) {
      const f = fakeFetch(200);
      expect(await verifyKey(provider, KEY, f.fetchImpl)).toBe('valid');
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]!.url).toBe(url);
      expect(f.calls[0]!.init.method ?? 'GET').toBe('GET');
      expect(new Headers(f.calls[0]!.init.headers).get(header)).toBe(value);
      expect(f.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('maps 401/403 to invalid and other failures to unreachable', async () => {
    for (const provider of ['anthropic', 'openai', 'google'] as const) {
      for (const status of [401, 403])
        expect(await verifyKey(provider, KEY, fakeFetch(status).fetchImpl)).toBe('invalid');
      for (const status of [429, 500])
        expect(await verifyKey(provider, KEY, fakeFetch(status).fetchImpl)).toBe('unreachable');
      const down = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      expect(await verifyKey(provider, KEY, down)).toBe('unreachable');
    }
  });

  it('treats a Gemini 400 API_KEY_INVALID as invalid and other 400s as unreachable', async () => {
    const invalid = JSON.stringify({
      error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] },
    });
    expect(await verifyKey('google', KEY, fakeFetch(400, invalid).fetchImpl)).toBe('invalid');
    expect(await verifyKey('google', KEY, fakeFetch(400, '{}').fetchImpl)).toBe('unreachable');
    expect(await verifyKey('openai', KEY, fakeFetch(400, invalid).fetchImpl)).toBe('unreachable');
  });
});

describe('config', () => {
  const base = { DEFAULT_MODEL: 'haiku', AI_MODELS: 'haiku', CLIENT_KEY_SALT: 'x'.repeat(16) };

  it('saved provider keys load; environment keys win', () => {
    const config = resolveConfig(
      { GEMINI_API_KEY: 'gemini-env-0123456789' },
      { ...base, OPENAI_API_KEY: 'sk-openai-saved-0123', GEMINI_API_KEY: 'gemini-saved-0123' },
    );
    expect(providerKey(config, 'openai')).toBe('sk-openai-saved-0123');
    expect(providerKey(config, 'google')).toBe('gemini-env-0123456789');
    expect(providerKey(config, 'anthropic')).toBeUndefined();
  });

  it('effective models drop models without a provider key and fall back to the first enabled', () => {
    const config = loadConfig({
      ...base,
      AI_MODELS: 'gpt-luna,sonnet,haiku',
      DEFAULT_MODEL: 'gpt-luna',
      ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key',
    });
    expect(effectiveModels(config)).toEqual({
      enabled: ['sonnet', 'haiku'],
      defaultModel: 'sonnet',
    });
    expect(effectiveModels(loadConfig(base))).toEqual({ enabled: [], defaultModel: undefined });
  });

  it('ignores removed settings', () => {
    const config = resolveConfig({}, { ...base, FREE_CREDITS: '3' } as Settings);
    expect(config.DEFAULT_MODEL).toBe('haiku');
    expect(config).not.toHaveProperty('FREE_CREDITS');
    const fromEnv = resolveConfig({ FREE_CREDITS: '3', FREE_AI_DISABLED: 'true' }, base);
    expect(fromEnv).not.toHaveProperty('FREE_CREDITS');
    expect(fromEnv).not.toHaveProperty('FREE_AI_DISABLED');
  });
});

describe('icons', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const zip = zipSync({ 'a/lambda.svg': strToU8(SVG) });
  const pack: AwsIconPack = {
    ...awsIconPack,
    sha256: createHash('sha256').update(zip).digest('hex'),
    files: { 'aws/lambda': 'a/lambda.svg' },
    noIcon: [],
  };

  const build = async (download: () => Promise<AsyncIterable<Uint8Array>>) => {
    const dir = await mkdtemp(join(tmpdir(), 'icons-app-'));
    const icons = new IconStore({ dir, pack, download });
    const config = loadConfig({ CLIENT_KEY_SALT: 'test-salt-0123456789' });
    const app = createApp({ config, store: new MemorySpendStore(), icons });
    return { app, icons, dir };
  };

  it('does not rate-limit GET /api/icons polling', async () => {
    const { app } = setup({ RATE_LIMIT_PER_MINUTE: '2' });
    for (let i = 0; i < 5; i++) expect((await app.request('/api/icons')).status).toBe(200);
  });

  it('reports missing without a store', async () => {
    const { app } = setup();
    const res = await app.request('/api/icons');
    expect(await res.json()).toEqual({ state: 'missing', release: awsIconPack.release });
  });

  it('GET /api/icons has no icons while fetching and includes them when ready', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, icons, dir } = await build(async () =>
      (async function* () {
        await gate;
        yield zip;
      })(),
    );
    const running = icons.ensure();
    const fetching = await (await app.request('/api/icons')).json();
    expect(fetching).toEqual({ state: 'fetching', release: pack.release });
    release();
    await running;
    const res = await app.request('/api/icons');
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({
      state: 'ready',
      release: pack.release,
      icons: { 'aws/lambda': SVG },
    });
    await rm(dir, { recursive: true, force: true });
  });

  it('GET /api/icons is not cached while not ready', async () => {
    const { app } = setup();
    const res = await app.request('/api/icons');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
  });

  it('GET /api/icons sends an ETag and Cache-Control when ready and honours If-None-Match', async () => {
    const { app, icons, dir } = await build(async () =>
      (async function* () {
        yield zip;
      })(),
    );
    await icons.ensure();
    const first = await app.request('/api/icons');
    const etag = first.headers.get('etag');
    expect(etag).toBe(`"aws-${pack.release}"`);
    expect(first.headers.get('cache-control')).toBe('private, max-age=86400');
    const body = await first.text();
    const again = await app.request('/api/icons');
    expect(await again.text()).toBe(body);

    const notModified = await app.request('/api/icons', { headers: { 'If-None-Match': etag! } });
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(notModified.headers.get('etag')).toBe(etag);

    const weak = await app.request('/api/icons', {
      headers: { 'If-None-Match': `"x", W/${etag}` },
    });
    expect(weak.status).toBe(304);
    const stale = await app.request('/api/icons', { headers: { 'If-None-Match': '"aws-old"' } });
    expect(stale.status).toBe(200);
    await rm(dir, { recursive: true, force: true });
  });

  it('POST /api/icons/retry after a failure starts another download', async () => {
    let fail = true;
    const download = vi.fn(async () => {
      if (fail) throw new Error('boom');
      return (async function* () {
        yield zip;
      })();
    });
    const { app, icons, dir } = await build(download);
    await icons.ensure();
    expect(icons.state()).toBe('failed');
    fail = false;
    const res = await app.request('/api/icons/retry', { method: 'POST' });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(icons.state()).toBe('ready'));
    expect(download).toHaveBeenCalledTimes(2);
    await rm(dir, { recursive: true, force: true });
  });
});

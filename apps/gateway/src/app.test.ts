import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig, type Settings } from './config.js';
import { SetupService, type KeyCheck } from './setup.js';
import { MemoryCreditStore } from './store.js';

const setup = (env: Record<string, string> = {}) => {
  const config = loadConfig({
    CLIENT_KEY_SALT: 'test-salt-0123456789',
    ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key',
    ...env,
  });
  const store = new MemoryCreditStore(config.FREE_CREDITS);
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

  it('defaults to Haiku on the instance key and lists both models with benchmarks', async () => {
    const res = await setup().app.request('/api/models');
    const body = (await res.json()) as {
      defaultModel: string;
      enabled: string[];
      options: { id: string; benchmark: { costPerOperationUsd: number } }[];
    };
    expect(body.defaultModel).toBe('haiku');
    expect(body.enabled).toEqual(['haiku']);
    expect(body.options.map((o) => o.id)).toEqual(['haiku', 'sonnet']);
    expect(body.options[1]!.benchmark.costPerOperationUsd).toBeGreaterThan(
      body.options[0]!.benchmark.costPerOperationUsd,
    );
  });

  it('rejects a model the instance key does not serve, with a BYOK hint', async () => {
    const { app } = setup();
    const res = await app.request(
      '/api/ai/generate',
      post('/api/ai/generate', { prompt: 'x', catalogVersion: 'v', model: 'sonnet' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'model_not_enabled', byok: true });
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

  it('reports credits and availability', async () => {
    const res = await setup().app.request('/api/credits/status');
    expect(await res.json()).toEqual({ remaining: 3, freeAiAvailable: true });
  });

  it('validates AI requests and enforces the prompt limit', async () => {
    const { app } = setup();
    expect((await app.request('/api/ai/generate', post('/api/ai/generate', {}))).status).toBe(400);
    const tooLong = { prompt: 'x'.repeat(8001), catalogVersion: 'v' };
    expect((await app.request('/api/ai/generate', post('/api/ai/generate', tooLong))).status).toBe(
      400,
    );
  });

  it('does not charge credits for unimplemented operations', async () => {
    const { app } = setup();
    const res = await app.request('/api/ai/review', post('/api/ai/review', { project: {} }));
    expect(res.status).toBe(501);
    const status = await app.request('/api/credits/status', {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(((await status.json()) as { remaining: number }).remaining).toBe(3);
  });

  it('kill switch: manual flag and budget cap both disable free AI', async () => {
    const off = setup({ FREE_AI_DISABLED: 'true' });
    expect(
      (await off.app.request('/api/ai/review', post('/api/ai/review', { project: {} }))).status,
    ).toBe(503);

    const capped = setup({ DAILY_BUDGET_MICRO_USD: '100' });
    await capped.store.addSpend(100);
    expect(
      (
        (await (await capped.app.request('/api/credits/status')).json()) as {
          freeAiAvailable: boolean;
        }
      ).freeAiAvailable,
    ).toBe(false);
  });

  it('returns 402 with a BYOK hint when credits are exhausted', async () => {
    const { app } = setup({ FREE_CREDITS: '0' });
    const res = await app.request('/api/ai/review', post('/api/ai/review', { project: {} }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'no_credits', byok: true });
  });

  it('rate limits per client', async () => {
    const { app } = setup({ RATE_LIMIT_PER_MINUTE: '2' });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.request('/api/credits/status')).status);
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
  const wizard = (env: Record<string, string> = {}, check: KeyCheck = 'valid') => {
    let saved: Settings = {};
    const service = new SetupService({
      env,
      persistence: { read: () => saved, write: (s) => (saved = structuredClone(s)) },
      setupCode: 'code-1234',
      verifyKey: async () => check,
      generateSalt: () => 'generated-salt-0123456789',
    });
    const app = createApp({
      config: () => service.config(),
      setup: service,
      store: new MemoryCreditStore(() => service.config().FREE_CREDITS),
    });
    return { app, saved: () => saved };
  };
  const input = {
    code: 'code-1234',
    apiKey: 'sk-ant-test-0123456789abcdef',
    models: ['haiku', 'sonnet'],
    defaultModel: 'sonnet',
    freeCredits: 10,
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
      FREE_CREDITS: '10',
      MONTHLY_BUDGET_MICRO_USD: '20000000',
    });
    expect(await (await app.request('/api/models')).json()).toMatchObject({
      defaultModel: 'sonnet',
      enabled: ['haiku', 'sonnet'],
    });
    expect(await (await app.request('/api/credits/status')).json()).toEqual({
      remaining: 10,
      freeAiAvailable: true,
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
        freeCredits: 10,
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

  it('is absent when the gateway runs without a wizard (Workers)', async () => {
    const res = await setup().app.request('/api/setup/complete', post('', input));
    expect(res.status).toBe(404);
  });
});

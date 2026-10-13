import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryCreditStore } from './store.js';

const setup = (env: Record<string, string> = {}) => {
  const config = loadConfig({ CLIENT_KEY_SALT: 'test-salt-0123456789', ...env });
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
    const res = await app.request(
      '/api/ai/generate',
      post('/api/ai/generate', { prompt: 'blog', catalogVersion: 'v' }),
    );
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

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('api in demo mode', () => {
  it('never fetches', async () => {
    vi.stubEnv('VITE_DEMO', 'true');
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    vi.resetModules();
    const { api } = await import('./api');
    await expect(api.models()).rejects.toMatchObject({ status: 0, code: 'demo_mode' });
    await expect(api.setupStatus()).rejects.toMatchObject({ code: 'demo_mode' });
    await expect(api.icons()).rejects.toMatchObject({ code: 'demo_mode' });
    expect(spy).not.toHaveBeenCalled();
  });
});

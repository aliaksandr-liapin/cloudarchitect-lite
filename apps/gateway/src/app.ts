import { awsCatalog, awsIconPack, type IconSet } from '@cloudarchitect/catalog';
import { listedModels, ModelChoice } from '@cloudarchitect/domain';
import { anthropicClient, type LlmClient } from '@cloudarchitect/generator';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import type { Config } from './config.js';
import { registerGenerateRoutes } from './generate.js';
import type { IconStore } from './icons.js';
import { SetupError, SetupInput, type SetupService } from './setup.js';
import type { SpendStore } from './store.js';

export interface Deps {
  /** A getter lets the setup wizard change settings without a restart. */
  config: Config | (() => Config);
  /** First-run wizard; present only on self-hosted Node installs (ADR-0012). */
  setup?: SetupService;
  store: SpendStore;
  /** Official icons fetched on first start; absent in tests and edge runtimes. */
  icons?: IconStore;
  /** Structured logger. Must never receive prompts, graphs or keys (NFR-006). */
  log?: (event: Record<string, unknown>) => void;
  /** Provider client factory; tests inject a fake. */
  llm?: (apiKey: string) => LlmClient;
  /** Clock in epoch ms for operation tokens; tests inject one. */
  now?: () => number;
}

export type Env = { Variables: { clientKey: string } };

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fixed-window limiter per client key. Per-instance only. */
function rateLimiter(limitPerMinute: () => number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()) => {
    const w = windows.get(key);
    if (!w || now - w.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= limitPerMinute();
  };
}

export function createApp({
  config: configSource,
  setup,
  store,
  icons,
  log = () => {},
  llm = anthropicClient,
  now = Date.now,
}: Deps) {
  const app = new Hono<Env>();
  const cfg = typeof configSource === 'function' ? configSource : () => configSource;
  const allow = rateLimiter(() => cfg().RATE_LIMIT_PER_MINUTE);
  const origins = cfg()
    .ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim());

  app.use('*', requestId());
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  );
  app.use('/api/*', cors({ origin: origins, allowMethods: ['GET', 'POST'], maxAge: 600 }));
  app.use(
    '/api/*',
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
  );

  // Anonymous client key: salted hash of the connecting IP. Raw IPs are never stored or logged.
  app.use('/api/*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    c.set('clientKey', await sha256(`${cfg().CLIENT_KEY_SALT}:${ip}`));
    // The web app polls GET /api/icons every 3 s while the first download runs; that is ~20 calls/min
    // and would exhaust the default budget. The route is cheap and serves a fixed in-memory object.
    const exempt = c.req.method === 'GET' && c.req.path === '/api/icons';
    if (!exempt && !allow(c.get('clientKey'))) return c.json({ error: 'rate_limited' }, 429);
    await next();
  });

  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    log({
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  /** True when a key is configured and neither the daily nor the monthly limit is reached (NFR-009). */
  async function aiAvailable() {
    const config = cfg();
    if (!config.ANTHROPIC_API_KEY) return false;
    const { dayMicroUsd, monthMicroUsd } = await store.spend();
    return (
      dayMicroUsd < config.DAILY_BUDGET_MICRO_USD && monthMicroUsd < config.MONTHLY_BUDGET_MICRO_USD
    );
  }

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/api/catalog/manifest', (c) => c.json({ providers: { aws: awsCatalog.manifest } }));

  /** Model options with their measured benchmark, and which ones this instance's key serves. */
  app.get('/api/models', (c) =>
    c.json({
      defaultModel: cfg().DEFAULT_MODEL,
      enabled: cfg().AI_MODELS,
      options: listedModels(),
    }),
  );

  const iconState = () => icons?.state() ?? 'missing';
  // The ready body (~150 KB) never changes for a release, so it is serialized once and served with an
  // ETag; browsers cache it for a day and revalidate with If-None-Match. While the download runs or
  // has failed, the small status body must not be cached.
  let readyBody: { set: IconSet; etag: string; body: string } | undefined;
  app.get('/api/icons', (c) => {
    const set = icons?.iconSet();
    if (!set) {
      c.header('Cache-Control', 'no-store');
      return c.json({ state: iconState(), release: awsIconPack.release });
    }
    if (readyBody?.set !== set) {
      readyBody = {
        set,
        etag: `"aws-${set.release}"`,
        body: JSON.stringify({ state: 'ready', release: set.release, icons: set.icons }),
      };
    }
    c.header('ETag', readyBody.etag);
    c.header('Cache-Control', 'private, max-age=86400');
    const match = c.req.header('if-none-match');
    if (match?.split(',').some((t) => t.trim().replace(/^W\//, '') === readyBody?.etag)) {
      return c.body(null, 304);
    }
    c.header('Content-Type', 'application/json; charset=UTF-8');
    return c.body(readyBody.body);
  });
  app.post('/api/icons/retry', (c) => {
    const state = iconState();
    if (icons && (state === 'missing' || state === 'failed')) void icons.ensure();
    return c.json({ state: icons?.state() ?? state }, 202);
  });

  const setupFailure = (c: Context<Env>, err: unknown) => {
    if (err instanceof SetupError) return c.json({ error: err.code }, err.status);
    throw err;
  };

  app.get('/api/setup/status', (c) =>
    c.json(setup ? { available: true, ...setup.status() } : { available: false, configured: true }),
  );
  app.post('/api/setup/verify-key', async (c) => {
    if (!setup) return c.json({ error: 'not_found' }, 404);
    const body = z
      .object({ code: z.string().max(64), apiKey: z.string().min(20).max(300) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    try {
      return c.json({ result: await setup.checkKey(body.data.code, body.data.apiKey) });
    } catch (err) {
      return setupFailure(c, err);
    }
  });
  app.post('/api/setup/complete', async (c) => {
    if (!setup) return c.json({ error: 'not_found' }, 404);
    const body = SetupInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json(
        { error: 'invalid_request', issues: body.error.issues.map((i) => i.path.join('.')) },
        400,
      );
    try {
      await setup.complete(body.data);
      log({ requestId: c.get('requestId'), event: 'setup_completed' });
      return c.json({ ok: true, ...setup.status() });
    } catch (err) {
      return setupFailure(c, err);
    }
  });

  registerGenerateRoutes(app, { cfg, setup, store, log, aiAvailable, llm, now });

  /**
   * Edit, Review and Ask are Phase 3. Request validation and the key and spending-limit checks are live; a
   * valid request returns 501.
   */
  const aiOperation = (schema: z.ZodType) => async (c: Context<Env>) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const body = schema.safeParse(raw);
    const model = z.object({ model: ModelChoice.optional() }).safeParse(raw);
    if (!body.success || !model.success)
      return c.json(
        {
          error: 'invalid_request',
          issues: [...(body.error?.issues ?? []), ...(model.error?.issues ?? [])].map((i) =>
            i.path.join('.'),
          ),
        },
        400,
      );
    if (setup && !setup.status().configured) return c.json({ error: 'setup_required' }, 503);
    const chosen = model.data.model ?? cfg().DEFAULT_MODEL;
    if (!cfg().AI_MODELS.includes(chosen))
      return c.json({ error: 'model_not_enabled', model: chosen }, 403);
    if (!cfg().ANTHROPIC_API_KEY) return c.json({ error: 'setup_required' }, 503);
    if (!(await aiAvailable())) return c.json({ error: 'ai_unavailable' }, 503);
    return c.json({ error: 'not_implemented' }, 501);
  };

  app.post(
    '/api/ai/edit',
    aiOperation(z.object({ project: z.unknown(), instruction: z.string().min(1).max(2000) })),
  );
  app.post('/api/ai/review', aiOperation(z.object({ project: z.unknown() })));
  app.post(
    '/api/ai/ask',
    aiOperation(z.object({ project: z.unknown(), question: z.string().min(1).max(2000) })),
  );

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    log({ requestId: c.get('requestId'), level: 'error', error: err.name });
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

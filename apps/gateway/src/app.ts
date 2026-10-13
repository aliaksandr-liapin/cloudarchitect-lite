import { awsCatalog } from '@cloudarchitect/catalog';
import { LIMITS } from '@cloudarchitect/domain';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import type { Config } from './config.js';
import type { CreditStore } from './store.js';

export interface Deps {
  config: Config;
  store: CreditStore;
  /** Structured logger. Must never receive prompts, graphs or keys (NFR-006). */
  log?: (event: Record<string, unknown>) => void;
}

type Env = { Variables: { clientKey: string } };

const GenerateBody = z.object({
  prompt: z.string().min(1).max(LIMITS.maxPromptChars),
  catalogVersion: z.string(),
});

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fixed-window limiter per client key. Per-instance only; production Workers use the Rate Limiting binding. */
function rateLimiter(limitPerMinute: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()) => {
    const w = windows.get(key);
    if (!w || now - w.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= limitPerMinute;
  };
}

export function createApp({ config, store, log = () => {} }: Deps) {
  const app = new Hono<Env>();
  const allow = rateLimiter(config.RATE_LIMIT_PER_MINUTE);
  const origins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

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
    const ip =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    c.set('clientKey', await sha256(`${config.CLIENT_KEY_SALT}:${ip}`));
    if (!allow(c.get('clientKey'))) return c.json({ error: 'rate_limited' }, 429);
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

  /** Kill switch: manual flag or either budget cap reached (NFR-009). */
  async function freeAiAvailable() {
    if (config.FREE_AI_DISABLED) return false;
    const { dayMicroUsd, monthMicroUsd } = await store.spend();
    return (
      dayMicroUsd < config.DAILY_BUDGET_MICRO_USD && monthMicroUsd < config.MONTHLY_BUDGET_MICRO_USD
    );
  }

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/api/catalog/manifest', (c) => c.json({ providers: { aws: awsCatalog.manifest } }));

  app.get('/api/credits/status', async (c) =>
    c.json({
      remaining: await store.remaining(c.get('clientKey')),
      freeAiAvailable: await freeAiAvailable(),
    }),
  );

  /**
   * AI operations. Request validation, kill switch and credit checks are live; the LLM pipeline is not
   * implemented yet (ROADMAP Phase 2), so a valid request returns 501 without charging a credit.
   */
  const aiOperation = (schema: z.ZodType) => async (c: Context<Env>) => {
    const body = schema.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json(
        { error: 'invalid_request', issues: body.error.issues.map((i) => i.path.join('.')) },
        400,
      );
    if (!(await freeAiAvailable())) return c.json({ error: 'free_ai_unavailable' }, 503);
    if ((await store.remaining(c.get('clientKey'))) <= 0)
      return c.json({ error: 'no_credits', byok: true }, 402);
    return c.json({ error: 'not_implemented' }, 501);
  };

  app.post('/api/ai/generate', aiOperation(GenerateBody));
  app.post(
    '/api/ai/generate/continue',
    aiOperation(z.object({ operationId: z.string(), answers: z.record(z.string(), z.string()) })),
  );
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

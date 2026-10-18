import { awsCatalog } from '@cloudarchitect/catalog';
import {
  ContinueRequest,
  DesignToggles,
  GenerateRequest,
  ModelChoice,
  Question,
  Requirement,
  type GenerateResponse,
  type Project,
} from '@cloudarchitect/domain';
import {
  callUsage,
  extract,
  generateArchitecture,
  GenerationError,
  type CallUsage,
  type LlmClient,
} from '@cloudarchitect/generator';
import type { Context, Hono } from 'hono';
import type { UnofficialStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { Env } from './app.js';
import type { Config } from './config.js';
import {
  OPERATION_TTL_MS,
  OperationTokenError,
  signOperation,
  verifyOperation,
  type OperationState,
} from './operation-token.js';
import type { SetupService } from './setup.js';
import type { CreditStore } from './store.js';

export interface GenerateDeps {
  cfg: () => Config;
  setup?: SetupService;
  store: CreditStore;
  log: (event: Record<string, unknown>) => void;
  freeAiAvailable: () => Promise<boolean>;
  llm: (apiKey: string) => LlmClient;
  now: () => number;
}

type Ctx = Context<Env>;

/** Fields of a verified token the route relies on; the token itself only shape-checks the binding fields. */
const TokenState = z.object({
  model: ModelChoice,
  toggles: DesignToggles,
  prompt: z.string().min(1),
  name: z.string(),
  requirements: z.array(Requirement),
  assumptions: z.array(z.string()),
  questions: z.array(Question),
});

/** One log event per AI request: counts and cost only, never content (NFR-006). */
class Operation {
  readonly calls: CallUsage[] = [];
  model: ModelChoice | null = null;

  constructor(
    private readonly c: Ctx,
    private readonly deps: GenerateDeps,
    private readonly event: 'ai_generate' | 'ai_continue',
  ) {}

  /** Wraps the provider client so every completed call is priced and added to the spend counters. */
  tracked(llm: LlmClient): LlmClient {
    return async (req) => {
      const res = await llm(req);
      const usage = callUsage(req.model, res.usage);
      this.calls.push(usage);
      await this.deps.store.addSpend(usage.costMicroUsd);
      return res;
    };
  }

  get costMicroUsd() {
    return this.calls.reduce((sum, u) => sum + u.costMicroUsd, 0);
  }

  finish(outcome: string) {
    this.deps.log({
      requestId: this.c.get('requestId'),
      event: this.event,
      model: this.model,
      calls: this.calls.length,
      inputTokens: this.calls.reduce(
        (sum, u) => sum + u.usage.input + u.usage.cacheWrite + u.usage.cacheRead,
        0,
      ),
      outputTokens: this.calls.reduce((sum, u) => sum + u.usage.output, 0),
      costMicroUsd: this.costMicroUsd,
      outcome,
    });
  }
}

const invalid = (c: Ctx, op: Operation, error: z.ZodError) => {
  op.finish('invalid_request');
  return c.json(
    { error: 'invalid_request', issues: error.issues.map((i) => i.path.join('.')) },
    400,
  );
};

/** Edited requirements win; one whose text differs from the token's, or whose id is new, is the user's. */
export function mergeRequirements(
  fromToken: Requirement[],
  edited: Requirement[] | undefined,
): Requirement[] {
  if (!edited) return fromToken;
  const byId = new Map(fromToken.map((r) => [r.id, r]));
  return edited.map((r) => {
    const original = byId.get(r.id);
    return original && original.text === r.text
      ? { ...r, provenance: original.provenance }
      : { ...r, provenance: 'user' as const };
  });
}

export function registerGenerateRoutes(app: Hono<Env>, deps: GenerateDeps) {
  const { cfg, setup, store } = deps;
  const secret = () => `operation-token:${cfg().CLIENT_KEY_SALT}`;

  /** Setup, model, kill switch and credit checks shared by both routes; returns a response to stop. */
  async function precheck(c: Ctx, op: Operation, model: ModelChoice) {
    const stop = (outcome: string, res: Response) => (op.finish(outcome), res);
    // Models outside AI_MODELS are only available with the user's own key (ADR-0011).
    if (!cfg().AI_MODELS.includes(model))
      return stop(
        'model_not_enabled',
        c.json({ error: 'model_not_enabled', model, byok: true }, 403),
      );
    if (!(await deps.freeAiAvailable()))
      return stop('free_ai_unavailable', c.json({ error: 'free_ai_unavailable' }, 503));
    if ((await store.remaining(c.get('clientKey'))) <= 0)
      return stop('no_credits', c.json({ error: 'no_credits', byok: true }, 402));
    return null;
  }

  const setupRequired = (c: Ctx, op: Operation) => {
    if (!setup || setup.status().configured) return null;
    op.finish('setup_required');
    return c.json({ error: 'setup_required' }, 503);
  };

  /** Model failures are never charged; their spend is already counted by the tracked client. */
  const failure = (c: Ctx, op: Operation, err: unknown) => {
    const error = err instanceof GenerationError ? 'generation_failed' : 'provider_error';
    op.finish(error);
    return c.json({ error }, 502);
  };

  /** Charges one credit for a schema-valid project, unless the client has gone away. */
  async function deliver(c: Ctx, op: Operation, project: Project) {
    if (c.req.raw.signal.aborted) {
      op.finish('aborted');
      return c.json({ error: 'client_closed' }, 499 as UnofficialStatusCode);
    }
    if (!(await store.consume(c.get('clientKey')))) {
      op.finish('no_credits');
      return c.json({ error: 'no_credits', byok: true }, 402);
    }
    op.finish('done');
    const body: GenerateResponse = {
      status: 'done',
      project,
      usage: { costUsd: op.costMicroUsd / 1_000_000 },
    };
    return c.json(body);
  }

  app.post('/api/ai/generate', async (c) => {
    const op = new Operation(c, deps, 'ai_generate');
    const parsed = GenerateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, op, parsed.error);
    const body = parsed.data;
    const stopped = setupRequired(c, op);
    if (stopped) return stopped;
    const model = body.model ?? cfg().DEFAULT_MODEL;
    op.model = model;
    const blocked = await precheck(c, op, model);
    if (blocked) return blocked;
    if (body.catalogVersion !== awsCatalog.manifest.catalogVersion) {
      op.finish('catalog_mismatch');
      return c.json({ error: 'catalog_mismatch' }, 409);
    }

    const llm = op.tracked(deps.llm(cfg().ANTHROPIC_API_KEY!));
    const signal = c.req.raw.signal;
    let project: Project;
    try {
      const extracted = await extract(llm, { prompt: body.prompt, toggles: body.toggles, signal });
      if (extracted.questions.length || body.reviewRequirements) {
        const operationId = crypto.randomUUID();
        const state: OperationState = {
          operationId,
          clientKey: c.get('clientKey'),
          model,
          toggles: body.toggles,
          prompt: body.prompt,
          name: extracted.name,
          requirements: extracted.requirements,
          assumptions: extracted.assumptions,
          questions: extracted.questions,
          exp: deps.now() + OPERATION_TTL_MS,
        };
        const res: GenerateResponse = {
          status: 'questions',
          operationId,
          operationToken: await signOperation(state, secret()),
          requirements: extracted.requirements,
          assumptions: extracted.assumptions,
          questions: extracted.questions,
        };
        op.finish('questions');
        return c.json(res);
      }
      ({ project } = await generateArchitecture(llm, awsCatalog, {
        prompt: body.prompt,
        toggles: body.toggles,
        model,
        name: extracted.name,
        requirements: extracted.requirements,
        assumptions: extracted.assumptions,
        questions: [],
        answers: {},
        signal,
        now: new Date(deps.now()),
      }));
    } catch (err) {
      return failure(c, op, err);
    }
    return deliver(c, op, project);
  });

  app.post('/api/ai/generate/continue', async (c) => {
    const op = new Operation(c, deps, 'ai_continue');
    const parsed = ContinueRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, op, parsed.error);
    const body = parsed.data;
    const stopped = setupRequired(c, op);
    if (stopped) return stopped;

    const rejectOperation = () => (
      op.finish('invalid_operation'),
      c.json({ error: 'invalid_operation' }, 400)
    );
    let verified: OperationState;
    try {
      verified = await verifyOperation(body.operationToken, secret(), deps.now());
    } catch (err) {
      if (!(err instanceof OperationTokenError)) throw err;
      if (err.code === 'invalid') return rejectOperation();
      op.finish('operation_expired');
      return c.json({ error: 'operation_expired' }, 410);
    }
    if (verified.clientKey !== c.get('clientKey') || verified.operationId !== body.operationId)
      return rejectOperation();
    const state = TokenState.safeParse(verified);
    if (!state.success) return rejectOperation();
    const { model, toggles, prompt, name, assumptions, questions } = state.data;
    op.model = model;
    const blocked = await precheck(c, op, model);
    if (blocked) return blocked;

    const llm = op.tracked(deps.llm(cfg().ANTHROPIC_API_KEY!));
    let project: Project;
    try {
      ({ project } = await generateArchitecture(llm, awsCatalog, {
        prompt,
        toggles,
        model,
        name,
        requirements: mergeRequirements(state.data.requirements, body.requirements),
        assumptions,
        questions,
        answers: body.answers,
        signal: c.req.raw.signal,
        now: new Date(deps.now()),
      }));
    } catch (err) {
      return failure(c, op, err);
    }
    return deliver(c, op, project);
  });
}

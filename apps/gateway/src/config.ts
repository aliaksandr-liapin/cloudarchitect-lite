import { MODEL_POLICY, ModelChoice } from '@cloudarchitect/domain';
import { z } from 'zod';

const modelList = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  )
  .pipe(z.array(ModelChoice).min(1));

/**
 * Runtime configuration. Read from env vars (Node) or Worker bindings; secrets never have defaults.
 * Budget caps are in micro-USD (1 USD = 1_000_000) to keep counters integral.
 */
export const Config = z
  .object({
    ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
    FREE_CREDITS: z.coerce.number().int().min(0).default(3),
    DAILY_BUDGET_MICRO_USD: z.coerce.number().int().min(0).default(5_000_000),
    MONTHLY_BUDGET_MICRO_USD: z.coerce.number().int().min(0).default(50_000_000),
    /** Manual kill switch, independent of the caps. */
    FREE_AI_DISABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
    /** Models the instance's own key may serve (ADR-0011). Others need the user's own key. */
    AI_MODELS: modelList.prefault(MODEL_POLICY.freeTierModels.join(',')),
    DEFAULT_MODEL: ModelChoice.default(MODEL_POLICY.defaultModel),
    /** Salt for hashing client identifiers; required so raw IPs are never stored. */
    CLIENT_KEY_SALT: z.string().min(16),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
  })
  .refine((c) => c.AI_MODELS.includes(c.DEFAULT_MODEL), {
    path: ['DEFAULT_MODEL'],
    message: 'DEFAULT_MODEL must be one of AI_MODELS',
  });
export type Config = z.infer<typeof Config>;

/** Keys the setup wizard may persist; everything else stays env-only. */
export const SETTING_KEYS = [
  'FREE_CREDITS',
  'DAILY_BUDGET_MICRO_USD',
  'MONTHLY_BUDGET_MICRO_USD',
  'RATE_LIMIT_PER_MINUTE',
  'AI_MODELS',
  'DEFAULT_MODEL',
  'CLIENT_KEY_SALT',
  'ANTHROPIC_API_KEY',
] as const;
export type Settings = Partial<Record<(typeof SETTING_KEYS)[number], string>> & {
  setupCompletedAt?: string;
};

export function loadConfig(env: Record<string, unknown>): Config {
  const parsed = Config.safeParse(env);
  if (!parsed.success) {
    // Report which keys are wrong without echoing their values.
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid gateway configuration: ${keys}`);
  }
  return parsed.data;
}

/** Saved settings form the base; environment variables always win (twelve-factor overrides). */
export function resolveConfig(env: Record<string, unknown>, settings: Settings): Config {
  const fromSettings = Object.fromEntries(
    SETTING_KEYS.flatMap((k) => (settings[k] !== undefined ? [[k, settings[k]]] : [])),
  );
  const fromEnv = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  return loadConfig({ ...fromSettings, ...fromEnv });
}

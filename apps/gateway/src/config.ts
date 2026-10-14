import { MODEL_POLICY } from '@cloudarchitect/domain';
import { z } from 'zod';

/**
 * Runtime configuration. Read from env vars (Node) or Worker bindings; secrets never have defaults.
 * Budget caps are in micro-USD (1 USD = 1_000_000) to keep counters integral.
 */
export const Config = z.object({
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
  /** Model for free credits (ADR-0011); overriding it requires a new eval run. */
  FREE_TIER_MODEL: z.string().min(1).default(MODEL_POLICY.freeTier.model),
  FREE_TIER_REPAIR_TURNS: z.coerce
    .number()
    .int()
    .min(0)
    .max(2)
    .default(MODEL_POLICY.freeTier.repairTurns),
  /** Salt for hashing client identifiers; required so raw IPs are never stored. */
  CLIENT_KEY_SALT: z.string().min(16),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});
export type Config = z.infer<typeof Config>;

export function loadConfig(env: Record<string, unknown>): Config {
  const parsed = Config.safeParse(env);
  if (!parsed.success) {
    // Report which keys are wrong without echoing their values.
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid gateway configuration: ${keys}`);
  }
  return parsed.data;
}

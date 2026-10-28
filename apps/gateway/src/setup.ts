import { ModelChoice } from '@cloudarchitect/domain';
import { z } from 'zod';
import { resolveConfig, SETTING_KEYS, type Config, type Settings } from './config.js';

/** Where wizard settings live. Node uses a 0600 JSON file on the data volume (settings-file.ts). */
export interface SettingsPersistence {
  read(): Settings;
  write(settings: Settings): void;
}

export type KeyCheck = 'valid' | 'invalid' | 'unreachable';

/** Checks an Anthropic key with a read-only call; the key is never logged or returned. */
export async function verifyAnthropicKey(apiKey: string): Promise<KeyCheck> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'valid';
    return res.status === 401 || res.status === 403 ? 'invalid' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export const SetupInput = z.object({
  code: z.string().min(1).max(64),
  /** Omitted when the key comes from the environment. */
  apiKey: z.string().min(20).max(300).optional(),
  models: z.array(ModelChoice).min(1),
  defaultModel: ModelChoice,
  dailyBudgetUsd: z.number().min(0).max(100_000),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000),
  rateLimitPerMinute: z.number().int().min(1).max(10_000),
});
export type SetupInput = z.infer<typeof SetupInput>;

export class SetupError extends Error {
  constructor(
    readonly code:
      | 'invalid_code'
      | 'already_configured'
      | 'invalid_api_key'
      | 'key_check_failed'
      | 'invalid_settings',
    readonly status: 400 | 403 | 409 | 502,
  ) {
    super(code);
  }
}

/**
 * First-run setup for self-hosted (Node/container) installs (ADR-0012). Holds the live config:
 * settings saved by the wizard are the base, environment variables override them.
 */
export class SetupService {
  private settings: Settings;
  private current: Config;

  constructor(
    private readonly deps: {
      env: Record<string, unknown>;
      persistence: SettingsPersistence;
      /** One-time code printed to the container log; proves the user can see the server console. */
      setupCode: string;
      verifyKey?: (key: string) => Promise<KeyCheck>;
      generateSalt: () => string;
    },
  ) {
    this.settings = deps.persistence.read();
    if (!this.settings.CLIENT_KEY_SALT && !deps.env.CLIENT_KEY_SALT) {
      this.settings = { ...this.settings, CLIENT_KEY_SALT: deps.generateSalt() };
      deps.persistence.write(this.settings);
    }
    this.current = resolveConfig(deps.env, this.settings);
  }

  config(): Config {
    return this.current;
  }

  status() {
    return {
      configured: Boolean(this.settings.setupCompletedAt),
      keyFromEnvironment: Boolean(this.deps.env.ANTHROPIC_API_KEY),
      /** Settings fixed by environment variables; wizard values for these are ignored. */
      lockedByEnvironment: SETTING_KEYS.filter(
        (k) => k !== 'CLIENT_KEY_SALT' && k !== 'ANTHROPIC_API_KEY' && Boolean(this.deps.env[k]),
      ),
      /** Effective non-secret values, so the wizard starts from what is in force. */
      current: {
        models: this.current.AI_MODELS,
        defaultModel: this.current.DEFAULT_MODEL,
        dailyBudgetUsd: this.current.DAILY_BUDGET_MICRO_USD / 1_000_000,
        monthlyBudgetUsd: this.current.MONTHLY_BUDGET_MICRO_USD / 1_000_000,
        rateLimitPerMinute: this.current.RATE_LIMIT_PER_MINUTE,
      },
    };
  }

  /** Re-opens the wizard; saved values become its starting point. The salt and key are kept. */
  reset() {
    const { setupCompletedAt: _done, ...rest } = this.settings;
    void _done;
    this.settings = rest;
    this.deps.persistence.write(rest);
  }

  checkCode(code: string) {
    // Length-independent comparison so the code cannot be guessed character by character.
    const a = new TextEncoder().encode(code);
    const b = new TextEncoder().encode(this.deps.setupCode);
    let diff = a.length ^ b.length;
    for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
    if (diff !== 0) throw new SetupError('invalid_code', 403);
  }

  async checkKey(code: string, apiKey: string): Promise<KeyCheck> {
    this.checkCode(code);
    return (this.deps.verifyKey ?? verifyAnthropicKey)(apiKey);
  }

  async complete(input: SetupInput) {
    if (this.status().configured) throw new SetupError('already_configured', 409);
    this.checkCode(input.code);
    if (!input.models.includes(input.defaultModel)) throw new SetupError('invalid_settings', 400);

    const apiKey = this.status().keyFromEnvironment ? undefined : input.apiKey;
    if (!this.status().keyFromEnvironment) {
      if (!apiKey) throw new SetupError('invalid_api_key', 400);
      const check = await (this.deps.verifyKey ?? verifyAnthropicKey)(apiKey);
      if (check === 'invalid') throw new SetupError('invalid_api_key', 400);
      if (check === 'unreachable') throw new SetupError('key_check_failed', 502);
    }

    const next: Settings = {
      ...this.settings,
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
      AI_MODELS: input.models.join(','),
      DEFAULT_MODEL: input.defaultModel,
      DAILY_BUDGET_MICRO_USD: String(Math.round(input.dailyBudgetUsd * 1_000_000)),
      MONTHLY_BUDGET_MICRO_USD: String(Math.round(input.monthlyBudgetUsd * 1_000_000)),
      RATE_LIMIT_PER_MINUTE: String(input.rateLimitPerMinute),
      setupCompletedAt: new Date().toISOString(),
    };
    const config = resolveConfig(this.deps.env, next); // throws before anything is saved
    this.deps.persistence.write(next);
    this.settings = next;
    this.current = config;
  }
}

import { ModelChoice, modelOption, PROVIDERS, type Provider } from '@cloudarchitect/domain';
import { z } from 'zod';
import { KEY_SETTING, resolveConfig, SETTING_KEYS, type Config, type Settings } from './config.js';

const KEY_SETTINGS: readonly string[] = Object.values(KEY_SETTING);

/** Where wizard settings live. Node uses a 0600 JSON file on the data volume (settings-file.ts). */
export interface SettingsPersistence {
  read(): Settings;
  write(settings: Settings): void;
}

export type KeyCheck = 'valid' | 'invalid' | 'unreachable';

/** Read-only "list models" call per provider; each key goes only to its own provider's host. */
function keyCheckRequest(provider: Provider, apiKey: string): [string, Record<string, string>] {
  switch (provider) {
    case 'anthropic':
      return [
        'https://api.anthropic.com/v1/models?limit=1',
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      ];
    case 'openai':
      return ['https://api.openai.com/v1/models', { authorization: `Bearer ${apiKey}` }];
    case 'google':
      return [
        'https://generativelanguage.googleapis.com/v1beta/models',
        { 'x-goog-api-key': apiKey },
      ];
  }
}

/** Checks a provider key with a read-only call; the key is never logged or returned. */
export async function verifyKey(
  provider: Provider,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> {
  try {
    const [url, headers] = keyCheckRequest(provider, apiKey);
    const res = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'valid';
    if (res.status === 401 || res.status === 403) return 'invalid';
    // Gemini answers a bad key with 400 INVALID_ARGUMENT and reason API_KEY_INVALID.
    if (
      provider === 'google' &&
      res.status === 400 &&
      (await res.text()).includes('API_KEY_INVALID')
    )
      return 'invalid';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

const ApiKey = z.string().min(20).max(300);

export const SetupInput = z.object({
  code: z.string().min(1).max(64),
  /** Keys entered in the wizard; a provider left out keeps its saved or environment key. */
  apiKeys: z
    .object({ anthropic: ApiKey.optional(), openai: ApiKey.optional(), google: ApiKey.optional() })
    .optional(),
  /** @deprecated 0.2 body: the Anthropic key. Use `apiKeys.anthropic`; kept for one release. */
  apiKey: ApiKey.optional(),
  models: z.array(ModelChoice).min(1),
  defaultModel: ModelChoice,
  dailyBudgetUsd: z.number().min(0).max(100_000),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000),
  rateLimitPerMinute: z.number().int().min(1).max(10_000),
});
export type SetupInput = z.infer<typeof SetupInput>;

export type KeySource = 'environment' | 'saved' | 'none';

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
      verifyKey?: (provider: Provider, key: string) => Promise<KeyCheck>;
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

  /** Where each provider's key comes from; environment keys win over saved ones. */
  private keySources(settings: Settings = this.settings): Record<Provider, KeySource> {
    return Object.fromEntries(
      PROVIDERS.map((p) => {
        const name = KEY_SETTING[p];
        const source = this.deps.env[name] ? 'environment' : settings[name] ? 'saved' : 'none';
        return [p, source];
      }),
    ) as Record<Provider, KeySource>;
  }

  status() {
    const providers = this.keySources();
    return {
      configured: Boolean(this.settings.setupCompletedAt),
      /** Key sources only, never key values. */
      providers,
      /** @deprecated Use `providers.anthropic === 'environment'`; kept for one release. */
      keyFromEnvironment: providers.anthropic === 'environment',
      /** Settings fixed by environment variables; wizard values for these are ignored. */
      lockedByEnvironment: SETTING_KEYS.filter(
        (k) => k !== 'CLIENT_KEY_SALT' && !KEY_SETTINGS.includes(k) && Boolean(this.deps.env[k]),
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

  async checkKey(code: string, provider: Provider, apiKey: string): Promise<KeyCheck> {
    this.checkCode(code);
    return this.check(provider, apiKey);
  }

  private check(provider: Provider, apiKey: string) {
    return (this.deps.verifyKey ?? verifyKey)(provider, apiKey);
  }

  async complete(input: SetupInput) {
    if (this.status().configured) throw new SetupError('already_configured', 409);
    this.checkCode(input.code);
    if (!input.models.includes(input.defaultModel)) throw new SetupError('invalid_settings', 400);

    // A key set in the environment wins, so a key entered for that provider is ignored.
    const before = this.keySources();
    const entered = { anthropic: input.apiKey, ...input.apiKeys };
    const newKeys = PROVIDERS.flatMap((p) => {
      const key = entered[p];
      return key && before[p] !== 'environment' ? [[p, key] as const] : [];
    });

    const keys: Settings = Object.fromEntries(newKeys.map(([p, key]) => [KEY_SETTING[p], key]));
    const after = this.keySources({ ...this.settings, ...keys });
    if (PROVIDERS.every((p) => after[p] === 'none')) throw new SetupError('invalid_api_key', 400);
    if (input.models.some((m) => after[modelOption(m).provider] === 'none'))
      throw new SetupError('invalid_settings', 400);

    const checks = await Promise.all(newKeys.map(([p, key]) => this.check(p, key)));
    if (checks.includes('invalid')) throw new SetupError('invalid_api_key', 400);
    if (checks.includes('unreachable')) throw new SetupError('key_check_failed', 502);

    const next: Settings = {
      ...this.settings,
      ...keys,
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

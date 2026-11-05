import {
  listedModels,
  modelOption,
  PROVIDER_LABEL,
  PROVIDERS,
  type ModelChoice,
  type ModelOption,
  type Provider,
} from '@cloudarchitect/domain';
import { useEffect, useState } from 'react';
import { ApiError, api, type KeySource } from './api';
import { REPO_URL } from './demo';
import { ModelGroups } from './models';

const STEPS = ['Welcome', 'AI providers', 'Models', 'Limits', 'Review'] as const;

const MESSAGES: Record<string, string> = {
  invalid_code:
    'The setup code is wrong. Copy the link printed in the terminal where the server runs.',
  invalid_api_key:
    'A provider rejected its API key, or no key was given. Check that each key is active and copied completely.',
  key_check_failed:
    'Could not reach a provider to check its key. Check the internet connection and retry.',
  invalid_settings: 'These settings do not match the available keys. Go back and review them.',
  already_configured: 'Setup was already completed.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
};
const message = (err: unknown) =>
  err instanceof ApiError
    ? (MESSAGES[err.code] ?? `Request failed (${err.code}).`)
    : 'The server is not reachable. Is `docker compose up` still running?';

type CheckState = 'unchecked' | 'checking' | 'valid' | 'invalid' | 'unreachable';
type Sources = Record<Provider, KeySource>;
type Checks = Record<Provider, CheckState>;

const KEY_PAGES: Record<Provider, { href: string; text: string; placeholder: string }> = {
  anthropic: {
    href: 'https://platform.claude.com/settings/keys',
    text: 'platform.claude.com → API keys',
    placeholder: 'sk-ant-api03-…',
  },
  openai: {
    href: 'https://platform.openai.com/api-keys',
    text: 'platform.openai.com → API keys',
    placeholder: 'sk-…',
  },
  google: {
    href: 'https://aistudio.google.com/apikey',
    text: 'aistudio.google.com → Get API key',
    placeholder: 'AIza…',
  },
};

/** Where each key comes from; a 0.2 server only reports whether the Anthropic key is in the environment. */
export function keySources(status?: {
  providers?: Sources;
  keyFromEnvironment?: boolean;
}): Sources {
  return (
    status?.providers ?? {
      anthropic: status?.keyFromEnvironment ? 'environment' : 'none',
      openai: 'none',
      google: 'none',
    }
  );
}

/** A provider counts when its key is from the environment, saved, or checked as working in this session. */
export const hasKey = (sources: Sources, checks: Checks, p: Provider) =>
  sources[p] !== 'none' || checks[p] === 'valid';

export const keyedProviders = (sources: Sources, checks: Checks) =>
  PROVIDERS.filter((p) => hasKey(sources, checks, p));

const names = (ps: readonly Provider[], joiner: string) => {
  const labels = ps.map((p) => PROVIDER_LABEL[p]);
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} ${joiner} ${labels.at(-1)}`
    : (labels[0] ?? '');
};

export const welcomeKeyLine = (keyed: readonly Provider[]) =>
  keyed.length
    ? `Keys found for ${names(keyed, 'and')}. Add keys for other AI providers, or continue.`
    : `Add an API key for ${names(PROVIDERS, 'or')} (one is enough).`;

/** Review line: which providers are connected and how. */
export const providerSummary = (sources: Sources, checks: Checks) =>
  keyedProviders(sources, checks)
    .map((p) => {
      const how =
        sources[p] === 'environment'
          ? 'from environment'
          : checks[p] === 'valid'
            ? 'checked ✓, stored on the server'
            : 'saved key kept';
      return `${PROVIDER_LABEL[p]} (${how})`;
    })
    .join(', ');

/** Models of providers with a key and a benchmark, the only ones the Models step offers. */
export const offeredModels = (keyed: readonly Provider[]): ModelOption[] =>
  listedModels().filter((o) => keyed.includes(o.provider));

/** The configured selection restricted to offered models; the default falls back to the first one left. */
export function effectiveSelection(
  models: readonly ModelChoice[],
  defaultModel: ModelChoice,
  offered: readonly ModelOption[],
) {
  const kept = models.filter((m) => offered.some((o) => o.id === m));
  return {
    models: kept,
    defaultModel: kept.includes(defaultModel) ? defaultModel : kept[0],
  };
}

/** Step 2: one card per provider with key field, check button, key page link and result. */
export function ProvidersStep({
  sources,
  keys,
  checks,
  onKey,
  onCheck,
}: {
  sources: Sources;
  keys: Record<Provider, string>;
  checks: Checks;
  onKey: (p: Provider, value: string) => void;
  onCheck: (p: Provider) => void;
}) {
  return (
    <section>
      <h1>AI providers</h1>
      <p>
        Add a key for at least one provider. Each key is used only for that provider&apos;s models,
        and you can add more later by re-running setup.
      </p>
      <div className="provider-cards">
        {PROVIDERS.map((p) => {
          const label = PROVIDER_LABEL[p];
          const page = KEY_PAGES[p];
          const check = checks[p];
          return (
            <div key={p} className="provider-card">
              <h2>{label}</h2>
              {sources[p] === 'environment' ? (
                <p className="ok">✓ Set by environment (.env). Nothing to enter here.</p>
              ) : (
                <>
                  {sources[p] === 'saved' && check !== 'valid' && (
                    <p className="ok">✓ A key is saved. Enter a new one only to replace it.</p>
                  )}
                  <p className="small">
                    Create a key at{' '}
                    <a href={page.href} target="_blank" rel="noreferrer">
                      {page.text}
                    </a>
                    . Set a spend limit there as well.
                  </p>
                  <label className="field">
                    {label} API key
                    <input
                      type="password"
                      value={keys[p]}
                      onChange={(e) => onKey(p, e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={page.placeholder}
                    />
                  </label>
                  <button
                    onClick={() => onCheck(p)}
                    disabled={keys[p].trim().length < 20 || check === 'checking'}
                  >
                    {check === 'checking' ? 'Checking…' : 'Check key'}
                  </button>{' '}
                  {check === 'valid' && <span className="ok">✓ Key works</span>}
                  {check === 'invalid' && <span className="alert-text">Key rejected</span>}
                  {check === 'unreachable' && (
                    <span className="alert-text">Could not reach {label}</span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Keys are stored only on this server&apos;s data volume (owner-only file) and are never sent
        to the browser again or written to logs.
      </p>
    </section>
  );
}

/**
 * First-run setup for self-hosted installs (ADR-0012). The one-time code from the server log proves
 * the person configuring the instance can see its console.
 */
export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.setupStatus>>>();
  const [unreachable, setUnreachable] = useState(false);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  const [keys, setKeys] = useState<Record<Provider, string>>({
    anthropic: '',
    openai: '',
    google: '',
  });
  const [checks, setChecks] = useState<Checks>({
    anthropic: 'unchecked',
    openai: 'unchecked',
    google: 'unchecked',
  });
  const [models, setModels] = useState<ModelChoice[]>(['haiku']);
  const [defaultModel, setDefaultModel] = useState<ModelChoice>('haiku');
  const [dailyBudgetUsd, setDaily] = useState(5);
  const [monthlyBudgetUsd, setMonthly] = useState(50);
  const [rateLimitPerMinute, setRate] = useState(20);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.setupStatus().then(
      (s) => {
        setStatus(s);
        // Start from the values in force (saved settings or environment), not hard-coded defaults.
        if (s.current) {
          setModels(s.current.models);
          setDefaultModel(s.current.defaultModel);
          setDaily(s.current.dailyBudgetUsd);
          setMonthly(s.current.monthlyBudgetUsd);
          setRate(s.current.rateLimitPerMinute);
        }
      },
      () => setUnreachable(true),
    );
  }, []);

  const sources = keySources(status);
  const keyed = keyedProviders(sources, checks);
  const offered = offeredModels(keyed);
  // The configured models may name providers without a key (raw settings); only offered ones count.
  const selection = effectiveSelection(models, defaultModel, offered);
  const chosenDefault = selection.defaultModel;
  const canNext = [
    Boolean(status?.available && !status.configured && code.trim()),
    keyed.length > 0,
    selection.models.length > 0 && chosenDefault !== undefined,
    monthlyBudgetUsd >= dailyBudgetUsd && rateLimitPerMinute >= 1,
    true,
  ][step];

  const setKey = (p: Provider, value: string) => {
    setKeys((k) => ({ ...k, [p]: value }));
    setChecks((c) => ({ ...c, [p]: 'unchecked' }));
  };

  const checkKey = async (p: Provider) => {
    setError(undefined);
    setChecks((c) => ({ ...c, [p]: 'checking' }));
    try {
      const { result } = await api.verifyKey(code.trim(), p, keys[p].trim());
      setChecks((c) => ({ ...c, [p]: result }));
    } catch (err) {
      setChecks((c) => ({ ...c, [p]: 'unchecked' }));
      setError(message(err));
    }
  };

  const finish = async () => {
    if (!chosenDefault) return;
    setBusy(true);
    setError(undefined);
    try {
      // Only keys checked in this session are sent; saved and environment keys stay where they are.
      const apiKeys = Object.fromEntries(
        PROVIDERS.filter((p) => sources[p] !== 'environment' && checks[p] === 'valid').map((p) => [
          p,
          keys[p].trim(),
        ]),
      );
      await api.completeSetup({
        code: code.trim(),
        ...(Object.keys(apiKeys).length ? { apiKeys } : {}),
        models: selection.models,
        defaultModel: chosenDefault,
        dailyBudgetUsd,
        monthlyBudgetUsd,
        rateLimitPerMinute,
      });
      setKeys({ anthropic: '', openai: '', google: '' });
      setDone(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const isLocked = (key: string) => Boolean(status?.lockedByEnvironment?.includes(key));

  const toggleModel = (id: ModelChoice) => {
    const current = selection.models;
    const next = current.includes(id) ? current.filter((m) => m !== id) : [...current, id];
    setModels(next);
    const keep = chosenDefault && next.includes(chosenDefault) ? chosenDefault : next[0];
    if (keep) setDefaultModel(keep);
  };

  const cost = chosenDefault && modelOption(chosenDefault).benchmark?.costPerOperationUsd;
  const generationsPerMonth = cost === undefined ? undefined : Math.floor(monthlyBudgetUsd / cost);

  return (
    <div className="wizard">
      <header className="wizard-head">
        <strong>CloudArchitect Lite</strong> <span className="muted">· Setup</span>
      </header>
      {!done && (
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className={i < step ? 'is-done' : ''}
            >
              <span className="step-no">{i + 1}</span> {s}
            </li>
          ))}
        </ol>
      )}

      <main className="wizard-body">
        {unreachable && (
          <p role="alert" className="alert">
            The server is not reachable. Start it with <code>docker compose up</code> and reload
            this page.
          </p>
        )}
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}

        {done ? (
          <section>
            <h1>You are all set</h1>
            <p>
              Settings are saved on the server&apos;s data volume and apply immediately. To change
              them later, see{' '}
              <a href={`${REPO_URL}/blob/main/docs/operations/installation.md#re-running-setup`}>
                Re-running setup
              </a>{' '}
              in the installation guide.
            </p>
            <a className="button primary" href="/">
              Open the editor
            </a>
          </section>
        ) : step === 0 ? (
          <section>
            <h1>Welcome</h1>
            {status?.configured ? (
              <>
                <p>This installation is already set up.</p>
                <a className="button primary" href="/">
                  Open the editor
                </a>
              </>
            ) : status && !status.available ? (
              <p>This deployment is configured by its operator; there is nothing to set up here.</p>
            ) : (
              <>
                <p>
                  Five short steps connect this installation to an AI provider and set usage limits:
                </p>
                <ol>
                  <li>Confirm you can see the server log (setup code).</li>
                  <li>{welcomeKeyLine(keyed)}</li>
                  <li>Choose which models to offer, based on measured quality and cost.</li>
                  <li>Set limits so usage never exceeds your budget.</li>
                  <li>Review and finish.</li>
                </ol>
                <label className="field">
                  Setup code
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="muted small">
                    Printed in the terminal running <code>docker compose up</code> (or{' '}
                    <code>docker compose logs gateway</code>). The link there fills this in.
                  </span>
                </label>
                <p className="muted small">
                  Manual editing, validation and export work without AI; you can finish setup later.
                </p>
              </>
            )}
          </section>
        ) : step === 1 ? (
          <ProvidersStep
            sources={sources}
            keys={keys}
            checks={checks}
            onKey={setKey}
            onCheck={checkKey}
          />
        ) : step === 2 ? (
          <section>
            <h1>Models</h1>
            <p>
              Choose which models the editor can use with your keys. Only providers with a key are
              listed. Models you leave off are shown in the editor but cannot be selected.
            </p>
            <Locked status={status} keys={['AI_MODELS', 'DEFAULT_MODEL']} />
            <div className="choices">
              {offered.map((o) => (
                <label key={o.id} className="choice">
                  <input
                    type="checkbox"
                    checked={selection.models.includes(o.id)}
                    disabled={isLocked('AI_MODELS')}
                    onChange={() => toggleModel(o.id)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
            <ModelGroups
              options={offered}
              selected={chosenDefault}
              enabled={selection.models}
              onSelect={isLocked('DEFAULT_MODEL') ? undefined : setDefaultModel}
              selectLabel="Make default"
              disabledLabel="Enable first"
            />
          </section>
        ) : step === 3 ? (
          <section>
            <h1>Limits</h1>
            <p>AI stops automatically when a budget is reached; manual editing keeps working.</p>
            <Locked
              status={status}
              keys={['RATE_LIMIT_PER_MINUTE', 'DAILY_BUDGET_MICRO_USD', 'MONTHLY_BUDGET_MICRO_USD']}
            />
            <div className="grid2">
              <NumberField
                label="AI requests per minute"
                disabled={isLocked('RATE_LIMIT_PER_MINUTE')}
                value={rateLimitPerMinute}
                min={1}
                onChange={setRate}
              />
              <NumberField
                label="Daily budget (USD)"
                disabled={isLocked('DAILY_BUDGET_MICRO_USD')}
                value={dailyBudgetUsd}
                min={0}
                step={0.5}
                onChange={setDaily}
              />
              <NumberField
                label="Monthly budget (USD)"
                disabled={isLocked('MONTHLY_BUDGET_MICRO_USD')}
                value={monthlyBudgetUsd}
                min={0}
                step={1}
                onChange={setMonthly}
              />
            </div>
            {monthlyBudgetUsd < dailyBudgetUsd && (
              <p className="alert">The monthly budget must be at least the daily budget.</p>
            )}
            <p className="estimate">
              {generationsPerMonth === undefined ? (
                <>
                  Cost per generation with {chosenDefault && modelOption(chosenDefault).label}: Not
                  yet measured.
                </>
              ) : (
                <>
                  With {chosenDefault && modelOption(chosenDefault).label} at about ${cost} per
                  generation, ${monthlyBudgetUsd} a month covers about{' '}
                  <strong>{generationsPerMonth.toLocaleString()}</strong> generations.
                </>
              )}
            </p>
          </section>
        ) : (
          <section>
            <h1>Review</h1>
            <Locked status={status} keys={status?.lockedByEnvironment ?? []} />
            <dl className="detail">
              <dt>AI providers</dt>
              <dd>{providerSummary(sources, checks)}</dd>
              <dt>Models served</dt>
              <dd>{selection.models.map((m) => modelOption(m).label).join(', ')}</dd>
              <dt>Default model</dt>
              <dd>{chosenDefault && modelOption(chosenDefault).label}</dd>
              <dt>Budget</dt>
              <dd>
                ${dailyBudgetUsd} per day, ${monthlyBudgetUsd} per month
              </dd>
              <dt>Rate limit</dt>
              <dd>{rateLimitPerMinute} AI requests per minute</dd>
            </dl>
          </section>
        )}
      </main>

      {!done && !(step === 0 && (status?.configured || (status && !status.available))) && (
        <footer className="wizard-foot">
          <button onClick={() => setStep((s) => s - 1)} disabled={step === 0 || busy}>
            Back
          </button>
          <span className="spacer" />
          {step < STEPS.length - 1 ? (
            <button className="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next
            </button>
          ) : (
            <button className="primary" onClick={finish} disabled={busy}>
              {busy ? 'Saving…' : 'Finish setup'}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

/** Environment variables override the wizard; say so instead of silently ignoring input. */
function Locked({ status, keys }: { status?: { lockedByEnvironment?: string[] }; keys: string[] }) {
  const locked = keys.filter((k) => status?.lockedByEnvironment?.includes(k));
  if (!locked.length) return null;
  return (
    <p className="notice-inline">
      Set by environment variables (<code>.env</code>): <code>{locked.join(', ')}</code>. Values
      chosen here for these are ignored; remove them from <code>.env</code> and restart to manage
      them here.
    </p>
  );
}

function NumberField(props: {
  label: string;
  disabled?: boolean;
  value: number;
  min: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      {props.label}
      <input
        type="number"
        disabled={props.disabled}
        value={props.value}
        min={props.min}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Math.max(props.min, Number(e.target.value) || 0))}
      />
    </label>
  );
}

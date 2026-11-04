import { modelOption, type ModelChoice } from '@cloudarchitect/domain';
import { useEffect, useState } from 'react';
import { ApiError, api } from './api';
import { ModelComparison } from './models';

const STEPS = ['Welcome', 'API key', 'Models', 'Limits', 'Review'] as const;

const MESSAGES: Record<string, string> = {
  invalid_code:
    'The setup code is wrong. Copy the link printed in the terminal where the server runs.',
  invalid_api_key:
    'Anthropic rejected this API key. Check that it is active and copied completely.',
  key_check_failed:
    'Could not reach Anthropic to check the key. Check the internet connection and retry.',
  already_configured: 'Setup was already completed.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
};
const message = (err: unknown) =>
  err instanceof ApiError
    ? (MESSAGES[err.code] ?? `Request failed (${err.code}).`)
    : 'The server is not reachable. Is `docker compose up` still running?';

/**
 * First-run setup for self-hosted installs (ADR-0012). The one-time code from the server log proves
 * the person configuring the instance can see its console.
 */
export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.setupStatus>>>();
  const [unreachable, setUnreachable] = useState(false);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  const [apiKey, setApiKey] = useState('');
  const [keyState, setKeyState] = useState<'unchecked' | 'checking' | 'valid'>('unchecked');
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

  const keyReady = status?.keyFromEnvironment || keyState === 'valid';
  const canNext = [
    Boolean(status?.available && !status.configured && code.trim()),
    keyReady,
    models.length > 0 && models.includes(defaultModel),
    monthlyBudgetUsd >= dailyBudgetUsd && rateLimitPerMinute >= 1,
    true,
  ][step];

  const checkKey = async () => {
    setError(undefined);
    setKeyState('checking');
    try {
      const { result } = await api.verifyKey(code.trim(), apiKey.trim());
      setKeyState(result === 'valid' ? 'valid' : 'unchecked');
      if (result !== 'valid')
        setError(MESSAGES[result === 'invalid' ? 'invalid_api_key' : 'key_check_failed']);
    } catch (err) {
      setKeyState('unchecked');
      setError(message(err));
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.completeSetup({
        code: code.trim(),
        ...(status?.keyFromEnvironment ? {} : { apiKey: apiKey.trim() }),
        models,
        defaultModel,
        dailyBudgetUsd,
        monthlyBudgetUsd,
        rateLimitPerMinute,
      });
      setApiKey('');
      setDone(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const isLocked = (key: string) => Boolean(status?.lockedByEnvironment?.includes(key));

  const toggleModel = (id: ModelChoice) => {
    const next = models.includes(id) ? models.filter((m) => m !== id) : [...models, id];
    setModels(next);
    if (!next.includes(defaultModel) && next[0]) setDefaultModel(next[0]);
  };

  const cost = modelOption(defaultModel).benchmark.costPerOperationUsd;
  const generationsPerMonth = Math.floor(monthlyBudgetUsd / cost);

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
              them later, see <em>Re-running setup</em> in the installation guide.
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
                <p>Five short steps connect this installation to Claude and set usage limits:</p>
                <ol>
                  <li>Confirm you can see the server log (setup code).</li>
                  <li>Add your Anthropic API key.</li>
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
          <section>
            <h1>Anthropic API key</h1>
            {status?.keyFromEnvironment ? (
              <p className="ok">
                ✓ A key is provided by the environment (.env). Nothing to enter here.
              </p>
            ) : (
              <>
                <p>
                  Create a key at{' '}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    console.anthropic.com → API keys
                  </a>
                  . Set a monthly spend limit there as well.
                </p>
                <label className="field">
                  API key
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyState('unchecked');
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-ant-api03-…"
                  />
                </label>
                <button
                  onClick={checkKey}
                  disabled={apiKey.trim().length < 20 || keyState === 'checking'}
                >
                  {keyState === 'checking' ? 'Checking…' : 'Check key'}
                </button>{' '}
                {keyState === 'valid' && <span className="ok">✓ Key works</span>}
                <p className="muted small">
                  The key is stored only on this server&apos;s data volume (owner-only file) and is
                  never sent to the browser again or written to logs.
                </p>
              </>
            )}
          </section>
        ) : step === 2 ? (
          <section>
            <h1>Models</h1>
            <p>
              Choose which models the editor can use with your key. Models you leave off are shown
              in the editor but cannot be selected.
            </p>
            <Locked status={status} keys={['AI_MODELS', 'DEFAULT_MODEL']} />
            <div className="choices">
              {(['haiku', 'sonnet'] as const).map((id) => (
                <label key={id} className="choice">
                  <input
                    type="checkbox"
                    checked={models.includes(id)}
                    disabled={isLocked('AI_MODELS')}
                    onChange={() => toggleModel(id)}
                  />
                  {modelOption(id).label}
                </label>
              ))}
            </div>
            <ModelComparison
              selected={defaultModel}
              enabled={models}
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
              With {modelOption(defaultModel).label} at about ${cost} per generation, $
              {monthlyBudgetUsd} a month covers about{' '}
              <strong>{generationsPerMonth.toLocaleString()}</strong> generations.
            </p>
          </section>
        ) : (
          <section>
            <h1>Review</h1>
            <Locked status={status} keys={status?.lockedByEnvironment ?? []} />
            <dl className="detail">
              <dt>API key</dt>
              <dd>
                {status?.keyFromEnvironment
                  ? 'From environment'
                  : 'Checked ✓ (stored on the server)'}
              </dd>
              <dt>Models served</dt>
              <dd>{models.map((m) => modelOption(m).label).join(', ')}</dd>
              <dt>Default model</dt>
              <dd>{modelOption(defaultModel).label}</dd>
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

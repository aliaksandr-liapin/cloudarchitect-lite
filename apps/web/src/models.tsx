import {
  listedModels,
  PROVIDER_LABEL,
  PROVIDERS,
  type ModelChoice,
  type ModelOption,
} from '@cloudarchitect/domain';
import { useEffect, useState } from 'react';
import { api } from './api';
import { Collapsible } from './Collapsible';
import { DEMO } from './demo';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const NOT_MEASURED = 'Not yet measured';
const orNot = (x: number | undefined, f: (x: number) => string) =>
  x === undefined ? NOT_MEASURED : f(x);
export const usd = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

/** Measured quality, cost and speed per model (ADR-0011), so the choice is informed. */
export function ModelComparison({
  options = listedModels(),
  selected,
  enabled,
  available,
  onSelect,
  selectLabel = 'Use',
  disabledLabel = 'Own key',
}: {
  options?: readonly ModelOption[];
  selected?: ModelChoice;
  enabled?: readonly ModelChoice[];
  /** Whether each model's provider has a key; a model without one cannot be used. */
  available?: Partial<Record<ModelChoice, boolean>>;
  onSelect?: (id: ModelChoice) => void;
  selectLabel?: string;
  disabledLabel?: string;
}) {
  const b = (o: ModelOption) => o.benchmark;
  const rows: [string, (o: ModelOption) => string][] = [
    ['Blind review score (0–3)', (o) => orNot(b(o)?.blindMedianScore, (x) => x.toFixed(2))],
    ['Automated checks passed', (o) => orNot(b(o)?.passRate, pct)],
    ['Without critical defects', (o) => orNot(b(o)?.noCriticalDefectRate, pct)],
    ['Major defects (reviewed designs)', (o) => orNot(b(o)?.majorDefects, String)],
    ['Cost per generation', (o) => orNot(b(o)?.costPerOperationUsd, usd)],
    ['Typical wait', (o) => orNot(b(o)?.medianLatencySeconds, (x) => `${Math.round(x)} s`)],
  ];
  return (
    <table className="models">
      <thead>
        <tr>
          <th scope="col" />
          {options.map((o) => (
            <th key={o.id} scope="col" className={selected === o.id ? 'is-selected' : ''}>
              {o.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            {options.map((o) => (
              <td key={o.id} className={selected === o.id ? 'is-selected' : ''}>
                {value(o)}
              </td>
            ))}
          </tr>
        ))}
        {onSelect && (
          <tr>
            <th scope="row" />
            {options.map((o) => {
              const keyed = available?.[o.id] !== false;
              const allowed = keyed && (!enabled || enabled.includes(o.id));
              const blocked = keyed ? disabledLabel : 'Add a key in setup';
              return (
                <td key={o.id}>
                  <button
                    aria-pressed={selected === o.id}
                    disabled={!allowed}
                    title={allowed ? undefined : blocked}
                    onClick={() => onSelect(o.id)}
                  >
                    {selected === o.id ? 'Selected' : allowed ? selectLabel : blocked}
                  </button>
                </td>
              );
            })}
          </tr>
        )}
      </tbody>
      <caption className="muted small">
        Measured {options[0]?.benchmark?.measuredAt} in live eval runs (
        {options.map((o) => `${o.label}: ${o.benchmark?.runs ?? 0}`).join(', ')}); blind rubric
        review (PRD §14) of 12 designs per economical model and 9 per best-quality model by three AI
        reviewers, one from each provider.{' '}
        {options.map((o) => `${o.label}: ${o.summary}`).join(' ')}
      </caption>
    </table>
  );
}

/** One comparison table per provider, so numbers are only compared where the choice is real. */
export function ModelGroups({
  options = listedModels(),
  ...rest
}: Omit<Parameters<typeof ModelComparison>[0], 'options'> & { options?: readonly ModelOption[] }) {
  return (
    <>
      {PROVIDERS.map((p) => {
        const group = options.filter((o) => o.provider === p);
        return group.length ? (
          <section key={p} className="model-group">
            <h3>{PROVIDER_LABEL[p]}</h3>
            <ModelComparison options={group} {...rest} />
          </section>
        ) : null;
      })}
    </>
  );
}

const STORAGE_KEY = 'cloudarchitect.model';

/**
 * The browser's saved choice if the server still enables it and has a key for it; otherwise the
 * server default. Without a default (no enabled model has a key) nothing is selected and
 * generating answers setup_required.
 */
export function pickChoice(
  saved: string | null,
  m: {
    enabled: readonly ModelChoice[];
    defaultModel?: ModelChoice;
    available?: Partial<Record<ModelChoice, boolean>>;
  },
): ModelChoice | undefined {
  const id = saved as ModelChoice;
  return m.enabled.includes(id) && m.available?.[id] !== false ? id : m.defaultModel;
}

export interface ModelState {
  enabled?: readonly ModelChoice[];
  available?: Partial<Record<ModelChoice, boolean>>;
  /** The model Generate sends and the panel shows as selected; undefined lets the server decide. */
  choice?: ModelChoice;
  offline: boolean;
  select: (id: ModelChoice) => void;
}

const readSaved = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked: fall back to the server default
  }
};

/** One resolved choice (saved pick checked against `/api/models`) shared by the panel and Generate. */
export function useModelChoice(): ModelState {
  const [info, setInfo] = useState<Pick<ModelState, 'enabled' | 'available'>>({});
  const [choice, setChoice] = useState<ModelChoice>();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (DEMO) return; // read-only benchmark table, nothing to fetch
    api.models().then(
      (m) => {
        setInfo({ enabled: m.enabled, available: m.available });
        setChoice(pickChoice(readSaved(), m));
      },
      () => setOffline(true),
    );
  }, []);

  const select = (id: ModelChoice) => {
    setChoice(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* not persisted; still applies to this session */
    }
  };

  return { ...info, choice, offline, select };
}

/** Editor panel: pick the model for AI operations; models this instance does not enable are disabled. */
export function AiModelPanel({ state }: { state: ModelState }) {
  const { enabled, available, choice, offline, select } = state;
  return (
    <Collapsible id="model" title="AI model" defaultOpen={false}>
      {offline && !DEMO && (
        <p className="muted small">AI service unavailable — manual editing still works.</p>
      )}
      <ModelGroups
        selected={choice}
        enabled={enabled}
        available={available}
        onSelect={offline || DEMO ? undefined : select}
      />
    </Collapsible>
  );
}

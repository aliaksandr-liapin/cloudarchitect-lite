import { MODEL_OPTIONS, type ModelChoice, type ModelOption } from '@cloudarchitect/domain';
import { useEffect, useState } from 'react';
import { api } from './api';
import { Collapsible } from './Collapsible';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

/** Measured quality, cost and speed per model (ADR-0011), so the choice is informed. */
export function ModelComparison({
  options = MODEL_OPTIONS,
  selected,
  enabled,
  onSelect,
  selectLabel = 'Use',
  disabledLabel = 'Own key',
}: {
  options?: readonly ModelOption[];
  selected?: ModelChoice;
  enabled?: readonly ModelChoice[];
  onSelect?: (id: ModelChoice) => void;
  selectLabel?: string;
  disabledLabel?: string;
}) {
  const b = (o: ModelOption) => o.benchmark;
  const rows: [string, (o: ModelOption) => string][] = [
    ['Blind review score (0–3)', (o) => b(o).blindMedianScore.toFixed(2)],
    ['Automated checks passed', (o) => pct(b(o).passRate)],
    ['Without critical defects', (o) => pct(b(o).noCriticalDefectRate)],
    ['Major defects (15 designs)', (o) => String(b(o).majorDefects)],
    ['Cost per generation', (o) => usd(b(o).costPerOperationUsd)],
    ['Typical wait', (o) => `${Math.round(b(o).medianLatencySeconds)} s`],
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
              const allowed = !enabled || enabled.includes(o.id);
              return (
                <td key={o.id}>
                  <button
                    aria-pressed={selected === o.id}
                    disabled={!allowed}
                    title={allowed ? undefined : disabledLabel}
                    onClick={() => onSelect(o.id)}
                  >
                    {selected === o.id ? 'Selected' : allowed ? selectLabel : disabledLabel}
                  </button>
                </td>
              );
            })}
          </tr>
        )}
      </tbody>
      <caption className="muted small">
        Measured {options[0]?.benchmark.measuredAt} in live eval runs (
        {options.map((o) => `${o.label}: ${o.benchmark.runs}`).join(', ')}); blind rubric review by
        isolated AI reviewer sessions (PRD §14).{' '}
        {options.map((o) => `${o.label}: ${o.summary}`).join(' ')}
      </caption>
    </table>
  );
}

const STORAGE_KEY = 'cloudarchitect.model';

/** The model the user picked in the editor panel, if any and readable; the server default applies otherwise. */
export function readModelChoice(): ModelChoice | undefined {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODEL_OPTIONS.some((o) => o.id === saved) ? (saved as ModelChoice) : undefined;
  } catch {
    return undefined;
  }
}

/** Editor panel: pick the model for AI operations; models the server key does not serve need BYOK. */
export function AiModelPanel() {
  const [enabled, setEnabled] = useState<readonly ModelChoice[]>();
  const [choice, setChoice] = useState<ModelChoice>();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api.models().then(
      (m) => {
        setEnabled(m.enabled);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(STORAGE_KEY);
        } catch {
          /* storage blocked: fall back to the server default */
        }
        setChoice(
          m.enabled.includes(saved as ModelChoice) ? (saved as ModelChoice) : m.defaultModel,
        );
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

  return (
    <Collapsible id="model" title="AI model" defaultOpen={false}>
      {offline && (
        <p className="muted small">AI service unavailable — manual editing still works.</p>
      )}
      <ModelComparison
        selected={choice}
        enabled={enabled}
        onSelect={offline ? undefined : select}
      />
    </Collapsible>
  );
}

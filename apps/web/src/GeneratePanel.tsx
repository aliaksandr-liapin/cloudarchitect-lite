import { LIMITS, type DesignToggles } from '@cloudarchitect/domain';
import { useState } from 'react';
import { GenerationStatus, type StepId } from './GenerationStatus';

type Flag = Exclude<keyof DesignToggles, 'disasterRecovery'>;

const FLAGS: [Flag, string][] = [
  ['serverlessFirst', 'Serverless-first'],
  ['backups', 'Backups'],
  ['highAvailability', 'High availability'],
  ['costOptimized', 'Cost-optimized'],
  ['securityHardening', 'Security hardening'],
];

const DR_NEXT = { off: 'multi-az', 'multi-az': 'cross-region', 'cross-region': 'off' } as const;
const DR_LABEL = { off: 'Off', 'multi-az': 'Multi-AZ', 'cross-region': 'Cross-region' } as const;

export interface GenerateInput {
  prompt: string;
  toggles: DesignToggles;
  reviewRequirements: boolean;
}

/** Prompt box, design-priority chips and the Generate button (spec §2.3, §5). */
export function GeneratePanel({
  hasDiagram,
  busy,
  onGenerate,
  onCancel,
  step,
  startedAt,
  typicalSeconds,
  cancellable = true,
}: {
  hasDiagram: boolean;
  busy: boolean;
  onGenerate(input: GenerateInput): void;
  onCancel(): void;
  step?: StepId;
  startedAt?: number;
  /** Typical total wait for the chosen model, shown while reading and designing. */
  typicalSeconds?: number;
  /** False once the request can no longer be aborted (its response is being applied). */
  cancellable?: boolean;
}) {
  const [prompt, setPrompt] = useState('');
  const [toggles, setToggles] = useState<DesignToggles>({});
  const [reviewRequirements, setReviewRequirements] = useState(false);
  const dr = toggles.disasterRecovery ?? 'off';

  const flip = (key: Flag) => setToggles((t) => ({ ...t, [key]: t[key] ? undefined : true }));
  const cycleDr = () =>
    setToggles((t) => {
      const next = DR_NEXT[t.disasterRecovery ?? 'off'];
      return { ...t, disasterRecovery: next === 'off' ? undefined : next };
    });

  return (
    <section className="generate">
      <h2>Generate from a description</h2>
      <label className="field">
        <span className="sr-only">Describe your application</span>
        <textarea
          rows={5}
          maxLength={LIMITS.maxPromptChars}
          placeholder="Describe your application: what it does, who uses it, what matters most."
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <span className="muted small counter" aria-live="polite">
          {prompt.length} / {LIMITS.maxPromptChars}
        </span>
      </label>
      <div className="chips" role="group" aria-label="Design priorities">
        {FLAGS.slice(0, 2).map(([key, label]) => (
          <button
            key={key}
            className="chip"
            aria-pressed={Boolean(toggles[key])}
            disabled={busy}
            onClick={() => flip(key)}
          >
            {label}
          </button>
        ))}
        <button
          className="chip"
          aria-pressed={dr !== 'off'}
          disabled={busy}
          onClick={cycleDr}
          title="Click to cycle Off → Multi-AZ → Cross-region"
        >
          Disaster recovery: {DR_LABEL[dr]}
        </button>
        {FLAGS.slice(2).map(([key, label]) => (
          <button
            key={key}
            className="chip"
            aria-pressed={Boolean(toggles[key])}
            disabled={busy}
            onClick={() => flip(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="check small">
        <input
          type="checkbox"
          checked={reviewRequirements}
          disabled={busy}
          onChange={(e) => setReviewRequirements(e.target.checked)}
        />
        Review requirements before drawing
      </label>
      {hasDiagram && (
        <p className="muted small">
          Generating replaces the current diagram. The current one is kept in Versions.
        </p>
      )}
      {step && startedAt !== undefined ? (
        <GenerationStatus
          step={step}
          startedAt={startedAt}
          typicalSeconds={typicalSeconds}
          cancellable={cancellable}
          onCancel={onCancel}
        />
      ) : busy ? (
        <p className="muted small">Working…</p>
      ) : (
        <button
          className="primary"
          disabled={!prompt.trim()}
          onClick={() => onGenerate({ prompt: prompt.trim(), toggles, reviewRequirements })}
        >
          Generate
        </button>
      )}
    </section>
  );
}

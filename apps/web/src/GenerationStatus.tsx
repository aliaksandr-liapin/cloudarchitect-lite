import { useEffect, useState } from 'react';

export type StepId = 'reading' | 'designing' | 'checking';

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'reading', label: 'Reading your requirements' },
  { id: 'designing', label: 'Designing the architecture' },
  { id: 'checking', label: 'Checking the design' },
];

/** Elapsed time as m:ss, e.g. 0:07 or 1:05. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** What is happening during a generation: current step, time so far and the typical wait. */
export function GenerationStatus({
  step,
  startedAt,
  typicalSeconds,
  cancellable,
  onCancel,
}: {
  step: StepId;
  startedAt: number;
  typicalSeconds?: number;
  cancellable: boolean;
  onCancel(): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="gen-status">
      <div className="row">
        <span className="spinner" aria-hidden="true" />
        <span role="status" aria-live="polite" className="gen-current">
          {STEPS[current]?.label}…
        </span>
        <span className="spacer" />
        {cancellable && <button onClick={onCancel}>Cancel</button>}
      </div>
      <ol className="gen-steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={i < current ? 'done' : i === current ? 'current' : 'upcoming'}
            aria-current={i === current ? 'step' : undefined}
          >
            {s.label}
          </li>
        ))}
      </ol>
      <p className="muted small gen-time">
        {formatElapsed(now - startedAt)}
        {step !== 'checking' && typicalSeconds ? ` · usually about ${typicalSeconds} s` : ''}
      </p>
    </div>
  );
}

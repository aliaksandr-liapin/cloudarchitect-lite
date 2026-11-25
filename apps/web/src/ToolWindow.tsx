import type { ReactNode } from 'react';
import { TOOL_WINDOWS, type ToolWindowId } from './toolWindows';

export const WINDOW_TITLES: Record<ToolWindowId, string> = {
  add: 'Add',
  findings: 'Findings',
  versions: 'Versions',
  model: 'AI model',
};

/** A panel floating over the canvas, with a title bar and a close button. */
export function ToolWindow({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <section className="tool-window" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          className="tool-window-close"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="tool-window-body">{children}</div>
    </section>
  );
}

/** Toolbar buttons that show and hide the tool windows; counts stay current while closed. */
export function ToolToggles({
  open,
  findings,
  versions,
  onToggle,
}: {
  open: readonly ToolWindowId[];
  findings: number;
  versions: number;
  onToggle(id: ToolWindowId): void;
}) {
  const label = (id: ToolWindowId) =>
    id === 'findings'
      ? `Findings (${findings})`
      : id === 'versions'
        ? `Versions (${versions})`
        : WINDOW_TITLES[id];
  return (
    <div className="tool-toggles seg">
      {TOOL_WINDOWS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={open.includes(id)}
          onClick={() => onToggle(id)}
        >
          {label(id)}
        </button>
      ))}
    </div>
  );
}

/** Toolbar button that shows and hides the right-hand side panel (like draw.io's Format panel). */
export function PanelToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Side panel"
      aria-pressed={open}
      title={open ? 'Hide side panel' : 'Show side panel'}
      onClick={onToggle}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
        <path d="M10 2.75v10.5" />
        {open && (
          <path
            d="M10 2.75h2.75a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H10z"
            fill="currentColor"
          />
        )}
      </svg>
    </button>
  );
}

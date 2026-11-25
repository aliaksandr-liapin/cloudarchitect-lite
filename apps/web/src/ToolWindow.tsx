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

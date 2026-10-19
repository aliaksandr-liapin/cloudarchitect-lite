import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readPref, writePref } from './prefs';

/** A `<details>` section that remembers its open state per browser. */
export function Collapsible({
  id,
  title,
  defaultOpen,
  openSignal = 0,
  children,
}: {
  id: string;
  title: string;
  defaultOpen: boolean;
  /** Opens the section whenever this number increases. */
  openSignal?: number;
  children: ReactNode;
}) {
  const key = `cloudarchitect.section.${id}`;
  const [open, setOpen] = useState(() =>
    readPref(
      key,
      (raw) => (raw === 'open' ? true : raw === 'closed' ? false : undefined),
      defaultOpen,
    ),
  );
  const lastSignal = useRef(openSignal);

  useEffect(() => {
    if (openSignal > lastSignal.current) {
      setOpen(true);
      writePref(key, 'open');
    }
    lastSignal.current = openSignal;
  }, [openSignal, key]);

  return (
    <details
      className="collapsible"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        writePref(key, next ? 'open' : 'closed');
      }}
    >
      <summary>{title}</summary>
      {children}
    </details>
  );
}

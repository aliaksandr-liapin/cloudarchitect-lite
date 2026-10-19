import { Collapsible } from './Collapsible';
import type { ProjectVersion } from './versions';

/** Diagrams kept before AI results replaced them, newest first (spec §2.4). */
export function VersionsPanel({
  versions,
  onRestore,
  disabled = false,
  openSignal = 0,
}: {
  versions: ProjectVersion[];
  onRestore(v: ProjectVersion): void;
  /** True while a generation or another replace is in progress. */
  disabled?: boolean;
  /** Increases when a version is saved; opens the section. */
  openSignal?: number;
}) {
  return (
    <Collapsible
      id="versions"
      title={`Versions (${versions.length})`}
      defaultOpen={false}
      openSignal={openSignal}
    >
      {versions.length === 0 ? (
        <p className="muted small">Earlier diagrams appear here when a generation replaces one.</p>
      ) : (
        <ul className="versions">
          {versions.map((v) => (
            <li key={v.createdAt}>
              <span>{v.label}</span>
              <span className="spacer" />
              <button disabled={disabled} onClick={() => onRestore(v)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  );
}

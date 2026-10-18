import type { ProjectVersion } from './versions';

/** Diagrams kept before AI results replaced them, newest first (spec §2.4). */
export function VersionsPanel({
  versions,
  onRestore,
  disabled = false,
}: {
  versions: ProjectVersion[];
  onRestore(v: ProjectVersion): void;
  /** True while a generation or another replace is in progress. */
  disabled?: boolean;
}) {
  return (
    <section>
      <h2>Versions ({versions.length})</h2>
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
    </section>
  );
}

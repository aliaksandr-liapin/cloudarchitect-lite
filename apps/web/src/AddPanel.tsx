import { awsCatalog } from '@cloudarchitect/catalog';
import type { CloudService, ContainerKind, ExternalKind } from '@cloudarchitect/domain';
import { useState } from 'react';
import { Collapsible } from './Collapsible';
import { EXTERNAL_LABELS, newContainer } from './edit';
import { containerIcon, type IconUrls } from './icons';

export type AddItem =
  | { type: 'service'; serviceId: string }
  | { type: 'external'; kind: ExternalKind }
  | { type: 'container'; kind: ContainerKind };

export const DRAG_MIME = 'application/x-cloudarchitect-add';

const EXTERNAL_KINDS = Object.keys(EXTERNAL_LABELS) as ExternalKind[];

/** Services matching `query` (name, id or capability), grouped by category A to Z. */
export function filterServices(query: string): { category: string; services: CloudService[] }[] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, CloudService[]>();
  for (const s of awsCatalog.services) {
    const hit =
      !q ||
      s.displayName.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.capabilities.some((c) => c.toLowerCase().includes(q));
    if (!hit) continue;
    const list = groups.get(s.category) ?? [];
    list.push(s);
    groups.set(s.category, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, services]) => ({ category, services }));
}

function Row({
  name,
  item,
  iconUrl,
  generic,
  disabled,
  onAdd,
}: {
  name: string;
  item: AddItem;
  iconUrl: string | undefined;
  generic: string;
  disabled: boolean;
  onAdd: (item: AddItem) => void;
}) {
  return (
    <li
      className="add-row"
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      {iconUrl ? (
        <span className="add-icon is-official">
          <img src={iconUrl} alt="" draggable={false} />
        </span>
      ) : (
        <span className="add-icon" aria-hidden="true">
          {generic}
        </span>
      )}
      <span className="add-name" title={name}>
        {name}
      </span>
      <button
        type="button"
        aria-label={`Add ${name}`}
        disabled={disabled}
        onClick={() => onAdd(item)}
      >
        Add
      </button>
    </li>
  );
}

export function AddPanel({
  disabled,
  atLimit,
  iconUrls,
  onAdd,
}: {
  disabled: boolean;
  atLimit: boolean;
  iconUrls: IconUrls;
  onAdd: (item: AddItem) => void;
}) {
  const [query, setQuery] = useState('');
  const groups = filterServices(query);
  const off = disabled || atLimit;
  const q = query.trim().toLowerCase();
  const externals = EXTERNAL_KINDS.filter((k) => EXTERNAL_LABELS[k].toLowerCase().includes(q));
  const containers = awsCatalog.containers.filter((c) => c.displayName.toLowerCase().includes(q));
  return (
    <Collapsible id="add" title="Add" defaultOpen>
      <div className="add-panel">
        {atLimit && <p className="muted small">This design has the maximum of 150 components.</p>}
        <input
          type="search"
          aria-label="Search services"
          placeholder="Search services"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {groups.length + externals.length + containers.length === 0 && (
          <p className="muted small">No matching services.</p>
        )}
        {groups.map((g) => (
          <div key={g.category} className="add-group">
            <h3>{g.category}</h3>
            <ul>
              {g.services.map((s) => (
                <Row
                  key={s.id}
                  name={s.displayName}
                  item={{ type: 'service', serviceId: s.id }}
                  iconUrl={s.iconAssetId ? iconUrls[s.iconAssetId] : undefined}
                  generic="▢"
                  disabled={off}
                  onAdd={onAdd}
                />
              ))}
            </ul>
          </div>
        ))}
        {externals.length > 0 && (
          <div className="add-group">
            <h3>Outside AWS</h3>
            <ul>
              {externals.map((kind) => (
                <Row
                  key={kind}
                  name={EXTERNAL_LABELS[kind]}
                  item={{ type: 'external', kind }}
                  iconUrl={undefined}
                  generic="○"
                  disabled={off}
                  onAdd={onAdd}
                />
              ))}
            </ul>
          </div>
        )}
        {containers.length > 0 && (
          <div className="add-group">
            <h3>Containers</h3>
            <ul>
              {containers.map((c) => (
                <Row
                  key={c.kind}
                  name={c.displayName}
                  item={{ type: 'container', kind: c.kind }}
                  iconUrl={containerIcon(newContainer(c.kind, { x: 0, y: 0 }), iconUrls)}
                  generic="□"
                  disabled={disabled}
                  onAdd={onAdd}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Collapsible>
  );
}

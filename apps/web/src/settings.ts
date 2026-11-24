/**
 * The Details panel's Settings section (docs/superpowers/specs/2026-11-24-settings-editor-design.md):
 * which catalog features a component or connector can have, and the edit that sets one.
 */
import {
  UNSET_FEATURE_VALUE,
  type CatalogSnapshot,
  type PatchOp,
  type Project,
  type ServiceFeature,
} from '@cloudarchitect/domain';
import type { Selection } from './Details';

export type SettingRow = {
  /** The configuration key. */
  key: string;
  /** The first catalog feature for this key and element. */
  feature: ServiceFeature;
  /** The current value as text; undefined when unset. */
  value?: string;
};

export type SettingsView = { rows: SettingRow[]; other: { key: string; value: string }[] };

type Configuration = Record<string, string | number | boolean>;

function target(project: Project, selection: Selection) {
  if (selection.kind === 'node') {
    const node = project.nodes.find((n) => n.id === selection.id);
    return node && { configuration: node.configuration, services: [node.serviceId] };
  }
  const edge = project.edges.find((e) => e.id === selection.id);
  if (!edge) return undefined;
  const serviceOf = (id: string) => project.nodes.find((n) => n.id === id)?.serviceId;
  return {
    configuration: edge.configuration,
    services: [serviceOf(edge.source), serviceOf(edge.target)],
  };
}

/** Rows for the selected component or connector; undefined for containers and unknown ids. */
export function settingsView(
  project: Project,
  selection: Selection,
  catalog: CatalogSnapshot,
): SettingsView | undefined {
  const t = target(project, selection);
  if (!t) return undefined;
  const config: Configuration = t.configuration ?? {};
  const rows: SettingRow[] = [];
  for (const feature of catalog.features) {
    if (feature.appliesTo !== selection.kind || !t.services.includes(feature.serviceId)) continue;
    if (rows.some((r) => r.key === feature.configKey)) continue;
    const v = config[feature.configKey];
    rows.push({ key: feature.configKey, feature, value: v === undefined ? undefined : String(v) });
  }
  const other = Object.entries(config)
    .filter(([key]) => !rows.some((r) => r.key === key))
    .map(([key, v]) => ({ key, value: String(v) }));
  return { rows, other };
}

/**
 * The edit that sets `key` to `value` (trimmed; blank or a "not used" word removes it). Empty when nothing changes.
 * The op carries the whole new configuration, or undefined when it becomes empty.
 */
export function setSettingOps(
  project: Project,
  selection: Selection,
  key: string,
  value: string,
): PatchOp[] {
  const t = target(project, selection);
  if (!t) return [];
  const current: Configuration = t.configuration ?? {};
  const next: Configuration = { ...current };
  const trimmed = value.trim();
  // "none", "false" and the like mean not used: remove, never store them.
  const v = UNSET_FEATURE_VALUE.test(trimmed) ? '' : trimmed;
  if (v) {
    if (current[key] !== undefined && String(current[key]) === v) return [];
    next[key] = v;
  } else {
    if (current[key] === undefined) return [];
    delete next[key];
  }
  const configuration = Object.keys(next).length ? next : undefined;
  const op = selection.kind === 'node' ? 'updateNode' : 'updateEdge';
  return [{ op, id: selection.id, changes: { configuration } }];
}

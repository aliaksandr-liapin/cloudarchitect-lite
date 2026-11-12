import type { ArchEdge, ArchNode, Finding, Project } from '@cloudarchitect/domain';

export type ChangeKind =
  | 'node-added'
  | 'node-removed'
  | 'service-changed'
  | 'edge-added'
  | 'edge-removed'
  | 'edge-rewired'
  | 'container-moved'
  | 'requirement-link-dropped';

export interface Change {
  kind: ChangeKind;
  nodeIds: string[];
  edgeIds: string[];
  requirementId?: string;
}

const KIND_ORDER: readonly ChangeKind[] = [
  'node-added',
  'node-removed',
  'service-changed',
  'edge-added',
  'edge-removed',
  'edge-rewired',
  'container-moved',
  'requirement-link-dropped',
];

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unique = (ids: string[]) => [...new Set(ids)];
const byId = <T extends { id: string }>(items: readonly T[]) =>
  new Map(items.map((i) => [i.id, i]));

/** Identity of what a node is: catalog service, unresolved name, or external actor. */
function serviceKey(n: ArchNode): string {
  if (n.serviceId !== undefined) return n.serviceId;
  if (n.unresolved) return `unresolved:${n.unresolved.name}`;
  return `external:${n.external.kind}:${n.external.name}`;
}

/** The id a change is sorted by within its kind: the edge id for edge changes, else the node id. */
const sortId = (c: Change) => c.edgeIds[0] ?? c.nodeIds[0] ?? '';

/**
 * Structural diff by element id. Positions, sizes, labels, purposes, configuration and
 * containers themselves are ignored. A renamed node is a removal plus an addition.
 * Output is sorted by kind (declaration order), then element id, then requirement id.
 */
export function diffDesigns(before: Project, after: Project): Change[] {
  const changes: Change[] = [];
  const bn = byId(before.nodes);
  const an = byId(after.nodes);
  const be = byId(before.edges);
  const ae = byId(after.edges);

  for (const [id, n] of an) {
    const old = bn.get(id);
    if (!old) {
      changes.push({ kind: 'node-added', nodeIds: [id], edgeIds: [] });
      continue;
    }
    if (serviceKey(old) !== serviceKey(n))
      changes.push({ kind: 'service-changed', nodeIds: [id], edgeIds: [] });
    if (old.containerId !== n.containerId)
      changes.push({ kind: 'container-moved', nodeIds: [id], edgeIds: [] });
    for (const r of old.requirementIds)
      if (!n.requirementIds.includes(r))
        changes.push({
          kind: 'requirement-link-dropped',
          nodeIds: [id],
          edgeIds: [],
          requirementId: r,
        });
  }
  for (const id of bn.keys())
    if (!an.has(id)) changes.push({ kind: 'node-removed', nodeIds: [id], edgeIds: [] });

  const ends = (e: ArchEdge) => [e.source, e.target];
  for (const [id, e] of ae) {
    const old = be.get(id);
    if (!old) {
      changes.push({ kind: 'edge-added', nodeIds: unique(ends(e)), edgeIds: [id] });
      continue;
    }
    if (old.source !== e.source || old.target !== e.target)
      changes.push({
        kind: 'edge-rewired',
        nodeIds: unique([...ends(old), ...ends(e)]),
        edgeIds: [id],
      });
    for (const r of old.requirementIds)
      if (!e.requirementIds.includes(r))
        changes.push({
          kind: 'requirement-link-dropped',
          nodeIds: [],
          edgeIds: [id],
          requirementId: r,
        });
  }
  for (const [id, e] of be)
    if (!ae.has(id))
      changes.push({ kind: 'edge-removed', nodeIds: unique(ends(e)), edgeIds: [id] });

  return changes.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      compare(sortId(a), sortId(b)) ||
      compare(a.requirementId ?? '', b.requirementId ?? ''),
  );
}

/** Targeted: touches an element a sent finding names, or drops a requirement link it names. */
export function classifyChanges(
  changes: Change[],
  sent: Finding[],
): { targeted: Change[]; collateral: Change[] } {
  const nodes = new Set(sent.flatMap((f) => f.nodeIds));
  const edges = new Set(sent.flatMap((f) => f.edgeIds));
  const reqs = new Set(sent.flatMap((f) => f.requirementIds));
  const targeted: Change[] = [];
  const collateral: Change[] = [];
  for (const c of changes) {
    const hit =
      c.nodeIds.some((id) => nodes.has(id)) ||
      c.edgeIds.some((id) => edges.has(id)) ||
      (c.requirementId !== undefined && reqs.has(c.requirementId));
    (hit ? targeted : collateral).push(c);
  }
  return { targeted, collateral };
}

/** Stable identity of a finding independent of its generated id. */
export function findingKey(f: Finding): string {
  return [
    f.ruleId ?? 'structural',
    f.severity,
    [...f.nodeIds].sort().join(','),
    [...f.edgeIds].sort().join(','),
  ].join('|');
}

/** Repaired findings whose key does not appear among the first draft's findings. */
export function regressions(firstDraft: Finding[], repaired: Finding[]): Finding[] {
  const known = new Set(firstDraft.map(findingKey));
  return repaired.filter((f) => !known.has(findingKey(f)));
}

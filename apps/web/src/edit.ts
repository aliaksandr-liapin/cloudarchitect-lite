import { awsCatalog } from '@cloudarchitect/catalog';
import {
  LIMITS,
  type ArchEdge,
  type ArchNode,
  type Container,
  type ContainerKind,
  type ExternalKind,
  type PatchOp,
  type Project,
} from '@cloudarchitect/domain';
import { LEGACY_NODE_SIZE, NODE_SIZE } from './layout';

export type Point = { x: number; y: number };

export const EXTERNAL_LABELS: Record<ExternalKind, string> = {
  user: 'User',
  'client-app': 'Client app',
  'third-party': 'Third-party service',
  'on-premises': 'On-premises system',
};

export const NEW_CONTAINER_SIZE = { width: 320, height: 200 };

/** A short random id such as `node-k3j9x0ab`. */
export function newId(prefix: string): string {
  let suffix = '';
  while (suffix.length < 8) suffix += Math.random().toString(36).slice(2);
  return `${prefix}-${suffix.slice(0, 8)}`.slice(0, 128);
}

export function newServiceNode(serviceId: string, at: Point, containerId?: string): ArchNode {
  const service = awsCatalog.services.find((s) => s.id === serviceId);
  return {
    id: newId('node'),
    serviceId,
    provider: 'aws',
    label: service?.displayName ?? serviceId,
    requirementIds: [],
    position: { ...at },
    size: { ...NODE_SIZE },
    ...(containerId ? { containerId } : {}),
  };
}

export function newExternalNode(kind: ExternalKind, at: Point, containerId?: string): ArchNode {
  const name = EXTERNAL_LABELS[kind];
  return {
    id: newId('node'),
    external: { kind, name },
    provider: 'aws',
    label: name,
    requirementIds: [],
    position: { ...at },
    size: { ...NODE_SIZE },
    ...(containerId ? { containerId } : {}),
  };
}

export function newContainer(kind: ContainerKind, at: Point, parentId?: string): Container {
  const def = awsCatalog.containers.find((c) => c.kind === kind);
  return {
    id: newId('container'),
    kind,
    label: def?.displayName ?? kind,
    position: { ...at },
    size: { ...NEW_CONTAINER_SIZE },
    ...(parentId ? { parentId } : {}),
    ...(kind === 'subnet' ? { properties: { subnetType: 'private' as const } } : {}),
  };
}

/**
 * Whether a container of `kind` may sit inside `parentKind` (undefined means top level). A group is a
 * free annotation box: it nests anywhere, as the validator allows.
 */
export function canNest(kind: ContainerKind, parentKind: ContainerKind | undefined): boolean {
  if (parentKind === undefined || kind === 'group') return true;
  const def = awsCatalog.containers.find((c) => c.kind === kind);
  return (
    (def?.allowedParents as readonly ContainerKind[] | undefined)?.includes(parentKind) ?? false
  );
}

/** The toast shown when `canNest(kind, parent)` refused a container. */
export function nestRefusal(kind: ContainerKind): string {
  const def = awsCatalog.containers.find((c) => c.kind === kind);
  const name = def?.displayName ?? kind;
  const parents = ((def?.allowedParents ?? []) as readonly ContainerKind[]).map(
    (k) => awsCatalog.containers.find((c) => c.kind === k)?.displayName ?? k,
  );
  return parents.length === 0
    ? `${name} can only be placed at the top level.`
    : `${name} can only go inside: ${parents.join(', ')}.`;
}

/** Absolute origin of a container: its position plus every ancestor's. */
export function absolutePosition(project: Project, containerId: string | undefined): Point {
  let x = 0;
  let y = 0;
  const seen = new Set<string>();
  for (let id = containerId; id && !seen.has(id);) {
    seen.add(id);
    const c = project.containers.find((k) => k.id === id);
    if (!c) break;
    x += c.position?.x ?? 0;
    y += c.position?.y ?? 0;
    id = c.parentId;
  }
  return { x, y };
}

const isWithin = (project: Project, id: string | undefined, ancestor: string): boolean => {
  const seen = new Set<string>();
  for (let cur = id; cur && !seen.has(cur);) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = project.containers.find((c) => c.id === cur)?.parentId;
  }
  return false;
};

const depthOf = (project: Project, id: string): number => {
  let depth = 0;
  const seen = new Set<string>();
  for (let cur: string | undefined = id; cur && !seen.has(cur); depth++) {
    seen.add(cur);
    cur = project.containers.find((c) => c.id === cur)?.parentId;
  }
  return depth;
};

/**
 * After a drag, the components that now sit in a different container (by their centre), with
 * their new container (undefined: none). `position` is the dropped position relative to the
 * component's current container. A drag that includes a container moves no component between
 * containers: that container's own box is changing in the same gesture.
 */
export function dragReparents(
  project: Project,
  dragged: { id: string; type?: string; position: Point }[],
): { id: string; target: string | undefined }[] {
  if (dragged.some((d) => d.type === 'container')) return [];
  const out: { id: string; target: string | undefined }[] = [];
  for (const d of dragged) {
    if (d.type !== 'service') continue;
    const node = project.nodes.find((n) => n.id === d.id);
    if (!node) continue;
    const size = node.size ?? LEGACY_NODE_SIZE;
    const origin = absolutePosition(project, node.containerId);
    const target = containerAt(project, {
      x: origin.x + d.position.x + size.width / 2,
      y: origin.y + d.position.y + size.height / 2,
    })?.id;
    if (target !== node.containerId) out.push({ id: node.id, target });
  }
  return out;
}

/** The innermost container whose box holds `point`, ignoring `exclude` and everything inside it. */
export function containerAt(
  project: Project,
  point: Point,
  exclude?: string,
): Container | undefined {
  let best: Container | undefined;
  let bestDepth = -1;
  for (const c of project.containers) {
    if (!c.position || !c.size) continue;
    if (exclude && isWithin(project, c.id, exclude)) continue;
    const origin = absolutePosition(project, c.id);
    const inside =
      point.x >= origin.x &&
      point.x <= origin.x + c.size.width &&
      point.y >= origin.y &&
      point.y <= origin.y + c.size.height;
    if (!inside) continue;
    const depth = depthOf(project, c.id);
    if (depth > bestDepth) {
      best = c;
      bestDepth = depth;
    }
  }
  return best;
}

/** Moves a node into `containerId` (or top level) without moving it on screen. */
export function reparentNode(
  project: Project,
  nodeId: string,
  containerId: string | undefined,
): Project {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node || node.containerId === containerId) return project;
  const from = absolutePosition(project, node.containerId);
  const to = absolutePosition(project, containerId);
  const position = {
    x: node.position.x + from.x - to.x,
    y: node.position.y + from.y - to.y,
  };
  const moved = { ...node, position } as ArchNode;
  if (containerId) moved.containerId = containerId;
  else delete moved.containerId;
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? moved : n)) };
}

/** One remove op per selected id. `ids.nodes` may hold node or container ids; unknown ids are skipped. */
export function deletionOps(
  project: Project,
  ids: { nodes: string[]; edges: string[] },
): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const id of ids.nodes) {
    if (project.nodes.some((n) => n.id === id)) ops.push({ op: 'removeNode', id });
    else if (project.containers.some((c) => c.id === id)) ops.push({ op: 'removeContainer', id });
  }
  for (const id of ids.edges) {
    if (project.edges.some((e) => e.id === id)) ops.push({ op: 'removeEdge', id });
  }
  return ops;
}

/** The ids React Flow offers for deletion that were themselves selected; its extras (children, attached edges) are dropped. */
export function selectedIds(
  nodes: { id: string; selected?: boolean }[],
  edges: { id: string; selected?: boolean }[],
): { nodes: string[]; edges: string[] } {
  return {
    nodes: nodes.filter((n) => n.selected === true).map((n) => n.id),
    edges: edges.filter((e) => e.selected === true).map((e) => e.id),
  };
}

export function connectionError(
  project: Project,
  source: string,
  target: string,
): string | undefined {
  if (source === target) return 'A component cannot connect to itself.';
  if (project.edges.some((e) => e.source === source && e.target === target))
    return 'These two are already connected.';
  return undefined;
}

export function newEdge(source: string, target: string): ArchEdge {
  return { id: newId('edge'), source, target, kind: 'other', requirementIds: [] };
}

export function toggleRequirement(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
}

export function atNodeLimit(project: Project): boolean {
  return project.nodes.length >= LIMITS.maxNodes;
}

export type Shortcut = 'undo' | 'redo';

export function shortcutFor(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
): Shortcut | undefined {
  if (!(e.metaKey || e.ctrlKey)) return undefined;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return undefined;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** True where the browser's own text undo should win: text entry, not selects, checkboxes or buttons. */
export function isTextTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !el.type || TEXT_INPUT_TYPES.has(el.type.toLowerCase());
  return false;
}

export function shouldHandleShortcut(e: KeyboardEvent, busy: boolean): Shortcut | undefined {
  if (busy || isTextTarget(e.target)) return undefined;
  return shortcutFor(e);
}

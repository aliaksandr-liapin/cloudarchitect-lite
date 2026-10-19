import type { ArchEdge, ArchNode, Container, Project } from '@cloudarchitect/domain';
import type { Edge, Node } from '@xyflow/react';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';

/** Size `applyLayout` gives every service node. */
export const NODE_SIZE = { width: 220, height: 72 };
/** Size of a node saved before nodes stored a size, so old positions don't overlap. */
export const LEGACY_NODE_SIZE = { width: 168, height: 64 };
export const MIN_NODE_SIZE = { width: 160, height: 56 };
export const MIN_CONTAINER_SIZE = { width: 160, height: 80 };
export const CONTAINER_PAD = { top: 40, left: 16, right: 16, bottom: 16 };
const CONTAINER_PADDING = `[top=${CONTAINER_PAD.top},left=${CONTAINER_PAD.left},bottom=${CONTAINER_PAD.bottom},right=${CONTAINER_PAD.right}]`;

/** An ELK edge route in absolute flow coordinates: start, bend points, end, plus the label box. */
export type EdgeRoute = {
  points: { x: number; y: number }[];
  label?: { x: number; y: number; width: number; height: number };
};
/** Routes from one layout pass, keyed by edge id. Kept in memory only. */
export type Routes = ReadonlyMap<string, EdgeRoute>;

const LABEL_MAX_WIDTH = 160;
/** Estimated label box: 7 px per character, wrapping at 160 px over at most 2 lines of 16 px, plus 4 px. */
export function labelSize(text: string): { width: number; height: number } {
  const raw = text.length * 7;
  const lines = Math.min(2, Math.max(1, Math.ceil(raw / LABEL_MAX_WIDTH)));
  return { width: Math.min(LABEL_MAX_WIDTH, raw), height: lines * 16 + 4 };
}

/** The label text shown on an edge, shared by layout and rendering. */
const edgeLabel = (e: ArchEdge) => e.label ?? (e.kind === 'other' ? undefined : e.kind);

export type ServiceNodeData = {
  node: ArchNode;
  displayName: string;
  variant: 'service' | 'unresolved' | 'external';
};
export type ContainerNodeData = { container: Container };

/** ELK is ~1.5 MB, so it is loaded on first layout instead of blocking first paint. TODO(E1): run in a Web Worker. */
let elk: Promise<{ layout: (g: ElkNode) => Promise<ElkNode> }> | undefined;
const getElk = () =>
  (elk ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK()));

/** Builds the ELK hierarchy: containers become compound nodes so nested layout follows the container model (FR-019). */
export function toElkGraph(project: Project): ElkNode {
  const children = new Map<string | undefined, ElkNode[]>();
  const push = (parent: string | undefined, n: ElkNode) =>
    children.set(parent, [...(children.get(parent) ?? []), n]);

  for (const c of project.containers) {
    push(c.parentId, { id: c.id, layoutOptions: { 'elk.padding': CONTAINER_PADDING } });
  }
  // Auto layout resets hand-made sizes, so every node is laid out at the default size.
  for (const n of project.nodes) push(n.containerId, { id: n.id, ...NODE_SIZE });

  const attach = (n: ElkNode): ElkNode => ({
    ...n,
    children: (children.get(n.id) ?? []).map(attach),
  });

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.json.edgeCoords': 'ROOT',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '16',
      'elk.spacing.edgeLabel': '8',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    },
    children: (children.get(undefined) ?? []).map(attach),
    edges: project.edges.map((e) => {
      const text = edgeLabel(e);
      return {
        id: e.id,
        sources: [e.source],
        targets: [e.target],
        ...(text ? { labels: [{ text, ...labelSize(text) }] } : {}),
      };
    }),
  };
}

/** A project needs auto-layout when it has never been laid out (containers without sizes). */
export const needsLayout = (p: Project) => p.containers.some((c) => !c.size || !c.position);

/** One ELK pass over the project: every box (relative to its parent) and every edge route. */
async function runElk(project: Project): Promise<{ boxes: Map<string, ElkNode>; routes: Routes }> {
  const laid = await (await getElk()).layout(toElkGraph(project));
  const boxes = new Map<string, ElkNode>();
  const elkEdges: ElkExtendedEdge[] = [...(laid.edges ?? [])];
  const visit = (n: ElkNode) => {
    boxes.set(n.id, n);
    elkEdges.push(...(n.edges ?? []));
    n.children?.forEach(visit);
  };
  laid.children?.forEach(visit);

  const routes = new Map<string, EdgeRoute>();
  for (const e of elkEdges) {
    const s = e.sections?.[0];
    if (!s) continue;
    const l = e.labels?.[0];
    routes.set(e.id, {
      points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(({ x, y }) => ({ x, y })),
      // No label box without ELK coordinates: the edge then falls back to the smoothstep label position.
      ...(l && l.x !== undefined && l.y !== undefined
        ? { label: { x: l.x, y: l.y, width: l.width ?? 0, height: l.height ?? 0 } }
        : {}),
    });
  }
  return { boxes, routes };
}

/**
 * Runs ELK and writes positions (relative to the parent container), node sizes and container sizes back
 * into the project, and returns each edge's route in absolute coordinates (`edgeCoords: ROOT`).
 * Only called on first load or when the user asks for auto-layout, so manual positions are never lost (FR-006).
 */
export async function applyLayout(project: Project): Promise<{ project: Project; routes: Routes }> {
  const { boxes, routes } = await runElk(project);
  const pos = (id: string) => ({ x: boxes.get(id)?.x ?? 0, y: boxes.get(id)?.y ?? 0 });
  return {
    project: {
      ...project,
      containers: project.containers.map((c) => ({
        ...c,
        position: pos(c.id),
        size: { width: boxes.get(c.id)?.width ?? 200, height: boxes.get(c.id)?.height ?? 120 },
      })),
      nodes: project.nodes.map((n) => ({ ...n, position: pos(n.id), size: { ...NODE_SIZE } })),
    },
    routes,
  };
}

/**
 * Routes are not persisted. After a reload, Import or Restore this lays the stored project out again
 * in memory and keeps a route only where both endpoints and all their ancestor containers sit exactly
 * where that layout puts them, so the route still fits. Nothing in the project is changed.
 */
export async function recoverRoutes(project: Project): Promise<Routes> {
  const { boxes, routes } = await runElk(project);
  const same = (a: number | undefined, b: number | undefined) =>
    a !== undefined && b !== undefined && Math.abs(a - b) <= 0.5;
  const fits = (
    id: string,
    position?: { x: number; y: number },
    size?: { width: number; height: number },
  ) => {
    const box = boxes.get(id);
    return (
      !!box &&
      !!position &&
      !!size &&
      same(box.x, position.x) &&
      same(box.y, position.y) &&
      same(box.width, size.width) &&
      same(box.height, size.height)
    );
  };
  const containers = new Map(project.containers.map((c) => [c.id, c]));
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const unchanged = (nodeId: string) => {
    const n = nodes.get(nodeId);
    if (!n || !fits(n.id, n.position, n.size ?? LEGACY_NODE_SIZE)) return false;
    const seen = new Set<string>();
    for (let id = n.containerId; id && !seen.has(id); id = containers.get(id)?.parentId) {
      seen.add(id);
      const c = containers.get(id);
      if (!c || !fits(c.id, c.position, c.size)) return false;
    }
    return true;
  };
  const kept = new Map<string, EdgeRoute>();
  for (const e of project.edges) {
    const route = routes.get(e.id);
    if (route && unchanged(e.source) && unchanged(e.target)) kept.set(e.id, route);
  }
  return kept;
}

/** Whether `containerId` is `ancestor` or sits (at any depth) inside it. */
const within = (project: Project, containerId: string | undefined, ancestor: string) => {
  const seen = new Set<string>();
  for (
    let id = containerId;
    id && !seen.has(id);
    id = project.containers.find((c) => c.id === id)?.parentId
  ) {
    if (id === ancestor) return true;
    seen.add(id);
  }
  return false;
};

/**
 * Drops the routes a hand move or resize made stale: edges whose source or target changed, or whose
 * endpoint sits (at any depth) inside a changed container.
 */
export function dropRoutes(
  routes: Routes,
  project: Project,
  changedIds: readonly string[],
): Routes {
  const changed = new Set(changedIds);
  const containerOf = new Map(project.nodes.map((n) => [n.id, n.containerId]));
  const stale = (nodeId: string) =>
    changed.has(nodeId) || changedIds.some((c) => within(project, containerOf.get(nodeId), c));
  const kept = new Map(routes);
  for (const e of project.edges) if (stale(e.source) || stale(e.target)) kept.delete(e.id);
  return kept;
}

/** Boxes of a container's direct children, relative to the container. */
const childBoxes = (project: Project, containerId: string) => [
  ...project.nodes
    .filter((n) => n.containerId === containerId)
    .map((n) => ({ ...n.position, ...(n.size ?? LEGACY_NODE_SIZE) })),
  ...project.containers
    .filter((c) => c.parentId === containerId && c.position && c.size)
    .map((c) => ({ ...c.position!, ...c.size! })),
];

/** Smallest size a container can be resized to: its direct children's bounding box plus padding. */
export function containerMinSize(
  project: Project,
  containerId: string,
): { width: number; height: number } {
  const boxes = childBoxes(project, containerId);
  const right = Math.max(0, ...boxes.map((b) => b.x + b.width)) + CONTAINER_PAD.right;
  const bottom = Math.max(0, ...boxes.map((b) => b.y + b.height)) + CONTAINER_PAD.bottom;
  return {
    width: Math.max(MIN_CONTAINER_SIZE.width, right),
    height: Math.max(MIN_CONTAINER_SIZE.height, bottom),
  };
}

/**
 * Whether a proposed container box (`rect`, in its parent's coordinates) still holds its direct
 * children plus the padding. Left and top handles move the origin, so children are measured from the
 * new origin. A child already closer to an edge than the padding only bounds that edge where it is.
 */
export function fitsChildren(
  project: Project,
  containerId: string,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const container = project.containers.find((c) => c.id === containerId);
  const old = container?.position ?? { x: 0, y: 0 };
  const size = container?.size ?? { width: rect.width, height: rect.height };
  const boxes = childBoxes(project, containerId);
  if (!boxes.length) return true;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const dx = rect.x - old.x;
  const dy = rect.y - old.y;
  return (
    left - dx >= Math.min(CONTAINER_PAD.left, left) &&
    top - dy >= Math.min(CONTAINER_PAD.top, top) &&
    rect.width - (right - dx) >= Math.min(CONTAINER_PAD.right, size.width - right) &&
    rect.height - (bottom - dy) >= Math.min(CONTAINER_PAD.bottom, size.height - bottom)
  );
}

/** Converts stored project geometry to React Flow nodes. Parents must precede children, so containers go depth-first. */
export function toFlow(
  project: Project,
  displayName: (serviceId: string) => string,
  routes?: Routes,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const parented = (parentId?: string) => (parentId ? { parentId, extent: 'parent' as const } : {});

  const addContainer = (c: Container) => {
    nodes.push({
      id: c.id,
      type: 'container',
      position: c.position ?? { x: 0, y: 0 },
      style: { width: c.size?.width, height: c.size?.height },
      data: { container: c } satisfies ContainerNodeData,
      ...parented(c.parentId),
    });
    project.containers.filter((child) => child.parentId === c.id).forEach(addContainer);
  };
  project.containers.filter((c) => !c.parentId).forEach(addContainer);

  for (const n of project.nodes) {
    nodes.push({
      id: n.id,
      type: 'service',
      position: n.position,
      style: { ...(n.size ?? LEGACY_NODE_SIZE) },
      data: {
        node: n,
        displayName: n.serviceId
          ? displayName(n.serviceId)
          : n.external
            ? `${n.external.name} · external ${n.external.kind}`
            : (n.unresolved?.name ?? n.label),
        variant: n.serviceId ? 'service' : n.external ? 'external' : 'unresolved',
      } satisfies ServiceNodeData,
      ...parented(n.containerId),
    });
  }

  const edges: Edge[] = project.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'routed',
    data: { route: routes?.get(e.id), label: edgeLabel(e) },
    animated: e.kind === 'event',
  }));
  return { nodes, edges };
}

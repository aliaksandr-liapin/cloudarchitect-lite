import type { ArchNode, Container, Project } from '@cloudarchitect/domain';
import type { Edge, Node } from '@xyflow/react';
import type { ElkNode } from 'elkjs/lib/elk-api.js';

export const NODE_SIZE = { width: 168, height: 64 };
const CONTAINER_PADDING = '[top=40,left=16,bottom=16,right=16]';

export type ServiceNodeData = { node: ArchNode; displayName: string; unresolved: boolean };
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
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
    },
    children: (children.get(undefined) ?? []).map(attach),
    edges: project.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

/** A project needs auto-layout when it has never been laid out (containers without sizes). */
export const needsLayout = (p: Project) => p.containers.some((c) => !c.size || !c.position);

/**
 * Runs ELK and writes positions (relative to the parent container) and container sizes back into the project.
 * Only called on first load or when the user asks for auto-layout, so manual positions are never lost (FR-006).
 */
export async function applyLayout(project: Project): Promise<Project> {
  const laid = await (await getElk()).layout(toElkGraph(project));
  const boxes = new Map<string, ElkNode>();
  const visit = (n: ElkNode) => {
    boxes.set(n.id, n);
    n.children?.forEach(visit);
  };
  laid.children?.forEach(visit);

  const pos = (id: string) => ({ x: boxes.get(id)?.x ?? 0, y: boxes.get(id)?.y ?? 0 });
  return {
    ...project,
    containers: project.containers.map((c) => ({
      ...c,
      position: pos(c.id),
      size: { width: boxes.get(c.id)?.width ?? 200, height: boxes.get(c.id)?.height ?? 120 },
    })),
    nodes: project.nodes.map((n) => ({ ...n, position: pos(n.id) })),
  };
}

/** Converts stored project geometry to React Flow nodes. Parents must precede children, so containers go depth-first. */
export function toFlow(
  project: Project,
  displayName: (serviceId: string) => string,
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
      data: {
        node: n,
        displayName: n.serviceId ? displayName(n.serviceId) : n.unresolved!.name,
        unresolved: !n.serviceId,
      } satisfies ServiceNodeData,
      ...parented(n.containerId),
    });
  }

  const edges: Edge[] = project.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label ?? (e.kind === 'other' ? undefined : e.kind),
    animated: e.kind === 'event',
  }));
  return { nodes, edges };
}

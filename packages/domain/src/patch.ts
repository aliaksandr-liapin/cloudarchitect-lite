import { z } from 'zod';
import { ArchEdge, ArchNode, Container, Project } from './project.js';

const Id = z.string().min(1);

/** Graph patch produced by AI Edit (TECHNICAL_ARCHITECTURE §8). Applied only after user confirmation. */
export const PatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addNode'), node: ArchNode }),
  z.object({ op: z.literal('removeNode'), id: Id }),
  z.object({ op: z.literal('updateNode'), id: Id, changes: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal('addEdge'), edge: ArchEdge }),
  z.object({ op: z.literal('removeEdge'), id: Id }),
  z.object({ op: z.literal('updateEdge'), id: Id, changes: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal('addContainer'), container: Container }),
  z.object({ op: z.literal('removeContainer'), id: Id }),
  z.object({
    op: z.literal('updateContainer'),
    id: Id,
    changes: z.record(z.string(), z.unknown()),
  }),
  z.object({ op: z.literal('moveToContainer'), nodeId: Id, containerId: Id.nullable() }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const GraphPatch = z.object({
  baseRevision: z.number().int().nonnegative(),
  ops: z.array(PatchOp).min(1).max(100),
  rationale: z.string().max(4000).optional(),
});
export type GraphPatch = z.infer<typeof GraphPatch>;

export class StalePatchError extends Error {
  constructor(base: number, current: number) {
    super(`Patch is based on revision ${base} but the project is at revision ${current}.`);
    this.name = 'StalePatchError';
  }
}

/** Fields an update op may never touch; positions are preserved unless the user moves things. */
const PROTECTED = new Set(['id', 'position']);

function merge<T extends object>(item: T, changes: Record<string, unknown>): T {
  const safe = Object.fromEntries(Object.entries(changes).filter(([k]) => !PROTECTED.has(k)));
  return { ...item, ...safe };
}

/**
 * Applies a patch immutably and re-parses the result, so a patch can never produce an invalid project.
 * Removing a node also removes its edges; removing a container detaches (not deletes) its children.
 */
export function applyPatch(project: Project, patch: GraphPatch): Project {
  if (patch.baseRevision !== project.revision)
    throw new StalePatchError(patch.baseRevision, project.revision);
  let { nodes, edges, containers } = project;
  for (const op of patch.ops) {
    switch (op.op) {
      case 'addNode':
        nodes = [...nodes, op.node];
        break;
      case 'removeNode':
        nodes = nodes.filter((n) => n.id !== op.id);
        edges = edges.filter((e) => e.source !== op.id && e.target !== op.id);
        break;
      case 'updateNode':
        nodes = nodes.map((n) => (n.id === op.id ? merge(n, op.changes) : n));
        break;
      case 'addEdge':
        edges = [...edges, op.edge];
        break;
      case 'removeEdge':
        edges = edges.filter((e) => e.id !== op.id);
        break;
      case 'updateEdge':
        edges = edges.map((e) => (e.id === op.id ? merge(e, op.changes) : e));
        break;
      case 'addContainer':
        containers = [...containers, op.container];
        break;
      case 'removeContainer': {
        const removed = containers.find((c) => c.id === op.id);
        containers = containers
          .filter((c) => c.id !== op.id)
          .map((c) => (c.parentId === op.id ? { ...c, parentId: removed?.parentId } : c));
        nodes = nodes.map((n) =>
          n.containerId === op.id ? { ...n, containerId: removed?.parentId } : n,
        );
        break;
      }
      case 'updateContainer':
        containers = containers.map((c) => (c.id === op.id ? merge(c, op.changes) : c));
        break;
      case 'moveToContainer':
        nodes = nodes.map((n) =>
          n.id === op.nodeId ? { ...n, containerId: op.containerId ?? undefined } : n,
        );
        break;
    }
  }
  return Project.parse({ ...project, nodes, edges, containers, revision: project.revision + 1 });
}

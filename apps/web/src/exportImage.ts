import type { Project } from '@cloudarchitect/domain';
import { getNodesBounds, type Node } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { fileBaseName } from './storage';

export type ImageFormat = 'png' | 'svg';

/** Export needs something to draw. */
export const canExport = (p: Project) => p.nodes.length > 0 || p.containers.length > 0;

/** Image size and viewport transform that frame `bounds` with `padding` on every side, at scale 1. */
export function imageFrame(
  bounds: { x: number; y: number; width: number; height: number },
  padding = 40,
): { width: number; height: number; transform: string } {
  return {
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    transform: `translate(${padding - bounds.x}px, ${padding - bounds.y}px) scale(1)`,
  };
}

/**
 * Bounds of all nodes in flow coordinates. Child nodes carry positions relative to their parent, and
 * `getNodesBounds` only resolves parents through a node lookup, so absolute positions are computed here.
 */
export function diagramBounds(nodes: Node[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absolute = (n: Node, seen = new Set<string>()): { x: number; y: number } => {
    const parent = n.parentId && !seen.has(n.id) ? byId.get(n.parentId) : undefined;
    if (!parent) return n.position;
    const at = absolute(parent, seen.add(n.id));
    return { x: at.x + n.position.x, y: at.y + n.position.y };
  };
  return getNodesBounds(nodes.map((n) => ({ ...n, parentId: undefined, position: absolute(n) })));
}

/** Controls, minimap and resize handles are editing chrome, not part of the diagram. */
const keep = (el: Element) =>
  !(el instanceof HTMLElement) ||
  !(
    el.classList.contains('react-flow__controls') ||
    el.classList.contains('react-flow__minimap') ||
    el.classList.contains('react-flow__resize-control') ||
    el.classList.contains('react-flow__panel')
  );

/** Renders the whole diagram (not just the visible part) and downloads it. */
export async function exportImage(
  format: ImageFormat,
  viewport: HTMLElement,
  nodes: Node[],
  opts: { background: string; fileName: string },
): Promise<void> {
  const { width, height, transform } = imageFrame(diagramBounds(nodes));
  const render = format === 'png' ? toPng : toSvg;
  const url = await render(viewport, {
    backgroundColor: opts.background,
    width,
    height,
    pixelRatio: format === 'png' ? 2 : 1,
    filter: keep,
    style: { width: `${width}px`, height: `${height}px`, transform },
  });
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${fileBaseName(opts.fileName)}.${format}`,
  });
  a.click();
}

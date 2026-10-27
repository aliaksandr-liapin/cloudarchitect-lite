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
  const { width, height, transform } = imageFrame(getNodesBounds(nodes));
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

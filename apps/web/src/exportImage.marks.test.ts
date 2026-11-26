import type { Node } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

// What --mark-scale the viewport had at the moment html-to-image captured it.
const seen = vi.hoisted(() => ({ scale: undefined as string | undefined }));
vi.mock('html-to-image', () => ({
  toBlob: vi.fn(async (el: { style: CSSStyleDeclaration }) => {
    seen.scale = el.style.getPropertyValue('--mark-scale');
    return new Blob(['png']);
  }),
  toSvg: vi.fn(),
}));
vi.mock('./storage', () => ({ downloadBlob: vi.fn(), fileBaseName: (n: string) => n }));

const { exportImage } = await import('./exportImage');

/** Just enough of an element's inline style for exportImage. */
function fakeViewport(initial: Record<string, string> = {}) {
  const props = new Map(Object.entries(initial));
  const style = {
    getPropertyValue: (k: string) => props.get(k) ?? '',
    setProperty: (k: string, v: string) => void props.set(k, v),
    removeProperty: (k: string) => {
      const v = props.get(k) ?? '';
      props.delete(k);
      return v;
    },
  };
  return { el: { style } as unknown as HTMLElement, props };
}

const nodes = [
  { id: 'a', position: { x: 0, y: 0 }, width: 100, height: 50, data: {} },
] as unknown as Node[];

describe('exportImage and finding markers', () => {
  it('draws markers at their normal size, not enlarged for the zoomed-out screen', async () => {
    const { el, props } = fakeViewport();
    await exportImage('png', el, nodes, { background: '#fff', fileName: 'x' });
    expect(seen.scale).toBe('1');
    expect(props.has('--mark-scale')).toBe(false);
  });

  it('puts back a value the viewport already had', async () => {
    const { el, props } = fakeViewport({ '--mark-scale': '2' });
    await exportImage('png', el, nodes, { background: '#fff', fileName: 'x' });
    expect(seen.scale).toBe('1');
    expect(props.get('--mark-scale')).toBe('2');
  });
});

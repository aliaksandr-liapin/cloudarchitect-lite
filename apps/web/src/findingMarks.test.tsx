import type { Finding } from '@cloudarchitect/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { findingMarks, MARK_SIZE, markScale } from './findingMarks';
import { FindingMark } from './nodes';

const f = (severity: Finding['severity'], ruleId: string, over: Partial<Finding> = {}): Finding =>
  ({
    id: ruleId,
    severity,
    ruleId,
    explanation: `${ruleId} text`,
    nodeIds: [],
    edgeIds: [],
    containerIds: [],
    ...over,
  }) as Finding;

describe('findingMarks', () => {
  it('gives each component its worst severity and every finding line', () => {
    const marks = findingMarks(
      [
        f('info', 'VR-008', { nodeIds: ['s3'] }),
        f('warning', 'VR-026', { nodeIds: ['s3'] }),
        f('info', 'VR-013', { nodeIds: ['fn'] }),
      ],
      [],
    );
    expect(marks.get('s3')).toEqual({
      severity: 'warning',
      lines: ['VR-008: VR-008 text', 'VR-026: VR-026 text'],
    });
    expect(marks.get('fn')?.severity).toBe('info');
  });
  it('puts a connector finding on the component it points at, and container findings on the container', () => {
    const marks = findingMarks(
      [
        f('error', 'VR-004', { edgeIds: ['e1'] }),
        f('warning', 'VR-018', { containerIds: ['vpc'] }),
      ],
      [{ id: 'e1', target: 'q' }],
    );
    expect(marks.get('q')?.severity).toBe('error');
    expect(marks.get('vpc')?.severity).toBe('warning');
  });
});

describe('FindingMark', () => {
  it('is a button named by its findings, coloured by severity', () => {
    const html = renderToStaticMarkup(
      <FindingMark mark={{ severity: 'warning', lines: ['VR-026: s3 is not connected'] }} />,
    );
    expect(html).toContain('class="mark mark-warning nodrag nopan"');
    expect(html).toContain('aria-label="1 finding: VR-026: s3 is not connected"');
    expect(html).toContain('>!<');
  });
  it('shows i for info and counts several findings', () => {
    const html = renderToStaticMarkup(
      <FindingMark mark={{ severity: 'info', lines: ['a', 'b'] }} />,
    );
    expect(html).toContain('aria-label="2 findings: a; b"');
    expect(html).toContain('>i<');
  });
});

describe('markScale', () => {
  it('leaves the marker as drawn at 100% zoom and closer', () => {
    expect(markScale(1)).toBe(1);
    expect(markScale(2)).toBe(1);
  });

  it('keeps the marker at least 16 screen pixels when zoomed out', () => {
    for (const zoom of [0.75, 0.5, 0.37, 0.2]) {
      expect(MARK_SIZE * markScale(zoom) * zoom).toBeCloseTo(16);
    }
  });
});

describe('MARK_SIZE', () => {
  it('is the 20-pixel marker drawn in styles.css', () => {
    expect(MARK_SIZE).toBe(20);
  });
});

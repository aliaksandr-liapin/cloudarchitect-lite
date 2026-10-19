import { describe, expect, it } from 'vitest';
import { formatElapsed, STEPS } from './GenerationStatus';

describe('generation status', () => {
  it('formats elapsed time as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7000)).toBe('0:07');
    expect(formatElapsed(65000)).toBe('1:05');
  });

  it('lists the three steps in order', () => {
    expect(STEPS.map((s) => s.label)).toEqual([
      'Reading your requirements',
      'Designing the architecture',
      'Checking the design',
    ]);
  });
});

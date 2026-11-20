import type { Finding } from '@cloudarchitect/domain';
import { repairMessageFor } from '@cloudarchitect/generator';
import { describe, expect, it } from 'vitest';
import {
  doseFindings,
  doseMessage,
  EB_ARMS,
  eligibleInfo,
  hasVr018,
  pickInfo,
  seedFor,
  vr018Only,
} from './effort-budget-arms.js';
import { armFindings } from './info-repair-arms.js';

const f = (ruleId: string, severity: Finding['severity'], node = 'n1'): Finding => ({
  id: `f-${ruleId}-${node}`,
  class: 'rule',
  ruleId,
  severity,
  nodeIds: [node],
  edgeIds: [],
  containerIds: [],
  requirementIds: [],
  explanation: `${ruleId} explanation`,
  evidence: [],
  producerVersion: 'test',
});
const err = (r: string) => f(r, 'error');
const warn = (r: string, node?: string) => f(r, 'warning', node);
const info = (r: string) => f(r, 'info');

describe('effort-budget arms', () => {
  it('lists the four arms in order', () => {
    expect(EB_ARMS).toEqual(['0', '1', '2', 'S']);
  });

  it('arm 2 is a superset of arm 1 and both use the same seed', () => {
    const fs = [warn('VR-018'), info('VR-008'), info('VR-005'), info('VR-007')];
    const seed = seedFor('orders', 1);
    const one = pickInfo(fs, 1, seed);
    const two = pickInfo(fs, 2, seed);
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(2);
    expect(two[0]).toBe(one[0]);
  });

  it('seedFor is stable and differs across repeats', () => {
    expect(seedFor('orders', 1)).toBe(seedFor('orders', 1));
    expect(seedFor('orders', 1)).not.toBe(seedFor('orders', 2));
    expect(Number.isInteger(seedFor('orders', 1))).toBe(true);
    expect(seedFor('orders', 1)).toBeGreaterThanOrEqual(0);
  });

  it('different seeds can pick different findings (the pick is not by rule order)', () => {
    const fs = [info('VR-005'), info('VR-007'), info('VR-008'), info('VR-013'), info('VR-024')];
    const firsts = new Set(
      Array.from({ length: 20 }, (_, i) => pickInfo(fs, 1, seedFor('s', i))[0]!.ruleId),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('ignores info rules outside the five (VR-015) and sends what exists when fewer than k', () => {
    const fs = [warn('VR-018'), info('VR-015'), info('VR-008')];
    expect(eligibleInfo(fs).map((x) => x.ruleId)).toEqual(['VR-008']);
    expect(pickInfo(fs, 2, 1).map((x) => x.ruleId)).toEqual(['VR-008']);
  });

  it('dose 0 equals the W arm list', () => {
    const fs = [err('VR-001'), warn('VR-018'), info('VR-008')];
    expect(doseFindings(fs, 0, 1)).toEqual(armFindings(fs, 'W'));
  });

  it('errors and warnings come before info in a dose list', () => {
    const fs = [info('VR-008'), warn('VR-018')];
    expect(doseFindings(fs, 1, 1).map((x) => x.severity)).toEqual(['warning', 'info']);
  });

  it('vr018Only keeps every VR-018 finding and nothing else', () => {
    const fs = [warn('VR-018', 'alb1'), warn('VR-004'), warn('VR-018', 'alb2')];
    expect(vr018Only(fs)).toHaveLength(2);
    expect(hasVr018(fs)).toBe(true);
    expect(hasVr018([warn('VR-004')])).toBe(false);
  });

  it('doseMessage is the plain repair message, undefined when nothing is sent', () => {
    expect(doseMessage([info('VR-015')], 2, 1)).toBeUndefined();
    const fs = [warn('VR-018'), info('VR-008')];
    expect(doseMessage(fs, 1, 1)).toBe(repairMessageFor(doseFindings(fs, 1, 1)));
  });
});

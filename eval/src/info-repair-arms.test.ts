import { describe, expect, it } from 'vitest';
import type { Finding } from '@cloudarchitect/domain';
import {
  armFindings,
  infoRepairMessage,
  messageFor,
  sampleReviewJobs,
} from './info-repair-arms.js';

const f = (ruleId: string, severity: Finding['severity']): Finding => ({
  id: `f-${ruleId}`,
  class: 'rule',
  ruleId,
  severity,
  nodeIds: [],
  edgeIds: [],
  containerIds: [],
  requirementIds: [],
  explanation: `${ruleId} explanation`,
  evidence: [],
  producerVersion: 'test',
});

describe('armFindings', () => {
  const all = [
    f('VR-001', 'error'),
    f('VR-005', 'info'),
    f('VR-002', 'warning'),
    f('VR-015', 'info'),
    f('VR-024', 'info'),
    f('VR-099', 'info'),
  ];
  it('W keeps errors and warnings only', () => {
    expect(armFindings(all, 'W').map((x) => x.ruleId)).toEqual(['VR-001', 'VR-002']);
  });
  it('I adds the five info rules but never VR-015', () => {
    expect(armFindings(all, 'I').map((x) => x.ruleId)).toEqual([
      'VR-001',
      'VR-005',
      'VR-002',
      'VR-024',
    ]);
  });
});

describe('infoRepairMessage', () => {
  it('matches the spec text', () => {
    expect(infoRepairMessage('- x')).toBe(
      'The deterministic validator reported these findings on your architecture:\n- x\n\nReturn the complete corrected architecture. Fix every error. Fix each warning, or keep it only if it is intentional and say why in assumptions. Apply each info finding if it fits the requirements; otherwise leave it and say why in assumptions. Do not change anything else.',
    );
  });
});

describe('messageFor', () => {
  it('returns undefined when the arm has nothing to send', () => {
    const only015 = [f('VR-015', 'info')];
    expect(messageFor('W', only015)).toBeUndefined();
    expect(messageFor('I', only015)).toBeUndefined();
    const only008 = [f('VR-008', 'info')];
    expect(messageFor('W', only008)).toBeUndefined();
    expect(messageFor('I', only008)).toContain('VR-008');
  });
});

describe('sampleReviewJobs', () => {
  const jobs = [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`,
      model: 'm1',
      differ: true,
      infoSent: i < 3 ? 1 : 0,
    })),
    { id: 'same', model: 'm1', differ: false, infoSent: 5 },
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `b${i}`,
      model: 'm2',
      differ: true,
      infoSent: 0,
    })),
  ];
  it('takes jobs with info first, is stable for a seed, and skips identical pairs', () => {
    const a = sampleReviewJobs(jobs, 5, 1);
    expect(a).toEqual(sampleReviewJobs(jobs, 5, 1));
    const m1 = a.filter((j) => j.model === 'm1');
    expect(m1).toHaveLength(5);
    expect(m1.slice(0, 3).every((j) => j.infoSent > 0)).toBe(true);
    expect(a.some((j) => j.id === 'same')).toBe(false);
    expect(a.filter((j) => j.model === 'm2')).toHaveLength(4);
  });
});

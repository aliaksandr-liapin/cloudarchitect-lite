import { describe, expect, it } from 'vitest';
import { countByRule, ruleHitTable, type RuleHitRecord } from './rule-hits.js';

describe('countByRule', () => {
  it('keys findings by rule and severity', () => {
    expect(
      countByRule([
        { id: 'f1', severity: 'warning', ruleId: 'VR-003', explanation: 'x' },
        { id: 'f2', severity: 'warning', ruleId: 'VR-003', explanation: 'y' },
        { id: 'f3', severity: 'error', explanation: 'z' },
      ] as Parameters<typeof countByRule>[0]),
    ).toEqual({ 'VR-003:warning': 2, 'structural:error': 1 });
  });
});

describe('ruleHitTable', () => {
  const records: RuleHitRecord[] = [
    { model: 'a', ok: true, findingsByRule: { 'VR-003:warning': 3, 'VR-008:info': 1 } },
    { model: 'a', ok: true, findingsByRule: {} },
    { model: 'a', ok: false },
    { model: 'b', ok: true, findingsByRule: { 'VR-009:error': 1 } },
  ];

  it('counts runs with the rule, not findings, per model; errors first', () => {
    expect(ruleHitTable(records)).toBe(
      [
        '| Rule | Severity | a | b |',
        '| --- | --- | --- | --- |',
        '| VR-009 | error | · | 1/1 |',
        '| VR-003 | warning | 1/2 | · |',
        '| VR-008 | info | 1/2 | · |',
      ].join('\n'),
    );
  });

  it('marks a model without data for the field as n/a', () => {
    const table = ruleHitTable(
      [...records, { model: 'b', ok: true, firstDraftFindingsByRule: { 'VR-004:warning': 1 } }],
      'firstDraftFindingsByRule',
      ['a', 'b'],
    );
    expect(table).toContain('| VR-004 | warning | n/a | 1/1 |');
  });
});

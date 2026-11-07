/** Rule hits per model: how many runs of each model have at least one finding of each rule. */
import type { Finding } from '@cloudarchitect/domain';

/** Findings keyed `<ruleId>:<severity>`, e.g. `VR-003:warning`; findings without a rule are `structural`. */
export type FindingsByRule = Record<string, number>;

export function countByRule(findings: Finding[]): FindingsByRule {
  const out: FindingsByRule = {};
  for (const f of findings) {
    const key = `${f.ruleId ?? 'structural'}:${f.severity}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export interface RuleHitRecord {
  model: string;
  ok: boolean;
  findingsByRule?: FindingsByRule;
  firstDraftFindingsByRule?: FindingsByRule;
}

const SEVERITY_ORDER = ['error', 'warning', 'info'];

const byRule = (a: string, b: string) => {
  const [ra = '', sa = ''] = a.split(':');
  const [rb = '', sb = ''] = b.split(':');
  return SEVERITY_ORDER.indexOf(sa) - SEVERITY_ORDER.indexOf(sb) || ra.localeCompare(rb);
};

/**
 * A Markdown table: one row per rule that fired, one column per model, each cell
 * "runs with the rule / scored runs". Runs that never produced a project are left out.
 */
export function ruleHitTable(
  records: RuleHitRecord[],
  field: 'findingsByRule' | 'firstDraftFindingsByRule' = 'findingsByRule',
  models: string[] = [...new Set(records.map((r) => r.model))],
): string {
  const scored = records.filter((r) => r.ok && r[field]);
  const runs = new Map(models.map((m) => [m, scored.filter((r) => r.model === m)]));
  const rules = [...new Set(scored.flatMap((r) => Object.keys(r[field]!)))].sort(byRule);
  const cell = (model: string, rule: string) => {
    const rs = runs.get(model)!;
    if (!rs.length) return 'n/a';
    const hits = rs.filter((r) => (r[field]![rule] ?? 0) > 0).length;
    return hits ? `${hits}/${rs.length}` : `·`;
  };
  const header = ['Rule', 'Severity', ...models];
  const rows = rules.map((rule) => {
    const [id = '', severity = ''] = rule.split(':');
    return [id, severity, ...models.map((m) => cell(m, rule))];
  });
  return [header, header.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

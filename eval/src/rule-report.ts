/**
 * Prints rule hits per model from saved live runs (no API calls).
 * Usage: pnpm --filter @cloudarchitect/eval rules <run-id-or-dir> [...]
 * Runs from before first-draft logging have no first-draft table.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ruleHitTable, type RuleHitRecord } from './rule-hits.js';

const root = new URL('..', import.meta.url).pathname;
const runs = process.argv.slice(2);
if (!runs.length) {
  console.error('Usage: pnpm --filter @cloudarchitect/eval rules <run-id-or-dir> [...]');
  process.exit(1);
}
const records = runs.flatMap((run) => {
  const dir =
    isAbsolute(run) || run.includes('/') ? resolve(run) : join(root, 'results', 'live', run);
  return JSON.parse(readFileSync(join(dir, 'records.json'), 'utf8')) as RuleHitRecord[];
});

console.log('Final design (after any repair turn):\n');
console.log(ruleHitTable(records));
if (records.some((r) => r.firstDraftFindingsByRule)) {
  console.log('\nFirst draft (before any repair turn):\n');
  console.log(ruleHitTable(records, 'firstDraftFindingsByRule'));
}

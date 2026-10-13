import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Scenario, scoreCandidate, THRESHOLDS } from './harness.js';

const root = new URL('..', import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8')) as unknown;

const scenarios = readdirSync(join(root, 'scenarios'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => Scenario.parse(read(join('scenarios', f))));

const results = scenarios.map((s) => {
  try {
    return scoreCandidate(s, read(join('candidates', `${s.id}.project.json`)));
  } catch {
    return null; // No candidate yet for this scenario.
  }
});

const scored = results.filter((r) => r !== null);
const validRate = scored.length ? scored.filter((r) => r.schemaValid).length / scored.length : 1;

console.table(
  scored.map((r) => ({
    ...r,
    missingServices: r.missingServices.join(', '),
    forbiddenServices: r.forbiddenServices.join(', '),
  })),
);
console.log(
  `scenarios: ${scenarios.length}, scored: ${scored.length}, schema-valid rate: ${validRate.toFixed(2)}`,
);

mkdirSync(join(root, 'results'), { recursive: true });
writeFileSync(
  join(root, 'results', 'latest.json'),
  JSON.stringify({ at: new Date().toISOString(), results: scored }, null, 2),
);

const failed = validRate < THRESHOLDS.schemaValidRate || scored.some((r) => !r.passed);
process.exit(failed ? 1 : 0);

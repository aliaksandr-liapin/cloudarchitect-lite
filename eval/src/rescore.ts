/** Re-scores a saved spike run against the current scenario labels (no API calls). Usage: pnpm rescore <run-dir> */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Scenario, scoreCandidate } from './harness.js';

const root = new URL('..', import.meta.url).pathname;
const runDir = resolve(process.argv[2] ?? '');
const scenarios = new Map(
  readdirSync(join(root, 'scenarios'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => Scenario.parse(JSON.parse(readFileSync(join(root, 'scenarios', f), 'utf8'))))
    .map((s) => [s.id, s]),
);

const rows = readdirSync(join(runDir, 'outputs'))
  .filter((f) => f.endsWith('.project.json'))
  .map((f) => {
    const [, model, scenarioId] = /^([a-z_]+)-(.+)-\d+\.project\.json$/.exec(f)!;
    const r = scoreCandidate(
      scenarios.get(scenarioId!)!,
      JSON.parse(readFileSync(join(runDir, 'outputs', f), 'utf8')),
    );
    return {
      model,
      scenarioId,
      passed: r.passed,
      missing: r.missingServices.join(', '),
      errors: r.errorFindings,
    };
  });
console.table(rows.filter((r) => !r.passed));
for (const m of [...new Set(rows.map((r) => r.model))]) {
  const rs = rows.filter((r) => r.model === m);
  console.log(`${m}: ${rs.filter((r) => r.passed).length}/${rs.length} passed`);
}

/**
 * Fails unless the root version, every workspace version and the default image tag in compose.yaml agree.
 *
 *   node tools/check-versions.ts
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const manifests = [
  'package.json',
  'apps/web/package.json',
  'apps/gateway/package.json',
  'packages/domain/package.json',
  'packages/catalog/package.json',
  'packages/generator/package.json',
  'eval/package.json',
  'e2e/package.json',
];

const versions = new Map<string, string>();
for (const file of manifests) {
  const json = JSON.parse(await readFile(resolve(ROOT, file), 'utf8')) as { version?: string };
  versions.set(file, json.version ?? '(missing)');
}

const compose = await readFile(resolve(ROOT, 'compose.yaml'), 'utf8');
const tags = [...compose.matchAll(/^\s*image:\s*\S+:\$\{CLOUDARCHITECT_VERSION:-([^}]+)\}\s*$/gm)];
if (tags.length === 0) {
  console.error(
    'compose.yaml: no image line with a ${CLOUDARCHITECT_VERSION:-<default>} tag found',
  );
  process.exit(1);
}
tags.forEach((m, i) => versions.set(`compose.yaml image #${i + 1}`, m[1] as string));

const expected = versions.get('package.json');
const bad = [...versions].filter(([, v]) => v !== expected);
if (bad.length > 0) {
  console.error(`Versions differ from root package.json (${expected}):`);
  for (const [name, v] of bad) console.error(`  ${name}: ${v}`);
  process.exit(1);
}
console.log(`All ${versions.size} versions are ${expected}.`);

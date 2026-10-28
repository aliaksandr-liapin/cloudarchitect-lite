/**
 * Downloads the pinned official AWS icon pack, verifies its SHA-256 and writes the mapped SVGs as one
 * IconSet JSON file. The icons are never committed or shipped; each install fetches them itself.
 *
 *   node tools/fetch-icons.ts [--out <file>]
 *
 * The ZIP is cached in .cache/aws-icons-<release>.zip (kept only after it verifies). The default output
 * is .cache/icons/aws-<release>.json.
 */
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { parseArgs } from 'node:util';
import { extractIcons } from '../packages/catalog/src/extract.ts';
import type { AwsIconPack } from '../packages/catalog/src/icons.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = resolve(ROOT, '.cache');

const { values } = parseArgs({ options: { out: { type: 'string' } } });

// Schema-checked by the catalog tests (awsIconPack parses this entry at import); plain node cannot
// load the catalog index here, so the tool only checks what it relies on.
const packs = JSON.parse(
  await readFile(resolve(ROOT, 'packages/catalog/data/icon-packs.json'), 'utf8'),
) as Array<{ provider: string }>;
const pack = packs.find((p) => p.provider === 'aws') as AwsIconPack | undefined;
if (!pack || pack.status !== 'pinned' || !/^[0-9a-f]{64}$/.test(pack.sha256 ?? '')) {
  throw new Error('The AWS icon pack in packages/catalog/data/icon-packs.json is not pinned');
}

const zipPath = resolve(CACHE, `aws-icons-${pack.release}.zip`);
const outPath = values.out
  ? resolve(values.out)
  : resolve(CACHE, 'icons', `aws-${pack.release}.json`);
await mkdir(CACHE, { recursive: true });

let source: AsyncIterable<Uint8Array>;
let partPath: string | undefined;
if (existsSync(zipPath)) {
  console.log(`Using cached ${zipPath}`);
  source = createReadStream(zipPath);
} else {
  console.log(`Downloading ${pack.downloadUrl}`);
  const res = await fetch(pack.downloadUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  // Stream into the verifier and a .part file at the same time; keep the file only if it verifies.
  partPath = `${zipPath}.part`;
  const part = createWriteStream(partPath);
  const body = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
  source = (async function* () {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (!part.write(chunk)) await new Promise((r) => part.once('drain', r));
      yield chunk;
    }
    part.end();
    await finished(part);
  })();
}

try {
  const set = await extractIcons(source, pack);
  if (partPath) await rename(partPath, zipPath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(set));
  const missing = Object.keys(pack.files).filter((id) => !(id in set.icons));
  console.log(
    `Verified SHA-256 ${pack.sha256}\nWrote ${Object.keys(set.icons).length} icons to ${outPath}` +
      (missing.length ? `\nMissing: ${missing.join(', ')}` : ''),
  );
} catch (err) {
  if (partPath) await rm(partPath, { force: true });
  throw err;
}

/**
 * Node-only: verifies a downloaded icon pack ZIP against its pinned SHA-256 and pulls out the mapped
 * SVGs, streaming. Exported as `@cloudarchitect/catalog/extract` so the browser bundle never sees
 * `node:crypto`.
 */
import { createHash } from 'node:crypto';
import { Unzip, UnzipInflate } from 'fflate';
import type { AwsIconPack, IconSet } from './icons.js';

/** Bytes per Unzip.push call; bounds fflate's per-entry recursion. */
const UNZIP_SLICE = 4096;

export type IconPackErrorCode = 'hash_mismatch' | 'missing_file' | 'not_svg';

export class IconPackError extends Error {
  readonly code: IconPackErrorCode;
  constructor(code: IconPackErrorCode, message: string) {
    super(message);
    this.name = 'IconPackError';
    this.code = code;
  }
}

/**
 * Reads the ZIP once, chunk by chunk: every byte goes into the SHA-256, and only entries the pack maps
 * are decompressed and kept. Nothing is returned unless the hash matches the pinned one and every
 * mapped file is present and is an SVG.
 */
export async function extractIcons(
  chunks: AsyncIterable<Uint8Array>,
  pack: AwsIconPack,
): Promise<IconSet> {
  const wanted = new Set(Object.values(pack.files));
  const parts = new Map<string, Uint8Array[]>();
  const done = new Set<string>();
  const hash = createHash('sha256');
  let unzipError: unknown;

  const unzip = new Unzip((file) => {
    if (!wanted.has(file.name)) return;
    const buf: Uint8Array[] = [];
    parts.set(file.name, buf);
    file.ondata = (err, data, final) => {
      if (err) {
        unzipError ??= err;
        return;
      }
      buf.push(data);
      if (final) done.add(file.name);
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  // Keep hashing even if the archive turns out to be corrupt, so a tampered download reports
  // hash_mismatch rather than a parser error. fflate's Unzip.push recurses once per entry in the
  // chunk it gets, so large chunks are pushed in slices to keep that depth small.
  const feed = (chunk: Uint8Array, final: boolean) => {
    if (unzipError !== undefined) return;
    try {
      for (let i = 0; i < chunk.length; i += UNZIP_SLICE) {
        unzip.push(chunk.subarray(i, i + UNZIP_SLICE), false);
      }
      if (final) unzip.push(new Uint8Array(0), true);
    } catch (err) {
      unzipError = err;
    }
  };

  for await (const chunk of chunks) {
    hash.update(chunk);
    feed(chunk, false);
  }
  feed(new Uint8Array(0), true);

  const actual = hash.digest('hex');
  if (actual !== pack.sha256) {
    throw new IconPackError(
      'hash_mismatch',
      `Icon pack ${pack.release} has SHA-256 ${actual}, expected ${pack.sha256}`,
    );
  }
  if (unzipError !== undefined) throw unzipError;

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const icons: Record<string, string> = {};
  for (const [id, path] of Object.entries(pack.files)) {
    const buf = parts.get(path);
    if (!buf || !done.has(path)) {
      throw new IconPackError(
        'missing_file',
        `Icon pack ${pack.release} has no file ${path} (${id})`,
      );
    }
    let text: string;
    try {
      text = decoder.decode(concat(buf));
    } catch {
      text = '';
    }
    if (!text.includes('<svg')) {
      throw new IconPackError('not_svg', `Icon pack file ${path} (${id}) is not an SVG`);
    }
    icons[id] = text;
  }
  return { provider: 'aws', release: pack.release, icons };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractIcons, IconPackError } from './extract.js';
import type { AwsIconPack } from './icons.js';

const LAMBDA_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="lambda"/></svg>';
const REGION_SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>';

/** Pseudo-random, so it does not compress and the ZIP spans many 1 KB chunks. */
function noise(length: number): Uint8Array {
  let x = 2463534242;
  return Uint8Array.from({ length }, () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x & 0xff;
  });
}

const zip = zipSync({
  'Arch/48/Arch_AWS-Lambda_48.svg': strToU8(LAMBDA_SVG),
  'Arch/48/Arch_AWS-Lambda_48.png': noise(8192),
  'Groups/Region_32.svg': strToU8(REGION_SVG),
});
const sha256 = createHash('sha256').update(zip).digest('hex');

function pack(overrides: Partial<AwsIconPack> = {}): AwsIconPack {
  return {
    provider: 'aws',
    sourceUrl: 'https://aws.amazon.com/architecture/icons/',
    release: '2026-07-31',
    downloadUrl: 'https://example.invalid/icons.zip',
    sha256,
    termsAsPublished: 'terms',
    termsCheckedAt: '2026-10-27',
    files: {
      'aws/lambda': 'Arch/48/Arch_AWS-Lambda_48.svg',
      'aws/group/region': 'Groups/Region_32.svg',
    },
    noIcon: [],
    status: 'pinned',
    ...overrides,
  };
}

async function* oneChunk(data: Uint8Array) {
  yield data;
}

async function* chunked(data: Uint8Array, size: number) {
  for (let i = 0; i < data.length; i += size) yield data.slice(i, i + size);
}

async function rejection(p: Promise<unknown>): Promise<IconPackError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(IconPackError);
  return err as IconPackError;
}

describe('extractIcons', () => {
  it('extract: builds the set from a small ZIP', async () => {
    const set = await extractIcons(oneChunk(zip), pack());
    expect(set).toEqual({
      provider: 'aws',
      release: '2026-07-31',
      icons: { 'aws/lambda': LAMBDA_SVG, 'aws/group/region': REGION_SVG },
    });
  });

  it('extract: hash_mismatch', async () => {
    const err = await rejection(extractIcons(oneChunk(zip), pack({ sha256: '0'.repeat(64) })));
    expect(err.code).toBe('hash_mismatch');
  });

  it('extract: missing_file', async () => {
    const files = { 'aws/lambda': 'Arch/48/Arch_AWS-Lambda_48.svg', 'aws/s3': 'Arch/48/S3.svg' };
    const err = await rejection(extractIcons(oneChunk(zip), pack({ files })));
    expect(err.code).toBe('missing_file');
    expect(err.message).toContain('Arch/48/S3.svg');
  });

  it('extract: not_svg', async () => {
    const bad = zipSync({ 'a.svg': strToU8('<html>not an icon</html>') });
    const badPack = pack({
      sha256: createHash('sha256').update(bad).digest('hex'),
      files: { 'aws/lambda': 'a.svg' },
    });
    const err = await rejection(extractIcons(oneChunk(bad), badPack));
    expect(err.code).toBe('not_svg');
  });

  it('handles one huge chunk holding thousands of tiny entries', async () => {
    // fflate's Unzip.push recurses once per entry in the chunk it is given; the real pack has
    // ~8,400 entries, which overflowed the stack when a download arrived in large chunks.
    const entries: Record<string, Uint8Array> = { 'icon.svg': strToU8(LAMBDA_SVG) };
    for (let i = 0; i < 20000; i++) entries[`__MACOSX/._f${i}`] = strToU8('x');
    const big = zipSync(entries, { level: 0 });
    const bigPack = pack({
      sha256: createHash('sha256').update(big).digest('hex'),
      files: { 'aws/lambda': 'icon.svg' },
    });
    const set = await extractIcons(oneChunk(big), bigPack);
    expect(set.icons).toEqual({ 'aws/lambda': LAMBDA_SVG });
  });

  it('extractIcons consumes chunks incrementally', async () => {
    expect(zip.length).toBeGreaterThan(4 * 1024);
    let pulled = 0;
    async function* counting() {
      for await (const c of chunked(zip, 1024)) {
        pulled++;
        yield c;
      }
    }
    const whole = await extractIcons(oneChunk(zip), pack());
    const streamed = await extractIcons(counting(), pack());
    expect(streamed).toEqual(whole);
    expect(pulled).toBe(Math.ceil(zip.length / 1024));
  });
});

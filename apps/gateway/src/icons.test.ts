import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { awsIconPack, type AwsIconPack } from '@cloudarchitect/catalog';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconStore } from './icons.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
const zip = zipSync({ 'a/lambda.svg': strToU8(SVG) });
const sha256 = createHash('sha256').update(zip).digest('hex');
const pack: AwsIconPack = {
  ...awsIconPack,
  release: '2026-07-31',
  sha256,
  files: { 'aws/lambda': 'a/lambda.svg' },
  noIcon: [],
};

async function* chunks(data: Uint8Array): AsyncIterable<Uint8Array> {
  for (let i = 0; i < data.length; i += 64) yield data.subarray(i, i + 64);
}
const okDownload = () => vi.fn(async () => chunks(zip));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'icons-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const cacheFile = () => join(dir, `aws-${pack.release}.json`);
const validSet = { provider: 'aws', release: pack.release, icons: { 'aws/lambda': SVG } };

describe('IconStore', () => {
  it('loads a valid cache without downloading', async () => {
    await writeFile(cacheFile(), JSON.stringify(validSet));
    const download = okDownload();
    const store = new IconStore({ dir, pack, download });
    expect(store.state()).toBe('missing');
    await store.ensure();
    expect(store.state()).toBe('ready');
    expect(store.iconSet()?.icons['aws/lambda']).toBe(SVG);
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads, verifies and caches on first start', async () => {
    const download = okDownload();
    const store = new IconStore({ dir, pack, download });
    await store.ensure();
    expect(store.state()).toBe('ready');
    expect(download).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toEqual([`aws-${pack.release}.json`]);

    const second = okDownload();
    const again = new IconStore({ dir, pack, download: second });
    await again.ensure();
    expect(again.state()).toBe('ready');
    expect(second).not.toHaveBeenCalled();
  });

  it('failed download leaves state failed and no cache file, and a later ensure retries', async () => {
    const logs: Record<string, unknown>[] = [];
    let fail = true;
    const download = vi.fn(async () => {
      if (fail) throw new Error('boom');
      return chunks(zip);
    });
    const store = new IconStore({ dir, pack, download, log: (e) => logs.push(e) });
    await store.ensure();
    expect(store.state()).toBe('failed');
    expect(await readdir(dir)).toEqual([]);
    expect(logs).toContainEqual({ event: 'icons', state: 'failed', error: 'network' });
    fail = false;
    await store.ensure();
    expect(store.state()).toBe('ready');
  });

  it('hash mismatch fails with no cache file', async () => {
    const logs: Record<string, unknown>[] = [];
    const bad = { ...pack, sha256: 'a'.repeat(64) };
    const store = new IconStore({
      dir,
      pack: bad,
      download: okDownload(),
      log: (e) => logs.push(e),
    });
    await store.ensure();
    expect(store.state()).toBe('failed');
    expect(await readdir(dir)).toEqual([]);
    expect(logs).toContainEqual({ event: 'icons', state: 'failed', error: 'hash_mismatch' });
  });

  it('a mapped entry that inflates past the cap fails with too_large and no cache file', async () => {
    const logs: Record<string, unknown>[] = [];
    const bomb = zipSync({ 'a/lambda.svg': new Uint8Array(4 * 1024 * 1024) }, { level: 9 });
    const bombPack = { ...pack, sha256: createHash('sha256').update(bomb).digest('hex') };
    const store = new IconStore({
      dir,
      pack: bombPack,
      download: vi.fn(async () => chunks(bomb)),
      log: (e) => logs.push(e),
    });
    await store.ensure();
    expect(store.state()).toBe('failed');
    expect(await readdir(dir)).toEqual([]);
    expect(logs).toContainEqual({ event: 'icons', state: 'failed', error: 'too_large' });
  });

  it('refetches a corrupt cache', async () => {
    await writeFile(cacheFile(), '{"provider":"aws"');
    const download = okDownload();
    const store = new IconStore({ dir, pack, download });
    await store.ensure();
    expect(store.state()).toBe('ready');
    expect(download).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(cacheFile(), 'utf8')).icons['aws/lambda']).toBe(SVG);
  });

  it('refetches a cache that lacks a mapped icon', async () => {
    await writeFile(cacheFile(), JSON.stringify({ ...validSet, icons: {} }));
    const download = okDownload();
    await new IconStore({ dir, pack, download }).ensure();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('shares one download between concurrent ensure calls', async () => {
    const download = okDownload();
    const store = new IconStore({ dir, pack, download });
    const all = [store.ensure(), store.ensure(), store.ensure()];
    expect(store.state()).toBe('fetching');
    await Promise.all(all);
    expect(download).toHaveBeenCalledTimes(1);
    expect(store.state()).toBe('ready');
  });

  it('removes caches of old releases after a successful fetch', async () => {
    await writeFile(join(dir, 'aws-2025-01-31.json'), '{}');
    await new IconStore({ dir, pack, download: okDownload() }).ensure();
    expect(await readdir(dir)).toEqual([`aws-${pack.release}.json`]);
  });

  it('removes leftover .json.tmp files after a successful fetch', async () => {
    await writeFile(join(dir, `aws-${pack.release}.json.tmp`), '{"partial');
    await writeFile(join(dir, 'aws-2025-01-31.json.tmp'), '{}');
    await new IconStore({ dir, pack, download: okDownload() }).ensure();
    expect(await readdir(dir)).toEqual([`aws-${pack.release}.json`]);
  });

  it('a cleanup failure never marks a good fetch failed', async () => {
    // A directory with the name of an old cache cannot be removed by rm without `recursive`.
    await mkdir(join(dir, 'aws-2025-01-31.json'));
    await writeFile(join(dir, 'aws-2025-01-31.json', 'x'), '');
    const store = new IconStore({ dir, pack, download: okDownload() });
    await store.ensure();
    expect(store.state()).toBe('ready');
    expect(await readdir(dir)).toContain(`aws-${pack.release}.json`);
  });
});

describe('IconStore download timeouts', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('a slow but steady download succeeds although it outlasts the idle timeout', async () => {
    const download = vi.fn(async () =>
      (async function* () {
        for (let i = 0; i < zip.length; i += 16) {
          await sleep(20);
          yield zip.subarray(i, i + 16);
        }
      })(),
    );
    expect(Math.ceil(zip.length / 16) * 20).toBeGreaterThan(80);
    const store = new IconStore({ dir, pack, download, timeouts: { idleMs: 80, totalMs: 10_000 } });
    await store.ensure();
    expect(store.state()).toBe('ready');
  });

  it('aborts a download that stalls, even if the source ignores the signal', async () => {
    const logs: Record<string, unknown>[] = [];
    let signal: AbortSignal | undefined;
    const download = vi.fn(async (_url: string, s: AbortSignal) => {
      signal = s;
      return (async function* () {
        yield zip.subarray(0, 64);
        await new Promise(() => {});
      })();
    });
    const store = new IconStore({
      dir,
      pack,
      download,
      log: (e) => logs.push(e),
      timeouts: { idleMs: 50, totalMs: 10_000 },
    });
    await store.ensure();
    expect(store.state()).toBe('failed');
    expect(signal?.aborted).toBe(true);
    expect(logs).toContainEqual({ event: 'icons', state: 'failed', error: 'network' });
    expect(await readdir(dir)).toEqual([]);
  });

  it('aborts a response that never starts', async () => {
    const download = vi.fn(() => new Promise<AsyncIterable<Uint8Array>>(() => {}));
    const store = new IconStore({ dir, pack, download, timeouts: { idleMs: 50, totalMs: 10_000 } });
    await store.ensure();
    expect(store.state()).toBe('failed');
  });

  it('aborts a steady download that passes the total cap', async () => {
    const download = vi.fn(async () =>
      (async function* () {
        for (;;) {
          await sleep(10);
          yield new Uint8Array(1);
        }
      })(),
    );
    const store = new IconStore({ dir, pack, download, timeouts: { idleMs: 1_000, totalMs: 100 } });
    await store.ensure();
    expect(store.state()).toBe('failed');
  });

  it('aborts the signal after a successful download too', async () => {
    let signal: AbortSignal | undefined;
    const download = vi.fn(async (_url: string, s: AbortSignal) => {
      signal = s;
      return chunks(zip);
    });
    await new IconStore({ dir, pack, download }).ensure();
    expect(signal?.aborted).toBe(true);
  });
});

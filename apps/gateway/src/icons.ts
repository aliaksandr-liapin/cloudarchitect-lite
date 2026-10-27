import type { AwsIconPack, IconSet } from '@cloudarchitect/catalog';
import { extractIcons, IconPackError } from '@cloudarchitect/catalog/extract';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export type IconState = 'missing' | 'fetching' | 'ready' | 'failed';

export type Download = (url: string, signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>>;

const DOWNLOAD_TIMEOUT_MS = 120_000;

const fetchDownload: Download = async (url, signal) => {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  return Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
};

/**
 * The official AWS icons for this install. They are downloaded once from the pinned URL, verified
 * against the pinned SHA-256, and kept as one JSON file in the data volume. Nothing is committed or
 * shipped in the image.
 */
export class IconStore {
  #state: IconState = 'missing';
  #set: IconSet | undefined;
  #running: Promise<void> | undefined;
  readonly #dir: string;
  readonly #pack: AwsIconPack;
  readonly #download: Download;
  readonly #log: (e: Record<string, unknown>) => void;

  constructor(deps: {
    dir: string;
    pack: AwsIconPack;
    download?: Download;
    log?: (e: Record<string, unknown>) => void;
  }) {
    this.#dir = deps.dir;
    this.#pack = deps.pack;
    this.#download = deps.download ?? fetchDownload;
    this.#log = deps.log ?? (() => {});
  }

  state(): IconState {
    return this.#state;
  }

  iconSet(): IconSet | undefined {
    return this.#state === 'ready' ? this.#set : undefined;
  }

  /** Loads the cache or downloads the pack. Concurrent calls share one run; never rejects. */
  ensure(): Promise<void> {
    if (this.#state === 'ready') return Promise.resolve();
    this.#running ??= this.#run().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  get #file() {
    return join(this.#dir, `aws-${this.#pack.release}.json`);
  }

  async #run(): Promise<void> {
    this.#state = 'fetching';
    try {
      const cached = await this.#readCache();
      if (cached) {
        this.#set = cached;
        this.#state = 'ready';
        this.#log({ event: 'icons', state: 'ready' });
        return;
      }
      this.#log({ event: 'icons', state: 'fetching' });
      this.#set = await this.#fetchAndStore();
      this.#state = 'ready';
      this.#log({ event: 'icons', state: 'ready' });
    } catch (err) {
      this.#state = 'failed';
      this.#log({
        event: 'icons',
        state: 'failed',
        error: err instanceof IconPackError ? err.code : 'network',
      });
    }
  }

  async #readCache(): Promise<IconSet | undefined> {
    try {
      const data: unknown = JSON.parse(await readFile(this.#file, 'utf8'));
      const set = data as Partial<IconSet> | null;
      if (
        set?.provider === 'aws' &&
        set.release === this.#pack.release &&
        set.icons &&
        typeof set.icons === 'object' &&
        Object.keys(this.#pack.files).every((id) => typeof set.icons?.[id] === 'string')
      ) {
        return set as IconSet;
      }
    } catch {
      // Missing or corrupt cache: fall through to a fresh download.
    }
    return undefined;
  }

  async #fetchAndStore(): Promise<IconSet> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let set: IconSet;
    try {
      const body = await this.#download(this.#pack.downloadUrl, controller.signal);
      set = await extractIcons(body, this.#pack);
    } finally {
      clearTimeout(timer);
    }
    await mkdir(this.#dir, { recursive: true });
    const tmp = `${this.#file}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(set));
      await rename(tmp, this.#file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    const keep = `aws-${this.#pack.release}.json`;
    for (const name of await readdir(this.#dir)) {
      if (/^aws-.*\.json$/.test(name) && name !== keep)
        await rm(join(this.#dir, name), { force: true });
    }
    return set;
  }
}

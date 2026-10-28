import type { AwsIconPack, IconSet } from '@cloudarchitect/catalog';
import { extractIcons, IconPackError } from '@cloudarchitect/catalog/extract';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export type IconState = 'missing' | 'fetching' | 'ready' | 'failed';

export type Download = (url: string, signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>>;

/** Abort when no bytes arrive for this long; slow links still finish as long as data keeps coming. */
const IDLE_TIMEOUT_MS = 60_000;
/** Hard cap on the whole download (~22 MB at well under 1 Mbit/s still fits). */
const TOTAL_TIMEOUT_MS = 15 * 60_000;

export interface DownloadTimeouts {
  idleMs: number;
  totalMs: number;
}

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
  readonly #timeouts: DownloadTimeouts;

  constructor(deps: {
    dir: string;
    pack: AwsIconPack;
    download?: Download;
    log?: (e: Record<string, unknown>) => void;
    timeouts?: Partial<DownloadTimeouts>;
  }) {
    this.#timeouts = {
      idleMs: deps.timeouts?.idleMs ?? IDLE_TIMEOUT_MS,
      totalMs: deps.timeouts?.totalMs ?? TOTAL_TIMEOUT_MS,
    };
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
    let set: IconSet;
    try {
      set = await extractIcons(
        watchdog(this.#download, this.#pack.downloadUrl, controller, this.#timeouts),
        this.#pack,
      );
    } finally {
      // Always abort: releases the connection whether the read finished, failed or timed out.
      controller.abort();
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
    await this.#removeOldCaches();
    return set;
  }

  /** Best effort: a leftover file from an old release or a crashed write never fails a good fetch. */
  async #removeOldCaches(): Promise<void> {
    const keep = `aws-${this.#pack.release}.json`;
    try {
      for (const name of await readdir(this.#dir)) {
        if (/^aws-.*\.json(\.tmp)?$/.test(name) && name !== keep) {
          await rm(join(this.#dir, name), { force: true }).catch(() => {});
        }
      }
    } catch {
      // Cleanup is retried after the next successful fetch.
    }
  }
}

/**
 * Yields the download's chunks, aborting if no chunk arrives within `idleMs` (the wait for the
 * response counts too) or the whole download takes longer than `totalMs`. The abort rejects the
 * pending read even if the source ignores the signal.
 */
async function* watchdog(
  download: Download,
  url: string,
  controller: AbortController,
  { idleMs, totalMs }: DownloadTimeouts,
): AsyncIterable<Uint8Array> {
  const { signal } = controller;
  const aborted = new Promise<never>((_, reject) => {
    const fail = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  aborted.catch(() => {});
  const total = setTimeout(() => controller.abort(new Error('download timed out')), totalMs);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error('download stalled')), idleMs);
  };
  try {
    touch();
    const body = await Promise.race([download(url, signal), aborted]);
    const it = body[Symbol.asyncIterator]();
    try {
      for (;;) {
        touch();
        const next = await Promise.race([it.next(), aborted]);
        if (next.done) return;
        yield next.value;
      }
    } finally {
      void it.return?.()?.catch(() => {});
    }
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
}

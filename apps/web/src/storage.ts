import { migrateProject, type Project } from '@cloudarchitect/domain';

/** Local project persistence in IndexedDB (FR-010). Browser storage can be evicted, so the UI also offers JSON export. */
const DB_NAME = 'cloudarchitect';
const STORE = 'projects';

export function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains('versions')) {
        const versions = db.createObjectStore('versions', { keyPath: ['projectId', 'createdAt'] });
        versions.createIndex('byProject', 'projectId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Close when another tab wants to upgrade, so this tab never blocks it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error('Another tab holds an older version of the database open; close it.'));
  });
}

/**
 * Runs one request in its own transaction and settles when the transaction ends:
 * quota errors surface at commit (abort), after the request itself has succeeded.
 */
export function inTx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error ?? req.error);
        t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
      }),
  );
}

const tx = <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) =>
  inTx(STORE, mode, run);

export const saveProject = (p: Project) => tx('readwrite', (s) => s.put(p)).then(() => undefined);

export async function loadProject(id: string): Promise<Project | undefined> {
  const raw = await tx('readonly', (s) => s.get(id));
  return raw ? migrateProject(raw) : undefined;
}

export type StorageState = 'ok' | 'unavailable';

/**
 * Startup load. "Not found" opens the sample; a failed load (database blocked by an old tab, a
 * migration error) also shows the sample but marks storage unavailable, so nothing is saved over
 * the project that could not be read.
 */
export async function bootProject(
  load: () => Promise<Project | undefined>,
  sample: Project,
): Promise<{ project: Project; storage: StorageState }> {
  try {
    return { project: (await load()) ?? sample, storage: 'ok' };
  } catch {
    return { project: sample, storage: 'unavailable' };
  }
}

/** File-name stem for a project: runs of unsafe characters become one dash. */
export function fileBaseName(name: string): string {
  return name.replace(/\W+/g, '-');
}

export function downloadJson(p: Project) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }),
  );
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${fileBaseName(p.name)}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<Project> {
  return migrateProject(JSON.parse(await file.text()));
}

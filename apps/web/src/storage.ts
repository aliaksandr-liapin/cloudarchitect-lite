import { migrateProject, type Project } from '@cloudarchitect/domain';

/** Local project persistence in IndexedDB (FR-010). Browser storage can be evicted, so the UI also offers JSON export. */
const DB_NAME = 'cloudarchitect';
const STORE = 'projects';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'projectId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const saveProject = (p: Project) => tx('readwrite', (s) => s.put(p)).then(() => undefined);

export async function loadProject(id: string): Promise<Project | undefined> {
  const raw = await tx('readonly', (s) => s.get(id));
  return raw ? migrateProject(raw) : undefined;
}

export function downloadJson(p: Project) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }),
  );
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${p.name.replace(/\W+/g, '-')}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<Project> {
  return migrateProject(JSON.parse(await file.text()));
}

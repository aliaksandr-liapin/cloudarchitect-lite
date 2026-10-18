import {
  graphContentHash,
  toggleLabels,
  type DesignToggles,
  type Project,
} from '@cloudarchitect/domain';
import { inTx } from './storage';

/** Snapshot of a project taken before an AI result replaces it. Not part of JSON export. */
export interface ProjectVersion {
  projectId: string;
  createdAt: string;
  label: string;
  toggles: DesignToggles;
  project: Project;
}

export interface VersionStore {
  /** Newest first. */
  list(projectId: string): Promise<ProjectVersion[]>;
  put(v: ProjectVersion): Promise<void>;
  remove(projectId: string, createdAt: string): Promise<void>;
}

export const MAX_VERSIONS = 10;

const pad = (n: number) => String(n).padStart(2, '0');

/** 'HH:MM' in local time, followed by the enabled design toggles when there are any. */
export function versionLabel(at: Date, toggles: DesignToggles): string {
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const labels = toggleLabels(toggles);
  return labels.length ? `${time} · ${labels.join(', ')}` : time;
}

const newestFirst = (a: ProjectVersion, b: ProjectVersion) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

/** Stores the project, then prunes the oldest versions beyond MAX_VERSIONS. Rejects if the store fails. */
export async function saveVersion(
  store: VersionStore,
  project: Project,
  now: Date = new Date(),
): Promise<ProjectVersion> {
  const toggles = project.generation?.toggles ?? {};
  const version: ProjectVersion = {
    projectId: project.projectId,
    createdAt: now.toISOString(),
    label: versionLabel(now, toggles),
    toggles,
    project,
  };
  await store.put(version);
  const all = (await store.list(project.projectId)).sort(newestFirst);
  for (const old of all.slice(MAX_VERSIONS)) await store.remove(old.projectId, old.createdAt);
  return version;
}

export type ReplaceDecision = 'replace' | 'confirm-edits';

/** Manual edits to a generated graph (layout excluded) need confirmation before an AI result replaces it. */
export function replaceDecision(current: Project | undefined): ReplaceDecision {
  return current?.generation && graphContentHash(current) !== current.generation.contentHash
    ? 'confirm-edits'
    : 'replace';
}

export class MemoryVersionStore implements VersionStore {
  private readonly items: ProjectVersion[] = [];

  async list(projectId: string) {
    return this.items.filter((v) => v.projectId === projectId).sort(newestFirst);
  }

  async put(v: ProjectVersion) {
    await this.remove(v.projectId, v.createdAt);
    this.items.push(v);
  }

  async remove(projectId: string, createdAt: string) {
    const i = this.items.findIndex((v) => v.projectId === projectId && v.createdAt === createdAt);
    if (i >= 0) this.items.splice(i, 1);
  }
}

const STORE = 'versions';

export const idbVersionStore: VersionStore = {
  async list(projectId) {
    const all = await inTx(
      STORE,
      'readonly',
      (s) => s.index('byProject').getAll(projectId) as IDBRequest<ProjectVersion[]>,
    );
    return all.sort(newestFirst);
  },
  async put(v) {
    await inTx(STORE, 'readwrite', (s) => s.put(v));
  },
  async remove(projectId, createdAt) {
    await inTx(STORE, 'readwrite', (s) => s.delete([projectId, createdAt]));
  },
};

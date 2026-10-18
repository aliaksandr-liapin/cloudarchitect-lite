import { samples } from '@cloudarchitect/catalog';
import { graphContentHash, migrateProject, type Project } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import {
  MAX_VERSIONS,
  MemoryVersionStore,
  prepareReplace,
  replaceDecision,
  unavailableVersionStore,
  type ReplaceUi,
  saveVersion,
  versionLabel,
  type VersionStore,
} from './versions';

const sample = migrateProject(samples.myblog);

const generated = (): Project => ({
  ...sample,
  generation: {
    toggles: {},
    model: 'sonnet',
    generatedAt: '2026-10-18T10:00:00.000Z',
    contentHash: graphContentHash(sample),
  },
});

describe('saveVersion', () => {
  it('keeps the newest 10', async () => {
    const store = new MemoryVersionStore();
    for (let i = 0; i < 12; i++) {
      await saveVersion(store, sample, new Date(2026, 9, 18, 10, i));
    }
    const list = await store.list(sample.projectId);
    expect(list).toHaveLength(MAX_VERSIONS);
    expect(list[0]!.createdAt).toBe(new Date(2026, 9, 18, 10, 11).toISOString());
    expect(list.at(-1)!.createdAt).toBe(new Date(2026, 9, 18, 10, 2).toISOString());
  });

  it('propagates store failures', async () => {
    const store: VersionStore = {
      list: async () => [],
      put: () => Promise.reject(new Error('quota')),
      remove: async () => undefined,
    };
    await expect(saveVersion(store, sample)).rejects.toThrow('quota');
  });
});

describe('versionLabel', () => {
  it('formats time and toggles', () => {
    const at = new Date(2026, 9, 18, 14, 32);
    expect(versionLabel(at, { serverlessFirst: true, backups: true })).toBe(
      '14:32 · Serverless-first, Backups',
    );
    expect(versionLabel(at, {})).toBe('14:32');
  });
});

describe('replaceDecision', () => {
  it('replaces without a project or without generation', () => {
    expect(replaceDecision(undefined)).toBe('replace');
    expect(replaceDecision(sample)).toBe('replace');
  });

  it('ignores layout-only changes', () => {
    const p = generated();
    const moved = {
      ...p,
      nodes: p.nodes.map((n) => ({ ...n, position: { x: 1, y: 2 } })),
    };
    expect(replaceDecision(moved)).toBe('replace');
  });

  it('asks to confirm after a content edit', () => {
    const p = generated();
    const renamed = {
      ...p,
      nodes: p.nodes.map((n, i) => (i === 0 ? { ...n, label: `${n.label} edited` } : n)),
    };
    expect(replaceDecision(renamed)).toBe('confirm-edits');
  });
});

describe('prepareReplace', () => {
  const failing: VersionStore = {
    list: async () => [],
    put: () => Promise.reject(new Error('quota')),
    remove: async () => undefined,
  };
  const edited = (): Project => {
    const p = generated();
    return { ...p, nodes: p.nodes.map((n, i) => (i === 0 ? { ...n, label: 'edited' } : n)) };
  };
  function ui(edits: boolean, storage: 'cancel' | 'replace' | 'export' = 'replace') {
    const calls: string[] = [];
    const u: ReplaceUi = {
      confirmEdits: async () => (calls.push('edits'), edits),
      storageFailed: async () => (calls.push('storage'), storage),
      exportJson: () => void calls.push('export'),
    };
    return { u, calls };
  }

  it('keeps the current diagram as a version without asking when it was not edited', async () => {
    const store = new MemoryVersionStore();
    const { u, calls } = ui(true);
    const r = await prepareReplace(store, generated(), u);
    expect(r?.saved?.project.projectId).toBe(sample.projectId);
    expect(await store.list(sample.projectId)).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('asks about hand edits first; Cancel stores nothing and stops', async () => {
    const store = new MemoryVersionStore();
    const { u, calls } = ui(false);
    expect(await prepareReplace(store, edited(), u)).toBeUndefined();
    expect(await store.list(sample.projectId)).toHaveLength(0);
    expect(calls).toEqual(['edits']);
  });

  it('keeps the edited diagram after the user confirms', async () => {
    const store = new MemoryVersionStore();
    const { u } = ui(true);
    expect((await prepareReplace(store, edited(), u))?.saved).toBeTruthy();
    expect(await store.list(sample.projectId)).toHaveLength(1);
  });

  it('asks on a storage failure: Cancel stops, Replace anyway goes on, Export JSON exports and goes on', async () => {
    const cancel = ui(true, 'cancel');
    expect(await prepareReplace(failing, sample, cancel.u)).toBeUndefined();
    const replace = ui(true, 'replace');
    expect(await prepareReplace(failing, sample, replace.u)).toEqual({ saved: null });
    const exp = ui(true, 'export');
    expect(await prepareReplace(failing, sample, exp.u)).toEqual({ saved: null });
    expect(exp.calls).toEqual(['storage', 'export']);
  });

  it('treats unavailable storage like a failed save', async () => {
    const { u, calls } = ui(true, 'replace');
    expect(await prepareReplace(unavailableVersionStore, sample, u)).toEqual({ saved: null });
    expect(calls).toEqual(['storage']);
  });

  it('goes on without a version when there is no diagram yet', async () => {
    const { u, calls } = ui(false);
    expect(await prepareReplace(failing, undefined, u)).toEqual({ saved: null });
    expect(calls).toEqual([]);
  });
});

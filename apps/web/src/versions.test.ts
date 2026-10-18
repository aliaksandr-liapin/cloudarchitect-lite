import { samples } from '@cloudarchitect/catalog';
import { graphContentHash, migrateProject, type Project } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import {
  MAX_VERSIONS,
  MemoryVersionStore,
  replaceDecision,
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

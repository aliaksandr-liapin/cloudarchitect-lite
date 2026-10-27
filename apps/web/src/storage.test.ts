import { samples } from '@cloudarchitect/catalog';
import { migrateProject } from '@cloudarchitect/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootProject, downloadBlob, fileBaseName } from './storage';

const sample = migrateProject(samples.myblog);

describe('bootProject', () => {
  it('opens the stored project', async () => {
    const stored = { ...sample, name: 'Mine' };
    expect(await bootProject(async () => stored, sample)).toEqual({
      project: stored,
      storage: 'ok',
    });
  });

  it('falls back to the sample when nothing is stored', async () => {
    expect(await bootProject(async () => undefined, sample)).toEqual({
      project: sample,
      storage: 'ok',
    });
  });

  it('marks storage unavailable when loading fails, so the sample never overwrites the real project', async () => {
    const r = await bootProject(() => Promise.reject(new Error('blocked')), sample);
    expect(r).toEqual({ project: sample, storage: 'unavailable' });
  });
});

describe('fileBaseName', () => {
  it('collapses unsafe characters into single dashes', () => {
    expect(fileBaseName('My Blog: v2')).toBe('My-Blog-v2');
  });
});

describe('downloadBlob', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('attaches an anchor, clicks it, removes it and revokes the object URL', () => {
    const calls: string[] = [];
    const anchor = {
      style: {} as Record<string, string>,
      click: () => calls.push('click'),
      remove: () => calls.push('remove'),
    } as unknown as HTMLAnchorElement & { href: string; download: string };
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: { append: () => calls.push('append') },
    });
    vi.stubGlobal('URL', {
      createObjectURL: () => (calls.push('create'), 'blob:x'),
      revokeObjectURL: (u: string) => calls.push(`revoke ${u}`),
    });
    downloadBlob(new Blob(['x']), 'diagram.png');
    expect(anchor.href).toBe('blob:x');
    expect(anchor.download).toBe('diagram.png');
    expect(calls).toEqual(['create', 'append', 'click', 'remove', 'revoke blob:x']);
  });
});

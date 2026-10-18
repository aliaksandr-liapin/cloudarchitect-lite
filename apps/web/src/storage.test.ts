import { samples } from '@cloudarchitect/catalog';
import { migrateProject } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { bootProject } from './storage';

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

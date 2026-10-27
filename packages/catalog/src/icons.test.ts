import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { awsCatalog, awsIconPack, requiredIconIds } from './index.js';

describe('AWS icon pack', () => {
  it('icons: every required id is mapped or explicitly noIcon', () => {
    const mapped = new Set(Object.keys(awsIconPack.files));
    const noIcon = new Set(awsIconPack.noIcon);
    for (const id of requiredIconIds(awsCatalog)) {
      expect(mapped.has(id) || noIcon.has(id), id).toBe(true);
    }
    expect([...awsIconPack.noIcon].sort()).toEqual([
      'aws/group/availability-zone',
      'aws/group/group',
    ]);
  });

  it('icons: no mapping points outside SVG files', () => {
    for (const [id, path] of Object.entries(awsIconPack.files)) {
      expect(path.endsWith('.svg'), id).toBe(true);
      expect(path.includes('..'), id).toBe(false);
    }
  });

  it('requires every service icon, every container kind and each subnet type', () => {
    const ids = requiredIconIds(awsCatalog);
    for (const s of awsCatalog.services) expect(ids).toContain(s.iconAssetId);
    for (const c of awsCatalog.containers) {
      if (c.kind !== 'subnet') expect(ids).toContain(`aws/group/${c.kind}`);
    }
    expect(ids).toContain('aws/group/subnet-public');
    expect(ids).toContain('aws/group/subnet-private');
    // A subnet is drawn by its type; an untyped subnet has no icon of its own.
    expect(ids).not.toContain('aws/group/subnet');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the browser entry free of node: imports', () => {
    for (const file of ['index.ts', 'icons.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/from ['"]node:/);
    }
  });
});

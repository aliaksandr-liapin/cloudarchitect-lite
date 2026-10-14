import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSettings } from './settings-file.js';

describe('FileSettings', () => {
  it('round-trips settings with owner-only permissions', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ca-settings-')), 'nested', 'settings.json');
    const store = new FileSettings(path);
    expect(store.read()).toEqual({});
    store.write({ DEFAULT_MODEL: 'haiku', ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(store.read()).toEqual({ DEFAULT_MODEL: 'haiku', ANTHROPIC_API_KEY: 'sk-ant-test' });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

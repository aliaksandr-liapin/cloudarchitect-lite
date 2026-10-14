import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Settings } from './config.js';
import type { SettingsPersistence } from './setup.js';

/**
 * Wizard settings as a JSON file on the data volume. It holds the API key, so it is written
 * atomically with owner-only permissions (0600) and never logged.
 */
export class FileSettings implements SettingsPersistence {
  constructor(private readonly path: string) {}

  read(): Settings {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, 'utf8')) as Settings;
  }

  write(settings: Settings) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }
}

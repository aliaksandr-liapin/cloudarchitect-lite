/**
 * Browser end-to-end test. One project per provider setup, each with its own spec file and
 * Docker stack (see src/stack.ts); `E2E_SETUP=claude|gemini|all` picks one, unset runs all three
 * in turn. Uses the installed Chrome, so no browser download.
 *
 * `E2E_SETUP=manual` instead runs only tests/manual.spec.ts, which saves the user manual's
 * screenshots (pnpm manual); it is never part of a normal run.
 */
import { defineConfig } from '@playwright/test';

const SETUPS = ['claude', 'gemini', 'all'] as const;
const selected = process.env.E2E_SETUP;
const MANUAL = selected === 'manual';
if (selected && !MANUAL && !(SETUPS as readonly string[]).includes(selected)) {
  throw new Error(`E2E_SETUP must be one of ${SETUPS.join(', ')} or manual; got ${selected}`);
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Per test; a generation step alone may wait up to GENERATION_TIMEOUT_MS (tests/helpers.ts).
  timeout: 180_000,
  // The setups share port 8080, and each spec walks one journey in order.
  workers: 1,
  reporter: 'list',
  use: {
    channel: 'chrome',
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: MANUAL
    ? [{ name: 'manual', testMatch: 'manual.spec.ts' }]
    : SETUPS.filter((s) => !selected || s === selected).map((s) => ({
        name: s,
        testMatch: `${s}.spec.ts`,
      })),
});

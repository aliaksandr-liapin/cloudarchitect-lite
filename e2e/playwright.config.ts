/**
 * Browser end-to-end test. One project per provider setup, each with its own spec file and
 * Docker stack (see src/stack.ts); `E2E_SETUP=claude|gemini|all` picks one, unset runs all three
 * in turn. Uses the installed Chrome, so no browser download.
 */
import { defineConfig } from '@playwright/test';

const SETUPS = ['claude', 'gemini', 'all'] as const;
const selected = process.env.E2E_SETUP;
if (selected && !(SETUPS as readonly string[]).includes(selected)) {
  throw new Error(`E2E_SETUP must be one of ${SETUPS.join(', ')}; got ${selected}`);
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  forbidOnly: !!process.env.CI,
  retries: 0,
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
  projects: SETUPS.filter((s) => !selected || s === selected).map((s) => ({
    name: s,
    testMatch: `${s}.spec.ts`,
  })),
});

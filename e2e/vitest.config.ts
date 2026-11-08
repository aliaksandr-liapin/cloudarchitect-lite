import { defineConfig } from 'vitest/config';

// Unit tests only; the browser specs in tests/ run with Playwright (`pnpm e2e`).
export default defineConfig({
  test: {
    include: ['fake-ai/**/*.test.ts', 'src/**/*.test.ts'],
  },
});

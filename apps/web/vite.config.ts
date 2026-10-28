import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the demo under /<repo>/; Docker and dev keep '/'.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  // The gateway runs on :8787 in dev (`pnpm dev`); same-origin /api keeps CSP and CORS simple.
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  // The ELK layout engine is a single ~1.4 MB lazy chunk by design; app chunks should stay well below this.
  build: { sourcemap: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});

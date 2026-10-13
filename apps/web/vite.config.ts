import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // The ELK layout engine is a single ~1.4 MB lazy chunk by design; app chunks should stay well below this.
  build: { sourcemap: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});

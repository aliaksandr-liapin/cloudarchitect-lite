import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryCreditStore } from './store.js';

// Node runtime for local development and container deployments. The in-memory store is per-process:
// run a single replica, or replace it with a shared transactional store before scaling out.
const config = loadConfig(process.env);
const app = createApp({
  config,
  store: new MemoryCreditStore(config.FREE_CREDITS),
  log: (e) => console.log(JSON.stringify(e)),
});
const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () =>
  console.log(JSON.stringify({ event: 'listening', port })),
);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

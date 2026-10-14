import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createApp } from './app.js';
import { FileSettings } from './settings-file.js';
import { SetupService } from './setup.js';
import { MemoryCreditStore } from './store.js';

// Node runtime for local development and self-hosted containers. The in-memory store is per-process:
// run a single replica, or replace it with a shared transactional store before scaling out.
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const setupCode = randomBytes(6).toString('hex');
const setup = new SetupService({
  env: process.env,
  persistence: new FileSettings(join(dataDir, 'settings.json')),
  setupCode,
  generateSalt: () => randomBytes(24).toString('base64url'),
});
const wizard = process.env.SETUP_WIZARD !== 'disabled';

// `node node.js reset-setup` re-opens the wizard on the next start (docs/operations/installation.md).
if (process.argv[2] === 'reset-setup') {
  setup.reset();
  console.log('Setup re-opened. Restart the gateway and open the new setup link from its log.');
  process.exit(0);
}

const app = createApp({
  config: () => setup.config(),
  ...(wizard ? { setup } : {}),
  store: new MemoryCreditStore(() => setup.config().FREE_CREDITS),
  // Container health checks run every 30 s; logging them would bury real traffic.
  log: (e) => {
    if (e.path !== '/health') console.log(JSON.stringify(e));
  },
});
const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(JSON.stringify({ event: 'listening', port }));
  if (wizard && !setup.status().configured) {
    const url = `${process.env.PUBLIC_URL ?? 'http://localhost:8080'}/setup?code=${setupCode}`;
    console.log(
      `\n  CloudArchitect Lite is running. Finish setup in your browser:\n\n    ${url}\n\n  The code in this link is valid until the server restarts.\n`,
    );
  }
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

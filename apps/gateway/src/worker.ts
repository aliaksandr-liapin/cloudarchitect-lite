import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { D1CreditStore } from './store.js';

type Bindings = { DB: D1Database } & Record<string, unknown>;

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const config = loadConfig(env);
    const app = createApp({
      config,
      store: new D1CreditStore(env.DB, config.FREE_CREDITS),
      log: (e) => console.log(JSON.stringify(e)),
    });
    return app.fetch(request, env, ctx);
  },
};

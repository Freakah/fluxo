import { serve } from '@hono/node-server';
import fs from 'node:fs';
import { loadConfig } from './config.ts';
import { openDb } from './db/db.ts';
import { createApp } from './app.ts';
import { loadProviders } from './providers/index.ts';
import { startScheduler } from './sync/scheduler.ts';
import { log } from './log.ts';

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
let config: ReturnType<typeof loadConfig>;
try { config = loadConfig(); } catch (e) {
  console.error(`
  Fluxo cannot start: ${(e as Error).message}
  See .env.example and docs/TROUBLESHOOTING.md.
`);
  process.exit(1);
}
const db = openDb(config.dbPath);
const providers = loadProviders(config);
const syncCtx = { db, providers, key: config.encryptionKey, intervalHours: config.SYNC_INTERVAL_HOURS };
const app = createApp({ db, config, providers, syncCtx, version });

if (config.SCHEDULER_ENABLED) startScheduler(syncCtx, { demo: config.APP_MODE === 'demo' });
const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (i) => {
  log.info('server started', { mode: config.APP_MODE, url: config.PUBLIC_URL, port: i.port, providers: Object.keys(providers) });
  console.log(`\n  Fluxo (${config.APP_MODE} mode) running at ${config.PUBLIC_URL}\n`);
  if (config.APP_MODE === 'live' && !providers.enablebanking) console.log('  No bank provider configured: set ENABLE_BANKING_APP_ID and ENABLE_BANKING_KEY_PATH (docs/PROVIDERS.md).\n');
});

const shutdown = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// One-shot background sync for cron/systemd timers: npm run sync
// Uses the same engine, locks and daily limits as the in-process scheduler.
import { loadConfig } from '../server/config.ts';
import { openDb } from '../server/db/db.ts';
import { loadProviders } from '../server/providers/index.ts';
import { runDueSyncs } from '../server/sync/scheduler.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
const n = await runDueSyncs({ db, providers: loadProviders(config), key: config.encryptionKey, intervalHours: config.SYNC_INTERVAL_HOURS });
console.log(`Processed ${n} due connection(s).`);
db.close();

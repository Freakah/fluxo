// Usage: npm run restore -- <path-to-backup.sqlite>   (stop the server first)
import { loadConfig } from '../server/config.ts';
import { restoreBackup } from '../server/backup.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run restore -- <backup.sqlite>');
  process.exit(1);
}
const config = loadConfig();
const r = restoreBackup(config.dbPath, file, config.DATA_DIR);
console.log(`Restored ${file} into ${config.dbPath}.`);
if (r.safetyCopy) console.log(`Previous database kept at ${r.safetyCopy}.`);
console.log(`Re-applied ${r.reapplied} deletion(s) recorded after the backup was taken.`);

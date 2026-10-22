// Usage: npm run backup [-- --keep 14]
import path from 'node:path';
import { loadConfig } from '../server/config.ts';
import { openDb } from '../server/db/db.ts';
import { createBackup } from '../server/backup.ts';

const config = loadConfig();
const keepIdx = process.argv.indexOf('--keep');
const keep = keepIdx > 0 ? Number(process.argv[keepIdx + 1]) : Number(process.env.BACKUP_KEEP ?? 14);
const db = openDb(config.dbPath);
const file = createBackup(db, path.join(path.dirname(config.dbPath), 'backups'), { keep });
db.close();
console.log(`Backup written: ${file}\nKeeping the newest ${keep} backups. Copy backups off this machine (encrypted) for real protection.`);
console.log('DATA_ENCRYPTION_KEY is NOT in the backup. Store it separately, or bank connections must be re-authorized after a restore.');

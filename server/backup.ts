// Backups are consistent SQLite snapshots (VACUUM INTO). They contain financial data and
// encrypted provider sessions, but never the encryption key (that lives in the environment).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, type DB } from './db/db.ts';
import { readDeletions, reapplyDeletions } from './domain/lifecycle.ts';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function createBackup(db: DB, dir: string, opts: { keep?: number; now?: Date } = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const now = opts.now ?? new Date();
  const file = path.join(dir, `fluxo-${stamp(now)}.sqlite`);
  if (fs.existsSync(file)) throw new Error(`Backup already exists: ${file}`);
  db.exec(`VACUUM INTO ${sqlString(file)}`);
  fs.writeFileSync(`${file}.json`, JSON.stringify({ createdAt: now.toISOString(), format: 'fluxo-sqlite-backup', version: 1 }, null, 2));
  pruneBackups(dir, opts.keep ?? 14);
  return file;
}

/** Keeps the newest `keep` backups; older ones are deleted (this is the backup expiry). */
export function pruneBackups(dir: string, keep: number): string[] {
  const files = fs.readdirSync(dir).filter((f) => /^fluxo-\d{8}T\d{6}Z\.sqlite$/.test(f)).sort();
  const old = files.slice(0, Math.max(0, files.length - keep));
  for (const f of old) { fs.rmSync(path.join(dir, f)); fs.rmSync(path.join(dir, `${f}.json`), { force: true }); }
  return old;
}

export function backupCreatedAt(file: string): string {
  const meta = `${file}.json`;
  if (fs.existsSync(meta)) return (JSON.parse(fs.readFileSync(meta, 'utf8')) as { createdAt: string }).createdAt;
  const m = /fluxo-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(path.basename(file));
  if (!m) throw new Error('Cannot determine when this backup was taken (missing .json metadata).');
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

/**
 * Restores a backup over dbPath. The server must be stopped. The current database is kept as
 * pre-restore-<time>.sqlite. Deletions recorded after the backup was taken are re-applied so
 * deleted data does not silently come back.
 */
export function restoreBackup(dbPath: string, backupFile: string, dataDir: string): { safetyCopy: string | null; reapplied: number; migrations: string[] } {
  if (!fs.existsSync(backupFile)) throw new Error(`Backup not found: ${backupFile}`);
  const check = new DatabaseSync(backupFile, { readOnly: true });
  try {
    const ok = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    const integrity = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (!ok || integrity.integrity_check !== 'ok') throw new Error('This file is not a valid Fluxo backup.');
  } finally { check.close(); }
  const createdAt = backupCreatedAt(backupFile);
  let safetyCopy: string | null = null;
  if (fs.existsSync(dbPath)) {
    safetyCopy = path.join(path.dirname(dbPath), `pre-restore-${stamp(new Date())}.sqlite`);
    const cur = new DatabaseSync(dbPath);
    cur.exec(`VACUUM INTO ${sqlString(safetyCopy)}`);
    cur.close();
  }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  fs.copyFileSync(backupFile, dbPath);
  const db = openDb(dbPath); // applies any newer migrations
  const migrations = (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]).map((r) => r.name);
  const reapplied = reapplyDeletions(db, readDeletions(dataDir), createdAt);
  db.close();
  return { safetyCopy, reapplied, migrations };
}

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;
type Param = null | number | bigint | string;

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

/** Applies pending SQL migrations in filename order, each in its own transaction. */
export function migrate(db: DB): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(all<{ name: string }>(db, 'SELECT name FROM schema_migrations').map((r) => r.name));
  const applied: string[] = [];
  for (const name of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    tx(db, () => {
      db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'));
      run(db, 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', name, new Date().toISOString());
    });
    applied.push(name);
  }
  return applied;
}

let depth = 0;
/** Runs fn inside a transaction (nested calls use savepoints). Rolls back on throw. */
export function tx<T>(db: DB, fn: () => T): T {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export function get<T>(db: DB, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function all<T>(db: DB, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function run(db: DB, sql: string, ...params: Param[]) {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export const nowIso = () => new Date().toISOString();

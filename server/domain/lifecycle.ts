// Data lifecycle: user creation, deletion of imported data, account deletion, and the deletion log
// that stops a restored backup from silently bringing deleted data back (see docs/BACKUP.md).
import fs from 'node:fs';
import path from 'node:path';
import { all, run, tx, nowIso, type DB } from '../db/db.ts';
import { ensureDefaultCategories, unlinkPaidBack } from './reclassify.ts';
import { DEFAULT_SETTINGS } from '../../shared/settings.ts';

export function createUser(db: DB, email: string, passwordHash: string, isDemo = false): number {
  return tx(db, () => {
    const id = run(db, 'INSERT INTO users (email, password_hash, is_demo, settings_json, created_at) VALUES (?,?,?,?,?)', email, passwordHash, isDemo ? 1 : 0, JSON.stringify(DEFAULT_SETTINGS), nowIso()).id;
    ensureDefaultCategories(db, id);
    return id;
  });
}

export type Deletion = { at: string; userId: number; scope: 'imported' | 'connection' | 'user'; connectionId?: number };

/** Deletes imported accounts + transactions (all, or one connection's). Manual cash entries are kept unless scope is all. */
export function deleteImportedData(db: DB, userId: number, connectionId?: number) {
  tx(db, () => {
    const accts = connectionId
      ? all<{ id: number }>(db, 'SELECT id FROM accounts WHERE user_id = ? AND connection_id = ?', userId, connectionId)
      : all<{ id: number }>(db, "SELECT id FROM accounts WHERE user_id = ? AND kind <> 'cash'", userId);
    for (const a of accts) {
      run(db, 'UPDATE transactions SET transfer_peer_id = NULL WHERE user_id = ? AND transfer_peer_id IN (SELECT id FROM transactions WHERE account_id = ?)', userId, a.id);
      unlinkPaidBack(db, userId, 'SELECT id FROM transactions WHERE account_id = ?', a.id);
      run(db, 'DELETE FROM transactions WHERE account_id = ? AND user_id = ?', a.id, userId);
      run(db, 'DELETE FROM accounts WHERE id = ? AND user_id = ?', a.id, userId);
    }
    run(db, 'DELETE FROM recurring WHERE user_id = ?', userId); // re-detected from what remains
    if (connectionId) run(db, 'DELETE FROM connections WHERE id = ? AND user_id = ?', connectionId, userId);
    else run(db, 'DELETE FROM connections WHERE user_id = ?', userId);
  });
}

export function deleteUser(db: DB, userId: number) {
  tx(db, () => {
    run(db, 'UPDATE transactions SET transfer_peer_id = NULL WHERE user_id = ?', userId);
    // Order matters for FK constraints without cascades on categories/rules references.
    for (const t of ['notifications', 'recurring', 'budgets', 'transactions', 'rules', 'accounts', 'categories', 'auth_states', 'connections', 'sessions']) run(db, `DELETE FROM ${t} WHERE user_id = ?`, userId);
    run(db, 'DELETE FROM users WHERE id = ?', userId);
  });
}

export function logDeletion(dataDir: string, d: Omit<Deletion, 'at'>) {
  if (dataDir === ':memory:') return;
  fs.mkdirSync(dataDir, { recursive: true });
  // Contains only ids and a timestamp, never financial data.
  fs.appendFileSync(path.join(dataDir, 'deletions.log'), JSON.stringify({ at: nowIso(), ...d }) + '\n');
}

export function readDeletions(dataDir: string): Deletion[] {
  const f = path.join(dataDir, 'deletions.log');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Deletion);
}

/** Re-applies deletions recorded after a backup was taken. Returns how many were applied. */
export function reapplyDeletions(db: DB, deletions: Deletion[], since: string): number {
  let n = 0;
  for (const d of deletions.filter((x) => x.at > since)) {
    if (d.scope === 'user') deleteUser(db, d.userId);
    else deleteImportedData(db, d.userId, d.scope === 'connection' ? d.connectionId : undefined);
    n++;
  }
  return n;
}

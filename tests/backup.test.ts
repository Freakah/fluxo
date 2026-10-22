import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, get, all } from '../server/db/db.ts';
import { createBackup, restoreBackup, pruneBackups } from '../server/backup.ts';
import { createDemoUser } from '../server/demo/seed.ts';
import { deleteUser, logDeletion } from '../server/domain/lifecycle.ts';
import { KEY } from './helpers.ts';

describe('backup and restore (synthetic data)', () => {
  it('restores a backup, keeps a safety copy, and re-applies later deletions', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-backup-'));
    const dbPath = path.join(dir, 'fluxo-live.sqlite');
    const db = openDb(dbPath);
    const keepUser = await createDemoUser(db, KEY);
    const goneUser = await createDemoUser(db, KEY);
    const count = (d: typeof db, u: number) => get<{ n: number }>(d, 'SELECT COUNT(*) n FROM transactions WHERE user_id = ?', u)!.n;
    const before = { keep: count(db, keepUser), gone: count(db, goneUser) };
    expect(before.keep).toBeGreaterThan(500);

    const backup = createBackup(db, path.join(dir, 'backups'), { now: new Date(Date.now() - 60_000) });
    expect(fs.existsSync(`${backup}.json`)).toBe(true);

    // After the backup: one user deletes their account (logged), and data changes.
    deleteUser(db, goneUser);
    logDeletion(dir, { userId: goneUser, scope: 'user' });
    db.exec("UPDATE transactions SET note = 'after backup'");
    db.close();

    const r = restoreBackup(dbPath, backup, dir);
    expect(r.safetyCopy && fs.existsSync(r.safetyCopy)).toBeTruthy();
    expect(r.reapplied).toBe(1);
    expect(r.migrations).toContain('001_init.sql');

    const restored = openDb(dbPath);
    expect(count(restored, keepUser)).toBe(before.keep);
    expect(count(restored, goneUser)).toBe(0); // deleted data was not silently reintroduced
    expect(get(restored, 'SELECT 1 FROM users WHERE id = ?', goneUser)).toBeUndefined();
    expect(all(restored, "SELECT 1 FROM transactions WHERE note = 'after backup'")).toHaveLength(0);
    expect(get<{ integrity_check: string }>(restored, 'PRAGMA integrity_check')!.integrity_check).toBe('ok');
    restored.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects files that are not backups and prunes old backups', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-backup-'));
    const junk = path.join(dir, 'junk.sqlite');
    fs.writeFileSync(junk, 'not a database');
    expect(() => restoreBackup(path.join(dir, 'x.sqlite'), junk, dir)).toThrow();
    const db = openDb(path.join(dir, 'db.sqlite'));
    for (let i = 0; i < 4; i++) createBackup(db, path.join(dir, 'b'), { now: new Date(Date.UTC(2026, 0, i + 1)), keep: 10 });
    expect(pruneBackups(path.join(dir, 'b'), 2)).toHaveLength(2);
    expect(fs.readdirSync(path.join(dir, 'b')).filter((f) => f.endsWith('.sqlite'))).toEqual(['fluxo-20260103T000000Z.sqlite', 'fluxo-20260104T000000Z.sqlite']);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

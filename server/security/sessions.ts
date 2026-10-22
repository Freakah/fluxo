// Server-side sessions: the cookie holds a random 256-bit token; only its SHA-256 hash is stored,
// so a database leak does not yield usable session tokens.
import { createHash, randomBytes } from 'node:crypto';
import { get, run, nowIso, type DB } from '../db/db.ts';

export const SESSION_COOKIE = 'fluxo_session';
const IDLE_DAYS = 7;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function createSession(db: DB, userId: number, ttlDays: number, userAgent: string | null, mfaPending = false): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 86400000);
  run(db, 'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, user_agent, mfa_pending) VALUES (?,?,?,?,?,?,?)',
    hashToken(token), userId, now.toISOString(), expiresAt.toISOString(), now.toISOString(), userAgent?.slice(0, 200) ?? null, mfaPending ? 1 : 0);
  return { token, expiresAt };
}

export type SessionUser = { userId: number; sessionHash: string; mfaPending: boolean; isDemo: boolean; email: string };

/** Validates a token: absolute expiry + idle timeout. Touches last_seen at most once a minute. */
export function validateSession(db: DB, token: string | undefined): SessionUser | null {
  if (!token || token.length > 100) return null;
  const h = hashToken(token);
  const s = get<{ user_id: number; expires_at: string; last_seen_at: string; mfa_pending: number; is_demo: number; email: string }>(db,
    'SELECT s.user_id, s.expires_at, s.last_seen_at, s.mfa_pending, u.is_demo, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?', h);
  if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expires_at) <= now || now - Date.parse(s.last_seen_at) > IDLE_DAYS * 86400000) {
    run(db, 'DELETE FROM sessions WHERE id_hash = ?', h);
    return null;
  }
  if (now - Date.parse(s.last_seen_at) > 60000) run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', nowIso(), h);
  return { userId: s.user_id, sessionHash: h, mfaPending: !!s.mfa_pending, isDemo: !!s.is_demo, email: s.email };
}

export const revokeSession = (db: DB, hash: string) => run(db, 'DELETE FROM sessions WHERE id_hash = ?', hash);
export const revokeOtherSessions = (db: DB, userId: number, keepHash: string) => run(db, 'DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?', userId, keepHash).changes;
export const purgeExpiredSessions = (db: DB) => run(db, 'DELETE FROM sessions WHERE expires_at <= ?', nowIso()).changes;

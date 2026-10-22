// Full data export and deletion.
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { all, get } from '../db/db.ts';
import { body, HttpError, uid, type Deps, type Env } from '../context.ts';
import { deleteImportedData, deleteUser, logDeletion } from '../domain/lifecycle.ts';
import { verifyPassword } from '../security/password.ts';
import { open } from '../security/secretbox.ts';
import { SESSION_COOKIE } from '../security/sessions.ts';
import { userSettings } from '../domain/notifications.ts';
import { resetDemoUser } from '../demo/seed.ts';
import { createSession } from '../security/sessions.ts';
import { setSessionCookie } from './auth.ts';
import { todayIn } from '../../shared/dates.ts';
import { log } from '../log.ts';

export const EXPORT_FORMAT = 'fluxo-export';
export const EXPORT_VERSION = 1;

export function privacyRoutes(deps: Deps) {
  const { db, config, providers } = deps;
  const app = new Hono<Env>();

  async function revokeAll(userId: number) {
    for (const cn of all<{ id: number; provider: string; provider_session_enc: string | null }>(db, 'SELECT id, provider, provider_session_enc FROM connections WHERE user_id = ? AND provider_session_enc IS NOT NULL', userId)) {
      try { await providers[cn.provider]?.revoke(open(config.encryptionKey, cn.provider_session_enc!)); } catch { log.warn('revoke failed during deletion', { connectionId: cn.id }); }
    }
  }

  // Documented in docs/DATA_EXPORT.md. Secrets (password hash, TOTP secret, provider sessions) are never exported.
  app.get('/export/full', (c) => {
    const userId = uid(c);
    const u = get<{ email: string; created_at: string }>(db, 'SELECT email, created_at FROM users WHERE id = ?', userId)!;
    const data = {
      format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(),
      notes: 'Amounts are integer minor units (e.g. cents); negative = money out. Dates are bank calendar dates.',
      user: { email: u.email, createdAt: u.created_at, settings: userSettings(db, userId) },
      connections: all(db, 'SELECT id, provider, institution_name, institution_country, status, consent_expires_at, last_success_at, created_at, disconnected_at FROM connections WHERE user_id = ?', userId),
      accounts: all(db, 'SELECT id, connection_id, name, display_name, iban_last4, currency, kind, included, balance_minor, balance_label, balance_at FROM accounts WHERE user_id = ?', userId),
      categories: all(db, 'SELECT id, key, name, color, is_system, archived_at FROM categories WHERE user_id = ?', userId),
      rules: all(db, 'SELECT id, priority, enabled, field, match_type, pattern, direction, account_id, category_id, created_at FROM rules WHERE user_id = ?', userId),
      budgets: all(db, 'SELECT category_id, currency, amount_minor, effective_month FROM budgets WHERE user_id = ?', userId),
      recurring: all(db, 'SELECT merchant, currency, kind, frequency, typical_amount_minor, last_date, next_date, confidence, status, user_kind, user_frequency, user_amount_minor FROM recurring WHERE user_id = ?', userId),
      transactions: all(db, `SELECT id, account_id, source, status, amount_minor, currency, original_pending_amount_minor, booking_date, value_date, description, counterparty, merchant,
        auto_category_id, auto_source, auto_confidence, auto_type, category_override_id, type_override, note, excluded, transfer_peer_id, needs_review FROM transactions WHERE user_id = ? ORDER BY booking_date, id`, userId),
      notifications: all(db, 'SELECT kind, title, body, created_at, read_at FROM notifications WHERE user_id = ?', userId),
    };
    c.header('Content-Disposition', `attachment; filename="fluxo-export-${todayIn('UTC')}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json(data);
  });

  app.post('/privacy/delete-imported', async (c) => {
    await body(c, z.object({ confirm: z.literal('DELETE') }));
    const userId = uid(c);
    await revokeAll(userId);
    deleteImportedData(db, userId);
    logDeletion(config.DATA_DIR, { userId, scope: 'imported' });
    return c.json({ ok: true });
  });

  app.post('/privacy/delete-account', async (c) => {
    const b = await body(c, z.object({ confirm: z.literal('DELETE MY ACCOUNT'), password: z.string().max(256).optional() }));
    const userId = uid(c);
    if (!c.get('user').isDemo) {
      const u = get<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', userId)!;
      if (!b.password || !(await verifyPassword(b.password, u.password_hash))) throw new HttpError(401, 'Password is incorrect.');
    }
    await revokeAll(userId);
    deleteUser(db, userId);
    logDeletion(config.DATA_DIR, { userId, scope: 'user' });
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.post('/demo/reset', async (c) => {
    if (!c.get('user').isDemo) throw new HttpError(403, 'Only demo workspaces can be reset.');
    const id = await resetDemoUser(db, config.encryptionKey, uid(c));
    const s = createSession(db, id, 1, c.req.header('user-agent') ?? null);
    setSessionCookie(c, deps, s.token, s.expiresAt);
    return c.json({ ok: true });
  });

  return app;
}

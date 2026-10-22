// Accounts and bank connections (read-only AIS). The user authenticates with the bank/provider directly.
import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { all, get, run, tx, nowIso } from '../db/db.ts';
import { body, HttpError, uid, clientIp, type Deps, type Env } from '../context.ts';
import { hashToken } from '../security/sessions.ts';
import { syncConnection, upsertAccounts, sealSession, MANUAL_COOLDOWN_MS, postProcess } from '../sync/engine.ts';
import { open } from '../security/secretbox.ts';
import { deleteImportedData, logDeletion } from '../domain/lifecycle.ts';
import { ProviderError } from '../providers/types.ts';
import { log } from '../log.ts';

const STATE_TTL_MS = 15 * 60_000;

export function bankRoutes(deps: Deps) {
  const { db, config, providers } = deps;
  const app = new Hono<Env>();
  const activeProviderId = () => (config.APP_MODE === 'demo' ? 'demo' : 'enablebanking');
  const provider = () => {
    const p = providers[activeProviderId()];
    if (!p) throw new HttpError(503, 'No bank provider is configured on this server. See docs/PROVIDERS.md (Enable Banking setup).');
    return p;
  };
  const ownConn = (userId: number, id: number) => {
    const c = get<{ id: number; provider: string; status: string; provider_session_enc: string | null; last_attempt_at: string | null; institution_name: string; institution_country: string }>(db,
      'SELECT id, provider, status, provider_session_enc, last_attempt_at, institution_name, institution_country FROM connections WHERE id = ? AND user_id = ?', id, userId);
    if (!c) throw new HttpError(404, 'Connection not found');
    return c;
  };

  app.get('/accounts', (c) => c.json(all(db, `SELECT a.id, a.connection_id, a.name, a.display_name, a.iban_last4, a.currency, a.kind, a.included,
    a.balance_minor, a.balance_type, a.balance_label, a.balance_at, a.synced_through,
    (SELECT MAX(booking_date) FROM transactions t WHERE t.account_id = a.id) AS latest_tx_date,
    (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS tx_count
    FROM accounts a WHERE a.user_id = ? ORDER BY a.kind = 'cash', a.id`, uid(c))));

  app.patch('/accounts/:id', async (c) => {
    const b = await body(c, z.object({ display_name: z.string().trim().max(40).nullable().optional(), included: z.boolean().optional() }).strict());
    const id = Number(c.req.param('id'));
    if (!get(db, 'SELECT 1 FROM accounts WHERE id = ? AND user_id = ?', id, uid(c))) throw new HttpError(404, 'Account not found');
    if (b.display_name !== undefined) run(db, 'UPDATE accounts SET display_name = ? WHERE id = ?', b.display_name || null, id);
    if (b.included !== undefined) run(db, 'UPDATE accounts SET included = ? WHERE id = ?', b.included ? 1 : 0, id);
    return c.json({ ok: true });
  });

  app.get('/connections', (c) => {
    const rows = all<Record<string, unknown> & { id: number }>(db, `SELECT id, provider, institution_name, institution_country, status, consent_expires_at, last_attempt_at, last_success_at,
      last_error_code, last_error_message, failure_count, next_sync_after, created_at, disconnected_at FROM connections WHERE user_id = ? ORDER BY id`, uid(c));
    const runs = all<{ connection_id: number; status: string; started_at: string; finished_at: string | null; inserted: number; updated: number; error_code: string | null }>(db,
      `SELECT r.connection_id, r.status, r.started_at, r.finished_at, r.inserted, r.updated, r.error_code FROM sync_runs r JOIN connections c ON c.id = r.connection_id
       WHERE c.user_id = ? ORDER BY r.started_at DESC LIMIT 100`, uid(c));
    return c.json(rows.map((r) => ({ ...r, live: providers[r.provider as string]?.live ?? false, simulated: r.provider === 'demo', recentRuns: runs.filter((x) => x.connection_id === r.id).slice(0, 5) })));
  });

  app.get('/institutions', async (c) => {
    const country = (c.req.query('country') ?? 'PT').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Invalid country');
    const p = provider();
    try {
      return c.json({ provider: p.label, live: p.live, institutions: await p.listInstitutions(country) });
    } catch (e) {
      throw new HttpError(502, e instanceof ProviderError ? `Could not load banks: ${e.message}` : 'Could not load banks from the provider.');
    }
  });

  // Starts authorization. Returns the provider URL; the browser navigates there.
  app.post('/connections/start', async (c) => {
    const b = await body(c, z.object({ institution: z.string().min(1).max(120), country: z.string().regex(/^[A-Z]{2}$/), connectionId: z.number().int().optional() }));
    const p = provider();
    if (b.connectionId) ownConn(uid(c), b.connectionId);
    const insts = await p.listInstitutions(b.country);
    const inst = insts.find((i) => i.name === b.institution);
    if (!inst) throw new HttpError(400, 'Unknown bank for this country.');
    const state = randomBytes(32).toString('base64url');
    run(db, 'INSERT INTO auth_states (state_hash, user_id, connection_id, provider, institution_name, institution_country, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
      hashToken(state), uid(c), b.connectionId ?? null, p.id, inst.name, inst.country, nowIso(), new Date(Date.now() + STATE_TTL_MS).toISOString());
    const days = Math.min(inst.maxConsentDays ?? 90, 180);
    const validUntil = new Date(Date.now() + days * 86400000 - 3600_000);
    const { url } = await p.startAuthorization({ institution: inst, state, redirectUrl: config.BANK_REDIRECT_URL ?? `${config.PUBLIC_URL}/api/connections/callback`, validUntil }).catch((e) => {
      throw new HttpError(502, e instanceof ProviderError ? `The provider refused to start authorization: ${e.message}` : 'Could not start authorization.');
    });
    return c.json({ url });
  });

  // Provider redirects the browser here. Validates single-use state bound to the signed-in user.
  app.get('/connections/callback', async (c) => {
    const back = (q: string) => c.redirect(`/accounts?${q}`, 302); // fixed internal destination only
    const state = c.req.query('state');
    const code = c.req.query('code');
    if (!state || state.length > 200) return back('error=invalid_state');
    const h = hashToken(state);
    const st = get<{ user_id: number; connection_id: number | null; provider: string; institution_name: string; institution_country: string; expires_at: string; used_at: string | null }>(db, 'SELECT * FROM auth_states WHERE state_hash = ?', h);
    if (!st || st.user_id !== uid(c)) return back('error=invalid_state');
    // Atomic single use: a replayed or duplicate callback finds used_at already set.
    if (run(db, 'UPDATE auth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL', nowIso(), h).changes !== 1) return back('error=already_used');
    if (Date.parse(st.expires_at) < Date.now()) return back('error=expired_state');
    if (c.req.query('error') || !code) return back('error=bank_declined');
    const p = providers[st.provider];
    if (!p) return back('error=provider_unavailable');
    let session;
    try { session = await p.completeAuthorization(code.slice(0, 500)); } catch (e) {
      log.warn('authorization completion failed', { provider: st.provider, kind: e instanceof ProviderError ? e.kind : 'unknown' });
      return back('error=authorization_failed');
    }
    const userId = uid(c);
    const connectionId = tx(db, () => {
      let id = st.connection_id;
      if (id) {
        run(db, `UPDATE connections SET status = 'active', provider_session_enc = ?, consent_expires_at = ?, last_error_code = NULL, last_error_message = NULL, failure_count = 0,
          next_sync_after = NULL, disconnected_at = NULL WHERE id = ? AND user_id = ?`, sealSession(config.encryptionKey, session.sessionRef), session.consentExpiresAt, id, userId);
      } else {
        id = run(db, `INSERT INTO connections (user_id, provider, institution_name, institution_country, status, provider_session_enc, consent_expires_at, created_at)
          VALUES (?,?,?,?, 'active', ?,?,?)`, userId, st.provider, st.institution_name, st.institution_country, sealSession(config.encryptionKey, session.sessionRef), session.consentExpiresAt, nowIso()).id;
      }
      upsertAccounts(db, userId, id, session.accounts);
      return id;
    });
    // Initial import runs in the background; the accounts page shows progress.
    void syncConnection(deps.syncCtx, connectionId, { trigger: 'initial' }).catch((e) => log.error('initial sync failed', { connectionId, err: String(e) }));
    return back(`connected=${connectionId}`);
  });

  app.post('/connections/:id/sync', async (c) => {
    const conn = ownConn(uid(c), Number(c.req.param('id')));
    if (!['active', 'error'].includes(conn.status)) throw new HttpError(409, 'This connection is not active. Reconnect it first.');
    if (conn.last_attempt_at && Date.now() - Date.parse(conn.last_attempt_at) < MANUAL_COOLDOWN_MS) {
      throw new HttpError(429, 'This connection was refreshed a few minutes ago. Banks limit how often data can be fetched; try again later.');
    }
    // The user clicked this button, so they are genuinely present: real PSU headers are sent.
    const psu = { ipAddress: clientIp(c, config.TRUST_PROXY), userAgent: c.req.header('user-agent')?.slice(0, 300) ?? 'unknown' };
    const r = await syncConnection(deps.syncCtx, conn.id, { trigger: 'manual', psu });
    return c.json(r);
  });

  app.post('/connections/:id/disconnect', async (c) => {
    const conn = ownConn(uid(c), Number(c.req.param('id')));
    let revoked = false;
    if (conn.provider_session_enc && providers[conn.provider]) {
      try { await providers[conn.provider].revoke(open(config.encryptionKey, conn.provider_session_enc)); revoked = true; } catch (e) {
        log.warn('provider revoke failed', { connectionId: conn.id, kind: e instanceof ProviderError ? e.kind : 'unknown' });
      }
    }
    run(db, "UPDATE connections SET status = 'disconnected', provider_session_enc = NULL, next_sync_after = NULL, disconnected_at = ? WHERE id = ?", nowIso(), conn.id);
    run(db, 'UPDATE accounts SET provider_account_uid = NULL WHERE connection_id = ?', conn.id);
    return c.json({ ok: true, providerRevoked: revoked });
  });

  app.post('/connections/:id/delete-data', async (c) => {
    const b = await body(c, z.object({ confirm: z.literal('DELETE') }));
    void b;
    const conn = ownConn(uid(c), Number(c.req.param('id')));
    if (conn.status !== 'disconnected') throw new HttpError(409, 'Disconnect this bank first, then delete its imported data.');
    deleteImportedData(db, uid(c), conn.id);
    logDeletion(config.DATA_DIR, { userId: uid(c), scope: 'connection', connectionId: conn.id });
    postProcess(db, uid(c), []);
    return c.json({ ok: true });
  });

  return app;
}

// Synchronization engine. Guarantees (see docs/SYNC.md):
// - all pages for an account are fetched before anything is written; writes are one DB transaction
// - idempotent: stable bank ids, else a content fingerprint + occurrence index (identical purchases stay separate)
// - overlapping lookback window on incremental syncs; posted history is never deleted
// - pending -> posted reconciliation only when unambiguous; otherwise both kept and flagged
// - per-account lease lock; backoff on temporary errors; provider rate limits respected
import { createHash, randomUUID } from 'node:crypto';
import { all, get, run, tx, nowIso, type DB } from '../db/db.ts';
import { addDays, daysBetween, todayIn } from '../../shared/dates.ts';
import { parseAmountToMinor } from '../../shared/money.ts';
import { normalizeMerchant } from '../domain/merchants.ts';
import { reclassify, detectTransfers } from '../domain/reclassify.ts';
import { detectRecurring } from '../domain/recurring.ts';
import { notify, checkBudgetAlerts, userSettings } from '../domain/notifications.ts';
import { ProviderError, type BankProvider, type ProviderTx, type PsuContext, type ProviderAccount } from '../providers/types.ts';
import { open, seal } from '../security/secretbox.ts';
import { log } from '../log.ts';

export const LOOKBACK_DAYS = 10;
const MAX_PAGES = 500;
const LOCK_MS = 10 * 60_000;
export const MAX_BACKGROUND_PER_DAY = 4;
export const MANUAL_COOLDOWN_MS = 10 * 60_000;

export type SyncCtx = { db: DB; providers: Record<string, BankProvider>; key: Buffer; intervalHours: number; now?: () => Date };
export type SyncResult = { status: 'success' | 'partial' | 'failed' | 'skipped'; inserted: number; updated: number; fetched: number; message?: string };

type Conn = { id: number; user_id: number; provider: string; status: string; provider_session_enc: string | null; consent_expires_at: string | null; failure_count: number; background_fetches_day: string | null; background_fetches_count: number; institution_name: string };
type Acct = { id: number; provider_account_uid: string | null; currency: string; synced_through: string | null; initial_sync_done: number; user_id: number };

const nowOf = (ctx: SyncCtx) => (ctx.now ? ctx.now() : new Date());

export function fingerprint(t: ProviderTx): string {
  return createHash('sha256').update([t.status === 'pending' ? 'P' : 'B', t.bookingDate, t.amount, t.currency, t.description, t.counterparty ?? ''].join('|')).digest('hex').slice(0, 32);
}

/** Store accounts returned by an authorization, matching existing ones by stable identity (no duplicates on reconnect). */
export function upsertAccounts(db: DB, userId: number, connectionId: number, accounts: ProviderAccount[]): number[] {
  return accounts.map((a) => {
    const existing = get<{ id: number }>(db, 'SELECT id FROM accounts WHERE user_id = ? AND identity_hash = ?', userId, a.identityHash);
    if (existing) {
      run(db, 'UPDATE accounts SET connection_id = ?, provider_account_uid = ?, name = ?, iban_last4 = COALESCE(?, iban_last4) WHERE id = ?', connectionId, a.uid, a.name, a.ibanLast4, existing.id);
      return existing.id;
    }
    return run(db, 'INSERT INTO accounts (user_id, connection_id, provider_account_uid, identity_hash, name, iban_last4, currency, kind, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      userId, connectionId, a.uid, a.identityHash, a.name, a.ibanLast4, a.currency, a.kind, nowIso()).id;
  });
}

export function sealSession(key: Buffer, ref: string) { return seal(key, ref); }

function acquireLock(db: DB, accountId: number, owner: string, now: Date): boolean {
  return run(db, 'UPDATE accounts SET lock_until = ?, lock_owner = ? WHERE id = ? AND (lock_until IS NULL OR lock_until < ?)',
    new Date(now.getTime() + LOCK_MS).toISOString(), owner, accountId, now.toISOString()).changes === 1;
}
const releaseLock = (db: DB, accountId: number, owner: string) => run(db, 'UPDATE accounts SET lock_until = NULL, lock_owner = NULL WHERE id = ? AND lock_owner = ?', accountId, owner);

/** Fetches every page for one account. Throws on any page failure so nothing partial is written. */
async function fetchAll(p: BankProvider, ref: string, uid: string, dateFrom: string | null, psu: PsuContext): Promise<ProviderTx[]> {
  const out: ProviderTx[] = [];
  const seen = new Set<string>();
  let key: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await p.getTransactions(ref, uid, { dateFrom, continuationKey: key, psu });
    out.push(...r.transactions);
    key = r.continuationKey;
    if (!key) return out;
    if (seen.has(key)) throw new ProviderError('temporary', 'PAGINATION_LOOP', 'Provider repeated a continuation key');
    seen.add(key);
  }
  throw new ProviderError('temporary', 'TOO_MANY_PAGES', 'Too many pages returned by the provider');
}

type Existing = { id: number; status: string; amount_minor: number; booking_date: string; description: string; merchant: string };

/** Writes one complete fetch for an account. Must run inside a transaction. Exported for tests. */
export function applyStatement(db: DB, acct: Acct, txs: ProviderTx[], dateFrom: string | null, now: Date): { inserted: number[]; updated: number } {
  const ts = now.toISOString();
  const inserted: number[] = [];
  let updated = 0;
  const seenIds = new Set<number>();
  const occ = new Map<string, number>();

  const byProviderId = db.prepare('SELECT id, status, amount_minor, booking_date, description, merchant FROM transactions WHERE account_id = ? AND provider_tx_id = ?');
  const byFp = db.prepare('SELECT id, status, amount_minor, booking_date, description, merchant FROM transactions WHERE account_id = ? AND fingerprint = ?');
  const updateFacts = db.prepare(`UPDATE transactions SET status = ?, amount_minor = ?, booking_date = ?, value_date = ?, description = ?, counterparty = ?,
    bank_code = ?, mcc = ?, merchant = ?, provider_tx_id = COALESCE(?, provider_tx_id), fingerprint = ?, last_seen_at = ?, missing_since = NULL, missing_count = 0,
    original_pending_amount_minor = COALESCE(original_pending_amount_minor, ?), needs_review = CASE WHEN status = 'cancelled' AND ? = 'pending' THEN NULL ELSE needs_review END, updated_at = ? WHERE id = ?`);
  const insert = db.prepare(`INSERT INTO transactions (user_id, account_id, source, provider_tx_id, fingerprint, status, amount_minor, currency, booking_date, value_date,
    description, counterparty, bank_code, mcc, first_seen_at, last_seen_at, merchant, auto_type, updated_at) VALUES (?,?, 'import', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // Pending first, so posted items reconcile only against pending rows the bank no longer reports.
  const ordered = [...txs.filter((t) => t.status === 'pending'), ...txs.filter((t) => t.status !== 'pending')];
  const pendingPool = all<Existing & { claimed?: boolean }>(db, "SELECT id, status, amount_minor, booking_date, description, merchant FROM transactions WHERE account_id = ? AND status = 'pending'", acct.id);

  for (const t of ordered) {
    const amount = parseAmountToMinor(t.amount, t.currency);
    const merchant = normalizeMerchant(t.description, t.counterparty);
    let fp: string | null = null;
    if (!t.id) {
      const base = fingerprint(t);
      const n = occ.get(base) ?? 0;
      occ.set(base, n + 1);
      fp = `${base}:${n}`;
    }
    let row = (t.id ? byProviderId.get(acct.id, t.id) : byFp.get(acct.id, fp)) as Existing | undefined;
    let pendingAmount: number | null = null;
    if (!row && t.status === 'posted') {
      // Reconcile with a pending row: same direction, same merchant, amount within 25%, booked 0..7 days after.
      const cands = pendingPool.filter((p) => !p.claimed && !seenIds.has(p.id) && Math.sign(p.amount_minor) === Math.sign(amount) && p.merchant === merchant
        && Math.abs(p.amount_minor - amount) <= Math.abs(p.amount_minor) * 0.25 && daysBetween(p.booking_date, t.bookingDate) >= 0 && daysBetween(p.booking_date, t.bookingDate) <= 7);
      const interchangeable = cands.length > 0 && cands.every((c) => c.amount_minor === cands[0].amount_minor && c.booking_date === cands[0].booking_date && c.description === cands[0].description);
      if (cands.length === 1 || interchangeable) {
        const p = cands[0];
        p.claimed = true;
        row = p;
        if (p.amount_minor !== amount) pendingAmount = p.amount_minor;
      } else if (cands.length > 1) {
        for (const c of cands) run(db, 'UPDATE transactions SET needs_review = ? WHERE id = ?', 'Several pending transactions could match a posted one; kept separately.', c.id);
      }
    }
    if (row && seenIds.has(row.id)) continue; // the bank sent the same id twice in one response: one transaction
    if (row) {
      updateFacts.run(t.status, amount, t.bookingDate, t.valueDate, t.description, t.counterparty, t.bankCode, t.mcc, merchant, t.id, t.id ? null : fp, ts, pendingAmount, t.status, ts, row.id);
      seenIds.add(row.id);
      updated++;
    } else {
      const id = Number(insert.run(acct.user_id, acct.id, t.id, t.id ? null : fp, t.status, amount, t.currency, t.bookingDate, t.valueDate, t.description, t.counterparty, t.bankCode, t.mcc, ts, ts, merchant, amount < 0 ? 'expense' : 'income', ts).lastInsertRowid);
      inserted.push(id);
      seenIds.add(id);
    }
  }

  // Pending rows inside the fetched window that the bank no longer reports: keep, mark cancelled, explain. Posted rows are never touched.
  for (const p of pendingPool) {
    if (seenIds.has(p.id) || p.claimed) continue;
    if (dateFrom && p.booking_date < dateFrom) continue;
    run(db, `UPDATE transactions SET status = 'cancelled', missing_since = COALESCE(missing_since, ?), missing_count = missing_count + 1,
      needs_review = 'No longer reported as pending by the bank (expired authorisation, or posted under a reference we could not match).', updated_at = ? WHERE id = ?`, ts, ts, p.id);
    updated++;
  }
  return { inserted, updated };
}

function backoffMs(failures: number) { return Math.min(15 * 60_000 * 2 ** Math.max(0, failures - 1), 6 * 3600_000); }

export async function syncConnection(ctx: SyncCtx, connectionId: number, opts: { trigger: 'scheduled' | 'manual' | 'initial'; psu?: PsuContext } = { trigger: 'scheduled' }): Promise<SyncResult> {
  const { db } = ctx;
  const now = nowOf(ctx);
  const conn = get<Conn>(db, 'SELECT * FROM connections WHERE id = ?', connectionId);
  if (!conn || !['active', 'error'].includes(conn.status) || !conn.provider_session_enc) return { status: 'skipped', inserted: 0, updated: 0, fetched: 0, message: 'Connection is not active' };
  const c: Conn = conn;
  let inserted: number[] = [], updated = 0, fetched = 0, failures = 0;
  let firstError: ProviderError | undefined;
  const settings = userSettings(db, conn.user_id);
  const today = todayIn(settings.timezone, now);

  if (conn.consent_expires_at && Date.parse(conn.consent_expires_at) <= now.getTime()) {
    run(db, "UPDATE connections SET status = 'expired', next_sync_after = NULL, last_error_code = 'CONSENT_EXPIRED', last_error_message = 'Bank access expired. Reconnect to resume syncing.' WHERE id = ?", conn.id);
    notify(db, conn.user_id, { kind: 'consent', key: `consent-expired:${conn.id}:${conn.consent_expires_at.slice(0, 10)}`, title: 'Bank access expired', body: `Reconnect ${conn.institution_name} to resume automatic syncing.`, link: '/accounts', severity: 'warning' });
    return { status: 'skipped', inserted: 0, updated: 0, fetched: 0, message: 'Consent expired' };
  }

  if (opts.trigger === 'scheduled') {
    const count = conn.background_fetches_day === today ? conn.background_fetches_count : 0;
    if (count >= MAX_BACKGROUND_PER_DAY) {
      run(db, 'UPDATE connections SET next_sync_after = ? WHERE id = ?', new Date(now.getTime() + 3600_000).toISOString(), conn.id);
      return { status: 'skipped', inserted: 0, updated: 0, fetched: 0, message: 'Daily background limit reached' };
    }
    run(db, 'UPDATE connections SET background_fetches_day = ?, background_fetches_count = ? WHERE id = ?', today, count + 1, conn.id);
  }

  const provider = ctx.providers[conn.provider];
  const runId = run(db, "INSERT INTO sync_runs (connection_id, trigger, started_at, status) VALUES (?,?,?, 'running')", conn.id, opts.trigger, now.toISOString()).id;
  run(db, 'UPDATE connections SET last_attempt_at = ? WHERE id = ?', now.toISOString(), conn.id);
  if (!provider) return finish('failed', new ProviderError('not_configured', 'PROVIDER_UNAVAILABLE', `Provider "${conn.provider}" is not configured on this server`));

  const ref = open(ctx.key, conn.provider_session_enc);
  const accounts = all<Acct>(db, 'SELECT id, provider_account_uid, currency, synced_through, initial_sync_done, user_id FROM accounts WHERE connection_id = ? AND provider_account_uid IS NOT NULL', conn.id);
  const owner = randomUUID();

  for (const acct of accounts) {
    if (!acquireLock(db, acct.id, owner, now)) { failures++; continue; }
    try {
      const dateFrom = acct.initial_sync_done && acct.synced_through ? addDays(acct.synced_through, -LOOKBACK_DAYS) : null;
      let psu = opts.psu ?? null;
      let txs: ProviderTx[];
      try { txs = await fetchAll(provider, ref, acct.provider_account_uid!, dateFrom, psu); } catch (e) {
        if (!(e instanceof ProviderError && e.code === 'PSU_HEADER_NOT_PROVIDED' && psu)) throw e;
        psu = null; // bank wants a header set we can't honestly supply: fetch as a background request instead
        txs = await fetchAll(provider, ref, acct.provider_account_uid!, dateFrom, psu);
      }
      const balances = await provider.getBalances(ref, acct.provider_account_uid!, psu).catch((e) => { if (e instanceof ProviderError && e.kind !== 'temporary') throw e; return []; });
      fetched += txs.length;
      tx(db, () => {
        const r = applyStatement(db, acct, txs, dateFrom, now);
        inserted = inserted.concat(r.inserted);
        updated += r.updated;
        const b = balances.find((x) => x.currency === acct.currency) ?? balances[0];
        if (b) run(db, 'UPDATE accounts SET balance_minor = ?, balance_type = ?, balance_label = ?, balance_at = ? WHERE id = ?', parseAmountToMinor(b.amount, b.currency), b.type, b.label, b.at ?? now.toISOString(), acct.id);
        run(db, 'UPDATE accounts SET synced_through = ?, initial_sync_done = 1 WHERE id = ?', today, acct.id);
      });
    } catch (e) {
      failures++;
      const pe = e instanceof ProviderError ? e : new ProviderError('temporary', 'INTERNAL', 'Unexpected error while syncing');
      if (!(e instanceof ProviderError)) log.error('sync account failed', { connectionId: conn.id, accountId: acct.id, err: String(e) });
      firstError ??= pe;
      if (pe.kind === 'consent_expired' || pe.kind === 'revoked' || pe.kind === 'rate_limited') break;
    } finally {
      releaseLock(db, acct.id, owner);
    }
  }

  if (inserted.length || updated) postProcess(db, conn.user_id, inserted);
  const status = failures === 0 ? 'success' : failures < accounts.length ? 'partial' : 'failed';
  return finish(status, firstError);

  function finish(status: 'success' | 'partial' | 'failed', err?: ProviderError): SyncResult {
    const end = nowOf(ctx).toISOString();
    run(db, 'UPDATE sync_runs SET finished_at = ?, status = ?, fetched = ?, inserted = ?, updated = ?, error_code = ?, error_message = ? WHERE id = ?',
      end, status, fetched, inserted.length, updated, err?.code ?? null, err?.message ?? null, runId);
    if (status === 'success') {
      run(db, "UPDATE connections SET status = 'active', last_success_at = ?, failure_count = 0, last_error_code = NULL, last_error_message = NULL, next_sync_after = ? WHERE id = ?",
        end, new Date(now.getTime() + ctx.intervalHours * 3600_000).toISOString(), c.id);
      if (c.consent_expires_at && Date.parse(c.consent_expires_at) - now.getTime() < 14 * 86400000) {
        notify(db, c.user_id, { kind: 'consent', key: `consent-expiring:${c.id}:${c.consent_expires_at.slice(0, 10)}`, title: 'Bank access expires soon', body: `Access to ${c.institution_name} expires on ${c.consent_expires_at.slice(0, 10)}. Reconnect to keep syncing.`, link: '/accounts', severity: 'warning' });
      }
    } else {
      const e = err ?? new ProviderError('temporary', 'LOCKED', 'Another sync is already running for this account');
      if (status === 'partial') run(db, 'UPDATE connections SET last_success_at = ? WHERE id = ?', end, c.id);
      const failuresN = c.failure_count + 1;
      if (e.kind === 'consent_expired' || e.kind === 'revoked') {
        run(db, 'UPDATE connections SET status = ?, next_sync_after = NULL, last_error_code = ?, last_error_message = ? WHERE id = ?',
          e.kind === 'revoked' ? 'revoked' : 'expired', e.code, e.kind === 'revoked' ? 'Access was revoked at the bank. Reconnect to resume syncing.' : 'Bank access expired. Reconnect to resume syncing.', c.id);
      } else {
        const wait = e.kind === 'rate_limited' ? (e.retryAfterSec ?? 21600) * 1000 : backoffMs(failuresN);
        run(db, "UPDATE connections SET status = CASE WHEN ? THEN 'error' ELSE status END, failure_count = ?, last_error_code = ?, last_error_message = ?, next_sync_after = ? WHERE id = ?",
          e.kind === 'rate_limited' ? 0 : 1, failuresN, e.code, friendly(e), new Date(now.getTime() + wait).toISOString(), c.id);
      }
      notify(db, c.user_id, { kind: 'sync', key: `sync:${c.id}:${e.code}:${today}`, title: e.kind === 'consent_expired' || e.kind === 'revoked' ? 'Reconnect your bank' : 'Sync problem', body: `${c.institution_name}: ${friendly(e)}`, link: '/accounts', severity: 'warning' });
    }
    return { status, inserted: inserted.length, updated, fetched, message: err ? friendly(err) : undefined };
  }
}

export function friendly(e: ProviderError): string {
  switch (e.kind) {
    case 'consent_expired': return 'Bank access expired. Reconnect to resume syncing.';
    case 'revoked': return 'Access was revoked at the bank. Reconnect to resume syncing.';
    case 'rate_limited': return 'The bank limits how often data can be fetched. We will retry automatically later.';
    case 'temporary': return 'The bank or provider did not respond. We will retry automatically with increasing delays.';
    case 'not_configured': return 'This server is not configured for this provider. See docs/PROVIDERS.md.';
    default: return 'The provider rejected the request. Try reconnecting; if it persists, report a bug (without financial details).';
  }
}

/** After new data: classify new rows, pair transfers, refresh recurring estimates, check budget alerts. */
export function postProcess(db: DB, userId: number, newIds: number[]) {
  if (newIds.length) reclassify(db, userId, newIds);
  detectTransfers(db, userId);
  detectRecurring(db, userId);
  checkBudgetAlerts(db, userId);
}

/** Connections due for a background sync. */
export function dueConnections(db: DB, now: Date): number[] {
  return all<{ id: number }>(db, "SELECT id FROM connections WHERE status IN ('active','error') AND provider_session_enc IS NOT NULL AND (next_sync_after IS NULL OR next_sync_after <= ?) ORDER BY id", now.toISOString()).map((r) => r.id);
}

/** Called at startup: runs left 'running' by a crash become 'interrupted'; expired locks are cleared. */
export function recoverInterrupted(db: DB) {
  const n = run(db, "UPDATE sync_runs SET status = 'interrupted', finished_at = ?, error_message = 'Server stopped during sync' WHERE status = 'running'", nowIso()).changes;
  run(db, 'UPDATE accounts SET lock_until = NULL, lock_owner = NULL WHERE lock_until < ?', nowIso());
  return n;
}

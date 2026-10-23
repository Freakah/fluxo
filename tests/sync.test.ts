import { describe, it, expect } from 'vitest';
import { all, get, run } from '../server/db/db.ts';
import { syncConnection, upsertAccounts, recoverInterrupted, dueConnections, MAX_BACKGROUND_PER_DAY } from '../server/sync/engine.ts';
import { totals } from '../server/domain/aggregate.ts';
import { deleteImportedData } from '../server/domain/lifecycle.ts';
import { ProviderError, type ProviderTx } from '../server/providers/types.ts';
import { freshDb, user, fakeProvider, connect, ctxFor, tx, acct } from './helpers.ts';
import { todayIn, addDays } from '../shared/dates.ts';

const today = todayIn('Europe/Lisbon');
const d = (n: number) => addDays(today, n);
const txRows = (db: ReturnType<typeof freshDb>) => all<{ id: number; status: string; amount_minor: number; provider_tx_id: string | null; note: string | null; original_pending_amount_minor: number | null; needs_review: string | null; booking_date: string }>(db, 'SELECT * FROM transactions ORDER BY id');
const spend = (db: ReturnType<typeof freshDb>, userId: number) => totals(db, { userId, from: d(-400), to: d(5) }).find((t) => t.currency === 'EUR') ?? { spending: 0, pendingOut: 0, income: 0 };

describe('sync engine', () => {
  it('imports all pages on the first sync and is idempotent on repeated syncs', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    const list: ProviderTx[] = Array.from({ length: 23 }, (_, i) => tx({ id: `e${i}`, amount: `-${i + 1}.00`, bookingDate: d(-i), description: `COMPRA LOJA ${i}` }));
    const p = fakeProvider({ statement: () => list, pageSize: 5 });
    const r1 = await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    expect(r1).toMatchObject({ status: 'success', inserted: 23 });
    expect(p.calls.filter((c) => c.dateFrom === null)).toHaveLength(5); // 5 pages, longest-history fetch
    const before = spend(db, u).spending;
    expect(before).toBe((23 * 24 / 2) * 100);
    for (let i = 0; i < 3; i++) await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    expect(txRows(db)).toHaveLength(23);
    expect(spend(db, u).spending).toBe(before);
    // Incremental syncs use an overlapping lookback window.
    expect(p.calls.at(-1)!.dateFrom).toBe(addDays(today, -10));
  });

  it('keeps two legitimate identical purchases (no bank ids) and stays stable on re-sync', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    const same = { amount: '-1.80', bookingDate: d(-2), description: 'PASTELARIA SAO ROQUE' };
    const p = fakeProvider({ statement: () => [tx(same), tx(same), tx({ ...same, amount: '-2.50' })] });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    expect(txRows(db)).toHaveLength(3);
    expect(spend(db, u).spending).toBe(180 + 180 + 250);
  });

  it('reconciles pending -> posted with a changed amount and keeps the user note', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    let bank: ProviderTx[] = [tx({ status: 'pending', amount: '-23.40', bookingDate: d(-1), description: 'COMPRA PINGO DOCE AMOREIRAS' })];
    const p = fakeProvider({ statement: () => bank });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    expect(spend(db, u)).toMatchObject({ spending: 0, pendingOut: 2340 });
    run(db, "UPDATE transactions SET note = 'dinner groceries'");
    bank = [tx({ id: 'b1', amount: '-23.85', bookingDate: today, description: 'COMPRA PINGO DOCE AMOREIRAS' })];
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    const rows = txRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'posted', amount_minor: -2385, original_pending_amount_minor: -2340, provider_tx_id: 'b1', note: 'dinner groceries' });
    expect(spend(db, u)).toMatchObject({ spending: 2385, pendingOut: 0 });
  });

  it('does not merge when several different pending items could match; flags them instead', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    let bank: ProviderTx[] = [
      tx({ status: 'pending', amount: '-10.00', bookingDate: d(-1), description: 'COMPRA GALP' }),
      tx({ status: 'pending', amount: '-11.00', bookingDate: d(-1), description: 'COMPRA GALP' }),
    ];
    const p = fakeProvider({ statement: () => bank });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    bank = [tx({ id: 'x', amount: '-10.50', bookingDate: today, description: 'COMPRA GALP' })];
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    const rows = txRows(db);
    expect(rows).toHaveLength(3);
    const flagged = rows.filter((r) => r.status !== 'posted');
    expect(flagged).toHaveLength(2);
    for (const f of flagged) expect(f.needs_review).toMatch(/Several pending/);
    expect(spend(db, u)).toMatchObject({ spending: 1050, pendingOut: 0 });
  });

  it('marks disappearing pending items as cancelled (kept, not counted) and never deletes posted history', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    let bank: ProviderTx[] = [
      tx({ id: 'old', amount: '-50.00', bookingDate: d(-60), description: 'COMPRA WORTEN' }),
      tx({ status: 'pending', amount: '-150.00', bookingDate: d(-1), description: 'HOTEL PRE-AUTORIZACAO' }),
    ];
    const p = fakeProvider({ statement: () => bank });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    bank = []; // provider now returns a shorter window with nothing in it
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    const rows = txRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.provider_tx_id === 'old')!.status).toBe('posted');
    const hotel = rows.find((r) => r.amount_minor === -15000)!;
    expect(hotel.status).toBe('cancelled');
    expect(hotel.needs_review).toMatch(/No longer reported/);
    expect(spend(db, u)).toMatchObject({ spending: 5000, pendingOut: 0 });
  });

  it('writes nothing when a later page fails, then succeeds on retry (no partial imports)', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    let fail = true;
    const list = Array.from({ length: 12 }, (_, i) => tx({ id: `e${i}`, amount: '-1.00', bookingDate: d(-i) }));
    const p = fakeProvider({ statement: () => list, pageSize: 5, failOn: ({ page }) => (fail && page === 2 ? new ProviderError('temporary', 'ASPSP_TIMEOUT', 'timeout') : undefined) });
    const r = await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    expect(r.status).toBe('failed');
    expect(txRows(db)).toHaveLength(0);
    const conn = get<{ status: string; failure_count: number; next_sync_after: string; last_success_at: string | null }>(db, 'SELECT * FROM connections WHERE id = ?', connectionId)!;
    expect(conn).toMatchObject({ status: 'error', failure_count: 1, last_success_at: null });
    expect(Date.parse(conn.next_sync_after)).toBeGreaterThan(Date.now() + 10 * 60_000); // backoff
    expect(get<{ initial_sync_done: number }>(db, 'SELECT initial_sync_done FROM accounts')!.initial_sync_done).toBe(0);
    fail = false;
    const r2 = await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    expect(r2.status).toBe('success');
    expect(txRows(db)).toHaveLength(12);
    expect(get<{ status: string; failure_count: number }>(db, 'SELECT status, failure_count FROM connections')).toMatchObject({ status: 'active', failure_count: 0 });
  });

  it('refuses a bank page with an unreadable transaction, says so, and imports once the bank sends valid data', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    let date = '2026-13-45';
    const p = fakeProvider({ statement: () => [tx({ id: 'ok', amount: '-1.00', bookingDate: d(-1) }), tx({ id: 'bad', amount: '-2.00', bookingDate: date })] });
    const r = await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    expect(r.status).toBe('failed');
    expect(txRows(db)).toHaveLength(0); // nothing half-imported, no impossible dates stored
    expect(get(db, 'SELECT status, last_error_code FROM connections')).toEqual({ status: 'error', last_error_code: 'MALFORMED_TRANSACTION' });
    expect(r.message).toMatch(/could not read/);
    date = d(-2);
    run(db, 'UPDATE connections SET next_sync_after = NULL, last_attempt_at = NULL');
    expect((await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' })).status).toBe('success');
    expect(txRows(db)).toHaveLength(2);
  });

  it('an unreadable balance does not block importing transactions', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    const p = fakeProvider({ statement: () => [tx({ id: 'ok', amount: '-1.00', bookingDate: d(-1) })] });
    p.getBalances = async () => [{ amount: 'n/a', currency: 'EUR', type: 'CLBD', label: 'Booked', at: null }];
    expect((await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' })).status).toBe('success');
    expect(txRows(db)).toHaveLength(1);
    expect(get(db, 'SELECT balance_minor FROM accounts')).toEqual({ balance_minor: null });
  });

  it('records a partial failure when one of several accounts fails', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u, [acct('a1'), acct('a2')]);
    const p = fakeProvider({ statement: (uid) => [tx({ id: `${uid}-1`, amount: '-5.00', bookingDate: today })], failOn: ({ uid }) => (uid === 'a2' ? new ProviderError('temporary', 'ASPSP_ERROR', 'x') : undefined) });
    const r = await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    expect(r.status).toBe('partial');
    expect(txRows(db)).toHaveLength(1);
    expect(get<{ status: string }>(db, "SELECT status FROM sync_runs ORDER BY id DESC LIMIT 1")!.status).toBe('partial');
  });

  it('respects provider rate limits with a long wait instead of retrying', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    const p = fakeProvider({ statement: () => [], failOn: () => new ProviderError('rate_limited', 'ASPSP_RATE_LIMIT_EXCEEDED', 'limit', 21600) });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    const c = get<{ status: string; next_sync_after: string }>(db, 'SELECT status, next_sync_after FROM connections')!;
    expect(c.status).toBe('active');
    expect(get<{ last_error_code: string }>(db, 'SELECT last_error_code FROM connections')!.last_error_code).toBe('RATE_LIMITED');
    expect(Date.parse(c.next_sync_after) - Date.now()).toBeGreaterThan(5.9 * 3600_000);
    expect(dueConnections(db, new Date())).not.toContain(connectionId);
  });

  it('limits background fetches per day', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    const p = fakeProvider({ statement: () => [] });
    for (let i = 0; i < MAX_BACKGROUND_PER_DAY + 2; i++) await syncConnection(ctxFor(db, p), connectionId, { trigger: 'scheduled' });
    expect(p.calls).toHaveLength(MAX_BACKGROUND_PER_DAY);
    expect(p.calls.every((c) => c.psu === null)).toBe(true); // background requests never claim the user is present
  });

  it('counts a manual refresh that falls back to a background request against the daily limit', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    const p = fakeProvider({ statement: () => [] });
    const background = p.getTransactions; // records only the requests that reach it (all without PSU headers)
    p.getTransactions = async (ref, uid, o) => {
      if (o.psu) throw new ProviderError('invalid', 'PSU_HEADER_NOT_PROVIDED', 'more headers needed');
      return background(ref, uid, o);
    };
    const psu = { ipAddress: '127.0.0.1', userAgent: 'test' };
    for (let i = 0; i < MAX_BACKGROUND_PER_DAY + 2; i++) await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual', psu });
    expect(p.calls).toHaveLength(MAX_BACKGROUND_PER_DAY);
    expect(get<{ last_error_code: string }>(db, 'SELECT last_error_code FROM connections')!.last_error_code).toBe('RATE_LIMITED');
  });

  it('deleting imported data also undoes "paid back" links to it', async () => {
    const db = freshDb();
    const u = user(db);
    const bank = connect(db, u, [acct('a1')]);
    const other = connect(db, u, [acct('b1')]);
    const p = fakeProvider({ statement: (uid) => [uid === 'a1' ? tx({ id: 'dinner', amount: '-40.00', bookingDate: today }) : tx({ id: 'mbway', amount: '20.00', bookingDate: today })] });
    await syncConnection(ctxFor(db, p), bank.connectionId, { trigger: 'initial' });
    await syncConnection(ctxFor(db, p), other.connectionId, { trigger: 'initial' });
    const id = (ref: string) => get<{ id: number }>(db, 'SELECT id FROM transactions WHERE provider_tx_id = ?', ref)!.id;
    run(db, "UPDATE transactions SET paid_back_for_id = ?, type_override = 'refund' WHERE id = ?", id('dinner'), id('mbway'));
    deleteImportedData(db, u, bank.connectionId);
    expect(get(db, 'SELECT paid_back_for_id, type_override FROM transactions WHERE id = ?', id('mbway'))).toEqual({ paid_back_for_id: null, type_override: null });
    expect(spend(db, u).spending).toBe(0);
  });

  it('expires consent by date and notifies only once', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    run(db, 'UPDATE connections SET consent_expires_at = ?', new Date(Date.now() - 1000).toISOString());
    const p = fakeProvider({ statement: () => [] });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'scheduled' });
    run(db, "UPDATE connections SET status = 'active'"); // simulate a second attempt
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'scheduled' });
    expect(get<{ status: string }>(db, 'SELECT status FROM connections')!.status).toBe('expired');
    expect(p.calls).toHaveLength(0);
    expect(all(db, "SELECT * FROM notifications WHERE kind = 'consent'")).toHaveLength(1);
  });

  it('handles provider-reported expired sessions', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    const p = fakeProvider({ statement: () => [], failOn: () => new ProviderError('consent_expired', 'EXPIRED_SESSION', 'expired') });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    expect(get<{ status: string; next_sync_after: string | null }>(db, 'SELECT status, next_sync_after FROM connections')).toMatchObject({ status: 'expired', next_sync_after: null });
  });

  it('asks for reconnection when the stored session cannot be decrypted (key rotated)', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    const p = fakeProvider({ statement: () => [] });
    const r = await syncConnection({ ...ctxFor(db, p), key: Buffer.alloc(32, 7) }, connectionId, { trigger: 'manual' });
    expect(r.status).toBe('failed');
    expect(get(db, 'SELECT status, last_error_code FROM connections')).toEqual({ status: 'expired', last_error_code: 'SESSION_UNREADABLE' });
    expect(p.calls).toHaveLength(0);
  });

  it('reconnection maps accounts by stable identity: no duplicate accounts or history', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId, accountIds } = connect(db, u, [acct('uid-old', 'IDENT-1')]);
    const p = fakeProvider({ statement: () => [tx({ id: 'e1', amount: '-9.99', bookingDate: today })] });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    // New provider session with a different account uid for the same account
    const again = upsertAccounts(db, u, connectionId, [acct('uid-new', 'IDENT-1')]);
    expect(again).toEqual(accountIds);
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    expect(all(db, 'SELECT * FROM accounts')).toHaveLength(1);
    expect(txRows(db)).toHaveLength(1);
    expect(p.calls.at(-1)!.uid).toBe('uid-new');
  });

  it('per-account locks prevent concurrent syncs; expired locks are recovered', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u);
    run(db, 'UPDATE accounts SET lock_until = ?, lock_owner = ?', new Date(Date.now() + 60_000).toISOString(), 'other');
    const p = fakeProvider({ statement: () => [tx({ id: 'e1', amount: '-1.00', bookingDate: today })] });
    const r = await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    expect(r.status).toBe('failed');
    expect(p.calls).toHaveLength(0);
    run(db, 'UPDATE accounts SET lock_until = ?', new Date(Date.now() - 1000).toISOString());
    run(db, "INSERT INTO sync_runs (connection_id, trigger, started_at, status) VALUES (?, 'scheduled', ?, 'running')", connectionId, new Date().toISOString());
    expect(recoverInterrupted(db)).toBe(1);
    expect((await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' })).status).toBe('success');
  });

  it('preserves user categorization across re-imports and pairs own-account transfers', async () => {
    const db = freshDb();
    const u = user(db);
    const { connectionId } = connect(db, u, [acct('cur'), acct('sav')]);
    const p = fakeProvider({ statement: (uid) => uid === 'cur'
      ? [tx({ id: 'c1', amount: '-200.00', bookingDate: d(-3), description: 'TRF P/ CONTA POUPANCA' }), tx({ id: 'c2', amount: '-12.00', bookingDate: d(-2), description: 'COMPRA LIDL' })]
      : [tx({ id: 's1', amount: '200.00', bookingDate: d(-2), description: 'TRF DE CONTA 0012' })] });
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'initial' });
    const types = all<{ provider_tx_id: string; auto_type: string }>(db, 'SELECT provider_tx_id, auto_type FROM transactions ORDER BY provider_tx_id');
    expect(types).toEqual([{ provider_tx_id: 'c1', auto_type: 'transfer' }, { provider_tx_id: 'c2', auto_type: 'expense' }, { provider_tx_id: 's1', auto_type: 'transfer' }]);
    expect(spend(db, u)).toMatchObject({ spending: 1200, income: 0 });
    const health = get<{ id: number }>(db, "SELECT id FROM categories WHERE key = 'health' AND user_id = ?", u)!.id;
    run(db, "UPDATE transactions SET category_override_id = ? WHERE provider_tx_id = 'c2'", health);
    await syncConnection(ctxFor(db, p), connectionId, { trigger: 'manual' });
    expect(get<{ category_override_id: number }>(db, "SELECT category_override_id FROM transactions WHERE provider_tx_id = 'c2'")!.category_override_id).toBe(health);
  });
});

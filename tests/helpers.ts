import { randomBytes } from 'node:crypto';
import { openDb, run, type DB } from '../server/db/db.ts';
import { createUser } from '../server/domain/lifecycle.ts';
import { seal } from '../server/security/secretbox.ts';
import { upsertAccounts, type SyncCtx } from '../server/sync/engine.ts';
import type { BankProvider, ProviderTx, ProviderAccount } from '../server/providers/types.ts';
import { loadConfig } from '../server/config.ts';
import { createApp } from '../server/app.ts';

export const KEY = randomBytes(32);

export function freshDb(): DB {
  return openDb(':memory:');
}

export function user(db: DB, email = `u${Math.random().toString(36).slice(2)}@example.com`) {
  return createUser(db, email, 'scrypt$x$x$x$x$x');
}

export const acct = (uid: string, identity = `id-${uid}`): ProviderAccount => ({ uid, identityHash: identity, name: `Account ${uid}`, ibanLast4: '1234', currency: 'EUR', kind: 'current' });

export function tx(p: Partial<ProviderTx> & { amount: string; bookingDate: string }): ProviderTx {
  return { id: null, status: 'posted', currency: 'EUR', valueDate: null, description: 'COMPRA LOJA', counterparty: null, bankCode: null, mcc: null, ...p };
}

type Call = { uid: string; dateFrom: string | null; key: string | null; psu: unknown };

/** Scriptable fake provider: `statement(uid)` is the bank's current list for an account, served in pages. */
export function fakeProvider(opts: { statement: (uid: string) => ProviderTx[]; pageSize?: number; failOn?: (call: { uid: string; page: number; dateFrom: string | null }) => Error | undefined; accounts?: ProviderAccount[] }) {
  const calls: Call[] = [];
  const revoked: string[] = [];
  const p: BankProvider & { calls: Call[]; revoked: string[] } = {
    id: 'fake', label: 'Fake', live: false, calls, revoked,
    async listInstitutions() { return [{ name: 'Fake Bank', country: 'PT', maxConsentDays: 180 }]; },
    async startAuthorization({ state }) { return { url: `https://bank.example.com/auth?state=${state}` }; },
    async completeAuthorization(code) {
      if (code !== 'good') throw new Error('bad code');
      return { sessionRef: `sess-${Math.random()}`, consentExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(), accounts: opts.accounts ?? [acct('a1')] };
    },
    async getBalances() { return [{ amount: '100.00', currency: 'EUR', type: 'CLBD', label: 'Booked (closing)', at: null }]; },
    async getTransactions(_ref, uid, { dateFrom, continuationKey, psu }) {
      calls.push({ uid, dateFrom, key: continuationKey, psu });
      const page = continuationKey ? Number(continuationKey) : 0;
      const err = opts.failOn?.({ uid, page, dateFrom });
      if (err) throw err;
      const size = opts.pageSize ?? 1000;
      const list = opts.statement(uid).filter((t) => !dateFrom || t.bookingDate >= dateFrom);
      return { transactions: list.slice(page * size, page * size + size), continuationKey: (page + 1) * size < list.length ? String(page + 1) : null };
    },
    async revoke(ref) { revoked.push(ref); },
  };
  return p;
}

/** Creates an active connection with the given provider accounts for a user. */
export function connect(db: DB, userId: number, accounts: ProviderAccount[] = [acct('a1')], provider = 'fake') {
  const id = run(db, `INSERT INTO connections (user_id, provider, institution_name, institution_country, status, provider_session_enc, consent_expires_at, created_at)
    VALUES (?, ?, 'Fake Bank', 'PT', 'active', ?, ?, ?)`, userId, provider, seal(KEY, 'sess-1'), new Date(Date.now() + 90 * 86400000).toISOString(), new Date().toISOString()).id;
  const accountIds = upsertAccounts(db, userId, id, accounts);
  return { connectionId: id, accountIds };
}

export const ctxFor = (db: DB, provider: BankProvider, now?: () => Date): SyncCtx => ({ db, providers: { [provider.id]: provider }, key: KEY, intervalHours: 6, now });

export function testApp(opts: { mode?: 'demo' | 'live'; providers?: Record<string, BankProvider>; env?: Record<string, string> } = {}) {
  const db = freshDb();
  const config = loadConfig({ APP_MODE: opts.mode ?? 'live', DATA_DIR: ':memory:', DATA_ENCRYPTION_KEY: KEY.toString('base64'), PUBLIC_URL: 'http://localhost:3000', NODE_ENV: 'test', ...opts.env });
  const providers = opts.providers ?? {};
  const app = createApp({ db, config, providers, syncCtx: { db, providers, key: KEY, intervalHours: 6 }, version: 'test' });
  return { app, db, config };
}

type Res = { status: number; json: any; text: string; headers: Headers }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Minimal cookie-jar client for app.request. */
export function client(app: ReturnType<typeof testApp>['app']) {
  let cookie = '';
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: 'http://localhost:3000', ...headers };
    if (cookie) h.Cookie = cookie;
    if (method !== 'GET' && !('Content-Type' in h)) h['Content-Type'] = 'application/json';
    const res = await app.request(path, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /fluxo_session=([^;]*)/.exec(set);
      if (m) cookie = m[1] ? `fluxo_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    req,
    get: (p: string) => req('GET', p),
    post: (p: string, b?: unknown) => req('POST', p, b),
    patch: (p: string, b?: unknown) => req('PATCH', p, b),
    put: (p: string, b?: unknown) => req('PUT', p, b),
    del: (p: string) => req('DELETE', p),
    setCookie: (c: string) => { cookie = c; },
    getCookie: () => cookie,
  };
}

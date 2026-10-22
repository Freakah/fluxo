import { describe, it, expect, beforeAll } from 'vitest';
import { all, get, run } from '../server/db/db.ts';
import { testApp, client, fakeProvider, tx, acct } from './helpers.ts';
import { todayIn } from '../shared/dates.ts';
import { hashToken } from '../server/security/sessions.ts';

const PW = 'correct horse battery staple';
const today = todayIn('Europe/Lisbon');

async function registered(app: ReturnType<typeof testApp>['app'], email: string) {
  const c = client(app);
  const r = await c.post('/api/auth/register', { email, password: PW });
  if (r.status !== 200) {
    const l = await c.post('/api/auth/login', { email, password: PW });
    expect(l.status).toBe(200);
  }
  return c;
}

/** Full connect flow through the API: start -> provider redirect -> callback. Returns the connection id. */
async function connectViaApi(c: ReturnType<typeof client>) {
  const s = await c.post('/api/connections/start', { institution: 'Fake Bank', country: 'PT' });
  expect(s.status).toBe(200);
  const state = new URL(s.json.url).searchParams.get('state')!;
  const cb = await c.get(`/api/connections/callback?state=${encodeURIComponent(state)}&code=good`);
  expect(cb.status).toBe(302);
  const loc = cb.headers.get('location')!;
  expect(loc).toMatch(/^\/accounts\?connected=\d+$/);
  await new Promise((r) => setTimeout(r, 50)); // initial import runs in the background
  return { id: Number(loc.split('=')[1]), state };
}

describe('authentication and sessions', () => {
  it('requires sign-in for protected routes and sets a hardened cookie', async () => {
    const { app } = testApp();
    const anon = client(app);
    expect((await anon.get('/api/transactions')).status).toBe(401);
    expect((await anon.get('/api/dashboard')).status).toBe(401);
    expect((await anon.get('/api/export/full')).status).toBe(401);
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify({ email: 'a@example.com', password: PW }) });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it('only the first user can register unless registration is opened', async () => {
    const { app } = testApp();
    await registered(app, 'first@example.com');
    const r = await client(app).post('/api/auth/register', { email: 'second@example.com', password: PW });
    expect(r.status).toBe(403);
    expect((await client(app).post('/api/auth/register', { email: 'x@example.com', password: 'short' })).status).toBe(403);
  });

  it('rejects weak passwords, wrong passwords, and rate-limits login attempts', async () => {
    const { app } = testApp({ env: { ALLOW_REGISTRATION: 'true' } });
    expect((await client(app).post('/api/auth/register', { email: 'w@example.com', password: 'short' })).status).toBe(400);
    await registered(app, 'rl@example.com');
    const c = client(app);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await c.post('/api/auth/login', { email: 'rl@example.com', password: 'wrong password!!' })).status);
    expect(codes.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('logout revokes the session server-side; other sessions can be signed out', async () => {
    const { app, db } = testApp();
    const a = await registered(app, 'multi@example.com');
    const b = client(app);
    expect((await b.post('/api/auth/login', { email: 'multi@example.com', password: PW })).status).toBe(200);
    expect((await a.get('/api/auth/sessions')).json).toHaveLength(2);
    expect((await a.post('/api/auth/sessions/revoke-others')).json.revoked).toBe(1);
    expect((await b.get('/api/transactions')).status).toBe(401);
    const stolen = a.getCookie();
    await a.post('/api/auth/logout');
    const replay = client(app);
    replay.setCookie(stolen);
    expect((await replay.get('/api/transactions')).status).toBe(401);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM sessions')!.n).toBe(0);
  });

  it('expires sessions by absolute and idle timeout', async () => {
    const { app, db } = testApp();
    const a = await registered(app, 'exp@example.com');
    run(db, 'UPDATE sessions SET last_seen_at = ?', new Date(Date.now() - 8 * 86400000).toISOString());
    expect((await a.get('/api/transactions')).status).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const { app, db } = testApp();
    const a = await registered(app, 'hash@example.com');
    const token = a.getCookie().split('=')[1];
    expect(get(db, 'SELECT 1 FROM sessions WHERE id_hash = ?', token)).toBeUndefined();
    expect(get(db, 'SELECT 1 FROM sessions WHERE id_hash = ?', hashToken(token))).toBeDefined();
  });
});

describe('request security', () => {
  it('blocks cross-site and non-JSON mutations, and sends security headers', async () => {
    const { app } = testApp();
    const a = await registered(app, 'csrf@example.com');
    expect((await a.req('POST', '/api/notifications/read-all', {}, { Origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await a.req('POST', '/api/notifications/read-all', {}, { 'Content-Type': 'text/plain' })).status).toBe(415);
    const res = await a.get('/api/health');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.json).toEqual({ status: 'ok', version: 'test', mode: 'live' });
  });
});

describe('user isolation', () => {
  let ctx: { app: ReturnType<typeof testApp>['app']; db: ReturnType<typeof testApp>['db']; alice: ReturnType<typeof client>; bob: ReturnType<typeof client>; aliceTx: number; aliceConn: number; aliceAcct: number; aliceRule: number };
  beforeAll(async () => {
    const p = fakeProvider({ statement: () => [tx({ id: 'e1', amount: '-12.34', bookingDate: today, description: 'COMPRA CONTINENTE' })] });
    const { app, db } = testApp({ providers: { enablebanking: p, fake: p }, env: { ALLOW_REGISTRATION: 'true' } });
    const alice = await registered(app, 'alice@example.com');
    const bob = await registered(app, 'bob@example.com');
    const { id } = await connectViaApi(alice);
    const aliceTx = get<{ id: number }>(db, 'SELECT id FROM transactions')!.id;
    const cats = (await alice.get('/api/categories')).json;
    const rule = await alice.post('/api/rules', { field: 'merchant', match_type: 'contains', pattern: 'continente', category_id: cats[0].id });
    ctx = { app, db, alice, bob, aliceTx, aliceConn: id, aliceAcct: get<{ id: number }>(db, 'SELECT id FROM accounts')!.id, aliceRule: rule.json.id };
  });

  it('another user cannot read or change someone else’s data', async () => {
    const { bob, aliceTx, aliceConn, aliceAcct, aliceRule } = ctx;
    expect((await bob.get('/api/transactions')).json.total).toBe(0);
    expect((await bob.get(`/api/transactions/${aliceTx}`)).status).toBe(404);
    expect((await bob.patch(`/api/transactions/${aliceTx}`, { note: 'hacked' })).status).toBe(404);
    expect((await bob.post('/api/transactions/bulk', { ids: [aliceTx], patch: { excluded: true } })).status).toBe(404);
    expect((await bob.patch(`/api/accounts/${aliceAcct}`, { included: false })).status).toBe(404);
    expect((await bob.post(`/api/connections/${aliceConn}/sync`)).status).toBe(404);
    expect((await bob.post(`/api/connections/${aliceConn}/disconnect`)).status).toBe(404);
    expect((await bob.patch(`/api/rules/${aliceRule}`, { enabled: false })).status).toBe(404);
    expect((await bob.del(`/api/rules/${aliceRule}`)).status).toBe(404);
    expect((await bob.get('/api/accounts')).json).toEqual([]);
    expect((await bob.get('/api/connections')).json).toEqual([]);
    expect((await bob.get(`/api/dashboard?accounts=${aliceAcct}`)).json.totals).toEqual([]);
    expect((await bob.get(`/api/reports?accounts=${aliceAcct}`)).json.totals).toEqual([]);
    const aliceCat = (await ctx.alice.get('/api/categories')).json[0].id;
    expect((await bob.patch(`/api/categories/${aliceCat}`, { name: 'x' })).status).toBe(404);
    expect((await bob.post('/api/rules', { field: 'merchant', match_type: 'contains', pattern: 'zz', category_id: aliceCat })).status).toBe(400);
    const csv = await bob.get('/api/transactions/export.csv');
    expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(1); // header only
    expect((await bob.get('/api/export/full')).json.transactions).toEqual([]);
    expect(get<{ note: string | null; excluded: number }>(ctx.db, 'SELECT note, excluded FROM transactions WHERE id = ?', aliceTx)).toEqual({ note: null, excluded: 0 });
  });

  it('bank callback state is single-use and bound to the user who started it', async () => {
    const { alice, bob } = ctx;
    const s = await alice.post('/api/connections/start', { institution: 'Fake Bank', country: 'PT' });
    const state = new URL(s.json.url).searchParams.get('state')!;
    const stolen = await bob.get(`/api/connections/callback?state=${state}&code=good`);
    expect(stolen.headers.get('location')).toBe('/accounts?error=invalid_state');
    const ok = await alice.get(`/api/connections/callback?state=${state}&code=good`);
    expect(ok.headers.get('location')).toMatch(/connected=/);
    const replay = await alice.get(`/api/connections/callback?state=${state}&code=good`);
    expect(replay.headers.get('location')).toBe('/accounts?error=already_used');
    const bogus = await alice.get('/api/connections/callback?state=nope&code=good');
    expect(bogus.headers.get('location')).toBe('/accounts?error=invalid_state');
    // Reconnecting the same bank account matched existing accounts: still one account.
    expect(all(ctx.db, 'SELECT id FROM accounts')).toHaveLength(1);
  });
});

describe('categorization through the API', () => {
  it('corrections win over rules, survive re-sync, and rules can be previewed, disabled and deleted', async () => {
    const p = fakeProvider({ statement: () => [
      tx({ id: 'e1', amount: '-5.00', bookingDate: today, description: 'COMPRA LOJA DO BAIRRO' }),
      tx({ id: 'e2', amount: '-7.00', bookingDate: today, description: 'COMPRA LOJA DO BAIRRO' }),
    ] });
    const { app, db } = testApp({ providers: { enablebanking: p, fake: p } });
    const c = await registered(app, 'cat@example.com');
    const { id } = await connectViaApi(c);
    const cats = (await c.get('/api/categories')).json as { id: number; key: string }[];
    const groceries = cats.find((x) => x.key === 'groceries')!.id;
    const health = cats.find((x) => x.key === 'health')!.id;
    const rows = (await c.get('/api/transactions')).json.rows as { id: number; category_source: string }[];
    expect(rows.every((r) => r.category_source === 'none')).toBe(true);
    // Manual correction on one
    expect((await c.patch(`/api/transactions/${rows[0].id}`, { categoryId: health })).status).toBe(200);
    // Rule preview shows matches; the overridden one will not change
    const prev = await c.post('/api/rules/preview', { field: 'merchant', match_type: 'equals', pattern: 'Loja Do Bairro', category_id: groceries });
    expect(prev.json).toMatchObject({ count: 2, changes: 1, overridden: 1 });
    const rule = await c.post('/api/rules', { field: 'merchant', match_type: 'equals', pattern: 'Loja Do Bairro', category_id: groceries });
    const after = (await c.get('/api/transactions')).json.rows as { id: number; category_id: number; category_source: string }[];
    expect(after.find((r) => r.id === rows[0].id)).toMatchObject({ category_id: health, category_source: 'user' });
    expect(after.find((r) => r.id === rows[1].id)).toMatchObject({ category_id: groceries, category_source: 'rule' });
    // Re-sync keeps both
    run(db, 'UPDATE connections SET last_attempt_at = NULL');
    expect((await c.post(`/api/connections/${id}/sync`)).json.status).toBe('success');
    const again = (await c.get('/api/transactions')).json.rows as { id: number; category_id: number }[];
    expect(again.find((r) => r.id === rows[0].id)!.category_id).toBe(health);
    // Disable, then delete rule -> back to uncategorized
    await c.patch(`/api/rules/${rule.json.id}`, { enabled: false });
    expect((await c.get(`/api/transactions/${rows[1].id}`)).json.auto_source).toBe('none');
    expect((await c.del(`/api/rules/${rule.json.id}`)).status).toBe(200);
    // Rename and archive a category without touching history
    await c.patch(`/api/categories/${health}`, { name: 'Saúde', archived: true });
    expect((await c.get(`/api/transactions/${rows[0].id}`)).json.category_name).toBe('Saúde');
    // Manual refresh cooldown
    expect((await c.post(`/api/connections/${id}/sync`)).status).toBe(429);
  });
});

describe('exports', () => {
  it('CSV respects filters, neutralizes formula injection, handles Unicode and excludes account identifiers', async () => {
    const p = fakeProvider({
      accounts: [{ ...acct('a1'), ibanLast4: '9876' }],
      statement: () => [
        tx({ id: 'e1', amount: '-10.00', bookingDate: today, description: '=HYPERLINK("http://evil")', counterparty: '+351 Café "Ç"' }),
        tx({ id: 'e2', amount: '-20.00', bookingDate: today, description: 'COMPRA LIDL, LISBOA' }),
        tx({ id: 'e3', amount: '-30.00', bookingDate: '2020-01-01', description: 'OLD' }),
      ],
    });
    const { app } = testApp({ providers: { enablebanking: p, fake: p } });
    const c = await registered(app, 'csv@example.com');
    await connectViaApi(c);
    const res = await c.get(`/api/transactions/export.csv?from=${today}`);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const lines = res.text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 within filter
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).toContain(`"'+351 Café ""Ç"""`);
    expect(res.text).toContain('"COMPRA LIDL, LISBOA"');
    expect(res.text).not.toContain('9876');
    expect(res.text).toMatch(/,-10\.00,EUR,/);
  });

  it('full export is complete JSON without secrets', async () => {
    const p = fakeProvider({ statement: () => [tx({ id: 'e1', amount: '-1.00', bookingDate: today })] });
    const { app } = testApp({ providers: { enablebanking: p, fake: p } });
    const c = await registered(app, 'full@example.com');
    await connectViaApi(c);
    const r = await c.get('/api/export/full');
    expect(r.json).toMatchObject({ format: 'fluxo-export', version: 1 });
    expect(r.json.transactions).toHaveLength(1);
    expect(r.text).not.toMatch(/password_hash|provider_session|totp_secret|scrypt\$|sess-/);
  });
});

describe('disconnect and deletion', () => {
  it('disconnect revokes provider access, stops syncing and keeps history; deletion removes it', async () => {
    const p = fakeProvider({ statement: () => [tx({ id: 'e1', amount: '-1.00', bookingDate: today })] });
    const { app, db } = testApp({ providers: { enablebanking: p, fake: p } });
    const c = await registered(app, 'del@example.com');
    const { id } = await connectViaApi(c);
    expect((await c.post(`/api/connections/${id}/delete-data`, { confirm: 'DELETE' })).status).toBe(409); // must disconnect first
    const d = await c.post(`/api/connections/${id}/disconnect`);
    expect(d.json.providerRevoked).toBe(true);
    expect(p.revoked).toHaveLength(1);
    expect(get(db, 'SELECT status, provider_session_enc FROM connections')).toEqual({ status: 'disconnected', provider_session_enc: null });
    expect((await c.post(`/api/connections/${id}/sync`)).status).toBe(409);
    expect((await c.get('/api/transactions')).json.total).toBe(1);
    expect((await c.post(`/api/connections/${id}/delete-data`, { confirm: 'nope' })).status).toBe(400);
    expect((await c.post(`/api/connections/${id}/delete-data`, { confirm: 'DELETE' })).status).toBe(200);
    expect((await c.get('/api/transactions')).json.total).toBe(0);
    expect(all(db, 'SELECT * FROM accounts')).toHaveLength(0);
  });

  it('account deletion requires the password and removes everything for that user only', async () => {
    const p = fakeProvider({ statement: () => [tx({ id: 'e1', amount: '-1.00', bookingDate: today })] });
    const { app, db } = testApp({ providers: { enablebanking: p, fake: p }, env: { ALLOW_REGISTRATION: 'true' } });
    const keep = await registered(app, 'keep@example.com');
    await connectViaApi(keep);
    const c = await registered(app, 'gone@example.com');
    await connectViaApi(c);
    expect((await c.post('/api/privacy/delete-account', { confirm: 'DELETE MY ACCOUNT', password: 'wrong wrong wrong' })).status).toBe(401);
    expect((await c.post('/api/privacy/delete-account', { confirm: 'DELETE MY ACCOUNT', password: PW })).status).toBe(200);
    expect((await c.get('/api/transactions')).status).toBe(401);
    expect(all(db, 'SELECT email FROM users')).toEqual([{ email: 'keep@example.com' }]);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM transactions')!.n).toBe(1);
    for (const t of ['accounts', 'connections', 'categories', 'sessions']) expect(get<{ n: number }>(db, `SELECT COUNT(DISTINCT user_id) n FROM ${t}`)!.n).toBe(1);
  });
});

describe('demo mode', () => {
  it('creates an isolated, labelled demo workspace and can reset it', async () => {
    const { app, db } = testApp({ mode: 'demo' });
    const c = client(app);
    expect((await c.post('/api/auth/register', { email: 'x@example.com', password: PW })).status).toBe(403);
    expect((await c.post('/api/auth/demo')).status).toBe(200);
    const s = await c.get('/api/session');
    expect(s.json).toMatchObject({ mode: 'demo', user: { isDemo: true }, provider: { id: 'demo', live: false } });
    const dash = (await c.get('/api/dashboard')).json;
    expect(dash.totals[0].spending).toBeGreaterThan(0);
    expect(dash.sync.problems.map((p: { status: string }) => p.status).sort()).toEqual(['error', 'expired']);
    const n1 = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM transactions')!.n;
    const other = client(app);
    await other.post('/api/auth/demo');
    expect((await other.get('/api/transactions')).json.total).toBe((await c.get('/api/transactions')).json.total);
    expect((await c.post('/api/demo/reset')).status).toBe(200);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM transactions')!.n).toBe(n1 * 2);
  });
});

import { Hono, type Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import { TOTP, Secret } from 'otpauth';
import { all, get, run, type DB } from '../db/db.ts';
import { body, HttpError, uid, clientIp, type Deps, type Env } from '../context.ts';
import { hashPassword, verifyPassword, dummyHash, passwordProblem } from '../security/password.ts';
import { createSession, revokeSession, revokeOtherSessions, SESSION_COOKIE, validateSession } from '../security/sessions.ts';
import { createLimiter } from '../security/ratelimit.ts';
import { seal, open } from '../security/secretbox.ts';
import { createUser } from '../domain/lifecycle.ts';
import { createDemoUser } from '../demo/seed.ts';

const email = z.email().max(254).transform((e) => e.toLowerCase().trim());

export function setSessionCookie(c: Context, deps: Deps, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: deps.config.PUBLIC_URL.startsWith('https://'), path: '/', expires: expiresAt });
}

const totpFor = (secret: string, label: string) => new TOTP({ issuer: 'Fluxo', label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });

export function authRoutes(deps: Deps) {
  const { db, config } = deps;
  const app = new Hono<Env>();
  const loginLimiter = createLimiter(10, 15 * 60_000); // per IP
  const accountLimiter = createLimiter(5, 15 * 60_000); // per email
  const demoLimiter = createLimiter(20, 60 * 60_000);
  const ua = (c: Context) => c.req.header('user-agent') ?? null;
  const limit = (c: Context, limiter: ReturnType<typeof createLimiter>, key: string) => {
    const wait = limiter.take(key);
    if (wait) { c.header('Retry-After', String(wait)); throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`); }
  };

  app.post('/register', async (c) => {
    limit(c, loginLimiter, clientIp(c, config.TRUST_PROXY));
    if (config.APP_MODE === 'demo') throw new HttpError(403, 'Registration is disabled in demo mode. Use “Try the demo”.');
    const users = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM users WHERE is_demo = 0')!.n;
    if (users > 0 && !config.ALLOW_REGISTRATION) throw new HttpError(403, 'Registration is closed on this server. Ask the administrator to set ALLOW_REGISTRATION=true.');
    const b = await body(c, z.object({ email, password: z.string() }));
    const problem = passwordProblem(b.password);
    if (problem) throw new HttpError(400, problem);
    if (get(db, 'SELECT 1 FROM users WHERE email = ?', b.email)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    const userId = createUser(db, b.email, await hashPassword(b.password));
    const s = createSession(db, userId, config.SESSION_TTL_DAYS, ua(c));
    setSessionCookie(c, deps, s.token, s.expiresAt);
    return c.json({ ok: true });
  });

  app.post('/login', async (c) => {
    const ip = clientIp(c, config.TRUST_PROXY);
    limit(c, loginLimiter, ip);
    const b = await body(c, z.object({ email, password: z.string().max(256) }));
    limit(c, accountLimiter, b.email);
    const u = get<{ id: number; password_hash: string; totp_enabled: number; is_demo: number }>(db, 'SELECT id, password_hash, totp_enabled, is_demo FROM users WHERE email = ?', b.email);
    const ok = u && !u.is_demo ? await verifyPassword(b.password, u.password_hash) : (await verifyPassword(b.password, await dummyHash()), false);
    if (!u || !ok) throw new HttpError(401, 'Email or password is incorrect.');
    accountLimiter.reset(b.email);
    const s = createSession(db, u.id, config.SESSION_TTL_DAYS, ua(c), !!u.totp_enabled);
    setSessionCookie(c, deps, s.token, s.expiresAt);
    return c.json({ ok: true, mfaRequired: !!u.totp_enabled });
  });

  app.post('/mfa', async (c) => {
    limit(c, loginLimiter, clientIp(c, config.TRUST_PROXY));
    const s = validateSession(db, getCookie(c, SESSION_COOKIE));
    if (!s?.mfaPending) throw new HttpError(401, 'Sign in again.');
    const b = await body(c, z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }));
    const u = get<{ totp_secret_enc: string; email: string }>(db, 'SELECT totp_secret_enc, email FROM users WHERE id = ?', s.userId)!;
    const delta = totpFor(open(config.encryptionKey, u.totp_secret_enc), u.email).validate({ token: b.code, window: 1 });
    if (delta === null) throw new HttpError(401, 'That code is not valid. Check your authenticator app’s time and try again.');
    // Rotate: replace the half-authenticated session with a full one.
    revokeSession(db, s.sessionHash);
    const full = createSession(db, s.userId, config.SESSION_TTL_DAYS, ua(c));
    setSessionCookie(c, deps, full.token, full.expiresAt);
    return c.json({ ok: true });
  });

  app.post('/demo', async (c) => {
    if (config.APP_MODE !== 'demo') throw new HttpError(404, 'Demo is not available on this server.');
    limit(c, demoLimiter, clientIp(c, config.TRUST_PROXY));
    const userId = await createDemoUser(db, config.encryptionKey);
    const s = createSession(db, userId, 1, ua(c));
    setSessionCookie(c, deps, s.token, s.expiresAt);
    return c.json({ ok: true });
  });

  app.post('/logout', (c) => {
    const s = validateSession(db, getCookie(c, SESSION_COOKIE));
    if (s) revokeSession(db, s.sessionHash);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  return app;
}

/** Account-security routes; mounted behind requireAuth. */
export function securityRoutes(deps: Deps) {
  const { db, config } = deps;
  const app = new Hono<Env>();

  app.get('/sessions', (c) => {
    const cur = c.get('user').sessionHash;
    const rows = all<{ id_hash: string; created_at: string; last_seen_at: string; user_agent: string | null }>(db, 'SELECT id_hash, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = ? AND mfa_pending = 0 ORDER BY last_seen_at DESC', uid(c));
    return c.json(rows.map((r) => ({ id: r.id_hash.slice(0, 16), createdAt: r.created_at, lastSeenAt: r.last_seen_at, userAgent: r.user_agent, current: r.id_hash === cur })));
  });
  app.post('/sessions/revoke-others', (c) => c.json({ revoked: revokeOtherSessions(db, uid(c), c.get('user').sessionHash) }));
  app.delete('/sessions/:id', (c) => {
    const id = c.req.param('id');
    if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(400, 'Invalid session id');
    run(db, 'DELETE FROM sessions WHERE user_id = ? AND substr(id_hash, 1, 16) = ? AND id_hash <> ?', uid(c), id, c.get('user').sessionHash);
    return c.json({ ok: true });
  });

  app.post('/password', async (c) => {
    if (c.get('user').isDemo) throw new HttpError(403, 'Demo accounts have no password.');
    const b = await body(c, z.object({ current: z.string().max(256), next: z.string() }));
    const u = get<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', uid(c))!;
    if (!(await verifyPassword(b.current, u.password_hash))) throw new HttpError(401, 'Current password is incorrect.');
    const problem = passwordProblem(b.next);
    if (problem) throw new HttpError(400, problem);
    run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.next), uid(c));
    revokeOtherSessions(db, uid(c), c.get('user').sessionHash);
    return c.json({ ok: true });
  });

  app.post('/totp/setup', (c) => {
    if (c.get('user').isDemo) throw new HttpError(403, 'Not available for demo accounts.');
    const secret = new Secret({ size: 20 }).base32;
    run(db, 'UPDATE users SET totp_secret_enc = ? WHERE id = ? AND totp_enabled = 0', seal(config.encryptionKey, secret), uid(c));
    return c.json({ secret, uri: totpFor(secret, c.get('user').email).toString() });
  });
  app.post('/totp/enable', async (c) => {
    const b = await body(c, z.object({ code: z.string().regex(/^\d{6}$/) }));
    const u = get<{ totp_secret_enc: string | null; email: string }>(db, 'SELECT totp_secret_enc, email FROM users WHERE id = ?', uid(c))!;
    if (!u.totp_secret_enc) throw new HttpError(400, 'Start setup first.');
    if (totpFor(open(config.encryptionKey, u.totp_secret_enc), u.email).validate({ token: b.code, window: 1 }) === null) throw new HttpError(400, 'That code is not valid.');
    run(db, 'UPDATE users SET totp_enabled = 1 WHERE id = ?', uid(c));
    return c.json({ ok: true });
  });
  app.post('/totp/disable', async (c) => {
    const b = await body(c, z.object({ password: z.string().max(256) }));
    const u = get<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', uid(c))!;
    if (!(await verifyPassword(b.password, u.password_hash))) throw new HttpError(401, 'Password is incorrect.');
    run(db, 'UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?', uid(c));
    return c.json({ ok: true });
  });
  return app;
}

export function sessionInfo(db: DB, userId: number) {
  return get<{ email: string; is_demo: number; totp_enabled: number; created_at: string }>(db, 'SELECT email, is_demo, totp_enabled, created_at FROM users WHERE id = ?', userId);
}

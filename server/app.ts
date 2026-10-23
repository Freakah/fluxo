import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { get } from './db/db.ts';
import { HttpError, type Deps, type Env } from './context.ts';
import { validateSession, SESSION_COOKIE } from './security/sessions.ts';
import { authRoutes, securityRoutes, sessionInfo } from './routes/auth.ts';
import { dataRoutes } from './routes/data.ts';
import { bankRoutes } from './routes/bank.ts';
import { insightRoutes } from './routes/insights.ts';
import { privacyRoutes } from './routes/privacy.ts';
import { userSettings } from './domain/notifications.ts';
import { log } from './log.ts';
import { AmountError } from '../shared/money.ts';

const AMOUNT_ERROR = 'That amount is not valid: it is too large or has more decimals than your currency allows.';

const WEB_DIST = path.resolve(import.meta.dirname, '../web/dist');

export function createApp(deps: Deps) {
  const { db, config } = deps;
  const app = new Hono<Env>();
  const origin = new URL(config.PUBLIC_URL).origin;

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
    },
    strictTransportSecurity: config.PUBLIC_URL.startsWith('https://') ? 'max-age=31536000; includeSubDomains' : false,
    referrerPolicy: 'same-origin',
    crossOriginEmbedderPolicy: false,
  }));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof AmountError) return c.json({ error: AMOUNT_ERROR }, 400);
    log.error('unhandled error', { path: c.req.path, err: err instanceof Error ? err.message : 'unknown' });
    return c.json({ error: 'Something went wrong on the server. Your data was not changed by this request. Try again; if it persists, see the troubleshooting guide.' }, 500);
  });

  // API responses contain financial data: never cache. Mutations must be same-origin JSON (CSRF defence
  // on top of SameSite=Lax cookies: cross-site pages cannot send JSON without a CORS preflight we never allow).
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const o = c.req.header('origin');
      if ((o && o !== origin) || c.req.header('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-site request blocked.');
      const ct = c.req.header('content-type') ?? '';
      if (!ct.startsWith('application/json')) throw new HttpError(415, 'Requests must use application/json.');
    }
    await next();
  });

  app.get('/api/health', (c) => {
    try { get(db, 'SELECT 1'); } catch { return c.json({ status: 'error', db: 'unavailable' }, 503); }
    return c.json({ status: 'ok', version: deps.version, mode: config.APP_MODE });
  });

  app.get('/api/session', (c) => {
    const s = validateSession(db, getCookie(c, SESSION_COOKIE));
    const anyUser = !!get(db, 'SELECT 1 FROM users WHERE is_demo = 0 LIMIT 1');
    const base = {
      mode: config.APP_MODE, version: deps.version,
      registrationOpen: config.APP_MODE === 'live' && (!anyUser || config.ALLOW_REGISTRATION),
      provider: config.APP_MODE === 'demo' ? { id: 'demo', label: 'Simulated bank (demo)', live: false } : deps.providers.enablebanking ? { id: 'enablebanking', label: deps.providers.enablebanking.label, live: deps.providers.enablebanking.live } : null,
    };
    if (!s) return c.json({ ...base, user: null });
    if (s.mfaPending) return c.json({ ...base, user: null, mfaPending: true });
    const u = sessionInfo(db, s.userId)!;
    return c.json({ ...base, user: { email: s.isDemo ? 'Demo user' : u.email, isDemo: s.isDemo, totpEnabled: !!u.totp_enabled, createdAt: u.created_at, settings: userSettings(db, s.userId) } });
  });

  app.route('/api/auth', authRoutes(deps));

  app.use('/api/*', async (c, next) => {
    const s = validateSession(db, getCookie(c, SESSION_COOKIE));
    if (!s || s.mfaPending) {
      if (c.req.method === 'GET' && c.req.path === '/api/connections/callback') return c.redirect('/?error=signin_required', 302);
      throw new HttpError(401, 'Please sign in.');
    }
    c.set('user', s);
    await next();
  });
  app.route('/api/auth', securityRoutes(deps));
  app.route('/api', dataRoutes(deps));
  app.route('/api', bankRoutes(deps));
  app.route('/api', insightRoutes(deps));
  app.route('/api', privacyRoutes(deps));
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  if (fs.existsSync(WEB_DIST)) {
    const root = path.relative(process.cwd(), WEB_DIST) || '.';
    app.use('/assets/*', async (c, next) => { await next(); c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
    app.use('*', serveStatic({ root }));
    const indexHtml = fs.readFileSync(path.join(WEB_DIST, 'index.html'), 'utf8');
    app.get('*', (c) => { c.header('Cache-Control', 'no-cache'); return c.html(indexHtml); });
  }
  return app;
}

// Dashboard, budgets, recurring payments, reports, notifications and preferences.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { all, get, run, nowIso } from '../db/db.ts';
import { body, HttpError, uid, type Deps, type Env } from '../context.ts';
import { totals, spendingByCategory, spendingByDay, byMonth, spendingByMerchant } from '../domain/aggregate.ts';
import { budgetStatus, budgetsFor, setBudget } from '../domain/budgets.ts';
import { monthlyEquivalent, type Frequency } from '../domain/recurring.ts';
import { checkBudgetAlerts, userSettings } from '../domain/notifications.ts';
import { TX_SELECT } from '../domain/txquery.ts';
import { addDays, addMonths, isDate, isMonth, monthBounds, monthOf, todayIn, daysBetween } from '../../shared/dates.ts';
import { mergeSettings } from '../../shared/settings.ts';
import { parseAmountToMinor } from '../../shared/money.ts';

const idsParam = (c: Context, userId: number, db: Deps['db']): number[] | null => {
  const raw = c.req.query('accounts');
  if (!raw) return null;
  if (!/^\d+(,\d+)*$/.test(raw)) throw new HttpError(400, 'Invalid accounts filter');
  const ids = raw.split(',').map(Number);
  const owned = all<{ id: number }>(db, `SELECT id FROM accounts WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, userId, ...ids).map((r) => r.id);
  return owned.length ? owned : [-1];
};

export function insightRoutes(deps: Deps) {
  const { db } = deps;
  const app = new Hono<Env>();
  const catMap = (userId: number) => new Map(all<{ id: number; name: string; color: string; key: string | null }>(db, 'SELECT id, name, color, key FROM categories WHERE user_id = ?', userId).map((c) => [c.id, c]));

  app.get('/dashboard', (c) => {
    const userId = uid(c);
    const s = userSettings(db, userId);
    const today = todayIn(s.timezone);
    const month = monthOf(today);
    const accountIds = idsParam(c, userId, db);
    const { from, to } = monthBounds(month);
    const prev = monthBounds(addMonths(month, -1));
    const cats = catMap(userId);
    const scope = { userId, accountIds, from, to };
    const dayOfMonth = +today.slice(8, 10);
    const daily = spendingByDay(db, scope).filter((d) => d.currency === s.currency);
    const prevDaily = spendingByDay(db, { ...scope, from: prev.from, to: prev.to }).filter((d) => d.currency === s.currency);
    const cumulative = (rows: { date: string; spending: number }[], days: number) => {
      let acc = 0; const out: number[] = [];
      for (let d = 1; d <= days; d++) { acc += rows.filter((r) => +r.date.slice(8, 10) === d).reduce((a, r) => a + r.spending, 0); out.push(acc); }
      return out;
    };
    const conns = all<{ id: number; institution_name: string; status: string; last_success_at: string | null; consent_expires_at: string | null; last_error_message: string | null; provider: string }>(db,
      'SELECT id, institution_name, status, last_success_at, consent_expires_at, last_error_message, provider FROM connections WHERE user_id = ?', userId);
    const problems = conns.filter((x) => ['error', 'expired', 'revoked'].includes(x.status) || (x.status === 'active' && x.consent_expires_at && Date.parse(x.consent_expires_at) - Date.now() < 14 * 86400000))
      .map((x) => ({ id: x.id, institution: x.institution_name, status: x.status, message: x.status === 'active' ? `Access expires on ${x.consent_expires_at!.slice(0, 10)}. Reconnect to keep syncing.` : x.last_error_message }));
    const upcoming = all<{ id: number; merchant: string; kind: string; frequency: string; typical_amount_minor: number; user_amount_minor: number | null; currency: string; next_date: string; status: string; confidence: string }>(db,
      "SELECT id, merchant, kind, COALESCE(user_frequency, frequency) frequency, typical_amount_minor, user_amount_minor, currency, next_date, status, confidence FROM recurring WHERE user_id = ? AND status IN ('confirmed','suggested') AND next_date BETWEEN ? AND ? ORDER BY next_date LIMIT 8",
      userId, today, addDays(today, 30));
    const accountsSql = accountIds ? `AND id IN (${accountIds.map(() => '?').join(',')})` : '';
    return c.json({
      today, month, currency: s.currency, accountIds,
      totals: totals(db, scope),
      budget: budgetStatus(db, userId, month, s.currency, s.budgetThresholds).total,
      balances: all(db, `SELECT id, name, display_name, kind, currency, balance_minor, balance_label, balance_at, included FROM accounts WHERE user_id = ? ${accountsSql} ORDER BY id`, userId, ...(accountIds ?? [])),
      byCategory: spendingByCategory(db, scope).map((r) => ({ ...r, name: cats.get(r.categoryId ?? -1)?.name ?? 'Uncategorized', color: cats.get(r.categoryId ?? -1)?.color ?? '#9e9e9e' })),
      trend: { days: monthBounds(month).days, dayOfMonth, current: cumulative(daily, dayOfMonth), previous: cumulative(prevDaily, prev.days) },
      recent: all(db, `${TX_SELECT} WHERE t.user_id = ? ${accountIds ? `AND t.account_id IN (${accountIds.map(() => '?').join(',')})` : ''} ORDER BY t.booking_date DESC, t.id DESC LIMIT 8`, userId, ...(accountIds ?? [])),
      upcoming,
      sync: { lastSuccess: conns.map((x) => x.last_success_at).filter(Boolean).sort().pop() ?? null, connections: conns.length, problems },
      unreadNotifications: get<{ n: number }>(db, 'SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)!.n,
    });
  });

  // ---- Budgets
  app.get('/budgets', (c) => {
    const userId = uid(c);
    const s = userSettings(db, userId);
    const month = c.req.query('month') ?? monthOf(todayIn(s.timezone));
    if (!isMonth(month)) throw new HttpError(400, 'month must be YYYY-MM');
    const st = budgetStatus(db, userId, month, s.currency, s.budgetThresholds);
    const cats = catMap(userId);
    return c.json({ month, currency: s.currency, thresholds: s.budgetThresholds, isCurrentMonth: month === monthOf(todayIn(s.timezone)),
      total: st.total, categories: st.categories.map((l) => ({ ...l, name: cats.get(l.categoryId!)?.name, color: cats.get(l.categoryId!)?.color })) });
  });

  app.put('/budgets', async (c) => {
    const b = await body(c, z.object({ categoryId: z.number().int().nullable(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable() }));
    const userId = uid(c);
    const s = userSettings(db, userId);
    if (b.categoryId !== null && !get(db, 'SELECT 1 FROM categories WHERE id = ? AND user_id = ?', b.categoryId, userId)) throw new HttpError(400, 'Unknown category');
    // Changes apply to the current month and later; past months keep their budget.
    setBudget(db, userId, b.categoryId, s.currency, b.amount === null ? null : parseAmountToMinor(b.amount, s.currency), monthOf(todayIn(s.timezone)));
    checkBudgetAlerts(db, userId);
    return c.json({ ok: true });
  });

  // ---- Recurring
  app.get('/recurring', (c) => {
    const userId = uid(c);
    const today = todayIn(userSettings(db, userId).timezone);
    const rows = all<{ id: number; frequency: Frequency; user_frequency: Frequency | null; typical_amount_minor: number; user_amount_minor: number | null; next_date: string | null; last_date: string; status: string }>(db,
      'SELECT * FROM recurring WHERE user_id = ? ORDER BY status = \'dismissed\', next_date', userId);
    return c.json(rows.map((r) => {
      const f = r.user_frequency ?? r.frequency;
      const amt = r.user_amount_minor ?? r.typical_amount_minor;
      const gap = f === 'weekly' ? 7 : f === 'monthly' ? 31 : f === 'quarterly' ? 92 : 366;
      return { ...r, effective_frequency: f, effective_amount_minor: amt, monthly_equivalent_minor: monthlyEquivalent(amt, f), possibly_ended: daysBetween(r.last_date, today) > gap * 1.5 };
    }));
  });

  app.patch('/recurring/:id', async (c) => {
    const b = await body(c, z.object({
      status: z.enum(['suggested', 'confirmed', 'dismissed', 'inactive']).optional(),
      kind: z.enum(['subscription', 'bill', 'income', 'other']).nullable().optional(),
      frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annual']).nullable().optional(),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    }).strict());
    const id = Number(c.req.param('id'));
    const r = get<{ currency: string }>(db, 'SELECT currency FROM recurring WHERE id = ? AND user_id = ?', id, uid(c));
    if (!r) throw new HttpError(404, 'Not found');
    if (b.status) run(db, 'UPDATE recurring SET status = ?, updated_at = ? WHERE id = ?', b.status, nowIso(), id);
    if (b.kind !== undefined) run(db, 'UPDATE recurring SET user_kind = ?, kind = COALESCE(?, kind) WHERE id = ?', b.kind, b.kind, id);
    if (b.frequency !== undefined) run(db, 'UPDATE recurring SET user_frequency = ? WHERE id = ?', b.frequency, id);
    if (b.amount !== undefined) run(db, 'UPDATE recurring SET user_amount_minor = ? WHERE id = ?', b.amount === null ? null : parseAmountToMinor(b.amount, r.currency), id);
    return c.json({ ok: true });
  });

  // ---- Reports
  app.get('/reports', (c) => {
    const userId = uid(c);
    const s = userSettings(db, userId);
    const today = todayIn(s.timezone);
    const to = c.req.query('to') ?? today;
    const from = c.req.query('from') ?? `${addMonths(monthOf(today), -11)}-01`;
    if (!isDate(from) || !isDate(to) || from > to) throw new HttpError(400, 'Invalid date range');
    if (daysBetween(from, to) > 3700) throw new HttpError(400, 'Date range too long (max ~10 years)');
    const accountIds = idsParam(c, userId, db);
    const scope = { userId, accountIds, from, to };
    const cats = catMap(userId);
    const months = byMonth(db, scope);
    // Budget vs actual per month (primary currency, all included accounts — budgets are not per account).
    const budgetVsActual: { month: string; budget: number | null; actual: number }[] = [];
    for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) {
      const b = budgetsFor(db, userId, m, s.currency).get(null) ?? null;
      const mb = monthBounds(m);
      const actual = totals(db, { userId, from: mb.from, to: mb.to }).find((t) => t.currency === s.currency)?.spending ?? 0;
      budgetVsActual.push({ month: m, budget: b, actual });
    }
    const rec = all<{ kind: string; currency: string; frequency: Frequency; user_frequency: Frequency | null; typical_amount_minor: number; user_amount_minor: number | null }>(db,
      "SELECT kind, currency, frequency, user_frequency, typical_amount_minor, user_amount_minor FROM recurring WHERE user_id = ? AND status = 'confirmed'", userId);
    const commitments: Record<string, Record<string, number>> = {};
    for (const r of rec) {
      const k = (commitments[r.currency] ??= {});
      k[r.kind] = (k[r.kind] ?? 0) + monthlyEquivalent(r.user_amount_minor ?? r.typical_amount_minor, r.user_frequency ?? r.frequency);
    }
    return c.json({
      from, to, currency: s.currency, accountIds,
      totals: totals(db, scope),
      byCategory: spendingByCategory(db, scope).map((r) => ({ ...r, name: cats.get(r.categoryId ?? -1)?.name ?? 'Uncategorized', color: cats.get(r.categoryId ?? -1)?.color ?? '#9e9e9e' })),
      byMonth: months, merchants: spendingByMerchant(db, scope), budgetVsActual, commitments,
    });
  });

  // ---- Notifications
  app.get('/notifications', (c) => c.json(all(db, 'SELECT id, kind, title, body, link, severity, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', uid(c))));
  app.post('/notifications/:id/read', (c) => { run(db, 'UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?', nowIso(), Number(c.req.param('id')), uid(c)); return c.json({ ok: true }); });
  app.post('/notifications/:id/unread', (c) => { run(db, 'UPDATE notifications SET read_at = NULL WHERE id = ? AND user_id = ?', Number(c.req.param('id')), uid(c)); return c.json({ ok: true }); });
  app.post('/notifications/read-all', (c) => { run(db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), uid(c)); return c.json({ ok: true }); });

  // ---- Preferences
  const settingsSchema = z.object({
    locale: z.enum(['en-PT', 'en-GB', 'en-US', 'pt-PT']).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    timezone: z.string().max(64).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone').optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    hideAmounts: z.boolean().optional(),
    budgetThresholds: z.array(z.number().int().min(1).max(200)).min(1).max(4).optional(),
    notify: z.object({ budget: z.boolean(), sync: z.boolean(), consent: z.boolean(), recurring: z.boolean() }).partial().optional(),
  }).strict();
  app.put('/me/settings', async (c) => {
    const b = await body(c, settingsSchema);
    const cur = userSettings(db, uid(c));
    const next = mergeSettings({ ...cur, ...b, notify: { ...cur.notify, ...(b.notify ?? {}) } });
    run(db, 'UPDATE users SET settings_json = ? WHERE id = ?', JSON.stringify(next), uid(c));
    return c.json(next);
  });

  return app;
}

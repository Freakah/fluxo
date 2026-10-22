// Plain-language highlights computed locally: "unusual" hints, the monthly recap and balance history.
// Nothing here leaves the server; the web app turns these numbers into sentences.
import { all, get, type DB } from '../db/db.ts';
import { spendingByCategory, spendingByMerchant, totals } from './aggregate.ts';
import { budgetStatus } from './budgets.ts';
import { addDays, addMonths, monthBounds, monthOf } from '../../shared/dates.ts';

export type Hint =
  | { kind: 'category_up'; categoryId: number | null; current: number; usual: number; pct: number }
  | { kind: 'price_up'; merchant: string; from: number; to: number; currency: string };

/** At most 2 hints: a category already above its usual full month, and subscription price rises. */
export function hints(db: DB, userId: number, today: string, currency: string): Hint[] {
  const month = monthOf(today);
  const cur = new Map(spendingByCategory(db, { userId, from: `${month}-01`, to: today }).filter((r) => r.currency === currency).map((r) => [r.categoryId, r.spending]));
  const past = [1, 2, 3].map((n) => monthBounds(addMonths(month, -n)))
    .map((b) => new Map(spendingByCategory(db, { userId, from: b.from, to: b.to }).filter((r) => r.currency === currency).map((r) => [r.categoryId, r.spending])));
  const out: Hint[] = [];
  const cats: Extract<Hint, { kind: 'category_up' }>[] = [];
  for (const [categoryId, current] of cur) {
    const months = past.filter((m) => (m.get(categoryId) ?? 0) > 0);
    if (months.length < 2) continue; // not enough history to call anything "usual"
    const usual = Math.round(past.reduce((a, m) => a + (m.get(categoryId) ?? 0), 0) / 3);
    // Month-to-date already 30% and €20 above a whole usual month: genuinely unusual, not just early-month noise.
    if (usual > 0 && current * 10 > usual * 13 && current - usual >= 2000) cats.push({ kind: 'category_up', categoryId, current, usual, pct: Math.round((current / usual - 1) * 100) });
  }
  cats.sort((a, b) => b.current - b.usual - (a.current - a.usual));
  if (cats[0]) out.push(cats[0]);

  const subs = all<{ merchant: string; currency: string }>(db, "SELECT merchant, currency FROM recurring WHERE user_id = ? AND status IN ('confirmed','suggested') AND direction = 'out'", userId);
  for (const r of subs) {
    const last = all<{ amount_minor: number; booking_date: string }>(db, `SELECT amount_minor, booking_date FROM transactions WHERE user_id = ? AND merchant = ? AND currency = ? AND status = 'posted'
      AND COALESCE(type_override, auto_type) = 'expense' ORDER BY booking_date DESC, id DESC LIMIT 2`, userId, r.merchant, r.currency);
    if (last.length < 2 || last[0].booking_date < addDays(today, -45)) continue;
    const [to, from] = [-last[0].amount_minor, -last[1].amount_minor];
    if (to * 100 > from * 102 && to - from >= 50) { out.push({ kind: 'price_up', merchant: r.merchant, from, to, currency: r.currency }); break; }
  }
  return out.slice(0, 2);
}

/** Summary of a finished month for the recap story. */
export function recap(db: DB, userId: number, month: string, currency: string, thresholds: number[]) {
  const b = monthBounds(month), p = monthBounds(addMonths(month, -1));
  const t = totals(db, { userId, from: b.from, to: b.to }).find((x) => x.currency === currency);
  const pt = totals(db, { userId, from: p.from, to: p.to }).find((x) => x.currency === currency);
  const cats = spendingByCategory(db, { userId, from: b.from, to: b.to }).filter((r) => r.currency === currency);
  const prevCats = new Map(spendingByCategory(db, { userId, from: p.from, to: p.to }).filter((r) => r.currency === currency).map((r) => [r.categoryId, r.spending]));
  const changes = cats.map((c) => ({ categoryId: c.categoryId, current: c.spending, previous: prevCats.get(c.categoryId) ?? 0 }))
    .filter((c) => c.previous > 0).sort((a, b2) => Math.abs(b2.current - b2.previous) - Math.abs(a.current - a.previous));
  // "Most visited": most payments, not most money (rent would always win that).
  const merchant = spendingByMerchant(db, { userId, from: b.from, to: b.to }, 25).filter((m) => m.currency === currency && m.spending > 0)
    .sort((a, b2) => b2.count - a.count || b2.spending - a.spending)[0] ?? null;
  const st = budgetStatus(db, userId, month, currency, thresholds);
  const lines = [...(st.total ? [st.total] : []), ...st.categories];
  return {
    month, currency,
    spending: t?.spending ?? 0, income: t?.income ?? 0, previousSpending: pt?.spending ?? 0, count: t?.count ?? 0,
    topCategory: cats[0] && cats[0].spending > 0 ? { categoryId: cats[0].categoryId, spending: cats[0].spending } : null,
    biggestChange: changes[0] ?? null,
    topMerchant: merchant && { merchant: merchant.merchant, spending: merchant.spending, count: merchant.count },
    budgets: { kept: lines.filter((l) => l.state !== 'over').length, total: lines.length },
  };
}

/** End-of-day balance for the last `days` days, worked back from the latest bank balance. */
export function balanceHistory(db: DB, userId: number, today: string, currency: string, accountIds: number[] | null, days = 90): { date: string; balance: number }[] | null {
  const ids = accountIds?.length ? `AND id IN (${accountIds.map(() => '?').join(',')})` : '';
  const accts = all<{ id: number; balance_minor: number }>(db, `SELECT id, balance_minor FROM accounts WHERE user_id = ? AND currency = ? AND included = 1 AND kind IN ('current','savings') AND balance_minor IS NOT NULL ${ids}`, userId, currency, ...(accountIds ?? []));
  if (!accts.length) return null;
  const marks = accts.map(() => '?').join(',');
  const from = addDays(today, -days);
  const daily = new Map(all<{ d: string; s: number }>(db, `SELECT booking_date d, SUM(amount_minor) s FROM transactions WHERE account_id IN (${marks}) AND status = 'posted' AND booking_date > ? GROUP BY booking_date`,
    ...accts.map((a) => a.id), from).map((r) => [r.d, r.s]));
  const later = get<{ s: number | null }>(db, `SELECT SUM(amount_minor) s FROM transactions WHERE account_id IN (${marks}) AND status = 'posted' AND booking_date > ?`, ...accts.map((a) => a.id), today)?.s ?? 0;
  let bal = accts.reduce((a, x) => a + x.balance_minor, 0) - later;
  const out: { date: string; balance: number }[] = [];
  for (let d = today; d >= from; d = addDays(d, -1)) { out.push({ date: d, balance: bal }); bal -= daily.get(d) ?? 0; }
  return out.reverse();
}

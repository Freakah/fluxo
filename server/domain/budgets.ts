// Budgets: a total monthly budget plus optional category budgets (category budgets are NOT added
// on top of the total). A budget set during a month applies to that whole month and later months;
// earlier months keep the amount that applied then. No rollover.
import { all, run, nowIso, type DB } from '../db/db.ts';
import { spendingByCategory, totals, PENDING_OUT_EXPR, EFF_CAT } from './aggregate.ts';
import { addMonths, monthBounds } from '../../shared/dates.ts';

export type BudgetLine = { categoryId: number | null; amount: number; spent: number; pending: number; remaining: number; pct: number; state: 'ok' | 'warning' | 'over'; previousSpent: number };

/** Budgets in effect for a month: latest row per scope with effective_month <= month (NULL amount = removed). */
export function budgetsFor(db: DB, userId: number, month: string, currency: string): Map<number | null, number> {
  const rows = all<{ category_id: number | null; amount_minor: number | null }>(db, `
    SELECT b.category_id, b.amount_minor FROM budgets b
    WHERE b.user_id = ? AND b.currency = ? AND b.effective_month = (
      SELECT MAX(b2.effective_month) FROM budgets b2 WHERE b2.user_id = b.user_id AND b2.currency = b.currency
        AND IFNULL(b2.category_id, 0) = IFNULL(b.category_id, 0) AND b2.effective_month <= ?)`, userId, currency, month);
  return new Map(rows.filter((r) => r.amount_minor !== null).map((r) => [r.category_id, r.amount_minor as number]));
}

export function setBudget(db: DB, userId: number, categoryId: number | null, currency: string, amount: number | null, month: string) {
  run(db, `INSERT INTO budgets (user_id, category_id, currency, amount_minor, effective_month, created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT (user_id, IFNULL(category_id, 0), currency, effective_month) DO UPDATE SET amount_minor = excluded.amount_minor`, userId, categoryId, currency, amount, month, nowIso());
}

function pendingByCategory(db: DB, userId: number, from: string, to: string, currency: string): Map<number | null, number> {
  const rows = all<{ cat: number | null; p: number }>(db, `SELECT ${EFF_CAT} AS cat, SUM(${PENDING_OUT_EXPR}) AS p FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ? AND t.booking_date BETWEEN ? AND ? AND t.excluded = 0 AND a.included = 1 AND t.currency = ? AND t.status = 'pending' GROUP BY cat`, userId, from, to, currency);
  return new Map(rows.map((r) => [r.cat, r.p]));
}

export function budgetStatus(db: DB, userId: number, month: string, currency: string, thresholds: number[]): { total: BudgetLine | null; categories: BudgetLine[] } {
  const b = budgetsFor(db, userId, month, currency);
  const { from, to } = monthBounds(month);
  const prev = monthBounds(addMonths(month, -1));
  const spentCat = new Map(spendingByCategory(db, { userId, from, to }).filter((r) => r.currency === currency).map((r) => [r.categoryId, r.spending]));
  const prevCat = new Map(spendingByCategory(db, { userId, from: prev.from, to: prev.to }).filter((r) => r.currency === currency).map((r) => [r.categoryId, r.spending]));
  const tot = totals(db, { userId, from, to }).find((t) => t.currency === currency);
  const prevTot = totals(db, { userId, from: prev.from, to: prev.to }).find((t) => t.currency === currency);
  const pend = pendingByCategory(db, userId, from, to, currency);
  const warn = Math.min(...thresholds);
  const line = (categoryId: number | null, amount: number, spent: number, pending: number, previousSpent: number): BudgetLine => {
    // Percent is display-only; computed from integers and rounded down.
    const pct = amount > 0 ? Math.floor((spent * 100) / amount) : spent > 0 ? 100 : 0;
    return { categoryId, amount, spent, pending, remaining: amount - spent, pct, previousSpent, state: spent > amount ? 'over' : pct >= warn ? 'warning' : 'ok' };
  };
  const totalAmt = b.get(null);
  const total = totalAmt === undefined ? null : line(null, totalAmt, tot?.spending ?? 0, tot?.pendingOut ?? 0, prevTot?.spending ?? 0);
  const categories = [...b.entries()].filter(([k]) => k !== null).map(([k, amt]) => line(k, amt, spentCat.get(k) ?? 0, pend.get(k) ?? 0, prevCat.get(k) ?? 0));
  return { total, categories };
}

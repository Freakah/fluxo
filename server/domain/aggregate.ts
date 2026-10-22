// Single source of truth for financial totals. Dashboard, budgets, reports and notifications
// all call these functions so the same rules apply everywhere (see docs/FINANCIAL_RULES.md).
import { all, type DB } from '../db/db.ts';

export const EFF_TYPE = 'COALESCE(t.type_override, t.auto_type)';
export const EFF_CAT = 'COALESCE(t.category_override_id, t.auto_category_id)';
/** Spending contribution: expenses add, refunds subtract. Transfers/income contribute nothing. */
export const SPEND_EXPR = `CASE WHEN t.status = 'posted' AND ${EFF_TYPE} IN ('expense','refund') THEN -t.amount_minor ELSE 0 END`;
export const INCOME_EXPR = `CASE WHEN t.status = 'posted' AND ${EFF_TYPE} = 'income' THEN t.amount_minor ELSE 0 END`;
export const PENDING_OUT_EXPR = `CASE WHEN t.status = 'pending' AND t.amount_minor < 0 AND ${EFF_TYPE} <> 'transfer' THEN -t.amount_minor ELSE 0 END`;

export type Scope = { userId: number; accountIds?: number[] | null; from: string; to: string };

/** WHERE clause shared by all report queries. Excluded transactions and excluded accounts never count. */
export function scopeWhere(s: Scope): { sql: string; params: (number | string)[] } {
  const params: (number | string)[] = [s.userId, s.from, s.to];
  let sql = 't.user_id = ? AND t.booking_date >= ? AND t.booking_date <= ? AND t.excluded = 0 AND a.included = 1';
  if (s.accountIds && s.accountIds.length) {
    sql += ` AND t.account_id IN (${s.accountIds.map(() => '?').join(',')})`;
    params.push(...s.accountIds);
  }
  return { sql, params };
}

const FROM = 'FROM transactions t JOIN accounts a ON a.id = t.account_id';

export type CurrencyTotals = { currency: string; spending: number; income: number; net: number; pendingOut: number; refunds: number; count: number };

export function totals(db: DB, s: Scope): CurrencyTotals[] {
  const w = scopeWhere(s);
  return all<CurrencyTotals>(db, `
    SELECT t.currency AS currency,
      SUM(${SPEND_EXPR}) AS spending,
      SUM(${INCOME_EXPR}) AS income,
      SUM(${INCOME_EXPR}) - SUM(${SPEND_EXPR}) AS net,
      SUM(${PENDING_OUT_EXPR}) AS pendingOut,
      SUM(CASE WHEN t.status = 'posted' AND ${EFF_TYPE} = 'refund' THEN t.amount_minor ELSE 0 END) AS refunds,
      COUNT(*) AS count
    ${FROM} WHERE ${w.sql} GROUP BY t.currency ORDER BY t.currency`, ...w.params);
}

export type CategoryRow = { categoryId: number | null; currency: string; spending: number; count: number };
export function spendingByCategory(db: DB, s: Scope): CategoryRow[] {
  const w = scopeWhere(s);
  return all<CategoryRow>(db, `
    SELECT ${EFF_CAT} AS categoryId, t.currency AS currency, SUM(${SPEND_EXPR}) AS spending, COUNT(*) AS count
    ${FROM} WHERE ${w.sql} AND t.status = 'posted' AND ${EFF_TYPE} IN ('expense','refund')
    GROUP BY ${EFF_CAT}, t.currency ORDER BY spending DESC`, ...w.params);
}

export type MonthRow = { month: string; currency: string; spending: number; income: number; net: number };
export function byMonth(db: DB, s: Scope): MonthRow[] {
  const w = scopeWhere(s);
  return all<MonthRow>(db, `
    SELECT substr(t.booking_date, 1, 7) AS month, t.currency AS currency,
      SUM(${SPEND_EXPR}) AS spending, SUM(${INCOME_EXPR}) AS income, SUM(${INCOME_EXPR}) - SUM(${SPEND_EXPR}) AS net
    ${FROM} WHERE ${w.sql} GROUP BY month, t.currency ORDER BY month`, ...w.params);
}

export type DayRow = { date: string; currency: string; spending: number };
export function spendingByDay(db: DB, s: Scope): DayRow[] {
  const w = scopeWhere(s);
  return all<DayRow>(db, `
    SELECT t.booking_date AS date, t.currency AS currency, SUM(${SPEND_EXPR}) AS spending
    ${FROM} WHERE ${w.sql} AND t.status = 'posted' GROUP BY t.booking_date, t.currency ORDER BY t.booking_date`, ...w.params);
}

export type MerchantRow = { merchant: string; currency: string; spending: number; count: number };
export function spendingByMerchant(db: DB, s: Scope, limit = 25): MerchantRow[] {
  const w = scopeWhere(s);
  return all<MerchantRow>(db, `
    SELECT t.merchant AS merchant, t.currency AS currency, SUM(${SPEND_EXPR}) AS spending, COUNT(*) AS count
    ${FROM} WHERE ${w.sql} AND t.status = 'posted' AND ${EFF_TYPE} IN ('expense','refund')
    GROUP BY t.merchant, t.currency ORDER BY spending DESC LIMIT ?`, ...w.params, limit);
}

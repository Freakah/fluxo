import { describe, it, expect } from 'vitest';
import { all, run, nowIso } from '../server/db/db.ts';
import { budgetStatus, setBudget } from '../server/domain/budgets.ts';
import { checkBudgetAlerts } from '../server/domain/notifications.ts';
import { totals, spendingByCategory } from '../server/domain/aggregate.ts';
import { categoryResolver, reclassify } from '../server/domain/reclassify.ts';
import { freshDb, user, connect } from './helpers.ts';
import { todayIn, monthOf, addMonths, monthBounds } from '../shared/dates.ts';

function addTx(db: ReturnType<typeof freshDb>, userId: number, accountId: number, amount: number, date: string, description: string, status = 'posted') {
  run(db, `INSERT INTO transactions (user_id, account_id, source, status, amount_minor, currency, booking_date, description, merchant, first_seen_at, last_seen_at, auto_type, updated_at)
    VALUES (?, ?, 'import', ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?)`, userId, accountId, status, amount, date, description, description, nowIso(), nowIso(), amount < 0 ? 'expense' : 'income', nowIso());
}

describe('budgets and shared totals', () => {
  const month = monthOf(todayIn('Europe/Lisbon'));
  const { from, to } = monthBounds(month);

  function setup() {
    const db = freshDb();
    const u = user(db);
    const { accountIds: [a] } = connect(db, u);
    const cat = categoryResolver(db, u);
    return { db, u, a, cat };
  }

  it('counts posted expenses, subtracts refunds, ignores pending/income/excluded, respects month boundaries', () => {
    const { db, u, a, cat } = setup();
    addTx(db, u, a, -5000, from, 'COMPRA CONTINENTE');
    addTx(db, u, a, -3000, to, 'COMPRA ZARA');
    addTx(db, u, a, 3000, to, 'DEVOLUCAO ZARA');
    addTx(db, u, a, -999, from, 'COMPRA LIDL', 'pending');
    addTx(db, u, a, 200000, from, 'TRF SALARIO');
    addTx(db, u, a, -7777, addMonths(month, -1) + '-28', 'COMPRA CONTINENTE'); // previous month
    addTx(db, u, a, -1234, from, 'COMPRA IKEA');
    run(db, "UPDATE transactions SET excluded = 1 WHERE description = 'COMPRA IKEA'");
    reclassify(db, u);
    const t = totals(db, { userId: u, from, to })[0];
    expect(t).toMatchObject({ spending: 5000, income: 200000, net: 195000, pendingOut: 999, refunds: 3000 });
    const byCat = new Map(spendingByCategory(db, { userId: u, from, to }).map((r) => [r.categoryId, r.spending]));
    expect(byCat.get(cat('groceries'))).toBe(5000);
    expect(byCat.get(cat('shopping'))).toBe(0); // purchase and refund cancel out in the month the refund posts
  });

  it('refund in a later month makes that month’s category spending negative', () => {
    const { db, u, a, cat } = setup();
    addTx(db, u, a, 4999, from, 'DEVOLUCAO ZARA');
    reclassify(db, u);
    expect(spendingByCategory(db, { userId: u, from, to }).find((r) => r.categoryId === cat('shopping'))!.spending).toBe(-4999);
  });

  it('category budgets are not added to the total; thresholds produce deduplicated alerts', () => {
    const { db, u, a, cat } = setup();
    setBudget(db, u, null, 'EUR', 10000, month);
    setBudget(db, u, cat('groceries'), 'EUR', 5000, month);
    addTx(db, u, a, -4100, from, 'COMPRA CONTINENTE'); // 82% of groceries, 41% of total
    reclassify(db, u);
    const st = budgetStatus(db, u, month, 'EUR', [80, 100]);
    expect(st.total).toMatchObject({ amount: 10000, spent: 4100, remaining: 5900, state: 'ok' });
    expect(st.categories[0]).toMatchObject({ amount: 5000, spent: 4100, pct: 82, state: 'warning' });
    checkBudgetAlerts(db, u);
    checkBudgetAlerts(db, u); // repeated syncs must not repeat alerts
    expect(all(db, "SELECT dedupe_key FROM notifications WHERE kind = 'budget'")).toEqual([{ dedupe_key: `budget:${cat('groceries')}:${month}:80` }]);
    addTx(db, u, a, -1000, from, 'COMPRA LIDL');
    reclassify(db, u);
    checkBudgetAlerts(db, u);
    const keys = all<{ dedupe_key: string; body: string }>(db, "SELECT dedupe_key, body FROM notifications WHERE kind = 'budget' ORDER BY id");
    expect(keys.map((k) => k.dedupe_key)).toEqual([`budget:${cat('groceries')}:${month}:80`, `budget:${cat('groceries')}:${month}:100`]);
    expect(keys.every((k) => !/\d+[.,]\d{2}/.test(k.body))).toBe(true); // no amounts in notification text
    expect(budgetStatus(db, u, month, 'EUR', [80, 100]).categories[0].state).toBe('over');
  });

  it('mid-month budget changes apply to the current month and later; earlier months keep their budget', () => {
    const { db, u } = setup();
    const prev = addMonths(month, -1);
    setBudget(db, u, null, 'EUR', 100000, prev);
    setBudget(db, u, null, 'EUR', 150000, month);
    expect(budgetStatus(db, u, prev, 'EUR', [80, 100]).total!.amount).toBe(100000);
    expect(budgetStatus(db, u, month, 'EUR', [80, 100]).total!.amount).toBe(150000);
    expect(budgetStatus(db, u, addMonths(month, 1), 'EUR', [80, 100]).total!.amount).toBe(150000);
    setBudget(db, u, null, 'EUR', null, month); // removal
    expect(budgetStatus(db, u, month, 'EUR', [80, 100]).total).toBeNull();
    expect(budgetStatus(db, u, prev, 'EUR', [80, 100]).total!.amount).toBe(100000);
  });

  it('never adds different currencies together', () => {
    const { db, u, a } = setup();
    addTx(db, u, a, -1000, from, 'COMPRA CONTINENTE');
    run(db, `INSERT INTO transactions (user_id, account_id, source, status, amount_minor, currency, booking_date, description, merchant, first_seen_at, last_seen_at, auto_type, updated_at)
      VALUES (?, ?, 'import', 'posted', -500, 'USD', ?, 'AMAZON.COM', 'Amazon', ?, ?, 'expense', ?)`, u, a, from, nowIso(), nowIso(), nowIso());
    const t = totals(db, { userId: u, from, to });
    expect(t.map((x) => [x.currency, x.spending])).toEqual([['EUR', 1000], ['USD', 500]]);
  });
});

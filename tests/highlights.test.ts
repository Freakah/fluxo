import { describe, it, expect } from 'vitest';
import { run, nowIso } from '../server/db/db.ts';
import { hints, balanceHistory } from '../server/domain/highlights.ts';
import { reclassify } from '../server/domain/reclassify.ts';
import { freshDb, user, connect } from './helpers.ts';

const add = (db: ReturnType<typeof freshDb>, u: number, a: number, amount: number, date: string, desc: string) =>
  run(db, `INSERT INTO transactions (user_id, account_id, source, status, amount_minor, currency, booking_date, description, merchant, first_seen_at, last_seen_at, auto_type, updated_at)
    VALUES (?, ?, 'import', 'posted', ?, 'EUR', ?, ?, ?, ?, ?, ?, ?)`, u, a, amount, date, desc, desc, nowIso(), nowIso(), amount < 0 ? 'expense' : 'income', nowIso());

describe('highlights', () => {
  it('flags a category only when the month so far is clearly above a usual month', () => {
    const db = freshDb();
    const u = user(db);
    const { accountIds: [a] } = connect(db, u);
    for (const m of ['07', '08', '09']) add(db, u, a, -5000, `2026-${m}-10`, 'RESTAURANTE O PATEO');
    add(db, u, a, -6000, '2026-10-05', 'RESTAURANTE O PATEO'); // 20% above usual: not flagged
    reclassify(db, u);
    expect(hints(db, u, '2026-10-22', 'EUR')).toEqual([]);
    add(db, u, a, -2000, '2026-10-20', 'RESTAURANTE O PATEO'); // 8000 vs 5000: +60%, +€30
    reclassify(db, u);
    expect(hints(db, u, '2026-10-22', 'EUR')).toMatchObject([{ kind: 'category_up', current: 8000, usual: 5000, pct: 60 }]);
  });

  it('works the balance back from the latest bank balance', () => {
    const db = freshDb();
    const u = user(db);
    const { accountIds: [a] } = connect(db, u);
    run(db, 'UPDATE accounts SET balance_minor = 10000 WHERE id = ?', a);
    add(db, u, a, -3000, '2026-10-21', 'COMPRA LOJA');
    const h = balanceHistory(db, u, '2026-10-22', 'EUR', null, 3)!;
    expect(h).toEqual([{ date: '2026-10-19', balance: 13000 }, { date: '2026-10-20', balance: 13000 }, { date: '2026-10-21', balance: 10000 }, { date: '2026-10-22', balance: 10000 }]);
  });
});

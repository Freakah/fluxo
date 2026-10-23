import { all, get, run, tx, nowIso, type DB } from '../db/db.ts';
import { classify, sortRules, ruleMatches, DEFAULT_CATEGORIES, type Rule, type TxInput, type Classification } from './categorize.ts';
import type { CategoryKey } from './merchants.ts';
import { daysBetween } from '../../shared/dates.ts';

export function ensureDefaultCategories(db: DB, userId: number) {
  for (const c of DEFAULT_CATEGORIES) {
    run(db, 'INSERT OR IGNORE INTO categories (user_id, key, name, color, is_system, created_at) VALUES (?,?,?,?,1,?)', userId, c.key, c.name, c.color, nowIso());
  }
}

export function categoryResolver(db: DB, userId: number): (k: CategoryKey) => number {
  const map = new Map(all<{ key: string; id: number }>(db, 'SELECT key, id FROM categories WHERE user_id = ? AND key IS NOT NULL', userId).map((r) => [r.key, r.id]));
  return (k) => {
    const id = map.get(k);
    if (id === undefined) throw new Error(`Missing system category ${k}`);
    return id;
  };
}

export const loadRules = (db: DB, userId: number) => sortRules(all<Rule>(db, 'SELECT * FROM rules WHERE user_id = ? AND enabled = 1', userId));

type Row = TxInput & { id: number; transfer_peer_id: number | null };

/** Recomputes automatic classification for a user's transactions (all, or the given ids). Never touches the user layer. */
export function reclassify(db: DB, userId: number, ids?: number[]): number {
  const rules = loadRules(db, userId);
  const cat = categoryResolver(db, userId);
  const where = ids ? `AND id IN (${ids.map(() => '?').join(',') || 'NULL'})` : '';
  const rows = all<Row>(db, `SELECT id, amount_minor, description, counterparty, merchant, mcc, bank_code, account_id, transfer_peer_id FROM transactions WHERE user_id = ? ${where}`, userId, ...(ids ?? []));
  const upd = db.prepare('UPDATE transactions SET auto_category_id = ?, auto_source = ?, auto_confidence = ?, auto_rule_id = ?, auto_type = ? WHERE id = ?');
  tx(db, () => {
    for (const r of rows) {
      const c = classify(r, rules, cat);
      const type = r.transfer_peer_id ? 'transfer' : c.type;
      upd.run(type === 'transfer' ? null : c.categoryId, c.source, c.confidence, c.ruleId, type, r.id);
    }
    syncPaidBack(db, userId);
  });
  return rows.length;
}

/** A "paid back" payment always sits in the same category as the expense it repays, even after recategorizing. */
export function syncPaidBack(db: DB, userId: number) {
  run(db, `UPDATE transactions SET category_override_id = (SELECT COALESCE(e.category_override_id, e.auto_category_id) FROM transactions e WHERE e.id = transactions.paid_back_for_id)
    WHERE user_id = ? AND paid_back_for_id IS NOT NULL`, userId);
}

/** Before expenses are deleted: payments that paid them back stop being refunds, so spending is not understated. */
export function unlinkPaidBack(db: DB, userId: number, expenseIdsSql: string, ...params: (number | string)[]) {
  run(db, `UPDATE transactions SET paid_back_for_id = NULL, type_override = NULL, category_override_id = NULL, updated_at = ?
    WHERE user_id = ? AND paid_back_for_id IN (${expenseIdsSql})`, nowIso(), userId, ...params);
}

/** Classification preview without writing (used by the rule preview endpoint). */
export function previewRule(db: DB, userId: number, rule: Omit<Rule, 'id'>): { id: number; merchant: string; description: string; booking_date: string; amount_minor: number; currency: string; current_category_id: number | null; overridden: boolean }[] {
  const rows = all<Row & { booking_date: string; currency: string; eff_cat: number | null; category_override_id: number | null }>(db,
    `SELECT id, amount_minor, description, counterparty, merchant, mcc, bank_code, account_id, transfer_peer_id, booking_date, currency,
      COALESCE(category_override_id, auto_category_id) AS eff_cat, category_override_id
     FROM transactions WHERE user_id = ? ORDER BY booking_date DESC LIMIT 5000`, userId);
  return rows.filter((r) => ruleMatches({ ...rule, id: 0 }, r)).map((r) => ({
    id: r.id, merchant: r.merchant, description: r.description, booking_date: r.booking_date, amount_minor: r.amount_minor,
    currency: r.currency, current_category_id: r.eff_cat, overridden: r.category_override_id !== null,
  }));
}

/**
 * Pairs opposite, equal-amount posted movements between two of the user's own accounts within 3 days
 * as internal transfers. Never uses wording alone. Ambiguous candidates (two equally close matches) are left unpaired.
 * Users can veto a pairing by overriding the type of either side.
 */
export function detectTransfers(db: DB, userId: number): number {
  type T = { id: number; account_id: number; amount_minor: number; currency: string; booking_date: string; type_override: string | null };
  const rows = all<T>(db, `SELECT t.id, t.account_id, t.amount_minor, t.currency, t.booking_date, t.type_override
    FROM transactions t WHERE t.user_id = ? AND t.status = 'posted' AND t.transfer_peer_id IS NULL
    AND (t.type_override IS NULL OR t.type_override = 'transfer') ORDER BY t.booking_date, t.id`, userId);
  const ins = rows.filter((r) => r.amount_minor > 0);
  const used = new Set<number>();
  let paired = 0;
  tx(db, () => {
    for (const out of rows) {
      if (out.amount_minor >= 0 || used.has(out.id)) continue;
      const cands = ins.filter((i) => !used.has(i.id) && i.account_id !== out.account_id && i.currency === out.currency
        && i.amount_minor === -out.amount_minor && Math.abs(daysBetween(out.booking_date, i.booking_date)) <= 3);
      if (!cands.length) continue;
      cands.sort((a, b) => Math.abs(daysBetween(out.booking_date, a.booking_date)) - Math.abs(daysBetween(out.booking_date, b.booking_date)));
      const best = cands[0];
      if (cands[1] && Math.abs(daysBetween(out.booking_date, cands[1].booking_date)) === Math.abs(daysBetween(out.booking_date, best.booking_date))) continue;
      used.add(out.id); used.add(best.id);
      run(db, "UPDATE transactions SET transfer_peer_id = ?, auto_type = 'transfer', auto_category_id = NULL WHERE id = ?", best.id, out.id);
      run(db, "UPDATE transactions SET transfer_peer_id = ?, auto_type = 'transfer', auto_category_id = NULL WHERE id = ?", out.id, best.id);
      paired++;
    }
  });
  return paired;
}

/** Breaks a transfer pairing (e.g. after the user overrides the type) and reclassifies both sides. */
export function unpairTransfer(db: DB, userId: number, txId: number) {
  const t = get<{ transfer_peer_id: number | null }>(db, 'SELECT transfer_peer_id FROM transactions WHERE id = ? AND user_id = ?', txId, userId);
  if (!t?.transfer_peer_id) return;
  run(db, 'UPDATE transactions SET transfer_peer_id = NULL WHERE id IN (?, ?) AND user_id = ?', txId, t.transfer_peer_id, userId);
  reclassify(db, userId, [txId, t.transfer_peer_id]);
}

export type { Classification };

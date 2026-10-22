// Recurring-payment detection from merchant identity, timing and amount patterns.
// Produces *estimates*: suggestions the user confirms, corrects, dismisses or marks inactive.
import { all, get, run, tx, nowIso, type DB } from '../db/db.ts';
import { addDays, addMonthsToDate, daysBetween, todayIn } from '../../shared/dates.ts';
import { merchantKey } from './merchants.ts';
import { EFF_TYPE, EFF_CAT } from './aggregate.ts';
import { notify, userSettings } from './notifications.ts';

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'annual';
const BUCKETS: [Frequency, number, number][] = [['weekly', 5, 9], ['monthly', 26, 35], ['quarterly', 80, 100], ['annual', 350, 380]];
const SUBSCRIPTION_CATS = new Set(['subscriptions', 'entertainment', 'education', 'health']);
const BILL_CATS = new Set(['utilities', 'housing', 'bank_fees', 'transport', 'other']);
// Everyday spending: repeated but not a commitment, unless the amount is fixed.
const EVERYDAY_CATS = new Set(['groceries', 'restaurants', 'fuel', 'shopping', 'cash', 'uncategorized']);

export type Occ = { date: string; amount: number }; // amount = positive outflow
export type Detected = { frequency: Frequency; typical: number; min: number; max: number; occurrences: number; lastDate: string; nextDate: string; confidence: 'high' | 'medium' | 'low'; variable: boolean };

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

export function nextDate(last: string, f: Frequency): string {
  return f === 'weekly' ? addDays(last, 7) : f === 'monthly' ? addMonthsToDate(last, 1) : f === 'quarterly' ? addMonthsToDate(last, 3) : addMonthsToDate(last, 12);
}

/** Pure pattern detection over one merchant's outflows (sorted by date). */
export function detectPattern(occsIn: Occ[], today: string): Detected | null {
  // Same-day charges are merged: a recurring commitment happens at most once per day.
  const byDay = new Map<string, number>();
  for (const o of occsIn) byDay.set(o.date, (byDay.get(o.date) ?? 0) + o.amount);
  const occs = [...byDay].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date));
  if (occs.length < 2) return null;
  const gaps = occs.slice(1).map((o, i) => daysBetween(occs[i].date, o.date));
  const g = median(gaps);
  const bucket = BUCKETS.find(([, lo, hi]) => g >= lo && g <= hi);
  if (!bucket) return null;
  const [frequency, lo, hi] = bucket;
  if (occs.length < (frequency === 'annual' ? 2 : 3)) return null;
  const consistent = gaps.filter((x) => x >= lo && x <= hi).length / gaps.length;
  if (consistent < 0.75) return null;
  const amounts = occs.map((o) => o.amount);
  const min = Math.min(...amounts), max = Math.max(...amounts);
  const variable = max * 100 > min * 115; // more than 15% spread
  const last = occs[occs.length - 1].date;
  let next = nextDate(last, frequency);
  // Long overdue (missed 2+ expected dates): stale, don't suggest.
  if (daysBetween(next, today) > hi * 2) return null;
  while (next < today && daysBetween(next, today) > 3) next = nextDate(next, frequency);
  const confidence = !variable && consistent >= 0.9 && occs.length >= (frequency === 'annual' ? 3 : 4) ? 'high' : occs.length >= 3 || frequency === 'annual' ? 'medium' : 'low';
  return { frequency, typical: median(amounts), min, max, occurrences: occs.length, lastDate: last, nextDate: next, confidence, variable };
}

export function monthlyEquivalent(amount: number, f: Frequency): number {
  return f === 'monthly' ? amount : f === 'weekly' ? Math.round((amount * 52) / 12) : f === 'quarterly' ? Math.round(amount / 3) : Math.round(amount / 12);
}

export function detectRecurring(db: DB, userId: number, now = new Date()): number {
  const s = userSettings(db, userId);
  const today = todayIn(s.timezone, now);
  const since = addDays(today, -450);
  const rows = all<{ merchant: string; currency: string; booking_date: string; amount_minor: number; cat_key: string | null }>(db, `
    SELECT t.merchant, t.currency, t.booking_date, t.amount_minor, c.key AS cat_key
    FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE t.user_id = ? AND t.status = 'posted' AND t.excluded = 0 AND ${EFF_TYPE} = 'expense' AND t.booking_date >= ?
    ORDER BY t.booking_date`, userId, since);
  const groups = new Map<string, { merchant: string; currency: string; cats: Map<string, number>; occs: Occ[] }>();
  for (const r of rows) {
    const k = `${merchantKey(r.merchant)}|${r.currency}`;
    const g = groups.get(k) ?? { merchant: r.merchant, currency: r.currency, cats: new Map<string, number>(), occs: [] as Occ[] };
    g.occs.push({ date: r.booking_date, amount: -r.amount_minor });
    if (r.cat_key) g.cats.set(r.cat_key, (g.cats.get(r.cat_key) ?? 0) + 1);
    groups.set(k, g);
  }
  let found = 0;
  tx(db, () => {
    for (const [k, g] of groups) {
      const d = detectPattern(g.occs, today);
      if (!d) continue;
      const cat = [...g.cats].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'uncategorized';
      if (EVERYDAY_CATS.has(cat) && d.variable) continue;
      if (/^(lev atm|mbway)/i.test(g.merchant)) continue; // cash and person-to-person payments are not commitments
      const kind = SUBSCRIPTION_CATS.has(cat) && !d.variable ? 'subscription' : BILL_CATS.has(cat) || d.variable ? 'bill' : 'other';
      const key = k.split('|')[0];
      const existing = get<{ id: number }>(db, "SELECT id FROM recurring WHERE user_id = ? AND merchant_key = ? AND currency = ? AND direction = 'out'", userId, key, g.currency);
      if (existing) {
        run(db, `UPDATE recurring SET merchant = ?, kind = COALESCE(user_kind, ?), frequency = ?, typical_amount_minor = ?, min_amount_minor = ?, max_amount_minor = ?, occurrences = ?,
          last_date = ?, next_date = ?, confidence = ?, updated_at = ? WHERE id = ?`, g.merchant, kind, d.frequency, d.typical, d.min, d.max, d.occurrences, d.lastDate, d.nextDate, d.confidence, nowIso(), existing.id);
      } else {
        const id = run(db, `INSERT INTO recurring (user_id, merchant_key, merchant, currency, direction, kind, frequency, typical_amount_minor, min_amount_minor, max_amount_minor,
          occurrences, last_date, next_date, confidence, status, updated_at) VALUES (?,?,?,?, 'out', ?,?,?,?,?,?,?,?,?, 'suggested', ?)`,
          userId, key, g.merchant, g.currency, kind, d.frequency, d.typical, d.min, d.max, d.occurrences, d.lastDate, d.nextDate, d.confidence, nowIso()).id;
        notify(db, userId, { kind: 'recurring', key: `recurring:${id}`, title: 'Possible recurring payment found', body: `A possible ${d.frequency} payment was detected. Review it to confirm or dismiss.`, link: '/recurring' });
      }
      found++;
    }
  });
  return found;
}

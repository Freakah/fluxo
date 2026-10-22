// Transaction list filtering shared by the list endpoint and CSV export.
import { z } from 'zod';
import { EFF_CAT, EFF_TYPE } from './aggregate.ts';
import { parseAmountToMinor } from '../../shared/money.ts';
import { isDate } from '../../shared/dates.ts';

const ids = z.string().regex(/^\d+(,\d+)*$/).transform((s) => s.split(',').map(Number));
export const txFilterSchema = z.object({
  q: z.string().max(100).optional(),
  accounts: ids.optional(),
  from: z.string().refine(isDate, 'expected YYYY-MM-DD').optional(),
  to: z.string().refine(isDate, 'expected YYYY-MM-DD').optional(),
  category: z.union([z.literal('none'), z.string().regex(/^\d+$/).transform(Number)]).optional(),
  type: z.enum(['expense', 'income', 'refund', 'transfer']).optional(),
  status: z.enum(['posted', 'pending', 'cancelled']).optional(),
  min: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  max: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  excluded: z.enum(['only', 'hide']).optional(),
  review: z.literal('1').optional(),
  source: z.enum(['import', 'manual']).optional(),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type TxFilter = z.infer<typeof txFilterSchema>;

export const TX_SELECT = `
  SELECT t.id, t.account_id, a.name AS account_name, a.display_name AS account_display_name, t.source, t.status, t.amount_minor, t.currency,
    t.original_pending_amount_minor, t.booking_date, t.value_date, t.description, t.counterparty, t.merchant, t.note, t.excluded,
    ${EFF_TYPE} AS type, ${EFF_CAT} AS category_id, c.name AS category_name, c.color AS category_color,
    CASE WHEN t.category_override_id IS NOT NULL THEN 'user' ELSE t.auto_source END AS category_source,
    CASE WHEN t.category_override_id IS NOT NULL THEN 'certain' ELSE t.auto_confidence END AS confidence,
    t.type_override IS NOT NULL AS type_overridden, t.transfer_peer_id, t.needs_review
  FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = ${EFF_CAT}`;

export function txWhere(userId: number, f: TxFilter, currency = 'EUR'): { sql: string; params: (string | number)[] } {
  const w = ['t.user_id = ?'];
  const p: (string | number)[] = [userId];
  if (f.q) {
    const like = `%${f.q.replace(/[!%_]/g, (m) => '!' + m)}%`;
    w.push("(t.merchant LIKE ? ESCAPE '!' OR t.description LIKE ? ESCAPE '!' OR IFNULL(t.note, '') LIKE ? ESCAPE '!' OR IFNULL(t.counterparty, '') LIKE ? ESCAPE '!')");
    p.push(like, like, like, like);
  }
  if (f.accounts?.length) { w.push(`t.account_id IN (${f.accounts.map(() => '?').join(',')})`); p.push(...f.accounts); }
  if (f.from) { w.push('t.booking_date >= ?'); p.push(f.from); }
  if (f.to) { w.push('t.booking_date <= ?'); p.push(f.to); }
  if (f.category === 'none') w.push(`(${EFF_CAT} IS NULL OR c.key = 'uncategorized')`);
  else if (f.category !== undefined) { w.push(`${EFF_CAT} = ?`); p.push(f.category); }
  if (f.type) { w.push(`${EFF_TYPE} = ?`); p.push(f.type); }
  if (f.status) { w.push('t.status = ?'); p.push(f.status); }
  if (f.min) { w.push('ABS(t.amount_minor) >= ?'); p.push(parseAmountToMinor(f.min, currency)); }
  if (f.max) { w.push('ABS(t.amount_minor) <= ?'); p.push(parseAmountToMinor(f.max, currency)); }
  if (f.excluded === 'only') w.push('t.excluded = 1');
  if (f.excluded === 'hide') w.push('t.excluded = 0');
  if (f.review) w.push('t.needs_review IS NOT NULL');
  if (f.source) { w.push('t.source = ?'); p.push(f.source); }
  return { sql: w.join(' AND '), params: p };
}

export const TX_ORDER: Record<TxFilter['sort'], string> = {
  date_desc: 't.booking_date DESC, t.id DESC',
  date_asc: 't.booking_date ASC, t.id ASC',
  amount_desc: 'ABS(t.amount_minor) DESC, t.id DESC',
  amount_asc: 'ABS(t.amount_minor) ASC, t.id ASC',
};

// Transactions, categories and rules.
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, run, tx, nowIso } from '../db/db.ts';
import { body, HttpError, uid, type Deps, type Env } from '../context.ts';
import { txFilterSchema, txWhere, TX_SELECT, TX_ORDER } from '../domain/txquery.ts';
import { reclassify, detectTransfers, previewRule, unpairTransfer } from '../domain/reclassify.ts';
import { detectRecurring } from '../domain/recurring.ts';
import { checkBudgetAlerts, userSettings } from '../domain/notifications.ts';
import { toCsv, textCell, numberCell } from '../domain/csv.ts';
import { minorToDecimal, parseAmountToMinor } from '../../shared/money.ts';
import { isDate, todayIn } from '../../shared/dates.ts';
import { normalizeMerchant } from '../domain/merchants.ts';

const TYPES = ['expense', 'income', 'refund', 'transfer'] as const;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const icon = z.string().regex(/^[a-z][a-z-]{0,23}$/); // icon name from the web app's icon set; unknown names fall back to a default

export function dataRoutes(deps: Deps) {
  const { db } = deps;
  const app = new Hono<Env>();

  const ownCategory = (userId: number, id: number) => {
    if (!get(db, 'SELECT 1 FROM categories WHERE id = ? AND user_id = ?', id, userId)) throw new HttpError(400, 'Unknown category');
  };
  const ownTx = (userId: number, id: number) => {
    const t = get<{ id: number; transfer_peer_id: number | null }>(db, 'SELECT id, transfer_peer_id FROM transactions WHERE id = ? AND user_id = ?', id, userId);
    if (!t) throw new HttpError(404, 'Transaction not found');
    return t;
  };
  const refreshDerived = (userId: number) => { detectRecurring(db, userId); checkBudgetAlerts(db, userId); };

  // ---- Transactions
  app.get('/transactions', (c) => {
    const f = txFilterSchema.safeParse(c.req.query());
    if (!f.success) throw new HttpError(400, 'Invalid filter: ' + f.error.issues.map((i) => i.path.join('.')).join(', '));
    const w = txWhere(uid(c), f.data, userSettings(db, uid(c)).currency);
    const rows = all(db, `${TX_SELECT} WHERE ${w.sql} ORDER BY ${TX_ORDER[f.data.sort]} LIMIT ? OFFSET ?`, ...w.params, f.data.limit, f.data.offset);
    const total = get<{ n: number }>(db, `SELECT COUNT(*) n FROM transactions t LEFT JOIN categories c ON c.id = COALESCE(t.category_override_id, t.auto_category_id) WHERE ${w.sql}`, ...w.params)!.n;
    return c.json({ rows, total, limit: f.data.limit, offset: f.data.offset });
  });

  app.get('/transactions/export.csv', (c) => {
    const f = txFilterSchema.safeParse({ ...c.req.query(), limit: 200, offset: 0 });
    if (!f.success) throw new HttpError(400, 'Invalid filter');
    const w = txWhere(uid(c), f.data, userSettings(db, uid(c)).currency);
    type R = { booking_date: string; value_date: string | null; status: string; account_name: string; account_display_name: string | null; merchant: string; description: string; counterparty: string | null; amount_minor: number; currency: string; original_pending_amount_minor: number | null; type: string; category_name: string | null; category_source: string; excluded: number; note: string | null; source: string };
    const rows = all<R>(db, `${TX_SELECT} WHERE ${w.sql} ORDER BY ${TX_ORDER[f.data.sort]} LIMIT 100000`, ...w.params);
    const csv = toCsv(
      ['booking_date', 'value_date', 'status', 'account', 'merchant', 'bank_description', 'counterparty', 'amount', 'currency', 'pending_amount', 'type', 'category', 'category_source', 'excluded_from_reports', 'note', 'source'],
      rows.map((r) => [r.booking_date, r.value_date ?? '', r.status, textCell(r.account_display_name ?? r.account_name), textCell(r.merchant), textCell(r.description), textCell(r.counterparty),
        numberCell(minorToDecimal(r.amount_minor, r.currency)), r.currency, r.original_pending_amount_minor === null ? '' : numberCell(minorToDecimal(r.original_pending_amount_minor, r.currency)),
        r.type, textCell(r.category_name), r.category_source, r.excluded ? 'yes' : 'no', textCell(r.note), r.source]),
    );
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="fluxo-transactions-${todayIn('UTC')}.csv"`);
    c.header('Cache-Control', 'no-store');
    return c.body(csv);
  });

  app.get('/transactions/:id', (c) => {
    const id = Number(c.req.param('id'));
    const t = get<Record<string, unknown> & { transfer_peer_id: number | null }>(db, `${TX_SELECT} WHERE t.id = ? AND t.user_id = ?`, id, uid(c));
    if (!t) throw new HttpError(404, 'Transaction not found');
    const extra = get<{ auto_source: string; auto_confidence: string; auto_rule_id: number | null; auto_category_id: number | null; category_override_id: number | null; type_override: string | null; auto_type: string; bank_code: string | null; mcc: string | null; first_seen_at: string; last_seen_at: string }>(db,
      'SELECT auto_source, auto_confidence, auto_rule_id, auto_category_id, category_override_id, type_override, auto_type, bank_code, mcc, first_seen_at, last_seen_at FROM transactions WHERE id = ?', id)!;
    const rule = extra.auto_rule_id ? get(db, 'SELECT id, field, match_type, pattern FROM rules WHERE id = ?', extra.auto_rule_id) : null;
    const peer = t.transfer_peer_id ? get(db, 'SELECT t.id, t.booking_date, t.amount_minor, t.currency, a.name AS account_name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ? AND t.user_id = ?', t.transfer_peer_id, uid(c)) : null;
    return c.json({ ...t, ...extra, rule, peer });
  });

  const patchSchema = z.object({
    categoryId: z.number().int().nullable().optional(),
    type: z.enum(TYPES).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    excluded: z.boolean().optional(),
  }).strict();

  function applyPatch(userId: number, ids: number[], p: z.infer<typeof patchSchema>) {
    if (p.categoryId) ownCategory(userId, p.categoryId);
    tx(db, () => {
      for (const id of ids) {
        const t = ownTx(userId, id);
        if (p.categoryId !== undefined) run(db, 'UPDATE transactions SET category_override_id = ?, updated_at = ? WHERE id = ?', p.categoryId, nowIso(), id);
        if (p.note !== undefined) run(db, 'UPDATE transactions SET note = ?, updated_at = ? WHERE id = ?', p.note?.trim() || null, nowIso(), id);
        if (p.excluded !== undefined) run(db, 'UPDATE transactions SET excluded = ?, updated_at = ? WHERE id = ?', p.excluded ? 1 : 0, nowIso(), id);
        if (p.type !== undefined) {
          run(db, 'UPDATE transactions SET type_override = ?, updated_at = ? WHERE id = ?', p.type, nowIso(), id);
          if (t.transfer_peer_id && p.type !== 'transfer') unpairTransfer(db, userId, id);
        }
      }
    });
    if (p.type !== undefined) detectTransfers(db, userId);
    refreshDerived(userId);
  }

  app.patch('/transactions/:id', async (c) => {
    const p = await body(c, patchSchema);
    applyPatch(uid(c), [Number(c.req.param('id'))], p);
    return c.json({ ok: true });
  });

  app.post('/transactions/bulk', async (c) => {
    const b = await body(c, z.object({ ids: z.array(z.number().int()).min(1).max(500), patch: patchSchema }));
    applyPatch(uid(c), [...new Set(b.ids)], b.patch);
    return c.json({ ok: true, updated: b.ids.length });
  });

  // Manual cash entries: a secondary convenience, always marked as manual.
  app.post('/transactions/manual', async (c) => {
    const b = await body(c, z.object({ date: z.string().refine(isDate), amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/), description: z.string().min(1).max(140), categoryId: z.number().int().nullable().optional() }));
    const userId = uid(c);
    const s = userSettings(db, userId);
    if (b.categoryId) ownCategory(userId, b.categoryId);
    let acct = get<{ id: number }>(db, "SELECT id FROM accounts WHERE user_id = ? AND kind = 'cash' AND currency = ?", userId, s.currency);
    acct ??= { id: run(db, "INSERT INTO accounts (user_id, identity_hash, name, currency, kind, created_at) VALUES (?, ?, 'Cash (manual)', ?, 'cash', ?)", userId, `cash:${s.currency}`, s.currency, nowIso()).id };
    const amount = parseAmountToMinor(b.amount, s.currency);
    const id = run(db, `INSERT INTO transactions (user_id, account_id, source, status, amount_minor, currency, booking_date, description, merchant, first_seen_at, last_seen_at, auto_type, category_override_id, updated_at)
      VALUES (?, ?, 'manual', 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userId, acct.id, amount, s.currency, b.date, b.description, normalizeMerchant(b.description), nowIso(), nowIso(), amount < 0 ? 'expense' : 'income', b.categoryId ?? null, nowIso()).id;
    reclassify(db, userId, [id]);
    refreshDerived(userId);
    return c.json({ id });
  });

  app.delete('/transactions/:id', (c) => {
    const id = Number(c.req.param('id'));
    // Only manual entries can be deleted; imported bank facts are never deleted by the user here.
    const r = run(db, "DELETE FROM transactions WHERE id = ? AND user_id = ? AND source = 'manual'", id, uid(c));
    if (!r.changes) throw new HttpError(400, 'Only manual entries can be deleted. Imported transactions can be excluded from reports instead.');
    refreshDerived(uid(c));
    return c.json({ ok: true });
  });

  // ---- Categories
  app.get('/categories', (c) => c.json(all(db, `SELECT c.id, c.key, c.name, c.color, c.icon, c.is_system, c.archived_at,
    (SELECT COUNT(*) FROM transactions t WHERE t.user_id = c.user_id AND COALESCE(t.category_override_id, t.auto_category_id) = c.id) AS tx_count
    FROM categories c WHERE c.user_id = ? ORDER BY c.archived_at IS NOT NULL, c.name`, uid(c))));

  app.post('/categories', async (c) => {
    const b = await body(c, z.object({ name: z.string().trim().min(1).max(40), color: color.default('#607d8b'), icon: icon.optional() }));
    if (get(db, 'SELECT 1 FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE AND archived_at IS NULL', uid(c), b.name)) throw new HttpError(409, 'A category with this name exists.');
    return c.json({ id: run(db, 'INSERT INTO categories (user_id, name, color, icon, created_at) VALUES (?,?,?,?,?)', uid(c), b.name, b.color, b.icon ?? null, nowIso()).id });
  });

  app.patch('/categories/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const b = await body(c, z.object({ name: z.string().trim().min(1).max(40).optional(), color: color.optional(), icon: icon.nullable().optional(), archived: z.boolean().optional() }).strict());
    const cat = get<{ key: string | null }>(db, 'SELECT key FROM categories WHERE id = ? AND user_id = ?', id, uid(c));
    if (!cat) throw new HttpError(404, 'Category not found');
    if (b.archived && (cat.key === 'uncategorized' || cat.key === 'income')) throw new HttpError(400, 'This category is required and cannot be archived.');
    if (b.name !== undefined) run(db, 'UPDATE categories SET name = ? WHERE id = ?', b.name, id);
    if (b.color !== undefined) run(db, 'UPDATE categories SET color = ? WHERE id = ?', b.color, id);
    if (b.icon !== undefined) run(db, 'UPDATE categories SET icon = ? WHERE id = ?', b.icon, id);
    // Archiving hides a category from pickers; historical transactions keep it.
    if (b.archived !== undefined) run(db, 'UPDATE categories SET archived_at = ? WHERE id = ?', b.archived ? nowIso() : null, id);
    return c.json({ ok: true });
  });

  // ---- Rules
  const ruleSchema = z.object({
    field: z.enum(['merchant', 'description']),
    match_type: z.enum(['equals', 'contains', 'starts_with']),
    pattern: z.string().trim().min(2, 'Pattern must have at least 2 characters').max(100),
    direction: z.enum(['any', 'out', 'in']).default('out'),
    account_id: z.number().int().nullable().default(null),
    category_id: z.number().int(),
    priority: z.number().int().min(0).max(1000).default(100),
    enabled: z.boolean().default(true),
  });
  const validateRule = (userId: number, r: { category_id: number; account_id: number | null }) => {
    ownCategory(userId, r.category_id);
    if (r.account_id !== null && !get(db, 'SELECT 1 FROM accounts WHERE id = ? AND user_id = ?', r.account_id, userId)) throw new HttpError(400, 'Unknown account');
  };
  const afterRuleChange = (userId: number) => { reclassify(db, userId); refreshDerived(userId); };

  app.get('/rules', (c) => c.json(all(db, `SELECT r.*, c.name AS category_name,
    (SELECT COUNT(*) FROM transactions t WHERE t.user_id = r.user_id AND t.auto_rule_id = r.id) AS match_count
    FROM rules r JOIN categories c ON c.id = r.category_id WHERE r.user_id = ? ORDER BY r.priority, r.id`, uid(c))));

  app.post('/rules/preview', async (c) => {
    const r = await body(c, ruleSchema);
    validateRule(uid(c), r);
    const matches = previewRule(db, uid(c), { ...r, enabled: 1 });
    return c.json({ count: matches.length, changes: matches.filter((m) => !m.overridden && m.current_category_id !== r.category_id).length, overridden: matches.filter((m) => m.overridden).length, sample: matches.slice(0, 50) });
  });

  app.post('/rules', async (c) => {
    const r = await body(c, ruleSchema);
    validateRule(uid(c), r);
    const id = run(db, 'INSERT INTO rules (user_id, priority, enabled, field, match_type, pattern, direction, account_id, category_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      uid(c), r.priority, r.enabled ? 1 : 0, r.field, r.match_type, r.pattern, r.direction, r.account_id, r.category_id, nowIso()).id;
    afterRuleChange(uid(c));
    return c.json({ id });
  });

  app.patch('/rules/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = get<z.infer<typeof ruleSchema>>(db, 'SELECT field, match_type, pattern, direction, account_id, category_id, priority, enabled FROM rules WHERE id = ? AND user_id = ?', id, uid(c));
    if (!existing) throw new HttpError(404, 'Rule not found');
    const patch = await body(c, ruleSchema.partial().strict());
    const r = { ...existing, enabled: !!existing.enabled, ...patch };
    validateRule(uid(c), r);
    run(db, 'UPDATE rules SET field = ?, match_type = ?, pattern = ?, direction = ?, account_id = ?, category_id = ?, priority = ?, enabled = ? WHERE id = ?',
      r.field, r.match_type, r.pattern, r.direction, r.account_id, r.category_id, r.priority, r.enabled ? 1 : 0, id);
    afterRuleChange(uid(c));
    return c.json({ ok: true });
  });

  app.delete('/rules/:id', (c) => {
    const r = run(db, 'DELETE FROM rules WHERE id = ? AND user_id = ?', Number(c.req.param('id')), uid(c));
    if (!r.changes) throw new HttpError(404, 'Rule not found');
    afterRuleChange(uid(c));
    return c.json({ ok: true });
  });

  return app;
}

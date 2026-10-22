import { useState } from 'react';
import { Link } from 'react-router';
import { api, useAction, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Badge, Card, Confirm, ErrorBox, Loading, Modal, Field, Help, Money } from '../components/ui.tsx';
import type { Category } from '../types.ts';

type Rule = { id: number; priority: number; enabled: number; field: 'merchant' | 'description'; match_type: 'equals' | 'contains' | 'starts_with'; pattern: string; direction: 'any' | 'out' | 'in'; account_id: number | null; category_id: number; category_name: string; match_count: number };
type Preview = { count: number; changes: number; overridden: number; sample: { id: number; merchant: string; description: string; booking_date: string; amount_minor: number; currency: string }[] };

export function Categories() {
  const toast = useToast();
  const cats = useApi<Category[]>('/categories');
  const rules = useApi<Rule[]>('/rules');
  const [newName, setNewName] = useState('');
  const [editRule, setEditRule] = useState<Partial<Rule> | null>(null);
  const [delRule, setDelRule] = useState<Rule | null>(null);
  const act = useAction();
  if (cats.error) return <ErrorBox error={cats.error} onRetry={() => cats.reload()} />;
  if (!cats.data || !rules.data) return <Loading />;
  const done = async (msg: string) => { toast(msg); await Promise.all([cats.reload(true), rules.reload(true)]); };
  const fail = (e: unknown) => toast((e as Error).message, { kind: 'error' });

  const patchCat = (c: Category, body: Record<string, unknown>, msg: string) => act.run(async () => {
    try { await api(`/categories/${c.id}`, { method: 'PATCH', body }); await done(msg); } catch (e) { fail(e); }
  });

  return (
    <div className="page">
      <div className="page-head"><h1>{m.categories.title}</h1></div>
      <Help>{m.categories.precedence}</Help>
      <Card title={m.categories.rules} actions={<button className="btn btn-primary btn-small" onClick={() => setEditRule({ field: 'merchant', match_type: 'contains', direction: 'out', priority: 100, enabled: 1 })}>{m.categories.addRule}</button>}>
        {rules.data.length === 0 ? <p className="muted">No rules yet. Create one here, or tick “{m.tx.remember}” when correcting a transaction.</p> : (
          <div className="table-wrap"><table className="table">
            <caption className="sr-only">Categorization rules in priority order</caption>
            <thead><tr><th scope="col">{m.categories.priority}</th><th scope="col">Condition</th><th scope="col">{m.tx.category}</th><th scope="col" className="num">Matches</th><th scope="col">{m.categories.enabled}</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rules.data.map((r) => (
              <tr key={r.id} className={r.enabled ? '' : 'muted-row'}>
                <td>{r.priority}</td>
                <td>{r.field === 'merchant' ? 'Merchant' : 'Description'} {r.match_type.replace('_', ' ')} “{r.pattern}”{r.direction !== 'any' && <small className="muted"> ({r.direction === 'out' ? 'money out' : 'money in'})</small>}</td>
                <td>{r.category_name}</td>
                <td className="num"><Link to={`/transactions?q=${encodeURIComponent(r.pattern)}`}>{r.match_count}</Link></td>
                <td><label className="switch"><input type="checkbox" checked={!!r.enabled} disabled={act.busy} onChange={(e) => act.run(async () => { try { await api(`/rules/${r.id}`, { method: 'PATCH', body: { enabled: e.target.checked } }); await done(e.target.checked ? 'Rule enabled' : 'Rule disabled'); } catch (er) { fail(er); } })} /><span className="sr-only">{m.categories.enabled}</span></label></td>
                <td className="actions"><button className="btn btn-small" onClick={() => setEditRule(r)}>{m.common.edit}</button><button className="btn btn-small btn-danger" onClick={() => setDelRule(r)}>{m.common.delete}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title={m.categories.categories}>
        <Help>{m.categories.archiveHelp}</Help>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { try { await api('/categories', { method: 'POST', body: { name: newName } }); setNewName(''); await done('Category added'); } catch (er) { fail(er); } }); }}>
          <label className="sr-only" htmlFor="newcat">New category name</label>
          <input id="newcat" placeholder="New category name" maxLength={40} required value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn btn-primary" disabled={act.busy}>{m.categories.add}</button>
        </form>
        <ul className="list">
          {cats.data.map((c) => (
            <li key={c.id} className="list-row">
              <span className="row">
                <label className="sr-only" htmlFor={`col-${c.id}`}>Colour for {c.name}</label>
                <input id={`col-${c.id}`} type="color" value={c.color} onChange={(e) => patchCat(c, { color: e.target.value }, m.common.saved)} />
                <strong>{c.name}</strong> {c.archived_at && <Badge tone="muted">{m.categories.archived}</Badge>}
                <Link to={`/transactions?category=${c.id}`} className="muted">{c.tx_count} transactions</Link>
              </span>
              <span className="row">
                <button className="link" onClick={() => { const n = prompt('Rename category', c.name); if (n && n.trim() && n.trim() !== c.name) patchCat(c, { name: n.trim() }, 'Renamed'); }}>Rename</button>
                {c.key !== 'uncategorized' && c.key !== 'income' && <button className="link" onClick={() => patchCat(c, { archived: !c.archived_at }, c.archived_at ? 'Restored' : 'Archived')}>{c.archived_at ? m.categories.unarchive : m.categories.archive}</button>}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {editRule && <RuleEditor rule={editRule} categories={cats.data.filter((c) => !c.archived_at)} onClose={(changed) => { setEditRule(null); if (changed) void done(m.common.saved); }} />}
      <Confirm open={!!delRule} title="Delete rule?" text={`Transactions matched by “${delRule?.pattern}” will be re-categorized automatically. Your manual choices on individual transactions are kept.`} confirmLabel={m.common.delete} danger busy={act.busy}
        onClose={() => setDelRule(null)} onConfirm={() => act.run(async () => { try { await api(`/rules/${delRule!.id}`, { method: 'DELETE' }); setDelRule(null); await done('Rule deleted'); } catch (e) { fail(e); } })} />
    </div>
  );
}

function RuleEditor({ rule, categories, onClose }: { rule: Partial<Rule>; categories: Category[]; onClose: (changed: boolean) => void }) {
  const { fmt } = useSession();
  const toast = useToast();
  const [r, setR] = useState<Partial<Rule>>(rule);
  const [preview, setPreview] = useState<Preview | null>(null);
  const { busy, run } = useAction();
  const body = { field: r.field, match_type: r.match_type, pattern: r.pattern ?? '', direction: r.direction, category_id: r.category_id, priority: Number(r.priority ?? 100), enabled: !!r.enabled, account_id: r.account_id ?? null };
  const valid = (r.pattern ?? '').trim().length >= 2 && !!r.category_id;
  const doPreview = () => run(async () => { try { setPreview(await api<Preview>('/rules/preview', { method: 'POST', body })); } catch (e) { toast((e as Error).message, { kind: 'error' }); } });
  const save = () => run(async () => {
    try {
      if (rule.id) await api(`/rules/${rule.id}`, { method: 'PATCH', body }); else await api('/rules', { method: 'POST', body });
      onClose(true);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  const set = (p: Partial<Rule>) => { setR({ ...r, ...p }); setPreview(null); };
  return (
    <Modal open wide title={rule.id ? 'Edit rule' : m.categories.addRule} onClose={() => onClose(false)} footer={<>
      <button className="btn" onClick={() => onClose(false)}>{m.common.cancel}</button>
      <button className="btn" disabled={!valid || busy} onClick={doPreview}>{m.categories.preview}</button>
      <button className="btn btn-primary" disabled={!valid || busy || !preview} title={preview ? undefined : 'Preview first'} onClick={save}>{m.common.save} &amp; apply</button>
    </>}>
      <div className="form-grid">
        <Field label={m.categories.field}>{(id) => <select id={id} value={r.field} onChange={(e) => set({ field: e.target.value as Rule['field'] })}><option value="merchant">Merchant name</option><option value="description">Bank description</option></select>}</Field>
        <Field label={m.categories.matchType}>{(id) => <select id={id} value={r.match_type} onChange={(e) => set({ match_type: e.target.value as Rule['match_type'] })}><option value="contains">contains</option><option value="equals">equals</option><option value="starts_with">starts with</option></select>}</Field>
        <Field label={m.categories.pattern} hint="Case and accents are ignored. Avoid very short or generic text such as “PAG” or “MB WAY”.">{(id, d) => <input id={id} aria-describedby={d} minLength={2} maxLength={100} value={r.pattern ?? ''} onChange={(e) => set({ pattern: e.target.value })} />}</Field>
        <Field label={m.categories.direction}>{(id) => <select id={id} value={r.direction} onChange={(e) => set({ direction: e.target.value as Rule['direction'] })}><option value="out">Money out</option><option value="in">Money in</option><option value="any">Both</option></select>}</Field>
        <Field label={m.tx.category}>{(id) => <select id={id} value={r.category_id ?? ''} onChange={(e) => set({ category_id: Number(e.target.value) })}><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <Field label={m.categories.priority} hint="Lower numbers win when several rules match.">{(id, d) => <input id={id} aria-describedby={d} type="number" min={0} max={1000} value={r.priority ?? 100} onChange={(e) => set({ priority: Number(e.target.value) })} />}</Field>
      </div>
      {preview && (
        <div role="status" className="preview">
          <p><strong>{preview.count}</strong> {m.categories.previewResult} <strong>{preview.changes}</strong>. {preview.overridden > 0 && <>{preview.overridden} {m.categories.overridden}.</>}</p>
          {preview.count > 200 && <p className="alert alert-warn">This rule matches many transactions. Make sure it is not too broad.</p>}
          <ul className="list small">{preview.sample.slice(0, 10).map((s) => <li key={s.id}>{fmt.date(s.booking_date)} · {s.merchant} · <span className="mono">{s.description}</span> · <Money minor={s.amount_minor} currency={s.currency} /></li>)}</ul>
        </div>
      )}
    </Modal>
  );
}

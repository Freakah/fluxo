import { useState } from 'react';
import { Link } from 'react-router';
import { api, useAction, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Card, ErrorBox, Loading, Money, Progress, stateBadge, Help, Field } from '../components/ui.tsx';
import { addMonths, monthBounds } from '../../../shared/dates.ts';
import { minorToDecimal } from '../../../shared/money.ts';
import type { BudgetLine, Category } from '../types.ts';

type B = { month: string; currency: string; thresholds: number[]; isCurrentMonth: boolean; total: BudgetLine | null; categories: BudgetLine[] };

function Line({ l, currency, title, editable, onSave, onRemove, link }: { l: BudgetLine; currency: string; title: string; editable: boolean; onSave: (v: string) => Promise<void>; onRemove?: () => Promise<void>; link: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(minorToDecimal(l.amount, currency));
  const { busy, run } = useAction();
  const diff = l.spent - l.previousSpent;
  return (
    <div className="budget-line">
      <div className="budget-top">
        <h3><Link to={link}>{title}</Link></h3>
        {stateBadge(l.state)}
      </div>
      <Progress pct={l.pct} state={l.state} label={`${title}: ${l.pct}% used`} />
      <p className="budget-nums">
        <span><Money minor={l.spent} currency={currency} /> {m.budgets.spent} {m.budgets.of} <Money minor={l.amount} currency={currency} /> ({l.pct}%)</span>
        <span className={l.remaining < 0 ? 'neg' : ''}><Money minor={Math.abs(l.remaining)} currency={currency} /> {l.remaining < 0 ? m.budgets.over : m.budgets.left}</span>
      </p>
      <p className="help">
        {l.pending > 0 && <>+ <Money minor={l.pending} currency={currency} /> pending (not counted yet) · </>}
        {m.budgets.previous}: <Money minor={l.previousSpent} currency={currency} /> ({diff >= 0 ? '+' : '−'}<Money minor={Math.abs(diff)} currency={currency} />)
      </p>
      {editable && (editing ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { await onSave(v.replace(',', '.')); setEditing(false); }); }}>
          <label className="sr-only" htmlFor={`b-${l.categoryId ?? 't'}`}>{m.budgets.amount}</label>
          <input id={`b-${l.categoryId ?? 't'}`} inputMode="decimal" pattern="\d+([.,]\d{1,2})?" required value={v} onChange={(e) => setV(e.target.value)} />
          <button className="btn btn-primary btn-small" disabled={busy}>{m.common.save}</button>
          <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>{m.common.cancel}</button>
          {onRemove && <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => run(onRemove)}>{m.budgets.remove}</button>}
        </form>
      ) : <button className="link" onClick={() => setEditing(true)}>{m.common.edit}</button>)}
    </div>
  );
}

export function Budgets() {
  const { fmt, settings } = useSession();
  const toast = useToast();
  const [month, setMonth] = useState<string | null>(null);
  const b = useApi<B>(`/budgets${month ? `?month=${month}` : ''}`);
  const cats = useApi<Category[]>('/categories');
  const [newCat, setNewCat] = useState('');
  const [newAmt, setNewAmt] = useState('');
  const add = useAction();
  if (b.error) return <ErrorBox error={b.error} onRetry={() => b.reload()} />;
  if (!b.data) return <Loading />;
  const x = b.data;
  const save = (categoryId: number | null) => async (amount: string | null) => {
    try { await api('/budgets', { method: 'PUT', body: { categoryId, amount } }); toast(m.common.saved); await b.reload(true); } catch (e) { toast((e as Error).message, { kind: 'error' }); throw e; }
  };
  const used = new Set(x.categories.map((c) => c.categoryId));
  const available = (cats.data ?? []).filter((c) => !c.archived_at && !used.has(c.id) && c.key !== 'income');
  const txLink = (catId: number | null) => `/transactions?from=${x.month}-01&to=${monthBounds(x.month).to}&status=posted${catId ? `&category=${catId}` : ''}`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>{m.budgets.title}</h1>
        <div className="row" role="group" aria-label="Month">
          <button className="btn btn-small" onClick={() => setMonth(addMonths(x.month, -1))} aria-label="Previous month">‹</button>
          <strong aria-live="polite">{fmt.month(x.month)}</strong>
          <button className="btn btn-small" onClick={() => setMonth(addMonths(x.month, 1))} disabled={x.isCurrentMonth} aria-label="Next month">›</button>
        </div>
      </div>
      {!x.isCurrentMonth && <p className="help">{m.budgets.notCurrent}</p>}
      <Card title={m.budgets.total}>
        {x.total ? <Line l={x.total} currency={x.currency} title={m.budgets.total} editable={x.isCurrentMonth} onSave={save(null)} onRemove={() => save(null)(null)} link={txLink(null)} /> : (
          x.isCurrentMonth ? <SetTotal onSave={save(null)} currency={settings.currency} /> : <p className="muted">No monthly budget was set for this month.</p>
        )}
      </Card>
      <Card title={m.budgets.category}>
        <Help>{m.budgets.categoryHelp}</Help>
        {x.categories.map((l) => <Line key={l.categoryId} l={l} currency={x.currency} title={l.name ?? 'Category'} editable={x.isCurrentMonth} onSave={save(l.categoryId)} onRemove={() => save(l.categoryId)(null)} link={txLink(l.categoryId)} />)}
        {x.isCurrentMonth && (
          <form className="row add-budget" onSubmit={(e) => { e.preventDefault(); void add.run(async () => { await save(Number(newCat))(newAmt.replace(',', '.')); setNewCat(''); setNewAmt(''); }); }}>
            <Field label={m.tx.category}>{(id) => <select id={id} required value={newCat} onChange={(e) => setNewCat(e.target.value)}><option value="">Choose…</option>{available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
            <Field label={`${m.budgets.amount} (${x.currency})`}>{(id) => <input id={id} required inputMode="decimal" pattern="\d+([.,]\d{1,2})?" value={newAmt} onChange={(e) => setNewAmt(e.target.value)} />}</Field>
            <button className="btn btn-primary" disabled={add.busy}>{m.budgets.add}</button>
          </form>
        )}
      </Card>
      <Card title={m.budgets.rules}>
        <p>{m.budgets.rulesText}</p>
        <p className="help">Alerts at {x.thresholds.join('% and ')}% (change in <Link to="/settings">Settings</Link>).</p>
      </Card>
    </div>
  );
}

function SetTotal({ onSave, currency }: { onSave: (v: string) => Promise<void>; currency: string }) {
  const [v, setV] = useState('');
  const { busy, run } = useAction();
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => onSave(v.replace(',', '.'))); }}>
      <Field label={`${m.budgets.amount} (${currency})`}>{(id) => <input id={id} required inputMode="decimal" pattern="\d+([.,]\d{1,2})?" value={v} onChange={(e) => setV(e.target.value)} />}</Field>
      <button className="btn btn-primary" disabled={busy}>{m.dashboard.setBudget}</button>
    </form>
  );
}

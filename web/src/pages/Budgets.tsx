import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Lightbulb, Check } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { m, t as tr, T } from '../i18n.ts';
import { useCategories, useSession, useToast } from '../state.tsx';
import { Card, Empty, ErrorBox, Loading, Money, Progress, Ring, stateBadge, Modal, PageHeader, Info } from '../components/ui.tsx';
import { CatIcon } from '../components/icons.tsx';
import { CategoryPicker } from './Transactions.tsx';
import { addMonths, monthBounds, todayIn, monthOf } from '../../../shared/dates.ts';
import { currencyExponent, minorToDecimal, parseAmountToMinor } from '../../../shared/money.ts';
import type { BudgetLine } from '../types.ts';

type B = { month: string; currency: string; thresholds: number[]; isCurrentMonth: boolean; total: BudgetLine | null; categories: BudgetLine[] };
type Wizard = { categoryId: number | null; amount: number | null; edit: boolean; total?: boolean };

export function Budgets() {
  const { fmt, settings } = useSession();
  const { byId, list: cats } = useCategories();
  const toast = useToast();
  const [month, setMonth] = useState<string | null>(null);
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const b = useApi<B>(`/budgets${month ? `?month=${month}` : ''}`);
  if (b.error) return <div className="page"><ErrorBox error={b.error} onRetry={() => b.reload()} /></div>;
  if (!b.data) return <div className="page"><Loading rows={5} /></div>;
  const x = b.data;
  const save = async (categoryId: number | null, amount: string | null) => {
    try { await api('/budgets', { method: 'PUT', body: { categoryId, amount } }); toast(amount === null ? tr('Budget removed') : m.common.saved); await b.reload(true); } catch (e) { toast((e as Error).message, { kind: 'error' }); throw e; }
  };
  const used = new Set(x.categories.map((c) => c.categoryId));
  const available = cats.filter((c) => !c.archived_at && !used.has(c.id) && c.key !== 'income');
  const txLink = (catId: number | null) => `/transactions?from=${x.month}-01&to=${monthBounds(x.month).to}&status=posted${catId ? `&category=${catId}` : ''}`;
  const today = todayIn(settings.timezone);
  const daysLeft = x.isCurrentMonth ? monthBounds(x.month).days - Number(today.slice(8)) + 1 : 0;
  const t = x.total;

  return (
    <div className="page">
      <PageHeader title={m.budgets.title} subtitle={tr('Decide how much to spend, and see how you are doing.')} info={<>{m.budgets.rulesText} {tr('Alerts at {list}% (change in Settings).', { list: x.thresholds.join('% · ') })}</>}
        actions={<div className="segmented" role="group" aria-label={tr('Month')}>
          <button onClick={() => setMonth(addMonths(x.month, -1))} aria-label={tr('Previous month')}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button className="on" aria-live="polite" tabIndex={-1}>{fmt.month(x.month)}</button>
          <button onClick={() => setMonth(addMonths(x.month, 1))} disabled={x.isCurrentMonth} aria-label={tr('Next month')}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>} />
      {!x.isCurrentMonth && <div className="alert alert-info" role="note">{m.budgets.notCurrent}</div>}

      <Card title={m.budgets.total}>
        {t ? (
          <div className="budget-hero">
            <Ring pct={t.pct} state={t.state} size={150} label={tr('{pct}% of the monthly budget used', { pct: t.pct })}>
              <span><strong>{t.pct}%</strong><br /><small className="muted">{tr('used')}</small></span>
            </Ring>
            <div className="budget-hero-text stack" style={{ gap: '.4rem' }}>
              <div className="row">{stateBadge(t.state)}</div>
              <div className={`big ${t.remaining < 0 ? 'neg' : ''}`}><T s={t.remaining < 0 ? '{amount} over' : '{amount} left'} amount={<Money minor={Math.abs(t.remaining)} currency={x.currency} />} /></div>
              <div className="muted"><T s="{spent} spent of {amount}" spent={<Money minor={t.spent} currency={x.currency} />} amount={<Money minor={t.amount} currency={x.currency} />} /></div>
              {daysLeft > 0 && t.remaining > 0 && <div className="suggest"><Lightbulb size={18} aria-hidden="true" /><span><T s="About {amount} a day for the next {n} days." amount={<strong><Money minor={Math.floor(t.remaining / daysLeft)} currency={x.currency} /></strong>} n={daysLeft} /></span></div>}
              {t.pending > 0 && <small className="muted"><T s="+ {amount} processing (not counted yet)" amount={<Money minor={t.pending} currency={x.currency} />} /></small>}
              <div className="row">
                <Link to={txLink(null)} className="btn btn-small">{tr('See payments')}</Link>
                {x.isCurrentMonth && <button className="btn btn-small" onClick={() => setWizard({ categoryId: null, amount: t.amount, edit: true, total: true })}><Pencil size={15} aria-hidden="true" />{m.common.edit}</button>}
              </div>
            </div>
          </div>
        ) : x.isCurrentMonth
          ? <Empty art="target" title={tr('Create a monthly budget')} action={<button className="btn btn-primary" onClick={() => setWizard({ categoryId: null, amount: null, edit: false, total: true })}><Plus size={18} aria-hidden="true" />{tr('Create budget')}</button>}>{tr('Choose one amount for all your spending this month. Fluxo suggests one from your last 3 months.')}</Empty>
          : <p className="muted">{tr('No monthly budget was set for this month.')}</p>}
      </Card>

      <section aria-labelledby="catb">
        <div className="card-head"><h2 id="catb">{m.budgets.category}<Info>{m.budgets.categoryHelp}</Info></h2></div>
        <div className="budget-grid">
          {x.categories.map((l) => {
            const c = l.categoryId ? byId.get(l.categoryId) : undefined;
            const diff = l.spent - l.previousSpent;
            return (
              <article key={l.categoryId} className="budget-card">
                <div className="budget-card-top">
                  <CatIcon cat={c ?? { color: l.color }} size={40} />
                  <h3><Link to={txLink(l.categoryId)}>{l.name ?? tr('Category')}</Link></h3>
                  {stateBadge(l.state)}
                </div>
                <Progress pct={l.pct} state={l.state} label={tr('{name}: {pct}% used', { name: l.name ?? '', pct: l.pct })} />
                <div className="budget-nums">
                  <span><T s="{spent} of {amount}" spent={<strong><Money minor={l.spent} currency={x.currency} /></strong>} amount={<Money minor={l.amount} currency={x.currency} />} /></span>
                  <span className={l.remaining < 0 ? 'neg' : 'muted'}><T s={l.remaining < 0 ? '{amount} over' : '{amount} left'} amount={<Money minor={Math.abs(l.remaining)} currency={x.currency} />} /></span>
                </div>
                <small className="muted">{m.budgets.previous}: <Money minor={l.previousSpent} currency={x.currency} /> ({diff >= 0 ? '+' : '−'}<Money minor={Math.abs(diff)} currency={x.currency} />){l.pending > 0 && <> · <T s="+ {amount} processing" amount={<Money minor={l.pending} currency={x.currency} />} /></>}</small>
                {x.isCurrentMonth && (
                  <div className="row">
                    <button className="btn btn-small" onClick={() => setWizard({ categoryId: l.categoryId, amount: l.amount, edit: true })} aria-label={tr('Edit {name} budget', { name: l.name ?? '' })}><Pencil size={15} aria-hidden="true" />{m.common.edit}</button>
                    <button className="btn btn-small btn-ghost" onClick={() => save(l.categoryId, null)} aria-label={tr('Remove {name} budget', { name: l.name ?? '' })}><Trash2 size={15} aria-hidden="true" />{tr('Remove')}</button>
                  </div>
                )}
              </article>
            );
          })}
          {x.isCurrentMonth && available.length > 0 && (
            <button className="budget-card add-card" onClick={() => setWizard({ categoryId: available[0].id, amount: null, edit: false })}><Plus size={28} aria-hidden="true" />{m.budgets.add}</button>
          )}
        </div>
        {!x.categories.length && !x.isCurrentMonth && <p className="muted">{tr('No category budgets this month.')}</p>}
      </section>

      {wizard && <BudgetWizard w={wizard} currency={x.currency} options={wizard.edit || wizard.total ? [] : available} onClose={() => setWizard(null)}
        onSave={async (cat, amt) => { await save(cat, amt); setWizard(null); }} />}
    </div>
  );
}

/** Three short steps: choose what to budget, pick an amount (with a suggestion), confirm. */
function BudgetWizard({ w, currency, options, onClose, onSave }: { w: Wizard; currency: string; options: ReturnType<typeof useCategories>['list']; onClose: () => void; onSave: (cat: number | null, amount: string) => Promise<void> }) {
  const { settings, fmt } = useSession();
  const { byId } = useCategories();
  const isTotal = !!w.total;
  const [step, setStep] = useState(w.edit || isTotal ? 1 : 0);
  const [cat, setCat] = useState<number | null>(w.categoryId);
  const [amt, setAmt] = useState(w.amount !== null ? minorToDecimal(w.amount, currency) : '');
  const { busy, run } = useAction();
  const cur = monthOf(todayIn(settings.timezone));
  const hist = useApi<{ totals: { currency: string; spending: number }[]; byCategory: { categoryId: number | null; currency: string; spending: number }[] }>(
    `/reports?from=${addMonths(cur, -3)}-01&to=${monthBounds(addMonths(cur, -1)).to}`);
  const spent3 = hist.data ? (cat === null ? hist.data.totals.find((t) => t.currency === currency)?.spending : hist.data.byCategory.find((c) => c.categoryId === cat && c.currency === currency)?.spending) ?? 0 : null;
  const step10 = 10 * 10 ** currencyExponent(currency); // suggestions round up to 10 whole currency units
  const suggestion = spent3 !== null && spent3 > 0 ? Math.ceil(spent3 / 3 / step10) * step10 : null;
  const amountMinor = (() => { try { return parseAmountToMinor(amt.replace(',', '.'), currency); } catch { return 0; } })();
  const sliderMax = Math.max(step10 * 10, (suggestion ?? 0) * 2, amountMinor);
  const valid = /^\d+([.,]\d{1,2})?$/.test(amt) && amountMinor > 0;
  const name = cat === null ? tr('All spending') : byId.get(cat)?.name ?? tr('Category');
  const steps = (isTotal || w.edit ? ['Amount', 'Confirm'] : ['Category', 'Amount', 'Confirm']).map((s) => tr(s));
  const idx = isTotal || w.edit ? step - 1 : step;

  return (
    <Modal open title={w.edit ? tr('Edit budget: {name}', { name }) : cat === null ? tr('Create a monthly budget') : m.budgets.add} onClose={onClose} footer={<>
      {step > (isTotal || w.edit ? 1 : 0) && <button className="btn" onClick={() => setStep(step - 1)}>{m.common.back}</button>}
      <span className="spacer" />
      {step < 2 ? <button className="btn btn-primary" disabled={step === 1 && !valid} onClick={() => setStep(step + 1)}>{tr('Continue')}</button>
        : <button className="btn btn-primary" disabled={busy || !valid} onClick={() => run(() => onSave(cat, amt.replace(',', '.')))}><Check size={18} aria-hidden="true" />{tr('Save budget')}</button>}
    </>}>
      <div className="steps-dots" aria-label={tr('Step {i} of {n}: {name}', { i: idx + 1, n: steps.length, name: steps[idx] })} role="img">{steps.map((s, k) => <span key={s} className={k === idx ? 'on' : ''} />)}</div>
      {step === 0 && <>
        <p className="lede">{tr('Which category do you want to keep an eye on?')}</p>
        <CategoryPicker label={m.tx.category} categories={options} value={cat} onChange={(v) => v !== null && setCat(v)} />
      </>}
      {step === 1 && <>
        <div className="row"><CatIcon cat={cat === null ? { color: '#2563eb', icon: 'wallet' } : byId.get(cat)} size={44} /><strong>{name}</strong></div>
        <div className="field">
          <label htmlFor="budget-amt">{m.budgets.amount} ({currency})</label>
          <div className="amount-input"><span aria-hidden="true">{fmt.currencySymbol(currency)}</span><input id="budget-amt" autoFocus data-autofocus inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
        </div>
        <label className="sr-only" htmlFor="budget-slider">{tr('Adjust amount')}</label>
        <input id="budget-slider" type="range" min={0} max={sliderMax} step={step10 / 2} value={amountMinor} onChange={(e) => setAmt(minorToDecimal(Number(e.target.value), currency))} />
        {suggestion !== null
          ? <button type="button" className="suggest" style={{ border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setAmt(minorToDecimal(suggestion, currency))}><Lightbulb size={18} aria-hidden="true" /><span><T s="You spent about {amount} a month lately. Use {suggestion}?" amount={<strong><Money minor={Math.round(spent3! / 3)} currency={currency} /></strong>} suggestion={<strong><Money minor={suggestion} currency={currency} /></strong>} /></span></button>
          : hist.data && <small className="muted">{tr('Not enough history yet for a suggestion.')}</small>}
      </>}
      {step === 2 && (
        <div className="welcome">
          <Ring pct={0} state="ok" size={120} label={tr('New budget')}><CatIcon cat={cat === null ? { color: '#2563eb', icon: 'wallet' } : byId.get(cat)} size={48} /></Ring>
          <h3><T s="{name}: {amount} a month" name={name} amount={<Money minor={amountMinor} currency={currency} />} /></h3>
          <p>{tr('Starts with this month and continues every month until you change it. Unused money does not roll over.')}</p>
        </div>
      )}
    </Modal>
  );
}

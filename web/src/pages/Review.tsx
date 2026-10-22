import { useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { Check, Shuffle, HandCoins, ChevronRight } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { m, t as tr, T } from '../i18n.ts';
import { useCategories, useSession, useToast } from '../state.tsx';
import { Empty, ErrorBox, Loading, Modal, Money, PageHeader, Progress, Switch, Confirm } from '../components/ui.tsx';
import { CatIcon } from '../components/icons.tsx';
import { CategoryPicker, PaidBackPicker } from './Transactions.tsx';
import type { Tx } from '../types.ts';

const touch = () => window.matchMedia?.('(pointer: coarse)').matches;

/** One payment at a time: confirm its category or change it. Swipe right = right, left = change (touch only). */
export function Review() {
  const { fmt } = useSession();
  const { list: cats, byId } = useCategories();
  const toast = useToast();
  const q = useApi<{ rows: Tx[]; total: number }>('/review');
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [changing, setChanging] = useState(false);
  const [payback, setPayback] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const act = useAction();
  const rows = q.data?.rows.filter((r) => !skipped.has(r.id)) ?? [];
  const t = rows[0];
  const [done, setDone] = useState(0); // checked during this visit, for the progress bar

  const after = async () => { setDone((n) => n + 1); await q.reload(true); window.dispatchEvent(new Event('fluxo:review')); };
  const accept = () => t && act.run(async () => {
    try {
      await api('/review/done', { method: 'POST', body: { ids: [t.id] } });
      await after();
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  const acceptAll = () => act.run(async () => {
    try { await api('/review/done', { method: 'POST', body: {} }); setAllOpen(false); await q.reload(true); window.dispatchEvent(new Event('fluxo:review')); toast(tr('All marked as checked')); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  const swipe = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => { if (e.pointerType === 'mouse') return; start.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); },
    onPointerMove: (e: PointerEvent) => { if (start.current !== null) setDx(e.clientX - start.current); },
    onPointerUp: () => { if (dx > 90) void accept(); else if (dx < -90) setChanging(true); start.current = null; setDx(0); },
    onPointerCancel: () => { start.current = null; setDx(0); },
  };

  if (q.error) return <div className="page"><ErrorBox error={q.error} onRetry={() => q.reload()} /></div>;
  if (!q.data) return <div className="page"><Loading rows={4} /></div>;
  const cat = t?.category_id ? byId.get(t.category_id) ?? { color: t.category_color } : null;
  const known = !!t?.category_id && byId.get(t.category_id)?.key !== 'uncategorized';
  const total = done + Math.max(rows.length, (q.data.total ?? 0) - skipped.size);

  return (
    <div className="page page-narrow">
      <PageHeader title={m.review.title} subtitle={m.review.subtitle} actions={rows.length > 1 && <button className="btn" onClick={() => setAllOpen(true)}><Check size={18} aria-hidden="true" />{m.review.allRight}</button>} />
      {!t ? (
        <div className="card"><Empty art="done" title={m.review.empty} action={<Link className="btn btn-primary" to="/">{m.review.backHome}</Link>}>
          {skipped.size ? <>{tr('You skipped {n}.', { n: skipped.size })} <button className="link" onClick={() => setSkipped(new Set())}>{tr('Show them again')}</button></> : m.review.emptyText}
        </Empty></div>
      ) : (
        <>
          <div className="review-progress">
            <span><T s="{i} of {n}" i={<strong>{done + 1}</strong>} n={total} /></span>
            <Progress pct={(done / total) * 100} state="ok" label={tr('{i} of {n} checked', { i: done, n: total })} />
          </div>
          <article className="card review-card" aria-live="polite" aria-label={`${tr(t.merchant)}, ${fmt.money(t.amount_minor, t.currency, 'always')}`} {...swipe}
            style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 30}deg)` : undefined, transition: dx ? 'none' : undefined }}>
            {dx > 40 && <span className="swipe-tag ok" aria-hidden="true"><Check size={18} /> {tr('Right')}</span>}
            {dx < -40 && <span className="swipe-tag change" aria-hidden="true"><Shuffle size={18} /> {tr('Change')}</span>}
            <CatIcon cat={cat} size={72} />
            <h2 className="review-merchant">{tr(t.merchant)}</h2>
            <div className="review-amount"><Money minor={t.amount_minor} currency={t.currency} sign="always" /></div>
            <div className="muted">{fmt.date(t.booking_date)} · {t.account_display_name ?? t.account_name}{t.status === 'pending' && ` · ${m.statuses.pending}`}</div>
            <p className="review-question">{known
              ? <T s="Is this {category}?" category={<strong>{t.category_name}</strong>} />
              : tr('Which category is this?')}</p>
            <p className="mono small muted review-desc">{t.description}</p>
          </article>
          <div className="review-actions">
            <button className="btn btn-big" onClick={() => setChanging(true)} disabled={act.busy}><Shuffle size={20} aria-hidden="true" />{m.review.change}</button>
            {known
              ? <button className="btn btn-primary btn-big" onClick={accept} disabled={act.busy}><Check size={20} aria-hidden="true" />{m.review.right}</button>
              : <button className="btn btn-big" onClick={accept} disabled={act.busy}>{m.review.leave}</button>}
          </div>
          <div className="review-more">
            <button className="link" onClick={() => setSkipped(new Set(skipped).add(t.id))}>{m.review.skip}<ChevronRight size={16} aria-hidden="true" /></button>
            {t.type !== 'transfer' && <button className="link" onClick={() => setPayback(true)}><HandCoins size={16} aria-hidden="true" />{t.amount_minor > 0 ? m.paidBack.thisPaidBack : m.paidBack.someonePaid}</button>}
          </div>
          {touch() && <p className="help center">{m.review.swipeHint}</p>}
          {changing && <ChangeCategory tx={t} categories={cats.filter((c) => !c.archived_at)} onClose={(changed) => { setChanging(false); if (changed) void after(); }} />}
          {payback && <PaidBackPicker tx={t} onClose={(changed) => { setPayback(false); if (changed) void after(); }} />}
        </>
      )}
      <Confirm open={allOpen} title={m.review.allRight} text={m.review.allRightText} confirmLabel={m.review.allRight} busy={act.busy} onConfirm={acceptAll} onClose={() => setAllOpen(false)} />
    </div>
  );
}

function ChangeCategory({ tx: t, categories, onClose }: { tx: Tx; categories: ReturnType<typeof useCategories>['list']; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [cat, setCat] = useState<number | null>(t.category_source === 'user' ? t.category_id : null);
  const [remember, setRemember] = useState(true);
  const { busy, run } = useAction();
  const save = () => run(async () => {
    try {
      await api(`/transactions/${t.id}`, { method: 'PATCH', body: { categoryId: cat } });
      if (remember && cat) await api('/rules', { method: 'POST', body: { field: 'merchant', match_type: 'equals', pattern: t.merchant, direction: t.amount_minor < 0 ? 'out' : 'in', category_id: cat } });
      toast(remember && cat ? tr('Saved. Future “{merchant}” payments will use this too.', { merchant: tr(t.merchant) }) : m.common.saved);
      onClose(true);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  return (
    <Modal open title={`${m.review.chooseFor} ${tr(t.merchant)}`} onClose={() => onClose(false)} footer={<><button className="btn" onClick={() => onClose(false)}>{m.common.cancel}</button><button className="btn btn-primary" disabled={busy || !cat} onClick={save}>{m.common.save}</button></>}>
      <CategoryPicker label={m.tx.category} categories={categories} value={cat} onChange={setCat} />
      {cat && <div className="field"><Switch checked={remember} onChange={setRemember} label={tr('Always use this for “{merchant}”', { merchant: tr(t.merchant) })} /></div>}
    </Modal>
  );
}

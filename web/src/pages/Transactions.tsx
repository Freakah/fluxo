import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, Plus, Download, SlidersHorizontal, ListChecks, Hourglass, Ban, Undo2, ArrowLeftRight, ArrowDownLeft, EyeOff, PencilLine, CircleHelp, Sparkles, RotateCcw } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useCategories, useSession, useToast } from '../state.tsx';
import { Badge, Card, Empty, ErrorBox, Loading, Money, Modal, Field, PageHeader, Switch } from '../components/ui.tsx';
import { CatIcon } from '../components/icons.tsx';
import { addDays, addMonths, monthBounds, monthOf, todayIn } from '../../../shared/dates.ts';
import type { Account, Category, Tx } from '../types.ts';

const FILTER_KEYS = ['q', 'accounts', 'from', 'to', 'category', 'type', 'status', 'min', 'max', 'sort', 'excluded', 'review', 'source'] as const;
const PAGE = 50;
const S = 13;

export function txBadges(t: Tx) {
  return (
    <>
      {t.status === 'pending' && <Badge tone="warn" icon={<Hourglass size={S} />}>{m.statuses.pending}</Badge>}
      {t.status === 'cancelled' && <Badge tone="muted" icon={<Ban size={S} />}>{m.statuses.cancelled}</Badge>}
      {t.type === 'refund' && <Badge tone="ok" icon={<Undo2 size={S} />}>{m.types.refund}</Badge>}
      {t.type === 'transfer' && <Badge tone="info" icon={<ArrowLeftRight size={S} />}>{m.types.transfer}</Badge>}
      {t.type === 'income' && <Badge tone="ok" icon={<ArrowDownLeft size={S} />}>{m.types.income}</Badge>}
      {!!t.excluded && <Badge tone="muted" icon={<EyeOff size={S} />}>Not counted</Badge>}
      {t.source === 'manual' && <Badge tone="info" icon={<PencilLine size={S} />}>{m.tx.manual}</Badge>}
      {t.needs_review && <Badge tone="warn" icon={<CircleHelp size={S} />}>{m.tx.review}</Badge>}
      {t.original_pending_amount_minor !== null && <Badge tone="muted">amount changed</Badge>}
    </>
  );
}

function dayLabel(d: string, today: string, fmt: ReturnType<typeof useSession>['fmt']) {
  if (d === today) return 'Today';
  if (d === addDays(today, -1)) return 'Yesterday';
  return fmt.date(d);
}

export function TxList({ rows, selected, onToggle, onOpen, grouped }: { rows: Tx[]; selected?: Set<number>; onToggle?: (id: number) => void; onOpen?: (t: Tx) => void; grouped?: boolean }) {
  const { fmt, settings } = useSession();
  const { byId } = useCategories();
  if (!rows.length) return <Empty art="search" title={m.tx.none}>Try another search or clear the filters.</Empty>;
  const today = todayIn(settings.timezone);
  const row = (t: Tx) => {
    const cat = t.category_id ? byId.get(t.category_id) ?? { color: t.category_color } : null;
    return (
      <li key={t.id} className={`tx ${t.status !== 'posted' ? 'tx-' + t.status : ''} ${t.excluded ? 'tx-excluded' : ''}`}>
        {onToggle && <span className="tx-check"><input type="checkbox" aria-label={`Select ${t.merchant} ${fmt.date(t.booking_date)}`} checked={selected?.has(t.id) ?? false} onChange={() => onToggle(t.id)} /></span>}
        <button className="tx-main" onClick={() => onOpen?.(t)} disabled={!onOpen} aria-label={onOpen ? `Open ${t.merchant}, ${fmt.date(t.booking_date)}` : undefined}>
          <CatIcon cat={cat} transfer={t.type === 'transfer'} size={40} />
          <span className="tx-text">
            <span className="tx-merchant">{t.merchant}</span>
            <span className="tx-sub">
              {t.type !== 'transfer' && <span className="cat">{t.category_name ?? 'Uncategorized'}{t.confidence === 'low' && ' · check'}</span>}
              <span>· {grouped ? t.account_display_name ?? t.account_name : fmt.shortDate(t.booking_date)}</span>
            </span>
          </span>
          <span className="tx-right">
            <Money minor={t.amount_minor} currency={t.currency} sign="always" className="tx-amount" />
            <span className="tx-badges">{txBadges(t)}</span>
          </span>
        </button>
      </li>
    );
  };
  if (!grouped) return <ul className="txlist">{rows.map(row)}</ul>;
  const days: [string, Tx[]][] = [];
  for (const t of rows) { const last = days.at(-1); if (last && last[0] === t.booking_date) last[1].push(t); else days.push([t.booking_date, [t]]); }
  return (
    <div className="txlist">
      {days.map(([d, txs]) => {
        const net = txs.filter((t) => t.status !== 'cancelled' && !t.excluded && t.type !== 'transfer' && t.currency === settings.currency).reduce((a, t) => a + t.amount_minor, 0);
        return (
          <Fragment key={d}>
            <div className="day-head" role="heading" aria-level={3}><span>{dayLabel(d, today, fmt)}</span><Money minor={net} currency={settings.currency} sign="exceptZero" /></div>
            <ul className="daygroup">{txs.map(row)}</ul>
          </Fragment>
        );
      })}
    </div>
  );
}

function datePreset(from: string | null, to: string | null, today: string) {
  if (!from && !to) return 'any';
  const cur = monthBounds(monthOf(today)), prev = monthBounds(addMonths(monthOf(today), -1));
  if (from === cur.from && to === today) return 'month';
  if (from === prev.from && to === prev.to) return 'last';
  if (from === `${addMonths(monthOf(today), -2)}-01` && to === today) return '3m';
  return 'custom';
}

export function Transactions() {
  const [sp, setSp] = useSearchParams();
  const { settings } = useSession();
  const toast = useToast();
  const { list: cats } = useCategories();
  const accts = useApi<Account[]>('/accounts');
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [more, setMore] = useState<Tx[]>([]);
  const moreAction = useAction();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(() => Number(sp.get('open')) || null);
  const [showFilters, setShowFilters] = useState(false);
  const [cashOpen, setCashOpen] = useState(sp.get('add') === 'cash');
  const bulk = useAction();
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const today = todayIn(settings.timezone);

  // One-shot params from other pages (open a transaction, add cash, focus search) are consumed and removed.
  useEffect(() => {
    if (sp.get('focus')) searchRef.current?.focus();
    if (sp.has('open') || sp.has('add') || sp.has('focus')) { const n = new URLSearchParams(sp); n.delete('open'); n.delete('add'); n.delete('focus'); setSp(n, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search -> URL
  useEffect(() => {
    const h = setTimeout(() => { if ((sp.get('q') ?? '') !== q) { const n = new URLSearchParams(sp); if (q) n.set('q', q); else n.delete('q'); setSp(n, { replace: true }); } }, 300);
    return () => clearTimeout(h);
  }, [q, sp, setSp]);

  const filterQs = useMemo(() => {
    const n = new URLSearchParams();
    for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) n.set(k, v); }
    return n.toString();
  }, [sp]);
  useEffect(() => { setMore([]); setSelected(new Set()); }, [filterQs]);
  const first = useApi<{ rows: Tx[]; total: number }>(`/transactions?${filterQs}&limit=${PAGE}`);
  const list = { ...first, data: first.data && { ...first.data, rows: [...first.data.rows, ...more] }, reload: async (silent?: boolean) => { setMore([]); await first.reload(silent); } };
  const hasMore = !!list.data && list.data.rows.length < list.data.total;
  const loadMore = () => moreAction.run(async () => {
    try {
      const r = await api<{ rows: Tx[] }>(`/transactions?${filterQs}&limit=${PAGE}&offset=${(first.data?.rows.length ?? 0) + more.length}`);
      setMore((x) => [...x, ...r.rows]);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  // Infinite scroll: load the next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) void loadMore(); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  });

  const setF = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const setDates = (preset: string) => {
    const n = new URLSearchParams(sp);
    const set = (f: string, t: string) => { n.set('from', f); n.set('to', t); };
    if (preset === 'any') { n.delete('from'); n.delete('to'); }
    if (preset === 'month') set(monthBounds(monthOf(today)).from, today);
    if (preset === 'last') { const b = monthBounds(addMonths(monthOf(today), -1)); set(b.from, b.to); }
    if (preset === '3m') set(`${addMonths(monthOf(today), -2)}-01`, today);
    if (preset === 'custom') setShowFilters(true);
    setSp(n, { replace: true });
  };
  const activeCats = cats.filter((c) => !c.archived_at);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bulkPatch = (patch: Record<string, unknown>, label: string) => bulk.run(async () => {
    const ids = [...selected];
    const before = list.data?.rows.filter((r) => selected.has(r.id)) ?? [];
    try {
      await api('/transactions/bulk', { method: 'POST', body: { ids, patch } });
      setSelected(new Set());
      await list.reload(true);
      toast(`${label}: ${ids.length}`, { action: { label: m.common.undo, run: async () => {
        // Undo restores each row's previous user-layer values.
        for (const b of before) await api(`/transactions/${b.id}`, { method: 'PATCH', body: 'categoryId' in patch ? { categoryId: b.category_source === 'user' ? b.category_id : null } : { excluded: !!b.excluded } });
        await list.reload(true);
      } } });
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });

  const advancedCount = (['min', 'max', 'excluded', 'review', 'type'] as const).filter((k) => sp.get(k)).length;
  const preset = datePreset(sp.get('from'), sp.get('to'), today);
  const anyFilter = FILTER_KEYS.some((k) => k !== 'sort' && sp.get(k));

  return (
    <div className="page">
      <PageHeader title={m.tx.title} subtitle="Every payment in and out, newest first." actions={<>
        <a className="btn" href={`/api/transactions/export.csv?${filterQs}`} title={m.tx.exportHelp} download><Download size={18} aria-hidden="true" />{m.tx.export}</a>
        <button className="btn btn-primary" onClick={() => setCashOpen(true)}><Plus size={18} aria-hidden="true" />{m.tx.addCash}</button>
      </>} />

      <div className="stack" role="search">
        <div className="toolbar">
          <div className="search-box">
            <Search size={18} aria-hidden="true" />
            <label className="sr-only" htmlFor="q">{m.tx.search}</label>
            <input id="q" ref={searchRef} type="search" placeholder={m.tx.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="sr-only" htmlFor="sort">{m.tx.sort}</label>
          <select id="sort" className="chip-select" value={sp.get('sort') ?? 'date_desc'} onChange={(e) => setF('sort', e.target.value === 'date_desc' ? '' : e.target.value)}>
            <option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="amount_desc">Largest amount</option><option value="amount_asc">Smallest amount</option>
          </select>
        </div>
        <div className="chips">
          <select aria-label={m.tx.category} className={`chip-select ${sp.get('category') ? 'set' : ''}`} value={sp.get('category') ?? ''} onChange={(e) => setF('category', e.target.value)}>
            <option value="">All categories</option><option value="none">Uncategorized</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived_at ? ' (archived)' : ''}</option>)}
          </select>
          <select aria-label="Date" className={`chip-select ${preset !== 'any' ? 'set' : ''}`} value={preset} onChange={(e) => setDates(e.target.value)}>
            <option value="any">Any time</option><option value="month">This month</option><option value="last">Last month</option><option value="3m">Last 3 months</option><option value="custom">Custom dates…</option>
          </select>
          {(accts.data?.length ?? 0) > 1 && (
            <select aria-label={m.tx.account} className={`chip-select ${sp.get('accounts') ? 'set' : ''}`} value={sp.get('accounts') ?? ''} onChange={(e) => setF('accounts', e.target.value)}>
              <option value="">All accounts</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>)}
            </select>
          )}
          <select aria-label={m.tx.status} className={`chip-select ${sp.get('status') ? 'set' : ''}`} value={sp.get('status') ?? ''} onChange={(e) => setF('status', e.target.value)}>
            <option value="">Any status</option>{Object.entries(m.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className={`chip-btn ${advancedCount ? 'on' : ''}`} aria-expanded={showFilters} aria-controls="filters" onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal size={16} aria-hidden="true" />{m.tx.filters}{advancedCount ? ` (${advancedCount})` : ''}
          </button>
          {anyFilter && <button className="link small" onClick={() => { setQ(''); setSp(new URLSearchParams(), { replace: true }); }}>{m.tx.clear}</button>}
          <span className="spacer" />
          <button className="chip-btn" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}><ListChecks size={16} aria-hidden="true" />Select</button>
        </div>
        {showFilters && (
          <div id="filters" className="filters card">
            <Field label={m.tx.from}>{(id) => <input id={id} type="date" value={sp.get('from') ?? ''} onChange={(e) => setF('from', e.target.value)} />}</Field>
            <Field label={m.tx.to}>{(id) => <input id={id} type="date" value={sp.get('to') ?? ''} onChange={(e) => setF('to', e.target.value)} />}</Field>
            <Field label={m.tx.type}>{(id) => <select id={id} value={sp.get('type') ?? ''} onChange={(e) => setF('type', e.target.value)}><option value="">{m.common.all}</option>{Object.entries(m.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
            <Field label={`${m.tx.min} (${settings.currency})`}>{(id) => <input id={id} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={sp.get('min') ?? ''} onChange={(e) => setF('min', e.target.value.replace(',', '.'))} />}</Field>
            <Field label={`${m.tx.max} (${settings.currency})`}>{(id) => <input id={id} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={sp.get('max') ?? ''} onChange={(e) => setF('max', e.target.value.replace(',', '.'))} />}</Field>
            <Field label="Counted in reports">{(id) => <select id={id} value={sp.get('excluded') ?? ''} onChange={(e) => setF('excluded', e.target.value)}><option value="">{m.common.all}</option><option value="hide">Only counted</option><option value="only">Only not counted</option></select>}</Field>
            <div className="field"><Switch checked={sp.get('review') === '1'} onChange={(v) => setF('review', v ? '1' : '')} label={m.tx.review} /></div>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <strong>{selected.size} {m.tx.selected}</strong>
          <label className="sr-only" htmlFor="bulkcat">{m.tx.bulkCategory}</label>
          <select id="bulkcat" defaultValue="" disabled={bulk.busy} onChange={(e) => { if (e.target.value) void bulkPatch({ categoryId: Number(e.target.value) }, 'Category set'); e.target.value = ''; }}>
            <option value="">{m.tx.bulkCategory}…</option>{activeCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn btn-small" disabled={bulk.busy} onClick={() => bulkPatch({ excluded: true }, 'Not counted')}>{m.tx.bulkExclude}</button>
          <button className="btn btn-small" disabled={bulk.busy} onClick={() => bulkPatch({ excluded: false }, 'Counted')}>{m.tx.bulkInclude}</button>
          <span className="spacer" />
          <button className="link" onClick={() => setSelected(new Set())}>{m.common.cancel}</button>
        </div>
      )}

      <Card>
        {list.error && <ErrorBox error={list.error} onRetry={() => list.reload()} />}
        {!list.data && !list.error && <Loading rows={6} />}
        {list.data && (
          <>
            <p className="muted small" aria-live="polite" style={{ margin: '0 .5rem .25rem' }}>{list.data.total} transactions{list.loading ? ' · updating…' : ''}
              {selecting && list.data.rows.length > 0 && <> · <button className="link" onClick={() => setSelected(selected.size ? new Set() : new Set(list.data!.rows.map((r) => r.id)))}>{selected.size ? 'Clear selection' : 'Select all shown'}</button></>}</p>
            <TxList rows={list.data.rows} grouped={!sp.get('sort') || sp.get('sort')?.startsWith('date')} selected={selected} onToggle={selecting ? toggle : undefined} onOpen={(t) => setOpen(t.id)} />
            <div ref={sentinel} />
            {hasMore && <button className="btn load-more" disabled={moreAction.busy} onClick={loadMore}>{moreAction.busy ? m.common.loading : `${m.tx.loadMore} (${list.data.total - list.data.rows.length} more)`}</button>}
          </>
        )}
      </Card>
      {open && <TxDetail id={open} categories={cats} onClose={(changed) => { setOpen(null); if (changed) void list.reload(true); }} />}
      <CashEntry open={cashOpen} categories={activeCats} onClose={(added) => { setCashOpen(false); if (added) void list.reload(true); }} />
    </div>
  );
}

type Detail = Tx & { auto_source: string; auto_confidence: string; auto_category_id: number | null; category_override_id: number | null; type_override: string | null; auto_type: string; bank_code: string | null; mcc: string | null; first_seen_at: string; last_seen_at: string; rule: { pattern: string; field: string; match_type: string } | null; peer: { id: number; booking_date: string; amount_minor: number; currency: string; account_name: string } | null };

/** Grid of category tiles with icons, used instead of a long drop-down. */
export function CategoryPicker({ categories, value, onChange, autoLabel, label }: { categories: Category[]; value: number | null; onChange: (id: number | null) => void; autoLabel?: string; label: string }) {
  return (
    <div className="cat-grid" role="radiogroup" aria-label={label}>
      {autoLabel && (
        <button type="button" role="radio" aria-checked={value === null} className="cat-option" onClick={() => onChange(null)}>
          <span className="cat-icon" aria-hidden="true" style={{ width: 36, height: 36, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Sparkles size={18} /></span>{autoLabel}
        </button>
      )}
      {categories.map((c) => (
        <button type="button" key={c.id} role="radio" aria-checked={value === c.id} className="cat-option" onClick={() => onChange(c.id)}>
          <CatIcon cat={c} />{c.name}
        </button>
      ))}
    </div>
  );
}

function TxDetail({ id, categories, onClose }: { id: number; categories: Category[]; onClose: (changed: boolean) => void }) {
  const { fmt } = useSession();
  const { byId } = useCategories();
  const toast = useToast();
  const d = useApi<Detail>(`/transactions/${id}`);
  const [form, setForm] = useState<{ categoryId: number | null; type: string | null; note: string; excluded: boolean } | null>(null);
  const [remember, setRemember] = useState(false);
  const [preview, setPreview] = useState<{ count: number; changes: number; overridden: number } | null>(null);
  const save = useAction();
  useEffect(() => { if (d.data && !form) setForm({ categoryId: d.data.category_override_id, type: d.data.type_override, note: d.data.note ?? '', excluded: !!d.data.excluded }); }, [d.data, form]);
  const t = d.data;
  const dirty = !!(t && form && (form.categoryId !== t.category_override_id || form.type !== t.type_override || form.note !== (t.note ?? '') || form.excluded !== !!t.excluded));
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const ruleBody = t && form?.categoryId ? { field: 'merchant', match_type: 'equals', pattern: t.merchant, direction: t.amount_minor < 0 ? 'out' : 'in', category_id: form.categoryId } : null;
  useEffect(() => {
    if (!remember || !ruleBody) { setPreview(null); return; }
    api<{ count: number; changes: number; overridden: number }>('/rules/preview', { method: 'POST', body: ruleBody }).then(setPreview).catch(() => setPreview(null));
  }, [remember, ruleBody?.category_id, ruleBody?.pattern]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { if (dirty && !confirm(m.common.unsaved)) return; onClose(false); };
  const submit = () => save.run(async () => {
    if (!t || !form) return;
    try {
      const prev = { categoryId: t.category_override_id, type: t.type_override, note: t.note, excluded: !!t.excluded };
      await api(`/transactions/${id}`, { method: 'PATCH', body: { categoryId: form.categoryId, type: form.type, note: form.note || null, excluded: form.excluded } });
      if (remember && ruleBody) await api('/rules', { method: 'POST', body: ruleBody });
      toast(remember ? 'Saved and rule created' : m.common.saved, { action: remember ? undefined : { label: m.common.undo, run: () => { void api(`/transactions/${id}`, { method: 'PATCH', body: prev }).then(() => onClose(true)); } } });
      onClose(true);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });

  const autoCat = categories.find((c) => c.id === t?.auto_category_id);
  const shownCat = form?.categoryId ? byId.get(form.categoryId) : autoCat;
  return (
    <Modal open side title={t ? t.merchant : m.common.loading} onClose={close} footer={t && <><button className="btn" onClick={close}>{m.common.cancel}</button><button className="btn btn-primary" disabled={!dirty || save.busy} onClick={submit}>{save.busy ? m.common.loading : m.common.save}</button></>}>
      {d.error && <ErrorBox error={d.error} />}
      {!t || !form ? <Loading /> : (
        <>
          <div className="detail-amount">
            <CatIcon cat={shownCat} transfer={t.type === 'transfer'} size={56} />
            <div><Money minor={t.amount_minor} currency={t.currency} sign="always" /></div>
            <div className="muted">{fmt.date(t.booking_date)} · {t.account_display_name ?? t.account_name}</div>
            <div className="tx-badges" style={{ justifyContent: 'center', marginTop: '.4rem' }}>{txBadges(t)}</div>
          </div>

          <h3 className="section-title" id="cat-label">{m.tx.category}</h3>
          <div className="explain"><Sparkles size={16} aria-hidden="true" /><span>{t.category_override_id ? m.sources.user : m.sources[t.auto_source]}{t.rule && <> (“{t.rule.pattern}”)</>} · {m.confidence[t.category_override_id ? 'certain' : t.auto_confidence]}</span></div>
          <CategoryPicker label={m.tx.category} categories={categories.filter((c) => !c.archived_at || c.id === form.categoryId)} value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} autoLabel={`Automatic (${autoCat?.name ?? 'Uncategorized'})`} />
          {form.categoryId && (
            <div className="field">
              <Switch checked={remember} onChange={setRemember} label={<>{m.tx.remember} (“{t.merchant}”)</>} />
              {preview && <small className="hint" role="status">{preview.count} {m.categories.previewResult} {preview.changes}; {preview.overridden} {m.categories.overridden}.</small>}
            </div>
          )}

          <h3 className="section-title">More options</h3>
          <Field label={m.tx.note}>{(fid) => <textarea id={fid} maxLength={500} rows={2} placeholder={m.tx.notePlaceholder} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}</Field>
          <Field label={m.tx.typeOverride}>{(fid) => (
            <select id={fid} value={form.type ?? ''} onChange={(e) => setForm({ ...form, type: e.target.value || null })}>
              <option value="">{m.tx.resetAuto} ({m.types[t.auto_type]})</option>
              {Object.entries(m.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}</Field>
          <div className="field">
            <Switch checked={form.excluded} onChange={(v) => setForm({ ...form, excluded: v })} label={m.tx.excluded} />
            <small className="hint">{m.tx.excludedHelp}</small>
          </div>

          <details className="disclosure">
            <summary>{m.tx.bankFacts}</summary>
            <dl className="facts">
              <dt>{m.tx.amount}</dt><dd><Money minor={t.amount_minor} currency={t.currency} sign="always" /> <small className="muted">{t.currency}</small></dd>
              {t.original_pending_amount_minor !== null && <><dt>{m.tx.pendingOriginal}</dt><dd><Money minor={t.original_pending_amount_minor} currency={t.currency} /></dd></>}
              <dt>{m.tx.status}</dt><dd>{m.statuses[t.status]}</dd>
              <dt>{m.tx.bookingDate}</dt><dd>{fmt.date(t.booking_date)}</dd>
              <dt>{m.tx.valueDate}</dt><dd>{t.value_date ? fmt.date(t.value_date) : 'Not supplied'}</dd>
              <dt>{m.tx.original}</dt><dd className="mono">{t.description}</dd>
              {t.counterparty && <><dt>Counterparty</dt><dd>{t.counterparty}</dd></>}
              <dt>{m.tx.account}</dt><dd>{t.account_display_name ?? t.account_name}</dd>
              {t.needs_review && <><dt>{m.tx.review}</dt><dd>{t.needs_review}</dd></>}
              {t.peer && <><dt>{m.tx.transferWith}</dt><dd>{t.peer.account_name}, {fmt.date(t.peer.booking_date)}, <Money minor={t.peer.amount_minor} currency={t.peer.currency} sign="always" /></dd></>}
            </dl>
          </details>
        </>
      )}
    </Modal>
  );
}

function CashEntry({ open, categories, onClose }: { open: boolean; categories: Category[]; onClose: (added: boolean) => void }) {
  const toast = useToast();
  const { settings, fmt } = useSession();
  const { busy, run } = useAction();
  const today = todayIn(settings.timezone);
  const [f, setF] = useState({ date: today, amount: '', description: '', categoryId: null as number | null });
  const submit = () => run(async () => {
    try {
      const amt = f.amount.replace(',', '.').trim();
      await api('/transactions/manual', { method: 'POST', body: { date: f.date, amount: amt.startsWith('-') ? amt : `-${amt}`, description: f.description, categoryId: f.categoryId } });
      toast('Cash payment added'); setF({ date: today, amount: '', description: '', categoryId: null }); onClose(true);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  return (
    <Modal open={open} title="Add a cash payment" onClose={() => onClose(false)} footer={<><button className="btn" onClick={() => onClose(false)}>{m.common.cancel}</button><button className="btn btn-primary" disabled={busy || !f.amount || !f.description} onClick={submit}>{m.common.save}</button></>}>
      <p className="help" style={{ marginTop: 0 }}>{m.tx.cashHelp}</p>
      <Field label="Amount spent" hint="For example 4.50">{(id, d) => <div className="amount-input"><span aria-hidden="true">{fmt.currencySymbol()}</span><input id={id} aria-describedby={d} inputMode="decimal" placeholder="0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>}</Field>
      <div className="form-grid">
        <Field label="What was it for?">{(id) => <input id={id} maxLength={140} placeholder="Coffee at the market" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label="Date">{(id) => <input id={id} type="date" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
      </div>
      <h3 className="section-title">{m.tx.category}</h3>
      <CategoryPicker label={m.tx.category} categories={categories.filter((c) => c.key !== 'income')} value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} autoLabel="Automatic" />
      <button type="button" className="link small" onClick={() => setF({ date: today, amount: '', description: '', categoryId: null })} style={{ alignSelf: 'flex-start' }}><RotateCcw size={14} aria-hidden="true" /> Clear</button>
    </Modal>
  );
}

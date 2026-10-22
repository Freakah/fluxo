import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, useAction, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Badge, Card, Empty, ErrorBox, Loading, Money, Modal, Field } from '../components/ui.tsx';
import type { Account, Category, Tx } from '../types.ts';

const FILTER_KEYS = ['q', 'accounts', 'from', 'to', 'category', 'type', 'status', 'min', 'max', 'sort', 'excluded', 'review', 'source'] as const;
const PAGE = 50;

export function txBadges(t: Tx) {
  return (
    <>
      {t.status === 'pending' && <Badge tone="warn" icon="◷">{m.statuses.pending}</Badge>}
      {t.status === 'cancelled' && <Badge tone="muted" icon="⊘">{m.statuses.cancelled}</Badge>}
      {t.type === 'refund' && <Badge tone="ok" icon="↩">{m.types.refund}</Badge>}
      {t.type === 'transfer' && <Badge tone="info" icon="⇄">{m.types.transfer}</Badge>}
      {t.type === 'income' && <Badge tone="ok" icon="+">{m.types.income}</Badge>}
      {!!t.excluded && <Badge tone="muted" icon="⊝">Excluded</Badge>}
      {t.source === 'manual' && <Badge tone="info" icon="✎">{m.tx.manual}</Badge>}
      {t.needs_review && <Badge tone="warn" icon="?">{m.tx.review}</Badge>}
      {t.original_pending_amount_minor !== null && <Badge tone="muted">amount changed</Badge>}
    </>
  );
}

export function TxList({ rows, selected, onToggle, onOpen }: { rows: Tx[]; selected?: Set<number>; onToggle?: (id: number) => void; onOpen?: (t: Tx) => void }) {
  const { fmt } = useSession();
  if (!rows.length) return <Empty title={m.tx.none} />;
  return (
    <ul className="txlist">
      {rows.map((t) => (
        <li key={t.id} className={`tx ${t.status !== 'posted' ? 'tx-' + t.status : ''} ${t.excluded ? 'tx-excluded' : ''}`}>
          {onToggle && <input type="checkbox" aria-label={`Select ${t.merchant} ${fmt.date(t.booking_date)}`} checked={selected?.has(t.id) ?? false} onChange={() => onToggle(t.id)} />}
          <button className="tx-main" onClick={() => onOpen?.(t)} disabled={!onOpen} aria-label={onOpen ? `Open ${t.merchant}, ${fmt.date(t.booking_date)}` : undefined}>
            <span className="tx-date">{fmt.shortDate(t.booking_date)}</span>
            <span className="tx-what">
              <span className="tx-merchant">{t.merchant}</span>
              <span className="tx-sub">
                {t.type !== 'transfer' && <span className="cat"><span className="dot" style={{ background: t.category_color ?? '#9e9e9e' }} aria-hidden="true" />{t.category_name ?? 'Uncategorized'}{t.confidence === 'low' && <span className="muted"> (check)</span>}</span>}
                <span className="muted"> · {t.account_display_name ?? t.account_name}</span>
              </span>
              <span className="tx-badges">{txBadges(t)}</span>
            </span>
            <Money minor={t.amount_minor} currency={t.currency} sign="always" className="tx-amount" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Transactions() {
  const [sp, setSp] = useSearchParams();
  const { settings } = useSession();
  const toast = useToast();
  const cats = useApi<Category[]>('/categories');
  const accts = useApi<Account[]>('/accounts');
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [more, setMore] = useState<Tx[]>([]);
  const moreAction = useAction();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Tx | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const bulk = useAction();

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
  const loadMore = () => moreAction.run(async () => {
    try {
      const r = await api<{ rows: Tx[] }>(`/transactions?${filterQs}&limit=${PAGE}&offset=${(first.data?.rows.length ?? 0) + more.length}`);
      setMore((x) => [...x, ...r.rows]);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });

  const setF = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const activeCats = cats.data?.filter((c) => !c.archived_at) ?? [];
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

  const activeFilterCount = FILTER_KEYS.filter((k) => k !== 'q' && k !== 'sort' && sp.get(k)).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>{m.tx.title}</h1>
        <div className="row">
          <button className="btn" onClick={() => setCashOpen(true)}>{m.tx.addCash}</button>
          <a className="btn" href={`/api/transactions/export.csv?${filterQs}`} title={m.tx.exportHelp} download>{m.tx.export}</a>
        </div>
      </div>
      <div className="toolbar" role="search">
        <label className="sr-only" htmlFor="q">{m.tx.search}</label>
        <input id="q" type="search" placeholder={m.tx.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" aria-expanded={showFilters} aria-controls="filters" onClick={() => setShowFilters(!showFilters)}>{m.tx.filters}{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
        <label className="sr-only" htmlFor="sort">{m.tx.sort}</label>
        <select id="sort" value={sp.get('sort') ?? 'date_desc'} onChange={(e) => setF('sort', e.target.value === 'date_desc' ? '' : e.target.value)}>
          <option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="amount_desc">Largest amount</option><option value="amount_asc">Smallest amount</option>
        </select>
      </div>
      {showFilters && (
        <div id="filters" className="filters card">
          <Field label={m.tx.account}>{(id) => <select id={id} value={sp.get('accounts') ?? ''} onChange={(e) => setF('accounts', e.target.value)}><option value="">{m.common.all}</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>)}</select>}</Field>
          <Field label={m.tx.from}>{(id) => <input id={id} type="date" value={sp.get('from') ?? ''} onChange={(e) => setF('from', e.target.value)} />}</Field>
          <Field label={m.tx.to}>{(id) => <input id={id} type="date" value={sp.get('to') ?? ''} onChange={(e) => setF('to', e.target.value)} />}</Field>
          <Field label={m.tx.category}>{(id) => <select id={id} value={sp.get('category') ?? ''} onChange={(e) => setF('category', e.target.value)}><option value="">{m.common.all}</option><option value="none">Uncategorized</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived_at ? ' (archived)' : ''}</option>)}</select>}</Field>
          <Field label={m.tx.type}>{(id) => <select id={id} value={sp.get('type') ?? ''} onChange={(e) => setF('type', e.target.value)}><option value="">{m.common.all}</option>{Object.entries(m.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
          <Field label={m.tx.status}>{(id) => <select id={id} value={sp.get('status') ?? ''} onChange={(e) => setF('status', e.target.value)}><option value="">{m.common.all}</option>{Object.entries(m.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
          <Field label={`${m.tx.min} (${settings.currency})`}>{(id) => <input id={id} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={sp.get('min') ?? ''} onChange={(e) => setF('min', e.target.value.replace(',', '.'))} />}</Field>
          <Field label={`${m.tx.max} (${settings.currency})`}>{(id) => <input id={id} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={sp.get('max') ?? ''} onChange={(e) => setF('max', e.target.value.replace(',', '.'))} />}</Field>
          <Field label="Reports">{(id) => <select id={id} value={sp.get('excluded') ?? ''} onChange={(e) => setF('excluded', e.target.value)}><option value="">{m.common.all}</option><option value="hide">Hide excluded</option><option value="only">Only excluded</option></select>}</Field>
          <div className="field"><label><input type="checkbox" checked={sp.get('review') === '1'} onChange={(e) => setF('review', e.target.checked ? '1' : '')} /> {m.tx.review}</label></div>
          <button className="btn" onClick={() => { setQ(''); setSp(new URLSearchParams(), { replace: true }); }}>{m.tx.clear}</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <strong>{selected.size} {m.tx.selected}</strong>
          <label className="sr-only" htmlFor="bulkcat">{m.tx.bulkCategory}</label>
          <select id="bulkcat" defaultValue="" disabled={bulk.busy} onChange={(e) => { if (e.target.value) void bulkPatch({ categoryId: Number(e.target.value) }, 'Category set'); e.target.value = ''; }}>
            <option value="">{m.tx.bulkCategory}…</option>{activeCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn btn-small" disabled={bulk.busy} onClick={() => bulkPatch({ excluded: true }, 'Excluded')}>{m.tx.bulkExclude}</button>
          <button className="btn btn-small" disabled={bulk.busy} onClick={() => bulkPatch({ excluded: false }, 'Included')}>{m.tx.bulkInclude}</button>
          <button className="link" onClick={() => setSelected(new Set())}>{m.common.cancel}</button>
        </div>
      )}

      <Card>
        {list.error && <ErrorBox error={list.error} onRetry={() => list.reload()} />}
        {!list.data && !list.error && <Loading />}
        {list.data && (
          <>
            <p className="muted" aria-live="polite">{list.data.total} transactions{list.loading ? ' · updating…' : ''}
              {list.data.rows.length > 0 && <> · <button className="link" onClick={() => setSelected(selected.size ? new Set() : new Set(list.data!.rows.map((r) => r.id)))}>{selected.size ? 'Clear selection' : 'Select all shown'}</button></>}</p>
            <TxList rows={list.data.rows} selected={selected} onToggle={toggle} onOpen={setOpen} />
            {list.data.rows.length < list.data.total && <button className="btn load-more" disabled={moreAction.busy} onClick={loadMore}>{moreAction.busy ? m.common.loading : `${m.tx.loadMore} (${list.data.total - list.data.rows.length} more)`}</button>}
          </>
        )}
      </Card>
      {open && <TxDetail id={open.id} categories={cats.data ?? []} onClose={(changed) => { setOpen(null); if (changed) void list.reload(true); }} />}
      <CashEntry open={cashOpen} categories={activeCats} onClose={(added) => { setCashOpen(false); if (added) void list.reload(true); }} />
    </div>
  );
}

type Detail = Tx & { auto_source: string; auto_confidence: string; auto_category_id: number | null; category_override_id: number | null; type_override: string | null; auto_type: string; bank_code: string | null; mcc: string | null; first_seen_at: string; last_seen_at: string; rule: { pattern: string; field: string; match_type: string } | null; peer: { id: number; booking_date: string; amount_minor: number; currency: string; account_name: string } | null };

function TxDetail({ id, categories, onClose }: { id: number; categories: Category[]; onClose: (changed: boolean) => void }) {
  const { fmt } = useSession();
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
  return (
    <Modal open title={t ? t.merchant : m.common.loading} onClose={close} wide footer={t && <><button className="btn" onClick={close}>{m.common.cancel}</button><button className="btn btn-primary" disabled={!dirty || save.busy} onClick={submit}>{save.busy ? m.common.loading : m.common.save}</button></>}>
      {d.error && <ErrorBox error={d.error} />}
      {!t || !form ? <Loading /> : (
        <div className="detail">
          <section>
            <h3>{m.tx.bankFacts}</h3>
            <dl className="facts">
              <dt>{m.tx.amount}</dt><dd><Money minor={t.amount_minor} currency={t.currency} sign="always" /> <small className="muted">{t.currency}</small></dd>
              {t.original_pending_amount_minor !== null && <><dt>{m.tx.pendingOriginal}</dt><dd><Money minor={t.original_pending_amount_minor} currency={t.currency} /></dd></>}
              <dt>{m.tx.status}</dt><dd>{m.statuses[t.status]} {txBadges(t)}</dd>
              <dt>{m.tx.bookingDate}</dt><dd>{fmt.date(t.booking_date)}</dd>
              <dt>{m.tx.valueDate}</dt><dd>{t.value_date ? fmt.date(t.value_date) : 'Not supplied'}</dd>
              <dt>{m.tx.original}</dt><dd className="mono">{t.description}</dd>
              {t.counterparty && <><dt>Counterparty</dt><dd>{t.counterparty}</dd></>}
              <dt>{m.tx.account}</dt><dd>{t.account_display_name ?? t.account_name}</dd>
              {t.needs_review && <><dt>{m.tx.review}</dt><dd>{t.needs_review}</dd></>}
              {t.peer && <><dt>{m.tx.transferWith}</dt><dd>{t.peer.account_name}, {fmt.date(t.peer.booking_date)}, <Money minor={t.peer.amount_minor} currency={t.peer.currency} sign="always" /></dd></>}
            </dl>
          </section>
          <section>
            <h3>{m.tx.classification}</h3>
            <p>{t.category_override_id ? m.sources.user : m.sources[t.auto_source]}{t.rule && <> (“{t.rule.pattern}”)</>} · <strong>{m.confidence[t.category_override_id ? 'certain' : t.auto_confidence]}</strong></p>
            {t.category_override_id && <p className="help">Automatic suggestion would be: {autoCat?.name ?? 'Uncategorized'}</p>}
            <h3>{m.tx.yourChanges}</h3>
            <Field label={m.tx.category}>{(fid) => (
              <select id={fid} value={form.categoryId ?? ''} onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{m.tx.resetAuto} ({autoCat?.name ?? 'Uncategorized'})</option>
                {categories.filter((c) => !c.archived_at || c.id === form.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}</Field>
            {form.categoryId && (
              <div className="field">
                <label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {m.tx.remember} (“{t.merchant}”)</label>
                {preview && <small className="hint" role="status">{preview.count} {m.categories.previewResult} {preview.changes}; {preview.overridden} {m.categories.overridden}.</small>}
              </div>
            )}
            <Field label={m.tx.typeOverride}>{(fid) => (
              <select id={fid} value={form.type ?? ''} onChange={(e) => setForm({ ...form, type: e.target.value || null })}>
                <option value="">{m.tx.resetAuto} ({m.types[t.auto_type]})</option>
                {Object.entries(m.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}</Field>
            <Field label={m.tx.note}>{(fid) => <textarea id={fid} maxLength={500} rows={2} placeholder={m.tx.notePlaceholder} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}</Field>
            <div className="field">
              <label><input type="checkbox" checked={form.excluded} onChange={(e) => setForm({ ...form, excluded: e.target.checked })} /> {m.tx.excluded}</label>
              <small className="hint">{m.tx.excludedHelp}</small>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

function CashEntry({ open, categories, onClose }: { open: boolean; categories: Category[]; onClose: (added: boolean) => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ date: today, amount: '', description: '', categoryId: '' });
  const submit = () => run(async () => {
    try {
      const amt = f.amount.replace(',', '.').trim();
      await api('/transactions/manual', { method: 'POST', body: { date: f.date, amount: amt.startsWith('-') ? amt : `-${amt}`, description: f.description, categoryId: f.categoryId ? Number(f.categoryId) : null } });
      toast('Cash entry added'); setF({ date: today, amount: '', description: '', categoryId: '' }); onClose(true);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  return (
    <Modal open={open} title={m.tx.addCash} onClose={() => onClose(false)} footer={<><button className="btn" onClick={() => onClose(false)}>{m.common.cancel}</button><button className="btn btn-primary" disabled={busy || !f.amount || !f.description} onClick={submit}>{m.common.save}</button></>}>
      <p className="help">{m.tx.cashHelp}</p>
      <Field label="Date">{(id) => <input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
      <Field label="Amount spent" hint="Positive number, e.g. 4.50">{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
      <Field label="Description">{(id) => <input id={id} maxLength={140} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <Field label={m.tx.category}>{(id) => <select id={id} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Automatic</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
    </Modal>
  );
}

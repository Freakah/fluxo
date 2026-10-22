import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, Pencil, Trash2, ArrowRight, Wand2 } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { m, t as tr, T } from '../i18n.ts';
import { useCategories, useSession, useToast } from '../state.tsx';
import { Badge, Card, Confirm, Empty, ErrorBox, Loading, Modal, Money, PageHeader, Segmented, Switch } from '../components/ui.tsx';
import { CatIcon, ICONS, iconName } from '../components/icons.tsx';
import type { Category } from '../types.ts';

type Rule = { id: number; priority: number; enabled: number; field: 'merchant' | 'description'; match_type: 'equals' | 'contains' | 'starts_with'; pattern: string; direction: 'any' | 'out' | 'in'; account_id: number | null; category_id: number; category_name: string; match_count: number };
type Preview = { count: number; changes: number; overridden: number; sample: { id: number; merchant: string; description: string; booking_date: string; amount_minor: number; currency: string }[] };

const COLORS = ['#2e7d32', '#ef6c00', '#1565c0', '#6d4c41', '#5e35b1', '#00838f', '#c2185b', '#7b1fa2', '#d32f2f', '#283593', '#0277bd', '#546e7a', '#827717', '#757575'];
const matchWords = { contains: 'contains', equals: 'is exactly', starts_with: 'starts with' };

export function Categories() {
  const toast = useToast();
  const { list: cats, byId, reload } = useCategories();
  const counts = useApi<Category[]>('/categories');
  const rules = useApi<Rule[]>('/rules');
  const [tab, setTab] = useState<'categories' | 'rules'>('categories');
  const [editCat, setEditCat] = useState<Partial<Category> | null>(null);
  const [editRule, setEditRule] = useState<Partial<Rule> | null>(null);
  const [delRule, setDelRule] = useState<Rule | null>(null);
  const act = useAction();
  if (counts.error) return <div className="page"><ErrorBox error={counts.error} onRetry={() => counts.reload()} /></div>;
  if (!counts.data || !rules.data) return <div className="page"><Loading rows={5} /></div>;
  const done = async (msg: string) => { toast(tr(msg)); await Promise.all([counts.reload(true), rules.reload(true), reload()]); };
  const fail = (e: unknown) => toast((e as Error).message, { kind: 'error' });
  const all = counts.data.length ? counts.data : cats;

  return (
    <div className="page">
      <PageHeader title={m.categories.title} subtitle={tr('How Fluxo sorts your spending. Tap a category to change its name, icon or colour.')} info={m.categories.precedence}
        actions={tab === 'categories'
          ? <button className="btn btn-primary" onClick={() => setEditCat({ color: COLORS[0], icon: 'tag' })}><Plus size={18} aria-hidden="true" />{m.categories.add}</button>
          : <button className="btn btn-primary" onClick={() => setEditRule({ field: 'merchant', match_type: 'contains', direction: 'out', priority: 100, enabled: 1 })}><Plus size={18} aria-hidden="true" />{m.categories.addRule}</button>} />
      <Segmented label={tr('Show')} value={tab} onChange={setTab} options={[{ value: 'categories', label: `${m.categories.categories} (${all.filter((c) => !c.archived_at).length})` }, { value: 'rules', label: `${m.categories.rules} (${rules.data.length})` }]} />

      {tab === 'categories' ? (
        <div className="cat-tiles">
          {all.map((c) => (
            <button key={c.id} className={`cat-tile ${c.archived_at ? 'archived' : ''}`} onClick={() => setEditCat(c)} aria-label={tr('Edit {name}', { name: c.name })}>
              <CatIcon cat={c} size={44} />
              <span className="item-text"><strong>{c.name}</strong><small className="muted">{tr(c.tx_count === 1 ? '{n} transaction' : '{n} transactions', { n: c.tx_count })}{c.archived_at ? ` · ${tr('archived')}` : ''}</small></span>
              <Pencil size={16} aria-hidden="true" className="muted" />
            </button>
          ))}
        </div>
      ) : (
        <Card>
          {rules.data.length === 0 ? <Empty art="done" title={tr('No rules yet')} action={<button className="btn btn-primary" onClick={() => setEditRule({ field: 'merchant', match_type: 'contains', direction: 'out', priority: 100, enabled: 1 })}><Plus size={18} aria-hidden="true" />{m.categories.addRule}</button>}>{tr('Rules sort payments automatically. You can also create one by switching on “{option}” when you change a payment’s category.', { option: m.tx.remember })}</Empty> : (
            <ul className="rule-list" aria-label={tr('Rules in priority order')}>
              {rules.data.map((r) => (
                <li key={r.id} className={`rule ${r.enabled ? '' : 'off'}`}>
                  <span className="rule-text">
                    <T s="When the {field} {how} {pattern}" field={tr(r.field === 'merchant' ? 'merchant' : 'bank description')} how={tr(matchWords[r.match_type])} pattern={<q>{r.pattern}</q>} />
                    {r.direction !== 'any' && <small className="muted">({tr(r.direction === 'out' ? 'money out' : 'money in')})</small>}
                    <ArrowRight size={16} aria-hidden="true" className="rule-arrow" />
                    <CatIcon cat={byId.get(r.category_id)} size={26} /><strong>{r.category_name}</strong>
                  </span>
                  <Link to={`/transactions?q=${encodeURIComponent(r.pattern)}`} className="small">{tr(r.match_count === 1 ? '{n} match' : '{n} matches', { n: r.match_count })}</Link>
                  <Switch checked={!!r.enabled} disabled={act.busy} label={<span className="sr-only">{m.categories.enabled}: {r.pattern}</span>}
                    onChange={(v) => act.run(async () => { try { await api(`/rules/${r.id}`, { method: 'PATCH', body: { enabled: v } }); await done(v ? 'Rule switched on' : 'Rule switched off'); } catch (er) { fail(er); } })} />
                  <button className="icon-btn" onClick={() => setEditRule(r)} aria-label={tr('Edit rule {pattern}', { pattern: r.pattern })}><Pencil size={17} aria-hidden="true" /></button>
                  <button className="icon-btn" onClick={() => setDelRule(r)} aria-label={tr('Delete rule {pattern}', { pattern: r.pattern })}><Trash2 size={17} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {editCat && <CategoryEditor c={editCat} onClose={(msg) => { setEditCat(null); if (msg) void done(msg); }} />}
      {editRule && <RuleEditor rule={editRule} categories={cats.filter((c) => !c.archived_at)} onClose={(changed) => { setEditRule(null); if (changed) void done(m.common.saved); }} />}
      <Confirm open={!!delRule} title={tr('Delete rule?')} text={tr('Payments matched by “{pattern}” will be sorted automatically again. Categories you picked by hand are kept.', { pattern: delRule?.pattern ?? '' })} confirmLabel={m.common.delete} danger busy={act.busy}
        onClose={() => setDelRule(null)} onConfirm={() => act.run(async () => { try { await api(`/rules/${delRule!.id}`, { method: 'DELETE' }); setDelRule(null); await done('Rule deleted'); } catch (e) { fail(e); } })} />
    </div>
  );
}

function CategoryEditor({ c, onClose }: { c: Partial<Category>; onClose: (msg?: string) => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [name, setName] = useState(c.name ?? '');
  const [color, setColor] = useState(c.color ?? COLORS[0]);
  const [icon, setIcon] = useState(iconName(c));
  const required = c.key === 'uncategorized' || c.key === 'income';
  const save = () => run(async () => {
    try {
      if (c.id) await api(`/categories/${c.id}`, { method: 'PATCH', body: { name: name.trim(), color, icon } });
      else await api('/categories', { method: 'POST', body: { name: name.trim(), color, icon } });
      onClose(c.id ? m.common.saved : tr('Category added'));
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  const archive = () => run(async () => {
    try { await api(`/categories/${c.id}`, { method: 'PATCH', body: { archived: !c.archived_at } }); onClose(tr(c.archived_at ? 'Restored' : 'Archived')); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  return (
    <Modal open title={c.id ? tr('Edit {name}', { name: c.name ?? '' }) : m.categories.add} onClose={() => onClose()} footer={<>
      {c.id && !required && <button className="btn btn-ghost" disabled={busy} onClick={archive}>{c.archived_at ? m.categories.unarchive : m.categories.archive}</button>}
      <span className="spacer" />
      <button className="btn" onClick={() => onClose()}>{m.common.cancel}</button>
      <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>{m.common.save}</button>
    </>}>
      <div className="row" style={{ justifyContent: 'center' }}><CatIcon cat={{ color, icon }} size={72} /></div>
      <div className="field"><label htmlFor="cat-name">{tr('Name')}</label><input id="cat-name" data-autofocus maxLength={40} placeholder={tr('Gym')} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <fieldset className="field">
        <legend>{tr('Colour')}</legend>
        <div className="swatches" role="radiogroup" aria-label={tr('Colour')}>
          {COLORS.map((col) => <button key={col} type="button" role="radio" aria-checked={color === col} aria-label={col} className="swatch-btn" style={{ background: col }} onClick={() => setColor(col)} />)}
          <label className="sr-only" htmlFor="cat-color">{tr('Custom colour')}</label>
          <input id="cat-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>{tr('Icon')}</legend>
        <div className="icon-grid" role="radiogroup" aria-label={tr('Icon')}>
          {Object.entries(ICONS).map(([k, I]) => <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={k} className="icon-opt" onClick={() => setIcon(k)}><I size={20} aria-hidden="true" /></button>)}
        </div>
      </fieldset>
      {c.archived_at && <Badge tone="muted">{m.categories.archived}</Badge>}
      {c.id && <p className="help">{m.categories.archiveHelp}</p>}
    </Modal>
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
    <Modal open wide title={rule.id ? tr('Edit rule') : m.categories.addRule} onClose={() => onClose(false)} footer={<>
      <button className="btn" onClick={() => onClose(false)}>{m.common.cancel}</button>
      <button className="btn" disabled={!valid || busy} onClick={doPreview}><Wand2 size={17} aria-hidden="true" />{m.categories.preview}</button>
      <button className="btn btn-primary" disabled={!valid || busy || !preview} title={preview ? undefined : tr('Preview first')} onClick={save}>{tr('Save and apply')}</button>
    </>}>
      <div className="rule-sentence">
        <span>{tr('When the')}</span>
        <label className="sr-only" htmlFor="r-field">{m.categories.field}</label>
        <select id="r-field" value={r.field} onChange={(e) => set({ field: e.target.value as Rule['field'] })}><option value="merchant">{tr('merchant name')}</option><option value="description">{tr('bank description')}</option></select>
        <label className="sr-only" htmlFor="r-how">{m.categories.matchType}</label>
        <select id="r-how" value={r.match_type} onChange={(e) => set({ match_type: e.target.value as Rule['match_type'] })}><option value="contains">{tr('contains')}</option><option value="equals">{tr('is exactly')}</option><option value="starts_with">{tr('starts with')}</option></select>
        <label className="sr-only" htmlFor="r-text">{m.categories.pattern}</label>
        <input id="r-text" data-autofocus minLength={2} maxLength={100} placeholder="CONTINENTE" value={r.pattern ?? ''} onChange={(e) => set({ pattern: e.target.value })} aria-describedby="r-hint" />
        <span>{tr('for')}</span>
        <label className="sr-only" htmlFor="r-dir">{m.categories.direction}</label>
        <select id="r-dir" value={r.direction} onChange={(e) => set({ direction: e.target.value as Rule['direction'] })}><option value="out">{tr('money out')}</option><option value="in">{tr('money in')}</option><option value="any">{tr('money in or out')}</option></select>
        <span>{tr(', put it in')}</span>
        <label className="sr-only" htmlFor="r-cat">{m.tx.category}</label>
        <select id="r-cat" value={r.category_id ?? ''} onChange={(e) => set({ category_id: Number(e.target.value) })}><option value="">{tr('choose a category…')}</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <small className="hint" id="r-hint">{tr('Upper/lower case and accents are ignored. Avoid very short or generic text such as “PAG” or “MB WAY”.')}</small>
      <details className="disclosure">
        <summary>{tr('Advanced')}</summary>
        <div className="field"><label htmlFor="r-prio">{m.categories.priority}</label><input id="r-prio" type="number" min={0} max={1000} value={r.priority ?? 100} onChange={(e) => set({ priority: Number(e.target.value) })} aria-describedby="r-prio-h" /><small className="hint" id="r-prio-h">{tr('Lower numbers win when several rules match.')}</small></div>
      </details>
      {preview && (
        <div role="status" className="preview">
          <p><strong>{preview.count}</strong> {m.categories.previewResult} <strong>{preview.changes}</strong>. {preview.overridden > 0 && <>{preview.overridden} {m.categories.overridden}.</>}</p>
          {preview.count > 200 && <p className="alert alert-warn">{tr('This rule matches many transactions. Make sure it is not too broad.')}</p>}
          <ul className="list small">{preview.sample.slice(0, 10).map((s) => <li key={s.id} className="list-row"><span>{fmt.date(s.booking_date)} · {tr(s.merchant)} · <span className="mono">{s.description}</span></span><Money minor={s.amount_minor} currency={s.currency} /></li>)}</ul>
        </div>
      )}
    </Modal>
  );
}

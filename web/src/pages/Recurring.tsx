import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, CalendarClock, CircleDashed, Receipt, Pencil, TriangleAlert } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Badge, Card, Empty, ErrorBox, Loading, Money, Modal, Field, PageHeader, Segmented } from '../components/ui.tsx';
import { Monogram } from '../components/icons.tsx';
import { addMonths, addDays, addMonthsToDate, monthBounds, monthOf, todayIn } from '../../../shared/dates.ts';
import { minorToDecimal } from '../../../shared/money.ts';
import type { Recurring } from '../types.ts';

const TABS = ['suggested', 'confirmed', 'inactive', 'dismissed'] as const;
const tabLabel: Record<string, string> = { suggested: m.recurring.suggested, confirmed: m.recurring.confirmed, inactive: m.recurring.inactiveL, dismissed: m.recurring.dismissed };

/** Payment dates inside a month: projected forward from the next expected date, and back to the last real charge. */
function datesIn(x: Recurring, month: string): string[] {
  if (!x.next_date) return [];
  const { from, to } = monthBounds(month);
  const step = (d: string, dir: 1 | -1) => x.effective_frequency === 'weekly' ? addDays(d, 7 * dir) : addMonthsToDate(d, dir * (x.effective_frequency === 'quarterly' ? 3 : x.effective_frequency === 'annual' ? 12 : 1));
  const out: string[] = [];
  for (let d = x.next_date, i = 0; d <= to && i < 80; d = step(d, 1), i++) if (d >= from) out.push(d);
  for (let d = step(x.next_date, -1), i = 0; d >= from && d >= x.last_date && i < 80; d = step(d, -1), i++) if (d <= to) out.push(d);
  return out;
}

export function RecurringPage() {
  const { fmt, settings } = useSession();
  const toast = useToast();
  const r = useApi<Recurring[]>('/recurring');
  const today = todayIn(settings.timezone);
  const [tab, setTab] = useState<(typeof TABS)[number]>('suggested');
  const [edit, setEdit] = useState<Recurring | null>(null);
  const [month, setMonth] = useState(monthOf(today));
  const [day, setDay] = useState<string | null>(null);
  const act = useAction();
  if (r.error) return <div className="page"><ErrorBox error={r.error} onRetry={() => r.reload()} /></div>;
  if (!r.data) return <div className="page"><Loading rows={5} /></div>;
  const rows = r.data.filter((x) => x.status === tab);
  const confirmed = r.data.filter((x) => x.status === 'confirmed' && x.currency === settings.currency);
  const totalMonthly = confirmed.reduce((a, x) => a + x.monthly_equivalent_minor, 0);
  const active = r.data.filter((x) => (x.status === 'confirmed' || x.status === 'suggested') && x.kind !== 'income');
  const week = active.filter((x) => x.next_date && x.next_date >= today && x.next_date <= addDays(today, 7));
  const byDay = new Map<string, Recurring[]>();
  for (const x of active) for (const d of datesIn(x, month)) byDay.set(d, [...(byDay.get(d) ?? []), x]);

  const setStatus = (x: Recurring, status: string) => act.run(async () => {
    try {
      await api(`/recurring/${x.id}`, { method: 'PATCH', body: { status } });
      await r.reload(true);
      toast(`${x.merchant}: ${tabLabel[status]}`, { action: { label: m.common.undo, run: () => { void api(`/recurring/${x.id}`, { method: 'PATCH', body: { status: x.status } }).then(() => r.reload(true)); } } });
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });

  const { from, days } = monthBounds(month);
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday-first calendar
  const dayItems = day ? byDay.get(day) ?? [] : [];

  return (
    <div className="page">
      <PageHeader title={m.recurring.title} subtitle="Subscriptions and bills that repeat, found automatically." info={m.recurring.help} />
      <div className="stats">
        <div className="stat"><span className="stat-icon accent"><Receipt size={22} aria-hidden="true" /></span><div><div className="stat-label">{m.recurring.totalMonthly}</div><div className="stat-value">~<Money minor={totalMonthly} /></div><small className="muted">{confirmed.length} confirmed · {m.common.estimate.toLowerCase()}</small></div></div>
        <div className="stat"><span className="stat-icon warn"><CalendarClock size={22} aria-hidden="true" /></span><div><div className="stat-label">Due in the next 7 days</div><div className="stat-value">{week.length}</div><small className="muted">~<Money minor={week.reduce((a, x) => a + x.effective_amount_minor, 0)} /></small></div></div>
        <button className="stat" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setTab('suggested')}><span className="stat-icon ok"><CircleDashed size={22} aria-hidden="true" /></span><div><div className="stat-label">Waiting for your review</div><div className="stat-value">{r.data.filter((x) => x.status === 'suggested').length}</div><small className="muted">Confirm or dismiss below</small></div></button>
      </div>

      <div className="grid-2">
        <Card title="Calendar" actions={
          <div className="segmented" role="group" aria-label="Calendar month">
            <button onClick={() => { setMonth(addMonths(month, -1)); setDay(null); }} aria-label="Previous month"><ChevronLeft size={18} aria-hidden="true" /></button>
            <button className="on" tabIndex={-1} aria-live="polite">{fmt.month(month)}</button>
            <button onClick={() => { setMonth(addMonths(month, 1)); setDay(null); }} aria-label="Next month"><ChevronRight size={18} aria-hidden="true" /></button>
          </div>}>
          <div className="cal-grid" role="group" aria-label={`Expected payments in ${fmt.month(month)}`}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow" aria-hidden="true">{d}</div>)}
            {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="cal-day blank" aria-hidden="true" />)}
            {Array.from({ length: days }, (_, i) => {
              const d = addDays(from, i);
              const items = byDay.get(d) ?? [];
              return (
                <button key={d} className={`cal-day ${d === today ? 'today' : ''} ${d === day ? 'sel' : ''}`} aria-pressed={d === day}
                  aria-label={`${fmt.date(d)}${items.length ? `, ${items.length} expected payment${items.length > 1 ? 's' : ''}` : ''}`} onClick={() => setDay(d === day ? null : d)}>
                  {i + 1}
                  <span className="cal-dots" aria-hidden="true">{items.slice(0, 3).map((x) => <i key={x.id} className={d < today ? 'past' : undefined} />)}</span>
                </button>
              );
            })}
          </div>
        </Card>
        <Card title={day ? fmt.date(day) : 'Next payments'}>
          {(() => {
            const list = day ? dayItems.map((x) => [day, x] as const) : active.filter((x) => x.next_date && x.next_date >= today).sort((a, b) => a.next_date!.localeCompare(b.next_date!)).slice(0, 7).map((x) => [x.next_date!, x] as const);
            return list.length ? (
              <ul className="list">
                {list.map(([d, x]) => (
                  <li key={`${d}-${x.id}`} className="item">
                    <Monogram name={x.merchant} />
                    <span className="item-text"><strong>{x.merchant}</strong><small className="muted">{d < today ? 'Paid' : '~'}{d < today ? ' ' : ''}{fmt.shortDate(d)} · {m.freqs[x.effective_frequency]}{x.status === 'suggested' ? ' · to review' : ''}</small></span>
                    <span>~<Money minor={x.effective_amount_minor} currency={x.currency} /></span>
                  </li>
                ))}
              </ul>
            ) : <Empty art="calendar" title={day ? 'Nothing on this day' : 'No upcoming bills'} />;
          })()}
        </Card>
      </div>

      <Segmented label="Status" value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t, label: `${tabLabel[t]} (${r.data!.filter((x) => x.status === t).length})` }))} />
      <Card>
        {!rows.length ? <Empty art={tab === 'suggested' ? 'done' : 'calendar'} title={tab === 'suggested' && !r.data.length ? m.recurring.empty : tab === 'suggested' ? 'All reviewed' : 'Nothing here'} /> : (
          <ul className="rule-list" aria-label={`${tabLabel[tab]} bills`}>
            {rows.map((x) => (
              <li key={x.id} className="rule bill" aria-label={x.merchant}>
                <Monogram name={x.merchant} size={44} />
                <div className="item-text">
                  <Link to={`/transactions?q=${encodeURIComponent(x.merchant)}`} className="item-title" style={{ color: 'inherit' }}>{x.merchant}</Link>
                  <small className="muted">{m.kinds[x.kind]} · {m.freqs[x.effective_frequency]} · next ~{x.next_date ? fmt.date(x.next_date) : '—'} · seen {x.occurrences}×</small>
                  {x.possibly_ended && <span><Badge tone="warn" icon={<TriangleAlert size={13} />}>{m.recurring.possiblyEnded}</Badge></span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>~<Money minor={x.effective_amount_minor} currency={x.currency} /></strong>
                  {x.max_amount_minor !== x.min_amount_minor && <small className="muted" style={{ display: 'block' }}>{m.recurring.variable}: {fmt.money(x.min_amount_minor, x.currency)}–{fmt.money(x.max_amount_minor, x.currency)}</small>}
                </div>
                <div className="row">
                  {x.status !== 'confirmed' && <button className="btn btn-small btn-primary" disabled={act.busy} onClick={() => setStatus(x, 'confirmed')}>{x.status === 'suggested' ? m.recurring.confirm : m.recurring.reactivate}</button>}
                  {x.status === 'confirmed' && <button className="btn btn-small" disabled={act.busy} onClick={() => setStatus(x, 'inactive')}>{m.recurring.inactive}</button>}
                  {x.status === 'suggested' && <button className="btn btn-small" disabled={act.busy} onClick={() => setStatus(x, 'dismissed')}>{m.recurring.dismiss}</button>}
                  <button className="icon-btn" onClick={() => setEdit(x)} aria-label={`Edit ${x.merchant}`}><Pencil size={17} aria-hidden="true" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <EditRecurring x={edit} onClose={(changed) => { setEdit(null); if (changed) void r.reload(true); }} />}
    </div>
  );
}

function EditRecurring({ x, onClose }: { x: Recurring; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [kind, setKind] = useState(x.kind);
  const [freq, setFreq] = useState(x.user_frequency ?? '');
  const [amount, setAmount] = useState(x.user_amount_minor === null ? '' : minorToDecimal(x.user_amount_minor, x.currency));
  const submit = () => run(async () => {
    try {
      await api(`/recurring/${x.id}`, { method: 'PATCH', body: { kind, frequency: freq || null, amount: amount ? amount.replace(',', '.') : null } });
      toast(m.common.saved); onClose(true);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  return (
    <Modal open title={x.merchant} onClose={() => onClose(false)} footer={<><button className="btn" onClick={() => onClose(false)}>{m.common.cancel}</button><button className="btn btn-primary" disabled={busy} onClick={submit}>{m.common.save}</button></>}>
      <Field label={m.recurring.kind}>{(id) => <select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(m.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
      <Field label={m.recurring.frequency}>{(id) => <select id={id} value={freq} onChange={(e) => setFreq(e.target.value)}><option value="">Detected ({m.freqs[x.frequency]})</option>{Object.entries(m.freqs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
      <Field label={`${m.recurring.typical} (${x.currency})`} hint={`Leave empty to use the detected typical amount (${minorToDecimal(x.typical_amount_minor, x.currency)}).`}>{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
    </Modal>
  );
}

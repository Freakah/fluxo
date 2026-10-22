import { useState } from 'react';
import { Link } from 'react-router';
import { api, useAction, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Badge, Card, Empty, ErrorBox, Loading, Money, Modal, Field, Help } from '../components/ui.tsx';
import { minorToDecimal } from '../../../shared/money.ts';
import type { Recurring } from '../types.ts';

const TABS = ['suggested', 'confirmed', 'inactive', 'dismissed'] as const;
const tabLabel: Record<string, string> = { suggested: m.recurring.suggested, confirmed: m.recurring.confirmed, inactive: m.recurring.inactiveL, dismissed: m.recurring.dismissed };

export function RecurringPage() {
  const { fmt, settings } = useSession();
  const toast = useToast();
  const r = useApi<Recurring[]>('/recurring');
  const [tab, setTab] = useState<(typeof TABS)[number]>('suggested');
  const [edit, setEdit] = useState<Recurring | null>(null);
  const act = useAction();
  if (r.error) return <ErrorBox error={r.error} onRetry={() => r.reload()} />;
  if (!r.data) return <Loading />;
  const rows = r.data.filter((x) => x.status === tab);
  const confirmed = r.data.filter((x) => x.status === 'confirmed' && x.currency === settings.currency);
  const totalMonthly = confirmed.reduce((a, x) => a + x.monthly_equivalent_minor, 0);

  const setStatus = (x: Recurring, status: string) => act.run(async () => {
    try {
      await api(`/recurring/${x.id}`, { method: 'PATCH', body: { status } });
      await r.reload(true);
      toast(`${x.merchant}: ${tabLabel[status]}`, { action: { label: m.common.undo, run: () => { void api(`/recurring/${x.id}`, { method: 'PATCH', body: { status: x.status } }).then(() => r.reload(true)); } } });
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });

  return (
    <div className="page">
      <div className="page-head"><h1>{m.recurring.title}</h1></div>
      <Help>{m.recurring.help}</Help>
      <div className="tiles">
        <div className="tile"><h2>{m.recurring.totalMonthly}</h2><p className="big">~<Money minor={totalMonthly} /></p><p className="help">{confirmed.length} confirmed · {m.common.estimate}</p></div>
      </div>
      <div className="tabs" role="tablist" aria-label="Status">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{tabLabel[t]} ({r.data!.filter((x) => x.status === t).length})</button>)}
      </div>
      <Card>
        {!rows.length ? <Empty title={tab === 'suggested' && !r.data.length ? m.recurring.empty : 'Nothing here.'} /> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{tabLabel[tab]} recurring payments</caption>
              <thead><tr><th scope="col">{m.tx.merchant}</th><th scope="col">{m.recurring.kind}</th><th scope="col">{m.recurring.frequency}</th><th scope="col" className="num">{m.recurring.typical}</th><th scope="col" className="num">{m.recurring.monthly}</th><th scope="col">{m.recurring.next}</th><th scope="col">{m.recurring.confidence}</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <th scope="row"><Link to={`/transactions?q=${encodeURIComponent(x.merchant)}`}>{x.merchant}</Link>{x.possibly_ended && <><br /><Badge tone="warn" icon="!">{m.recurring.possiblyEnded}</Badge></>}</th>
                    <td>{m.kinds[x.kind]}</td>
                    <td>{m.freqs[x.effective_frequency]}</td>
                    <td className="num">~<Money minor={x.effective_amount_minor} currency={x.currency} />{x.max_amount_minor !== x.min_amount_minor && <><br /><small className="muted">{m.recurring.variable}: {fmt.money(x.min_amount_minor, x.currency)}–{fmt.money(x.max_amount_minor, x.currency)}</small></>}</td>
                    <td className="num">~<Money minor={x.monthly_equivalent_minor} currency={x.currency} /></td>
                    <td>{x.next_date ? `~${fmt.date(x.next_date)}` : '—'}</td>
                    <td><Badge tone={x.confidence === 'high' ? 'ok' : x.confidence === 'medium' ? 'info' : 'warn'}>{x.confidence}</Badge><br /><small className="muted">{x.occurrences}×, last {fmt.shortDate(x.last_date)}</small></td>
                    <td className="actions">
                      {x.status !== 'confirmed' && <button className="btn btn-small btn-primary" disabled={act.busy} onClick={() => setStatus(x, 'confirmed')}>{x.status === 'suggested' ? m.recurring.confirm : m.recurring.reactivate}</button>}
                      {x.status === 'confirmed' && <button className="btn btn-small" disabled={act.busy} onClick={() => setStatus(x, 'inactive')}>{m.recurring.inactive}</button>}
                      {x.status === 'suggested' && <button className="btn btn-small" disabled={act.busy} onClick={() => setStatus(x, 'dismissed')}>{m.recurring.dismiss}</button>}
                      <button className="btn btn-small" onClick={() => setEdit(x)}>{m.common.edit}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, RefreshCw, Link2, Unplug, Trash2, Pencil, ShieldCheck, KeyRound, CircleSlash, ChevronRight, Search, ArrowRight, Ellipsis, CircleCheck, TriangleAlert, Hourglass, CircleX } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { m, t as tr } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Badge, Card, Confirm, Empty, ErrorBox, Loading, Money, Modal, PageHeader, Popover, Switch } from '../components/ui.tsx';
import { Monogram } from '../components/icons.tsx';
import { Art } from '../components/illustrations.tsx';
import type { Account, Connection } from '../types.ts';

const stateTone: Record<string, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = { active: 'ok', error: 'warn', expired: 'bad', revoked: 'bad', disconnected: 'muted', pending: 'info' };
const stateIcon: Record<string, ReactNode> = { active: <CircleCheck size={13} />, error: <TriangleAlert size={13} />, expired: <CircleX size={13} />, revoked: <CircleX size={13} />, disconnected: <CircleSlash size={13} />, pending: <Hourglass size={13} /> };

export function Accounts() {
  const { fmt, session } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const conns = useApi<Connection[]>('/connections');
  const accts = useApi<Account[]>('/accounts');
  const [picker, setPicker] = useState<{ connectionId?: number } | null>(() => (sp.get('connect') ? {} : null));
  const [disconnect, setDisconnect] = useState<Connection | null>(null);
  const [del, setDel] = useState<Connection | null>(null);
  const [rename, setRename] = useState<Account | null>(null);
  const [syncing, setSyncing] = useState<number | null>(null);
  const act = useAction();

  // Feedback after returning from the bank.
  useEffect(() => {
    const err = sp.get('error'), ok = sp.get('connected');
    if (err) toast(m.accounts.errors[err] ?? m.errors.generic, { kind: 'error' });
    if (ok) { toast(m.accounts.connected); const t = setTimeout(() => { void conns.reload(true); void accts.reload(true); }, 2500); return () => clearTimeout(t); }
    if (err || ok || sp.get('connect')) setSp(new URLSearchParams(), { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadAll = async () => { await Promise.all([conns.reload(true), accts.reload(true)]); };
  const sync = (c: Connection) => act.run(async () => {
    setSyncing(c.id);
    try {
      const r = await api<{ status: string; inserted: number; updated: number; message?: string }>(`/connections/${c.id}/sync`, { method: 'POST' });
      toast(r.status === 'success' ? tr('Up to date: {new} new, {updated} updated', { new: r.inserted, updated: r.updated }) : tr(r.message ?? r.status), { kind: r.status === 'success' ? 'ok' : 'error' });
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
    setSyncing(null);
    await reloadAll();
  });
  const patchAccount = (a: Account, body: Record<string, unknown>) => act.run(async () => {
    try { await api(`/accounts/${a.id}`, { method: 'PATCH', body }); await accts.reload(true); toast(m.common.saved); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });

  const header = <PageHeader title={m.accounts.title} subtitle={tr('The banks Fluxo reads from. Read-only: Fluxo can never move money.')}
    actions={<button className="btn btn-primary" onClick={() => setPicker({})} disabled={!session?.provider}><Plus size={18} aria-hidden="true" />{m.accounts.connect}</button>} />;
  if (conns.error) return <div className="page">{header}<ErrorBox error={conns.error} onRetry={() => conns.reload()} /></div>;
  if (!conns.data || !accts.data) return <div className="page">{header}<Loading rows={5} /></div>;
  const manual = accts.data.filter((a) => a.connection_id === null);

  return (
    <div className="page">
      {header}
      {!session?.provider && <div className="alert alert-warn" role="note"><TriangleAlert size={18} aria-hidden="true" />{m.accounts.noProvider}</div>}
      {session?.provider && !session.provider.live && session.mode === 'live' && <div className="alert alert-info" role="note">{tr('Provider: {name}. Sandbox connections return test data from the provider, not your real bank.', { name: session.provider.label })}</div>}

      {!conns.data.length && <Card><Empty art="bank" title={m.dashboard.empty} action={session?.provider && <button className="btn btn-primary" onClick={() => setPicker({})}><Plus size={18} aria-hidden="true" />{m.accounts.connect}</button>}>{m.dashboard.emptyHelp}</Empty></Card>}
      {conns.data.map((c) => {
        const accounts = accts.data!.filter((a) => a.connection_id === c.id);
        return (
          <section key={c.id} className="card conn-card" aria-labelledby={`conn-${c.id}`}>
            <div className="conn-head">
              <Monogram name={c.institution_name} size={48} />
              <div className="conn-title">
                <h2 id={`conn-${c.id}`}>{c.institution_name}</h2>
                <div className="row">
                  <Badge tone={stateTone[c.status] ?? 'muted'} icon={stateIcon[c.status]}>{m.accounts.states[c.status] ?? c.status}</Badge>
                  {c.simulated ? <Badge tone="info">{m.accounts.simulated}</Badge> : c.live ? <Badge tone="ok">{m.accounts.live}</Badge> : <Badge tone="info">{m.accounts.sandbox}</Badge>}
                  <small className="muted">{tr('Updated {ago}', { ago: fmt.ago(c.last_success_at) })}</small>
                </div>
              </div>
              <div className="row">
                {['active', 'error'].includes(c.status) && <button className="btn" disabled={act.busy} onClick={() => sync(c)}><RefreshCw size={17} aria-hidden="true" className={syncing === c.id ? 'spin' : undefined} />{syncing === c.id ? tr('Syncing…') : m.accounts.sync}</button>}
                {['expired', 'revoked', 'error', 'disconnected'].includes(c.status) && <button className="btn btn-primary" onClick={() => setPicker({ connectionId: c.id })}><Link2 size={17} aria-hidden="true" />{m.accounts.reconnect}</button>}
                <Popover label={tr('More actions for {name}', { name: c.institution_name })} button={<Ellipsis size={20} aria-hidden="true" />}>
                  {(close) => <>
                    {c.status !== 'disconnected' && <button className="menu-item" onClick={() => { close(); setDisconnect(c); }}><Unplug size={18} aria-hidden="true" />{m.accounts.disconnect}</button>}
                    {c.status === 'disconnected' && <button className="menu-item danger" onClick={() => { close(); setDel(c); }}><Trash2 size={18} aria-hidden="true" />{m.accounts.deleteData}</button>}
                  </>}
                </Popover>
              </div>
            </div>
            {c.last_error_message && c.status !== 'active' && <div className={`alert ${c.status === 'error' ? 'alert-warn' : 'alert-error'}`} role="status"><TriangleAlert size={18} aria-hidden="true" />{tr(c.last_error_message)}</div>}
            <AccountCards accounts={accounts} onPatch={patchAccount} onRename={setRename} />
            <details className="disclosure">
              <summary>{tr('Connection details')}</summary>
              <dl className="facts">
                <dt>{m.accounts.lastSuccess}</dt><dd>{fmt.dateTime(c.last_success_at)} <small className="muted">({fmt.ago(c.last_success_at)})</small></dd>
                <dt>{m.accounts.lastAttempt}</dt><dd>{fmt.dateTime(c.last_attempt_at)}</dd>
                <dt>{m.accounts.consent}</dt><dd>{c.consent_expires_at ? fmt.dateTime(c.consent_expires_at) : tr('Unknown')}</dd>
                {c.next_sync_after && ['active', 'error'].includes(c.status) && <><dt>{tr('Next automatic sync')}</dt><dd>{tr('after {time}', { time: fmt.dateTime(c.next_sync_after) })}</dd></>}
              </dl>
              {c.recentRuns.length > 0 && <><h3 className="section-title">{tr('Recent syncs')}</h3><ul className="list small">{c.recentRuns.map((r, i) => <li key={i} className="list-row"><span>{fmt.dateTime(r.started_at)}</span><span>{tr(r.status)}{r.error_code ? ` (${r.error_code})` : ''} · {tr('{new} new, {updated} updated', { new: r.inserted, updated: r.updated })}</span></li>)}</ul></>}
            </details>
          </section>
        );
      })}
      {manual.length > 0 && <Card title={m.accounts.manualAccount}><AccountCards accounts={manual} onPatch={patchAccount} onRename={setRename} /></Card>}

      <details className="disclosure">
        <summary><ShieldCheck size={18} aria-hidden="true" />{m.accounts.coverage}</summary>
        <ul className="bullets">{m.accounts.coverageText.map((t) => <li key={t}>{t}</li>)}</ul>
      </details>

      {picker && <ConnectWizard connectionId={picker.connectionId} onClose={() => setPicker(null)} />}
      {rename && <RenameAccount a={rename} onClose={() => setRename(null)} onSave={(n) => { patchAccount(rename, { display_name: n || null }); setRename(null); }} />}
      <Confirm open={!!disconnect} title={`${m.accounts.disconnect} ${disconnect?.institution_name ?? ''}?`} text={m.accounts.disconnectConfirm} confirmLabel={m.accounts.disconnect} busy={act.busy}
        onClose={() => setDisconnect(null)} onConfirm={() => act.run(async () => {
          try { const r = await api<{ providerRevoked: boolean }>(`/connections/${disconnect!.id}/disconnect`, { method: 'POST' }); toast(tr(r.providerRevoked ? 'Disconnected. Provider access ended.' : 'Disconnected locally. The provider could not confirm revocation — also revoke access in your bank app.')); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
          setDisconnect(null); await reloadAll();
        })} />
      <Confirm open={!!del} danger title={m.accounts.deleteData} text={m.accounts.deleteConfirm} typeToConfirm="DELETE" confirmLabel={m.common.delete} busy={act.busy}
        onClose={() => setDel(null)} onConfirm={() => act.run(async () => {
          try { await api(`/connections/${del!.id}/delete-data`, { method: 'POST', body: { confirm: 'DELETE' } }); toast(tr('Imported data deleted.')); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
          setDel(null); await reloadAll();
        })} />
    </div>
  );
}

function AccountCards({ accounts, onPatch, onRename }: { accounts: Account[]; onPatch: (a: Account, b: Record<string, unknown>) => void; onRename: (a: Account) => void }) {
  const { fmt } = useSession();
  return (
    <div className="acct-cards">
      {accounts.map((a, i) => (
        <article key={a.id} className={`acct-card ${['', 'alt1', 'alt2', 'alt3'][i % 4]} ${a.included ? '' : 'excluded'}`} aria-label={a.display_name ?? a.name}>
          <div className="acct-card-top">
            <div><strong>{a.display_name ?? a.name}</strong><br /><small>{tr(a.kind)}{a.iban_last4 ? ` · •••• ${a.iban_last4}` : ''} · {a.currency}</small></div>
            <button className="icon-btn" onClick={() => onRename(a)} aria-label={tr('Rename {name}', { name: a.display_name ?? a.name })}><Pencil size={17} aria-hidden="true" /></button>
          </div>
          <div>
            <div className="acct-balance"><Money minor={a.balance_minor} currency={a.currency} /></div>
            <small>{a.balance_label ? `${tr(a.balance_label)} · ${fmt.ago(a.balance_at)}` : m.dashboard.noBalance}</small>
          </div>
          <div className="acct-card-foot">
            <small>{tr(a.tx_count === 1 ? '{n} transaction' : '{n} transactions', { n: a.tx_count })}</small>
            <Switch checked={!!a.included} onChange={(v) => onPatch(a, { included: v })} label={<small>{m.accounts.include}</small>} />
          </div>
        </article>
      ))}
    </div>
  );
}

function RenameAccount({ a, onClose, onSave }: { a: Account; onClose: () => void; onSave: (name: string) => void }) {
  const [n, setN] = useState(a.display_name ?? a.name);
  return (
    <Modal open title={tr('Rename account')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{m.common.cancel}</button><button className="btn btn-primary" onClick={() => onSave(n.trim())}>{m.common.save}</button></>}>
      <div className="field"><label htmlFor="acct-name">{tr('Name shown in Fluxo')}</label><input id="acct-name" data-autofocus maxLength={60} value={n} onChange={(e) => setN(e.target.value)} /><small className="hint">{tr('Leave empty to use the bank’s name ({name}).', { name: a.name })}</small></div>
    </Modal>
  );
}

/** Three steps with pictures: what happens → choose bank → hand-off to the bank. */
function ConnectWizard({ connectionId, onClose }: { connectionId?: number; onClose: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<0 | 1 | 2>(connectionId ? 1 : 0);
  const [country, setCountry] = useState('PT');
  const [filter, setFilter] = useState('');
  const [bank, setBank] = useState<string | null>(null);
  const list = useApi<{ provider: string; live: boolean; institutions: { name: string; country: string }[] }>(step >= 1 ? `/institutions?country=${country}` : null);
  const { busy, run } = useAction();
  const start = () => run(async () => {
    try {
      const { url } = await api<{ url: string }>('/connections/start', { method: 'POST', body: { institution: bank, country, connectionId } });
      window.location.assign(url);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  const items = (list.data?.institutions ?? []).filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()));
  const Bank = Art.bank, Shield = Art.shield;
  return (
    <Modal open title={connectionId ? m.accounts.reconnect : m.accounts.connect} onClose={onClose} footer={<>
      {step > (connectionId ? 1 : 0) && <button className="btn" onClick={() => setStep((step - 1) as 0 | 1)}>{m.common.back}</button>}
      <span className="spacer" />
      {step === 0 && <button className="btn btn-primary" onClick={() => setStep(1)}>{tr('Continue')}<ArrowRight size={18} aria-hidden="true" /></button>}
      {step === 2 && <button className="btn btn-primary" disabled={busy} onClick={start}>{busy ? m.common.loading : tr('Continue to {bank}', { bank: bank ?? '' })}<ArrowRight size={18} aria-hidden="true" /></button>}
    </>}>
      <div className="steps-dots" role="img" aria-label={tr('Step {i} of {n}', { i: step + 1, n: 3 })}>{[0, 1, 2].map((k) => <span key={k} className={k === step ? 'on' : ''} />)}</div>
      {step === 0 && (
        <div className="stack">
          <div className="wizard-art"><Bank /></div>
          <ul className="feature-list">
            <li><span className="stat-icon ok"><ShieldCheck size={20} aria-hidden="true" /></span><div><strong>{tr('Read-only')}</strong><br /><small className="muted">{tr('Fluxo can see balances and transactions. It cannot make payments.')}</small></div></li>
            <li><span className="stat-icon accent"><KeyRound size={20} aria-hidden="true" /></span><div><strong>{tr('Your password stays with your bank')}</strong><br /><small className="muted">{tr('You sign in on your bank’s own page. Fluxo never sees your login or codes.')}</small></div></li>
            <li><span className="stat-icon warn"><Unplug size={20} aria-hidden="true" /></span><div><strong>{tr('Disconnect at any time')}</strong><br /><small className="muted">{tr('Here in Fluxo, or in your bank’s app.')}</small></div></li>
          </ul>
        </div>
      )}
      {step === 1 && <>
        <p className="lede">{m.accounts.chooseBank}</p>
        <div className="toolbar">
          <label className="sr-only" htmlFor="country">{tr('Country')}</label>
          <select id="country" className="chip-select" value={country} onChange={(e) => setCountry(e.target.value)}>{['PT', 'ES', 'FR', 'DE', 'IT', 'NL', 'BE', 'IE', 'FI', 'SE'].map((c) => <option key={c}>{c}</option>)}</select>
          <div className="search-box"><Search size={18} aria-hidden="true" /><label className="sr-only" htmlFor="bankq">{tr('Search banks')}</label><input id="bankq" type="search" placeholder={tr('Search banks')} value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        </div>
        {list.error && <ErrorBox error={list.error} onRetry={() => list.reload()} />}
        {list.loading && <Loading />}
        {list.data && (items.length ? (
          <ul className="bank-list">{items.map((i) => <li key={i.name}><button className="bank-btn" onClick={() => { setBank(i.name); setStep(2); }}><Monogram name={i.name} size={36} />{i.name}<ChevronRight size={18} aria-hidden="true" /></button></li>)}</ul>
        ) : <Empty art="search" title={tr('No banks found')} />)}
        {list.data && <p className="help">{tr('Via {provider}. Read-only access to accounts, balances and transactions.', { provider: list.data.provider })}</p>}
      </>}
      {step === 2 && bank && (
        <div className="welcome">
          <div className="wizard-art"><Shield /></div>
          <h3>{tr('Next: approve at {bank}', { bank })}</h3>
          <p>{m.accounts.redirectNote}</p>
          <p className="muted small">{tr('When you are done, you come straight back here and your transactions start importing.')}</p>
        </div>
      )}
    </Modal>
  );
}

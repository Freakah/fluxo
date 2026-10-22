import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, useAction, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Badge, Card, Confirm, Empty, ErrorBox, Loading, Money, Modal, Help } from '../components/ui.tsx';
import type { Account, Connection } from '../types.ts';

const stateTone: Record<string, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = { active: 'ok', error: 'warn', expired: 'bad', revoked: 'bad', disconnected: 'muted', pending: 'info' };
const stateIcon: Record<string, string> = { active: '✓', error: '!', expired: '✕', revoked: '✕', disconnected: '–', pending: '◷' };

export function Accounts() {
  const { fmt, session } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const conns = useApi<Connection[]>('/connections');
  const accts = useApi<Account[]>('/accounts');
  const [picker, setPicker] = useState<{ connectionId?: number } | null>(null);
  const [disconnect, setDisconnect] = useState<Connection | null>(null);
  const [del, setDel] = useState<Connection | null>(null);
  const act = useAction();

  // Feedback after returning from the bank.
  useEffect(() => {
    const err = sp.get('error'), ok = sp.get('connected');
    if (err) toast(m.accounts.errors[err] ?? m.errors.generic, { kind: 'error' });
    if (ok) { toast(m.accounts.connected); const t = setTimeout(() => { void conns.reload(true); void accts.reload(true); }, 2500); return () => clearTimeout(t); }
    if (err || ok) setSp(new URLSearchParams(), { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadAll = async () => { await Promise.all([conns.reload(true), accts.reload(true)]); };
  const sync = (c: Connection) => act.run(async () => {
    try {
      const r = await api<{ status: string; inserted: number; updated: number; message?: string }>(`/connections/${c.id}/sync`, { method: 'POST' });
      toast(r.status === 'success' ? `Synced: ${r.inserted} new, ${r.updated} updated` : r.message ?? r.status, { kind: r.status === 'success' ? 'ok' : 'error' });
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
    await reloadAll();
  });
  const patchAccount = (a: Account, body: Record<string, unknown>) => act.run(async () => {
    try { await api(`/accounts/${a.id}`, { method: 'PATCH', body }); await accts.reload(true); toast(m.common.saved); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });

  if (conns.error) return <ErrorBox error={conns.error} onRetry={() => conns.reload()} />;
  if (!conns.data || !accts.data) return <Loading />;
  const manual = accts.data.filter((a) => a.connection_id === null);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{m.accounts.title}</h1>
        <button className="btn btn-primary" onClick={() => setPicker({})} disabled={!session?.provider}>{m.accounts.connect}</button>
      </div>
      {!session?.provider && <div className="alert alert-warn" role="note">{m.accounts.noProvider}</div>}
      {session?.provider && !session.provider.live && session.mode === 'live' && <div className="alert alert-info" role="note">Provider: {session.provider.label}. Sandbox connections return test data from the provider, not your real bank.</div>}

      {!conns.data.length && <Card><Empty title={m.dashboard.empty}><p>{m.dashboard.emptyHelp}</p></Empty></Card>}
      {conns.data.map((c) => {
        const accounts = accts.data!.filter((a) => a.connection_id === c.id);
        return (
          <Card key={c.id} title={<>{c.institution_name} <Badge tone={stateTone[c.status] ?? 'muted'} icon={stateIcon[c.status]}>{m.accounts.states[c.status] ?? c.status}</Badge> {c.simulated ? <Badge tone="info">{m.accounts.simulated}</Badge> : c.live ? <Badge tone="ok">{m.accounts.live}</Badge> : <Badge tone="info">{m.accounts.sandbox}</Badge>}</>}
            actions={<>
              {['active', 'error'].includes(c.status) && <button className="btn btn-small" disabled={act.busy} onClick={() => sync(c)}>{act.busy ? m.common.loading : m.accounts.sync}</button>}
              {['expired', 'revoked', 'error', 'disconnected'].includes(c.status) && <button className="btn btn-small btn-primary" onClick={() => setPicker({ connectionId: c.id })}>{m.accounts.reconnect}</button>}
              {c.status !== 'disconnected' && <button className="btn btn-small" onClick={() => setDisconnect(c)}>{m.accounts.disconnect}</button>}
              {c.status === 'disconnected' && <button className="btn btn-small btn-danger" onClick={() => setDel(c)}>{m.accounts.deleteData}</button>}
            </>}>
            {c.last_error_message && c.status !== 'active' && <div className={`alert ${c.status === 'error' ? 'alert-warn' : 'alert-error'}`} role="status">{c.last_error_message}</div>}
            <dl className="facts compact">
              <dt>{m.accounts.lastSuccess}</dt><dd>{fmt.dateTime(c.last_success_at)} <small className="muted">({fmt.ago(c.last_success_at)})</small></dd>
              <dt>{m.accounts.lastAttempt}</dt><dd>{fmt.dateTime(c.last_attempt_at)}</dd>
              <dt>{m.accounts.consent}</dt><dd>{c.consent_expires_at ? fmt.dateTime(c.consent_expires_at) : 'Unknown'}</dd>
              {c.next_sync_after && ['active', 'error'].includes(c.status) && <><dt>Next automatic sync</dt><dd>after {fmt.dateTime(c.next_sync_after)}</dd></>}
            </dl>
            {c.recentRuns.length > 0 && <details><summary>Recent sync runs</summary><ul className="list small">{c.recentRuns.map((r, i) => <li key={i}>{fmt.dateTime(r.started_at)} — {r.status}{r.error_code ? ` (${r.error_code})` : ''}: {r.inserted} new, {r.updated} updated</li>)}</ul></details>}
            <AccountRows accounts={accounts} onPatch={patchAccount} />
          </Card>
        );
      })}
      {manual.length > 0 && <Card title={m.accounts.manualAccount}><AccountRows accounts={manual} onPatch={patchAccount} /></Card>}

      <Card title={m.accounts.coverage}><ul className="bullets">{m.accounts.coverageText.map((t) => <li key={t}>{t}</li>)}</ul></Card>

      {picker && <BankPicker connectionId={picker.connectionId} onClose={() => setPicker(null)} />}
      <Confirm open={!!disconnect} title={`${m.accounts.disconnect} ${disconnect?.institution_name ?? ''}?`} text={m.accounts.disconnectConfirm} confirmLabel={m.accounts.disconnect} busy={act.busy}
        onClose={() => setDisconnect(null)} onConfirm={() => act.run(async () => {
          try { const r = await api<{ providerRevoked: boolean }>(`/connections/${disconnect!.id}/disconnect`, { method: 'POST' }); toast(r.providerRevoked ? 'Disconnected. Provider access ended.' : 'Disconnected locally. The provider could not confirm revocation — also revoke access in your bank app.'); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
          setDisconnect(null); await reloadAll();
        })} />
      <Confirm open={!!del} danger title={m.accounts.deleteData} text={m.accounts.deleteConfirm} typeToConfirm="DELETE" confirmLabel={m.common.delete} busy={act.busy}
        onClose={() => setDel(null)} onConfirm={() => act.run(async () => {
          try { await api(`/connections/${del!.id}/delete-data`, { method: 'POST', body: { confirm: 'DELETE' } }); toast('Imported data deleted.'); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
          setDel(null); await reloadAll();
        })} />
    </div>
  );
}

function AccountRows({ accounts, onPatch }: { accounts: Account[]; onPatch: (a: Account, b: Record<string, unknown>) => void }) {
  const { fmt } = useSession();
  return (
    <ul className="list">
      {accounts.map((a) => (
        <li key={a.id} className="list-row">
          <span>
            <strong>{a.display_name ?? a.name}</strong> <small className="muted">{a.kind}{a.iban_last4 ? ` ·••${a.iban_last4}` : ''} · {a.currency} · {a.tx_count} transactions{a.latest_tx_date ? `, latest ${fmt.date(a.latest_tx_date)}` : ''}</small><br />
            <small className="muted">{a.balance_label ? `${a.balance_label}, reported ${fmt.dateTime(a.balance_at)}` : m.dashboard.noBalance}</small>
          </span>
          <span className="row">
            <Money minor={a.balance_minor} currency={a.currency} />
            <label className="switch"><input type="checkbox" checked={!!a.included} onChange={(e) => onPatch(a, { included: e.target.checked })} /> {m.accounts.include}</label>
            <button className="link" onClick={() => { const n = prompt('Display name (empty to reset)', a.display_name ?? a.name); if (n !== null) onPatch(a, { display_name: n.trim() || null }); }}>Rename</button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function BankPicker({ connectionId, onClose }: { connectionId?: number; onClose: () => void }) {
  const toast = useToast();
  const [country, setCountry] = useState('PT');
  const [filter, setFilter] = useState('');
  const list = useApi<{ provider: string; live: boolean; institutions: { name: string; country: string }[] }>(`/institutions?country=${country}`);
  const { busy, run } = useAction();
  const start = (name: string) => run(async () => {
    try {
      const { url } = await api<{ url: string }>('/connections/start', { method: 'POST', body: { institution: name, country, connectionId } });
      window.location.assign(url);
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  });
  const items = (list.data?.institutions ?? []).filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Modal open title={connectionId ? m.accounts.reconnect : m.accounts.chooseBank} onClose={onClose}>
      <Help>{m.accounts.redirectNote}</Help>
      <div className="row">
        <label htmlFor="country">Country</label>
        <select id="country" value={country} onChange={(e) => setCountry(e.target.value)}>{['PT', 'ES', 'FR', 'DE', 'IT', 'NL', 'BE', 'IE', 'FI', 'SE'].map((c) => <option key={c}>{c}</option>)}</select>
        <label className="sr-only" htmlFor="bankq">Search banks</label>
        <input id="bankq" type="search" placeholder="Search banks" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.reload()} />}
      {list.loading && <Loading />}
      {list.data && (items.length ? (
        <ul className="list bank-list">{items.map((i) => <li key={i.name}><button className="btn bank-btn" disabled={busy} onClick={() => start(i.name)}>{i.name}</button></li>)}</ul>
      ) : <Empty title="No banks found." />)}
      {list.data && <p className="help">Via {list.data.provider}. Read-only access to accounts, balances and transactions.</p>}
    </Modal>
  );
}

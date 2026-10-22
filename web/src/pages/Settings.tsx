import { useState } from 'react';
import { api, useAction, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Card, Confirm, Field, Help, Badge, Loading } from '../components/ui.tsx';
import type { Settings } from '../../../shared/settings.ts';

const TIMEZONES = ['Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'UTC'];

export function SettingsPage() {
  const { settings, updateSettings, session, refresh, fmt } = useSession();
  const toast = useToast();
  const isDemo = !!session?.user?.isDemo;
  const set = (p: Partial<Settings>) => updateSettings(p).then(() => toast(m.common.saved)).catch((e) => toast((e as Error).message, { kind: 'error' }));
  const [thr, setThr] = useState(settings.budgetThresholds.join(', '));
  const sessions = useApi<{ id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; current: boolean }[]>('/auth/sessions');
  const act = useAction();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [totp, setTotp] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [delImported, setDelImported] = useState(false);
  const [delAccount, setDelAccount] = useState(false);
  const [delPw, setDelPw] = useState('');
  const fail = (e: unknown) => toast((e as Error).message, { kind: 'error' });

  return (
    <div className="page">
      <div className="page-head"><h1>{m.settings.title}</h1></div>
      <Card title={m.settings.prefs}>
        <div className="form-grid">
          <Field label={m.settings.locale}>{(id) => <select id={id} value={settings.locale} onChange={(e) => set({ locale: e.target.value })}><option value="en-PT">English (Portugal) — 1 234,56 €</option><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option><option value="pt-PT">Português (formatos)</option></select>}</Field>
          <Field label={m.settings.currency} hint="Totals, budgets and reports use this currency. Other currencies are shown separately, never converted.">{(id, d) => <select id={id} aria-describedby={d} value={settings.currency} onChange={(e) => set({ currency: e.target.value })}>{['EUR', 'GBP', 'USD', 'CHF', 'BRL'].map((c) => <option key={c}>{c}</option>)}</select>}</Field>
          <Field label={m.settings.timezone} hint="Decides when “this month” starts and ends.">{(id, d) => <select id={id} aria-describedby={d} value={settings.timezone} onChange={(e) => set({ timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select>}</Field>
          <Field label={m.settings.theme}>{(id) => <select id={id} value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}><option value="system">{m.settings.themeSystem}</option><option value="light">{m.settings.themeLight}</option><option value="dark">{m.settings.themeDark}</option></select>}</Field>
          <div className="field"><label><input type="checkbox" checked={settings.hideAmounts} onChange={(e) => set({ hideAmounts: e.target.checked })} /> {m.common.hideAmounts}</label><small className="hint">Useful in public places or when sharing your screen.</small></div>
          <form className="field" onSubmit={(e) => { e.preventDefault(); const v = thr.split(/[ ,;]+/).filter(Boolean).map(Number); if (v.some((n) => !Number.isInteger(n) || n < 1 || n > 200)) { toast('Use whole numbers between 1 and 200.', { kind: 'error' }); return; } void set({ budgetThresholds: [...new Set(v)].sort((a, b) => a - b) }); }}>
            <label htmlFor="thr">{m.settings.thresholds}</label>
            <div className="row"><input id="thr" value={thr} onChange={(e) => setThr(e.target.value)} /><button className="btn btn-small">{m.common.save}</button></div>
          </form>
        </div>
      </Card>

      <Card title={m.settings.notifications}>
        {(['budget', 'sync', 'consent', 'recurring'] as const).map((k) => (
          <div className="field" key={k}><label><input type="checkbox" checked={settings.notify[k]} onChange={(e) => set({ notify: { ...settings.notify, [k]: e.target.checked } })} /> {m.settings[`n${k[0].toUpperCase()}${k.slice(1)}` as 'nBudget']}</label></div>
        ))}
        <Help>Notifications appear inside Fluxo only. They never include amounts or account numbers. Email and push delivery are not built in.</Help>
      </Card>

      <Card title={m.settings.security}>
        <h3>{m.settings.sessions}</h3>
        {!sessions.data ? <Loading /> : (
          <ul className="list">{sessions.data.map((s) => (
            <li key={s.id} className="list-row">
              <span><strong>{s.current ? m.settings.thisDevice : (s.userAgent?.slice(0, 60) ?? 'Unknown device')}</strong><br /><small className="muted">Signed in {fmt.dateTime(s.createdAt)} · last active {fmt.ago(s.lastSeenAt)}</small></span>
              {!s.current && <button className="btn btn-small" onClick={() => act.run(async () => { try { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); await sessions.reload(true); toast('Session signed out'); } catch (e) { fail(e); } })}>{m.nav.signOut}</button>}
            </li>
          ))}</ul>
        )}
        <button className="btn" disabled={act.busy} onClick={() => act.run(async () => { try { const r = await api<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' }); await sessions.reload(true); toast(`${r.revoked} other session(s) signed out`); } catch (e) { fail(e); } })}>{m.settings.signOutOthers}</button>

        {!isDemo && <>
          <h3>{m.settings.changePassword}</h3>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { try { await api('/auth/password', { method: 'POST', body: pw }); setPw({ current: '', next: '' }); toast('Password changed. Other sessions were signed out.'); } catch (er) { fail(er); } }); }}>
            <Field label={m.settings.current}>{(id) => <input id={id} type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
            <Field label={m.settings.next} hint={m.auth.passwordHint}>{(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="new-password" minLength={12} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}</Field>
            <div><button className="btn btn-primary" disabled={act.busy}>{m.settings.changePassword}</button></div>
          </form>

          <h3>{m.settings.mfa} {session?.user?.totpEnabled ? <Badge tone="ok" icon="✓">{m.settings.mfaOn}</Badge> : <Badge tone="muted">{m.settings.mfaOff}</Badge>}</h3>
          {session?.user?.totpEnabled ? (
            <form className="row" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { const p = prompt('Enter your password to turn off two-step verification'); if (!p) return; try { await api('/auth/totp/disable', { method: 'POST', body: { password: p } }); await refresh(); toast('Two-step verification turned off'); } catch (er) { fail(er); } }); }}>
              <button className="btn">{m.settings.mfaDisable}</button>
            </form>
          ) : totp ? (
            <form onSubmit={(e) => { e.preventDefault(); void act.run(async () => { try { await api('/auth/totp/enable', { method: 'POST', body: { code } }); setTotp(null); await refresh(); toast('Two-step verification is on'); } catch (er) { fail(er); } }); }}>
              <p>{m.settings.mfaScan}</p>
              <p><code className="secret">{totp.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
              <details><summary>Setup link (for apps that accept otpauth:// links)</summary><code className="secret">{totp.uri}</code></details>
              <Field label={m.auth.mfaCode}>{(id) => <input id={id} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
              <button className="btn btn-primary" disabled={act.busy}>{m.auth.verify}</button>
            </form>
          ) : <button className="btn" onClick={() => act.run(async () => { try { setTotp(await api('/auth/totp/setup', { method: 'POST' })); } catch (er) { fail(er); } })}>{m.settings.mfaSetup}</button>}
        </>}
      </Card>

      <Card title={m.settings.privacy}>
        <p>{m.settings.privacyText}</p>
        <p><a className="btn" href="/api/export/full" download>{m.settings.exportAll}</a></p>
        <Help>The export includes your transactions, labels, rules, budgets and settings in a documented JSON format (docs/DATA_EXPORT.md). It never includes passwords, two-step secrets or bank access tokens.</Help>
        <div className="danger-zone">
          <h3>Danger zone</h3>
          <p><button className="btn btn-danger" onClick={() => setDelImported(true)}>{m.settings.deleteImported}</button></p>
          <p><button className="btn btn-danger" onClick={() => setDelAccount(true)}>{m.settings.deleteAccount}</button></p>
        </div>
      </Card>

      <Confirm open={delImported} danger title={m.settings.deleteImported} text={m.settings.deleteImportedText} typeToConfirm="DELETE" confirmLabel={m.common.delete} busy={act.busy}
        onClose={() => setDelImported(false)} onConfirm={() => act.run(async () => { try { await api('/privacy/delete-imported', { method: 'POST', body: { confirm: 'DELETE' } }); setDelImported(false); toast('All imported bank data deleted.'); } catch (e) { fail(e); } })} />
      <Confirm open={delAccount} danger title={m.settings.deleteAccount} typeToConfirm="DELETE MY ACCOUNT" confirmLabel={m.settings.deleteAccount} busy={act.busy}
        text={<>{m.settings.deleteAccountText}{!isDemo && <Field label={m.auth.password}>{(id) => <input id={id} type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />}</Field>}</>}
        onClose={() => setDelAccount(false)} onConfirm={(typed) => act.run(async () => { try { await api('/privacy/delete-account', { method: 'POST', body: { confirm: typed, password: delPw || undefined } }); await refresh(); } catch (e) { fail(e); } })} />
    </div>
  );
}

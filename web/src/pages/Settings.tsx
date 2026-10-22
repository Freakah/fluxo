import { useState } from 'react';
import { SlidersHorizontal, Bell, ShieldCheck, Database, Download, Trash2, UserX, LogOut, Monitor, Sun, Moon, Type, MonitorDown, Languages } from 'lucide-react';
import { useInstall } from '../install.ts';
import { api, useAction, useApi } from '../api.ts';
import { m, t as tr } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Card, Confirm, Field, Badge, Loading, PageHeader, Switch } from '../components/ui.tsx';
import type { Settings } from '../../../shared/settings.ts';

const TIMEZONES = ['Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'UTC'];
const SECTIONS = [
  { id: 'prefs', label: 'Preferences', icon: <SlidersHorizontal size={18} /> },
  { id: 'notify', label: 'Notifications', icon: <Bell size={18} /> },
  { id: 'security', label: 'Security', icon: <ShieldCheck size={18} /> },
  { id: 'privacy', label: m.settings.privacy, icon: <Database size={18} /> },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

export function SettingsPage() {
  const { settings, updateSettings, session, refresh, fmt, lang, setDeviceLanguage } = useSession();
  const toast = useToast();
  const isDemo = !!session?.user?.isDemo;
  const set = (p: Partial<Settings>) => updateSettings(p).then(() => toast(m.common.saved)).catch((e) => toast((e as Error).message, { kind: 'error' }));
  const [section, setSection] = useState<Section>('prefs');
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
      <PageHeader title={m.settings.title} subtitle={tr('Make Fluxo work the way you like.')} />
      <div className="settings-layout">
        <div className="settings-nav" role="tablist" aria-label={tr('Settings sections')} aria-orientation="vertical">
          {SECTIONS.map((s) => <button key={s.id} role="tab" aria-selected={section === s.id} aria-controls={`set-${s.id}`} onClick={() => setSection(s.id)}><span aria-hidden="true">{s.icon}</span>{tr(s.label)}</button>)}
        </div>
        <div className="stack" id={`set-${section}`} role="tabpanel">
          {section === 'prefs' && (
            <Card title={tr('Language')} icon={<Languages size={18} />}>
              <div className="setting-row">
                <div><label htmlFor="s-lang"><strong>Language · Idioma</strong></label><br /><small className="muted">{tr('Changes all the words in Fluxo. Your data is not changed.')}</small></div>
                <select id="s-lang" value={lang} onChange={(e) => {
                  const l = e.target.value as 'en' | 'pt';
                  setDeviceLanguage(l); void set({ language: l });
                }}><option value="en">English</option><option value="pt">Português (Portugal)</option></select>
              </div>
            </Card>
            )}
          {section === 'prefs' && (
            <Card title={tr('Appearance and format')}>
              <fieldset className="field" style={{ marginBottom: '1rem' }}>
                <legend>{m.settings.theme}</legend>
                <div className="theme-options">
                  {([['system', m.settings.themeSystem, <Monitor size={16} key="i" />, 'linear-gradient(90deg,#f5f6fa 50%,#0d1117 50%)'], ['light', m.settings.themeLight, <Sun size={16} key="i" />, '#f5f6fa'], ['dark', m.settings.themeDark, <Moon size={16} key="i" />, '#0d1117']] as const).map(([v, label, icon, bg]) => (
                    <label key={v} className="theme-option">
                      <input type="radio" name="theme" value={v} checked={settings.theme === v} onChange={() => set({ theme: v })} />
                      <span className="theme-swatch" style={{ background: bg }} aria-hidden="true" />
                      <span className="row" style={{ gap: '.3rem' }}><span aria-hidden="true">{icon}</span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="field" style={{ marginBottom: '1rem' }}>
                <legend>{m.settings.textSize}</legend>
                <div className="theme-options">
                  {([['normal', m.settings.textNormal, 16], ['large', m.settings.textLarge, 19], ['xlarge', m.settings.textXlarge, 22]] as const).map(([v, label, px]) => (
                    <label key={v} className="theme-option">
                      <input type="radio" name="textsize" value={v} checked={settings.textSize === v} onChange={() => set({ textSize: v })} />
                      <span className="theme-swatch text-sample" aria-hidden="true" style={{ fontSize: px }}><Type size={px} /> Aa</span>
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <small className="hint">{m.settings.textHelp}</small>
              </fieldset>
              <div className="setting-row"><div><strong>{m.common.hideAmounts}</strong><br /><small className="muted">{tr('Useful in public places or when sharing your screen.')}</small></div><Switch checked={settings.hideAmounts} onChange={(v) => set({ hideAmounts: v })} label={<span className="sr-only">{m.common.hideAmounts}</span>} /></div>
              {lang === 'en' && <div className="setting-row"><div><label htmlFor="s-locale"><strong>{m.settings.locale}</strong></label></div><select id="s-locale" value={settings.locale === 'pt-PT' ? 'en-PT' : settings.locale} onChange={(e) => set({ locale: e.target.value })}><option value="en-PT">English (Portugal) — 1 234,56 €</option><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option></select></div>}
              <div className="setting-row"><div><label htmlFor="s-cur"><strong>{m.settings.currency}</strong></label><br /><small className="muted" id="s-cur-h">{tr('Totals, budgets and reports use this currency. Other currencies are shown separately, never converted.')}</small></div><select id="s-cur" aria-describedby="s-cur-h" value={settings.currency} onChange={(e) => set({ currency: e.target.value })}>{['EUR', 'GBP', 'USD', 'CHF', 'BRL'].map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="setting-row"><div><label htmlFor="s-tz"><strong>{m.settings.timezone}</strong></label><br /><small className="muted" id="s-tz-h">{tr('Decides when “this month” starts and ends.')}</small></div><select id="s-tz" aria-describedby="s-tz-h" value={settings.timezone} onChange={(e) => set({ timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select></div>
              <form className="setting-row" onSubmit={(e) => { e.preventDefault(); const v = thr.split(/[ ,;]+/).filter(Boolean).map(Number); if (v.some((n) => !Number.isInteger(n) || n < 1 || n > 200)) { toast(tr('Use whole numbers between 1 and 200.'), { kind: 'error' }); return; } void set({ budgetThresholds: [...new Set(v)].sort((a, b) => a - b) }); }}>
                <div><label htmlFor="thr"><strong>{m.settings.thresholds}</strong></label><br /><small className="muted">{tr('You get an alert when a budget reaches these percentages.')}</small></div>
                <div className="row"><input id="thr" style={{ width: 120 }} value={thr} onChange={(e) => setThr(e.target.value)} /><button className="btn btn-small">{m.common.save}</button></div>
              </form>
            </Card>
          )}

          {section === 'prefs' && <InstallCard />}

          {section === 'notify' && (
            <Card title={m.settings.notifications}>
              {(['budget', 'sync', 'consent', 'recurring'] as const).map((k) => (
                <div className="setting-row" key={k}><div><strong>{m.settings[`n${k[0].toUpperCase()}${k.slice(1)}` as 'nBudget']}</strong></div><Switch checked={settings.notify[k]} onChange={(v) => set({ notify: { ...settings.notify, [k]: v } })} label={<span className="sr-only">{m.settings[`n${k[0].toUpperCase()}${k.slice(1)}` as 'nBudget']}</span>} /></div>
              ))}
              <p className="help">{tr('Notifications appear inside Fluxo only. They never include amounts or account numbers. Email and push delivery are not built in.')}</p>
            </Card>
          )}

          {section === 'security' && <>
            <Card title={m.settings.sessions}>
              {!sessions.data ? <Loading /> : (
                <ul className="list">{sessions.data.map((s) => (
                  <li key={s.id} className="list-row">
                    <span><strong>{s.current ? m.settings.thisDevice : (s.userAgent?.slice(0, 60) ?? tr('Unknown device'))}</strong> {s.current && <Badge tone="ok">{tr('Current')}</Badge>}<br /><small className="muted">{tr('Signed in {when} · last active {ago}', { when: fmt.dateTime(s.createdAt), ago: fmt.ago(s.lastSeenAt) })}</small></span>
                    {!s.current && <button className="btn btn-small" onClick={() => act.run(async () => { try { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); await sessions.reload(true); toast(tr('Session signed out')); } catch (e) { fail(e); } })}><LogOut size={15} aria-hidden="true" />{m.nav.signOut}</button>}
                  </li>
                ))}</ul>
              )}
              <button className="btn" style={{ marginTop: '.75rem' }} disabled={act.busy} onClick={() => act.run(async () => { try { const r = await api<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' }); await sessions.reload(true); toast(tr('{n} other session(s) signed out', { n: r.revoked })); } catch (e) { fail(e); } })}>{m.settings.signOutOthers}</button>
            </Card>
            {!isDemo && <>
              <Card title={m.settings.changePassword}>
                <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { try { await api('/auth/password', { method: 'POST', body: pw }); setPw({ current: '', next: '' }); toast(tr('Password changed. Other sessions were signed out.')); } catch (er) { fail(er); } }); }}>
                  <Field label={m.settings.current}>{(id) => <input id={id} type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
                  <Field label={m.settings.next} hint={m.auth.passwordHint}>{(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="new-password" minLength={12} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}</Field>
                  <div><button className="btn btn-primary" disabled={act.busy}>{m.settings.changePassword}</button></div>
                </form>
              </Card>
              <Card title={<>{m.settings.mfa} {session?.user?.totpEnabled ? <Badge tone="ok">{m.settings.mfaOn}</Badge> : <Badge tone="muted">{m.settings.mfaOff}</Badge>}</>}>
                <p className="muted">{tr('Adds a 6-digit code from an authenticator app when you sign in.')}</p>
                {session?.user?.totpEnabled ? (
                  <form className="row" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { const p = prompt(tr('Enter your password to turn off two-step verification')); if (!p) return; try { await api('/auth/totp/disable', { method: 'POST', body: { password: p } }); await refresh(); toast(tr('Two-step verification turned off')); } catch (er) { fail(er); } }); }}>
                    <button className="btn">{m.settings.mfaDisable}</button>
                  </form>
                ) : totp ? (
                  <form className="stack" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { try { await api('/auth/totp/enable', { method: 'POST', body: { code } }); setTotp(null); await refresh(); toast(tr('Two-step verification is on')); } catch (er) { fail(er); } }); }}>
                    <p>{m.settings.mfaScan}</p>
                    <p><code className="secret">{totp.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
                    <details className="disclosure"><summary>{tr('Setup link (for apps that accept otpauth:// links)')}</summary><code className="secret">{totp.uri}</code></details>
                    <Field label={m.auth.mfaCode}>{(id) => <input id={id} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
                    <div><button className="btn btn-primary" disabled={act.busy}>{m.auth.verify}</button></div>
                  </form>
                ) : <button className="btn btn-primary" onClick={() => act.run(async () => { try { setTotp(await api('/auth/totp/setup', { method: 'POST' })); } catch (er) { fail(er); } })}>{m.settings.mfaSetup}</button>}
              </Card>
            </>}
          </>}

          {section === 'privacy' && <>
            <Card title={tr('Your data')}>
              <p>{m.settings.privacyText}</p>
              <p><a className="btn" href="/api/export/full" download><Download size={18} aria-hidden="true" />{m.settings.exportAll}</a></p>
              <p className="help">{tr('The export includes your transactions, labels, rules, budgets and settings in a documented JSON format (docs/DATA_EXPORT.md). It never includes passwords, two-step secrets or bank access tokens.')}</p>
            </Card>
            <section className="danger-zone" aria-labelledby="dz">
              <h2 id="dz">{tr('Danger zone')}</h2>
              <p className="muted">{tr('These actions cannot be undone.')}</p>
              <div className="row">
                <button className="btn btn-danger" onClick={() => setDelImported(true)}><Trash2 size={17} aria-hidden="true" />{m.settings.deleteImported}</button>
                <button className="btn btn-danger" onClick={() => setDelAccount(true)}><UserX size={17} aria-hidden="true" />{m.settings.deleteAccount}</button>
              </div>
            </section>
          </>}
        </div>
      </div>

      <Confirm open={delImported} danger title={m.settings.deleteImported} text={m.settings.deleteImportedText} typeToConfirm="DELETE" confirmLabel={m.common.delete} busy={act.busy}
        onClose={() => setDelImported(false)} onConfirm={() => act.run(async () => { try { await api('/privacy/delete-imported', { method: 'POST', body: { confirm: 'DELETE' } }); setDelImported(false); toast(tr('All imported bank data deleted.')); } catch (e) { fail(e); } })} />
      <Confirm open={delAccount} danger title={m.settings.deleteAccount} typeToConfirm="DELETE MY ACCOUNT" confirmLabel={m.settings.deleteAccount} busy={act.busy}
        text={<>{m.settings.deleteAccountText}{!isDemo && <Field label={m.auth.password}>{(id) => <input id={id} type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />}</Field>}</>}
        onClose={() => setDelAccount(false)} onConfirm={(typed) => act.run(async () => { try { await api('/privacy/delete-account', { method: 'POST', body: { confirm: typed, password: delPw || undefined } }); await refresh(); } catch (e) { fail(e); } })} />
    </div>
  );
}

function InstallCard() {
  const { state, install } = useInstall();
  return (
    <Card title={m.settings.install} icon={<MonitorDown size={18} />}>
      <p className="muted" style={{ marginTop: 0 }}>{m.settings.installHelp}</p>
      {state === 'installed' ? <p><strong>{m.settings.installed}</strong></p>
        : state === 'ready' ? <button className="btn btn-primary" onClick={install}><MonitorDown size={18} aria-hidden="true" />{tr('Install Fluxo')}</button>
          : <p className="help">{m.settings.installManual}</p>}
    </Card>
  );
}

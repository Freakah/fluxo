import { useState, type FormEvent } from 'react';
import { ShieldCheck, ChartPie, RefreshCw, Sparkles, Languages } from 'lucide-react';
import { api, useAction } from '../api.ts';
import { m, t } from '../i18n.ts';
import { useSession } from '../state.tsx';
import { Field } from '../components/ui.tsx';
import { Art } from '../components/illustrations.tsx';

export function Login() {
  const { session, refresh, lang, setDeviceLanguage } = useSession();
  const [mode, setMode] = useState<'signin' | 'register'>(session?.registrationOpen ? 'register' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(() => (new URLSearchParams(location.search).get('error') === 'signin_required' ? m.auth.signinRequired : null));
  const { busy, run } = useAction();
  const demo = session?.mode === 'demo';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setError(null);
      try {
        if (session?.mfaPending) await api('/auth/mfa', { method: 'POST', body: { code } });
        else await api(mode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body: { email, password } });
        await refresh();
      } catch (err) { setError((err as Error).message); }
    });
  };
  const startDemo = () => run(async () => {
    setError(null);
    try { await api('/auth/demo', { method: 'POST' }); await refresh(); } catch (err) { setError((err as Error).message); }
  });

  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="brand"><img src="/favicon.svg" alt="" width={40} height={40} /> {m.app.name}</div>
        <h2>{t('Know where your money goes.')}</h2>
        <div className="art-wrap"><Art.welcome /></div>
        <ul className="feature-list">
          <li><span className="stat-icon"><RefreshCw size={20} aria-hidden="true" /></span><span>{t('Transactions sync from your bank automatically.')}</span></li>
          <li><span className="stat-icon"><ChartPie size={20} aria-hidden="true" /></span><span>{t('Spending is sorted into categories for you.')}</span></li>
          <li><span className="stat-icon"><ShieldCheck size={20} aria-hidden="true" /></span><span>{t('Read-only and private: your data stays on your computer.')}</span></li>
        </ul>
      </aside>
      <main className="auth-main" id="main">
        <div className="auth-card">
          <button type="button" className="btn btn-small btn-ghost lang-switch" lang={lang === 'pt' ? 'en' : 'pt-PT'} onClick={() => setDeviceLanguage(lang === 'pt' ? 'en' : 'pt')}>
            <Languages size={16} aria-hidden="true" />{lang === 'pt' ? 'English' : 'Português'}
          </button>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {demo && !session?.mfaPending && (
            <div className="stack">
              <h1>{t('See Fluxo in action')}</h1>
              <p className="lede">{m.app.tagline}</p>
              <button className="btn btn-primary btn-big" onClick={startDemo} disabled={busy}><Sparkles size={20} aria-hidden="true" />{busy ? m.common.loading : m.demo.try}</button>
              <p className="help">{m.demo.tryHint}</p>
            </div>
          )}
          {!demo && session?.mfaPending && (
            <form onSubmit={submit}>
              <h1>{m.auth.mfaTitle}</h1>
              <p className="lede">{t('Open your authenticator app and enter the code for Fluxo.')}</p>
              <Field label={m.auth.mfaCode}>{(id) => <input id={id} autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
              <button className="btn btn-primary btn-big" disabled={busy}>{m.auth.verify}</button>
            </form>
          )}
          {!demo && !session?.mfaPending && (
            <form onSubmit={submit}>
              <h1>{t(mode === 'register' ? 'Create your Fluxo login' : 'Welcome back')}</h1>
              <p className="lede">{t(mode === 'register' ? 'This login is only for Fluxo. Never use your bank password here.' : 'Sign in to see your money.')}</p>
              <Field label={m.auth.email}>{(id) => <input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
              <Field label={m.auth.password} hint={mode === 'register' ? m.auth.passwordHint : undefined}>
                {(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
              <button className="btn btn-primary btn-big" disabled={busy}>{busy ? m.common.loading : mode === 'register' ? m.auth.register : m.auth.signIn}</button>
              {session?.registrationOpen && <p><button type="button" className="link" onClick={() => setMode(mode === 'register' ? 'signin' : 'register')}>{mode === 'register' ? t('I already have a login') : m.auth.register}</button></p>}
              {mode === 'signin' && <p className="help">{m.auth.forgot}</p>}
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

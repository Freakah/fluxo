import { useState, type FormEvent } from 'react';
import { api, useAction } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession } from '../state.tsx';
import { Field } from '../components/ui.tsx';

export function Login() {
  const { session, refresh } = useSession();
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
    <div className="center-page">
      <main className="auth-card" id="main">
        <h1><img src="/favicon.svg" alt="" width={32} height={32} /> {m.app.name}</h1>
        <p className="lede">{m.app.tagline}</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {demo && !session?.mfaPending && (
          <div className="demo-cta">
            <button className="btn btn-primary btn-big" onClick={startDemo} disabled={busy}>{busy ? m.common.loading : m.demo.try}</button>
            <p className="help">{m.demo.tryHint}</p>
          </div>
        )}
        {!demo && session?.mfaPending && (
          <form onSubmit={submit}>
            <h2>{m.auth.mfaTitle}</h2>
            <Field label={m.auth.mfaCode}>{(id) => <input id={id} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
            <button className="btn btn-primary" disabled={busy}>{m.auth.verify}</button>
          </form>
        )}
        {!demo && !session?.mfaPending && (
          <form onSubmit={submit}>
            <h2>{mode === 'register' ? m.auth.register : m.auth.signIn}</h2>
            <Field label={m.auth.email}>{(id) => <input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label={m.auth.password} hint={mode === 'register' ? m.auth.passwordHint : undefined}>
              {(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <button className="btn btn-primary" disabled={busy}>{busy ? m.common.loading : mode === 'register' ? m.auth.register : m.auth.signIn}</button>
            {session?.registrationOpen && <p><button type="button" className="link" onClick={() => setMode(mode === 'register' ? 'signin' : 'register')}>{mode === 'register' ? m.auth.signIn : m.auth.register}</button></p>}
            {mode === 'signin' && <p className="help">{m.auth.forgot}</p>}
          </form>
        )}
      </main>
    </div>
  );
}

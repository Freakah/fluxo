// Simulated bank consent screen for demo mode only. Clearly labelled; no credentials are asked for.
import { m } from '../i18n.ts';

export function DemoBank() {
  const p = new URLSearchParams(location.search);
  const state = p.get('state') ?? '';
  const institution = p.get('institution') ?? 'Simulated bank';
  const scenario = institution.startsWith('ActivoBank') ? 'flaky' : 'main';
  const go = (ok: boolean) => {
    const q = new URLSearchParams({ state });
    if (ok) q.set('code', `demo-code:${scenario}`); else q.set('error', 'access_denied');
    location.assign(`/api/connections/callback?${q}`); // fixed same-origin path, never the redirect param
  };
  return (
    <div className="center-page">
      <main className="auth-card" id="main">
        <p className="demo-banner" role="note">{m.demo.banner}</p>
        <h1>{institution}</h1>
        <p>This page stands in for your bank’s own login and approval screen. In live mode you would sign in on your bank’s site or app — Fluxo never sees those credentials.</p>
        <p><strong>Fluxo requests read-only access to:</strong></p>
        <ul className="bullets"><li>Account list and balances</li><li>Transaction history</li></ul>
        <p>It cannot make payments.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => go(true)}>Approve (simulated)</button>
          <button className="btn" onClick={() => go(false)}>Decline</button>
        </div>
      </main>
    </div>
  );
}

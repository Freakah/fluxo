// Simulated bank consent screen for demo mode only. Clearly labelled; no credentials are asked for.
import { ShieldCheck, List, Wallet, Ban } from 'lucide-react';
import { m } from '../i18n.ts';
import { Monogram } from '../components/icons.tsx';

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
      <main className="card stack" id="main" style={{ maxWidth: 460, width: '100%' }}>
        <p className="demo-banner" role="note" style={{ borderRadius: 12 }}>{m.demo.banner}</p>
        <div className="row"><Monogram name={institution} size={48} /><h1>{institution}</h1></div>
        <p className="muted">This page stands in for your bank’s own login and approval screen. In live mode you would sign in on your bank’s site or app — Fluxo never sees those credentials.</p>
        <p><strong>Fluxo asks for read-only access to:</strong></p>
        <ul className="feature-list">
          <li><span className="stat-icon accent"><Wallet size={18} aria-hidden="true" /></span><span>Account list and balances</span></li>
          <li><span className="stat-icon accent"><List size={18} aria-hidden="true" /></span><span>Transaction history</span></li>
          <li><span className="stat-icon bad"><Ban size={18} aria-hidden="true" /></span><span>It cannot make payments</span></li>
        </ul>
        <div className="row">
          <button className="btn btn-primary" onClick={() => go(true)}><ShieldCheck size={18} aria-hidden="true" />Approve (simulated)</button>
          <button className="btn" onClick={() => go(false)}>Decline</button>
        </div>
      </main>
    </div>
  );
}

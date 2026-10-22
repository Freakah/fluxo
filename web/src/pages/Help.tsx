import { Link } from 'react-router';
import { Compass, ShieldCheck, Keyboard, LifeBuoy } from 'lucide-react';
import { m, t, T } from '../i18n.ts';
import { Card, PageHeader } from '../components/ui.tsx';
import { Art } from '../components/illustrations.tsx';

const FAQ: [string, string][] = [
  ['Why is a transaction missing?', 'Banks share only what they expose through open banking, within the connection’s history window. Card payments can take a few days to complete. Check Banks for the last update and any connection problem.'],
  ['Why did a processing amount change?', 'Card payments are often authorised for one amount and completed for another (tips, fuel pre-authorisations, currency conversion). Fluxo keeps the final amount and shows what the processing amount was.'],
  ['A processing payment disappeared', 'If the bank stops reporting a processing payment, Fluxo marks it “Cancelled” instead of deleting it. It does not count as spending. If it later completes, it appears normally.'],
  ['Why is my spending different from my balance change?', 'Spending leaves out moving money between your own accounts, money coming in, and payments still processing. Refunds reduce it. Balances come straight from your bank.'],
  ['How do I fix a wrong category?', 'Open the payment in Activity, pick the right category, and switch on “also apply to this merchant” to create a rule. Your choice always wins and survives future updates.'],
  ['Two identical purchases — is one a duplicate?', 'Not necessarily. Fluxo never merges payments just because the date and amount match. If the bank sent both, both are kept.'],
  ['The update says “rate limited”', 'Banks limit background refreshes (often 4 per day). Fluxo waits and tries again automatically. “Sync now” has a short cooldown for the same reason.'],
  ['Bank access expired', 'Open-banking access lasts a limited time (often up to 180 days). Use Reconnect on the Banks page; your history and labels are kept and accounts are matched, not duplicated.'],
  ['Reporting a bug', 'Open an issue on the project repository using the bug template. Never paste real transactions, account numbers, tokens or screenshots with real data.'],
  ['Reporting a security problem', 'Do not open a public issue. Follow SECURITY.md in the repository.'],
];

export function Help() {
  return (
    <div className="page">
      <PageHeader title={m.nav.help} subtitle={t('Answers to common questions, and a quick tour of the app.')} />
      <section className="card help-hero">
        <div className="stack">
          <h2>{t('New here?')}</h2>
          <p className="muted">{t('The tour points out each part of Fluxo in under a minute.')}</p>
          <div><button className="btn btn-primary" onClick={() => dispatchEvent(new Event('fluxo:tour'))}><Compass size={18} aria-hidden="true" />{t('Take the tour')}</button></div>
        </div>
        <Art.welcome />
      </section>
      <div className="grid-2">
        <Card title={t('Common questions')} icon={<LifeBuoy size={18} />}>
          {FAQ.map(([q, a]) => <details key={q} className="faq"><summary>{t(q)}</summary><p>{t(a)}</p></details>)}
        </Card>
        <div className="stack">
          <Card title={m.accounts.coverage} icon={<ShieldCheck size={18} />}><ul className="bullets">{m.accounts.coverageText.map((t) => <li key={t}>{t}</li>)}</ul></Card>
          <Card title={t('Keyboard shortcuts')} icon={<Keyboard size={18} />}>
            <ul className="list">
              <li className="list-row"><span>{t('Search or jump to a page')}</span><kbd>Ctrl K</kbd></li>
              <li className="list-row"><span>{t('Search your activity')}</span><kbd>/</kbd></li>
              <li className="list-row"><span>{t('Close a window')}</span><kbd>Esc</kbd></li>
            </ul>
            <p className="help"><T s="Something else? See {settings} or the project README." settings={<Link to="/settings">{m.nav.settings}</Link>} /></p>
          </Card>
        </div>
      </div>
    </div>
  );
}

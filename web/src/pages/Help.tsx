import { m } from '../i18n.ts';
import { Card } from '../components/ui.tsx';

const FAQ: [string, string][] = [
  ['Why is a transaction missing?', 'Banks share only what they expose through open banking, within the connection’s history window. Card payments can take a few days to post. Check Accounts for the last successful sync and any connection problem.'],
  ['Why did a pending amount change?', 'Card payments are often authorised for one amount and booked for another (tips, fuel pre-authorisations, currency conversion). Fluxo keeps the posted amount and shows what the pending amount was.'],
  ['A pending payment disappeared', 'If the bank stops reporting a pending payment, Fluxo marks it “No longer pending” instead of deleting it. It does not count as spending. If it later posts, the posted transaction appears normally.'],
  ['Why is my spending different from my balance change?', 'Spending excludes transfers between your own accounts, income, and pending payments, and refunds reduce it. Balances come straight from your bank.'],
  ['How do I fix a wrong category?', 'Open the transaction, choose the category, and optionally tick “also apply to this merchant” to create a rule. Your choice always wins over automatic categorization and survives future syncs.'],
  ['Two identical purchases — is one a duplicate?', 'Not necessarily. Fluxo never merges transactions just because the date and amount match. If the bank sent both, both are kept.'],
  ['Sync says “rate limited”', 'Banks limit background refreshes (often 4 per day). Fluxo waits and retries automatically. Manual refresh has a short cooldown for the same reason.'],
  ['Bank access expired', 'Open-banking consent lasts a limited time (often up to 180 days). Use Reconnect on the Accounts page; your history and labels are kept and accounts are matched, not duplicated.'],
  ['Reporting a bug', 'Open an issue on the project repository using the bug template. Never paste real transactions, account numbers, tokens or screenshots with real data.'],
  ['Reporting a security problem', 'Do not open a public issue. Follow SECURITY.md in the repository.'],
];

export function Help() {
  return (
    <div className="page">
      <div className="page-head"><h1>{m.nav.help}</h1></div>
      <Card title={m.accounts.coverage}><ul className="bullets">{m.accounts.coverageText.map((t) => <li key={t}>{t}</li>)}</ul></Card>
      <Card title="Common questions">
        {FAQ.map(([q, a]) => <details key={q} className="faq"><summary>{q}</summary><p>{a}</p></details>)}
      </Card>
    </div>
  );
}

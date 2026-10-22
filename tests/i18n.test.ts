// Every piece of interface text must have a European Portuguese translation, with the same {placeholders}.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { en, setLanguage, t } from '../web/src/i18n.ts';
import { pt } from '../web/src/pt.ts';

const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));

const leaves = (v: unknown, key = ''): string[] => typeof v === 'string' ? (key === 'art' || key === 'target' ? [] : [v])
  : Array.isArray(v) ? v.flatMap((x) => leaves(x)) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => leaves(x, k)) : [];

/** String literals passed to t()/tr(), <T s=…>, and s={cond ? '…' : '…'}. */
export function usedStrings(): string[] {
  const out = new Set<string>();
  const lit = /'((?:[^'\\]|\\.)*)'/g;
  for (const f of files('web/src')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:t|tr)\(\s*([^;]*?)\s*(?:,\s*\{|\))/g)) for (const s of m[1].matchAll(lit)) out.add(s[1]);
    for (const m of src.matchAll(/<T s="([^"]+)"/g)) out.add(m[1]);
    for (const m of src.matchAll(/<T s=\{([^}]*)\}/g)) for (const s of m[1].matchAll(lit)) out.add(s[1]);
  }
  return [...out].filter((s) => /[A-Za-z]{2}/.test(s));
}

// Text that reaches t() through variables: module constants, server messages and provider labels.
export const INDIRECT = [
  'This month', '3 months', 'This year', '12 months', 'Custom', 'Preferences', 'Notifications', 'Security', 'Amount', 'Confirm', 'Category',
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'current', 'savings', 'card', 'cash', 'other',
  'success', 'partial', 'failed', 'interrupted', 'skipped', 'running', 'Category set', 'Not counted', 'Counted',
  'Rule switched on', 'Rule switched off', 'Rule deleted', 'Rule saved', 'Rule created',
  'You stayed inside every budget. Well done!', 'You spent less than the month before. Nice work!', 'More came in than went out. That is a good month.', 'Every month is a fresh start. Small changes add up.',
  'Available (interim)', 'Available (closing)', 'Available (opening)', 'Booked (interim)', 'Booked (closing)', 'Booked (opening)',
  'Bank access expired', 'Bank access expires soon', 'Possible recurring payment found',
  'Reconnect your bank', 'Monthly budget reached', '{name} budget reached', 'Monthly budget at {pct}%', '{name} budget at {pct}%',
  "You have used all of this month's monthly budget.", "You have used all of this month's {name} budget.", "You have used {pct}% of this month's monthly budget.", "You have used {pct}% of this month's {name} budget.",
  'A possible {frequency} payment was detected. Review it to confirm or dismiss.', 'Access to {bank} expires on {date}. Reconnect to keep syncing.',
  'Reconnect {bank} to resume automatic syncing.', 'Access expires on {date}. Reconnect to keep syncing.',
  'Bank access expired. Reconnect to resume syncing.', 'Access was revoked at the bank. Reconnect to resume syncing.',
  'The bank limits how often data can be fetched. We will retry automatically later.', 'The bank or provider did not respond. We will retry automatically with increasing delays.',
  'This server is not configured for this provider. See docs/PROVIDERS.md.', 'The provider rejected the request. Try reconnecting; if it persists, report a bug (without financial details).',
  'MB WAY from {name}', 'MB WAY to {name}', 'Transfer from {name}', 'Payment to entity {n}',
  'A category with this name exists.', 'An account with this email already exists. Sign in instead.', 'Current password is incorrect.',
  'Disconnect this bank first, then delete its imported data.', 'Email or password is incorrect.', 'Invalid date range', 'Date range too long (max ~10 years)',
  'No bank provider is configured on this server. See docs/PROVIDERS.md (Enable Banking setup).', 'Not available for demo accounts.',
  'Only manual entries can be deleted. Imported transactions can be excluded from reports instead.', 'Password is incorrect.',
  'Pick a payment you made and money you received in the same currency.', 'Please sign in.',
  'Registration is closed on this server. Ask the administrator to set ALLOW_REGISTRATION=true.', 'Sign in again.',
  'That code is not valid. Check your authenticator app’s time and try again.', 'That code is not valid.', 'This category is required and cannot be archived.',
  'This connection is not active. Reconnect it first.', 'This connection was refreshed a few minutes ago. Banks limit how often data can be fetched; try again later.',
  'Transaction not found', 'Too many attempts. Try again in {n} minute(s).', 'Something went wrong on the server. Your data was not changed by this request. Try again; if it persists, see the troubleshooting guide.',
  'Why is a transaction missing?', 'Banks share only what they expose through open banking, within the connection’s history window. Card payments can take a few days to complete. Check Banks for the last update and any connection problem.',
  'Why did a processing amount change?', 'Card payments are often authorised for one amount and completed for another (tips, fuel pre-authorisations, currency conversion). Fluxo keeps the final amount and shows what the processing amount was.',
  'A processing payment disappeared', 'If the bank stops reporting a processing payment, Fluxo marks it “Cancelled” instead of deleting it. It does not count as spending. If it later completes, it appears normally.',
  'Why is my spending different from my balance change?', 'Spending leaves out moving money between your own accounts, money coming in, and payments still processing. Refunds reduce it. Balances come straight from your bank.',
  'How do I fix a wrong category?', 'Open the payment in Activity, pick the right category, and switch on “also apply to this merchant” to create a rule. Your choice always wins and survives future updates.',
  'Two identical purchases — is one a duplicate?', 'Not necessarily. Fluxo never merges payments just because the date and amount match. If the bank sent both, both are kept.',
  'The update says “rate limited”', 'Banks limit background refreshes (often 4 per day). Fluxo waits and tries again automatically. “Sync now” has a short cooldown for the same reason.',
  'Bank access expired', 'Open-banking access lasts a limited time (often up to 180 days). Use Reconnect on the Banks page; your history and labels are kept and accounts are matched, not duplicated.',
  'Reporting a bug', 'Open an issue on the project repository using the bug template. Never paste real transactions, account numbers, tokens or screenshots with real data.',
  'Reporting a security problem', 'Do not open a public issue. Follow SECURITY.md in the repository.',
];

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');

describe('Portuguese translation', () => {
  const all = [...new Set([...leaves(en), ...usedStrings(), ...INDIRECT])];

  it('covers every interface string', () => {
    expect(all.length).toBeGreaterThan(300);
    if (process.env.I18N_DUMP) fs.writeFileSync(process.env.I18N_DUMP, JSON.stringify(all.filter((s) => !(s in pt)), null, 1));
    expect(all.filter((s) => !(s in pt))).toEqual([]);
  });

  it('keeps the same placeholders', () => {
    expect(Object.entries(pt).filter(([k, v]) => holes(k) !== holes(v)).map(([k]) => k)).toEqual([]);
  });

  it('translates fixed and filled-in text, and leaves unknown text alone', () => {
    setLanguage('pt');
    expect(t('Save')).toBe(pt.Save);
    expect(t('{n} min ago', { n: 5 })).toBe(pt['{n} min ago'].replace('{n}', '5'));
    expect(t('MB WAY from 912***523')).toBe(pt['MB WAY from {name}'].replace('{name}', '912***523'));
    expect(t('Pingo Doce')).toBe('Pingo Doce');
    expect(t('Monthly budget at 80%')).toBe('Orçamento mensal a 80%');
    expect(t('Restaurantes e cafés budget reached')).toBe('Orçamento de Restaurantes e cafés atingido');
    setLanguage('en');
    expect(t('Save')).toBe('Save');
  });
});

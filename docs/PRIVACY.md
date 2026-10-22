# Privacy and data lifecycle

> **Template notice.** This describes how the software behaves. It is not a legal privacy policy. If you run
> Fluxo for anyone other than yourself, have a qualified person review your obligations (e.g. GDPR) and write
> a proper policy. Fluxo makes no claim of automatic legal compliance or zero risk.

## What is collected and why
| Data | Purpose | Where |
|---|---|---|
| Email, password hash (scrypt), optional TOTP secret (encrypted) | Sign-in | Server database |
| Session records (hashed token, created/last seen, user agent) | Keeping you signed in; letting you sign out other devices | Server database |
| Bank connection metadata: bank name, status, consent expiry, sync times, encrypted provider session id | Syncing | Server database |
| Accounts: name, type, currency, last 4 IBAN characters, reported balance | Showing accounts and balances | Server database |
| Transactions: amount, currency, dates, status, bank description, counterparty name, bank codes | Tracking spending | Server database |
| Your labels: categories, rules, notes, budgets, recurring decisions, preferences | Your configuration | Server database |

Data minimization: full IBANs, raw provider payloads, bank addresses and account holder details are not stored. CSV exports contain no account numbers.

Not collected: bank passwords, PINs, card security codes, authentication codes (you enter those only at your bank). No analytics, trackers, advertising IDs, third-party fonts or CDNs. Nothing is sent to AI services. The browser stores only the session cookie — no financial data in local storage.

## Who receives data
Only the bank provider (Enable Banking) and, through it, your bank — to fetch your data under your consent. Nobody else.

## Disconnecting a bank
Accounts → Disconnect:
- stops scheduled imports immediately and erases the stored provider session,
- asks the provider to end the session (`DELETE /sessions`, which closes the bank consent where the bank supports it),
- **does not delete imported history** — you choose that separately.
You can also revoke third-party access in your bank’s app or online banking.

## Deleting data
- **Delete imported data for one connection** (after disconnecting): removes its accounts and transactions.
- **Delete all imported bank data** (Settings): disconnects every bank, then deletes all imported accounts/transactions. Login, categories and rules stay.
- **Delete my account** (Settings, password + typed confirmation): removes the user and everything linked to it.

Deletions remove the active database rows immediately. **Backups made earlier still contain the data until they expire** (by default the 14 newest backups are kept; see [BACKUP.md](BACKUP.md)). Restores re-apply logged deletions so deleted data is not silently reintroduced. SQLite may keep freed pages in the file until it is vacuumed; run `sqlite3 data/fluxo-live.sqlite "VACUUM"` while stopped if you need that space overwritten.

## Retention
Data stays until you delete it. Expired sessions and authorization states are purged automatically. Demo workspaces are deleted after 24 hours.

## Export
Settings → “Download all my data” produces a JSON file in the format described in [DATA_EXPORT.md](DATA_EXPORT.md). Transactions → “Export CSV” exports the current filtered list.

## Keeping private data out of Git
`.gitignore` excludes `.env`, `data/`, databases, keys and test output. Run `npm run scan:secrets` before publishing.

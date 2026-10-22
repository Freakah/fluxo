# Troubleshooting

| Problem | What to do |
|---|---|
| `npm start` says Node is too old / `node:sqlite` missing | Install Node.js 24 or newer. |
| `Invalid environment configuration` | The message lists the bad variable. Compare with `.env.example`. |
| `DATA_ENCRYPTION_KEY is required` | Live mode and production need a key: `npm run gen-key`, paste into `.env`. |
| Blank page after updating | Run `npm run build` and restart the server. |
| “No bank provider is configured” | Live mode without `ENABLE_BANKING_APP_ID` / `ENABLE_BANKING_KEY_PATH`. See [PROVIDERS.md](PROVIDERS.md). |
| Provider returns 401 / “rejected the application credentials” | Wrong app id, wrong private key, or the certificate uploaded doesn’t match the key. |
| Callback error “could not be verified” | The connection attempt was started in another browser/session, expired (15 min) or was already used. Start again. |
| Redirect URL rejected by the provider | The redirect registered in the Control Panel must be exactly `<PUBLIC_URL>/api/connections/callback`. |
| Sync problem / rate limited | Automatic retries with delays; banks allow ~4 background fetches a day. Check Accounts → Recent sync runs. |
| “Bank access expired” | Consent lasts up to ~180 days. Click Reconnect; history is kept. |
| Old transactions missing after first sync | Banks often expose full history only in the first hour after consent; later only ~90 days. |
| Totals differ from the bank app | Fluxo counts posted transactions by booking date, excludes own-account transfers and pending, and subtracts refunds. See [FINANCIAL_RULES.md](FINANCIAL_RULES.md). |
| Forgot password | On the server: `npm run reset-password -- you@example.com` (also turns off 2-step verification and signs out all sessions). |
| Database locked / disk full | Stop other processes using the file; free disk space; restore from backup if corrupted ([BACKUP.md](BACKUP.md)). |

## Reporting a bug
Open an issue using the bug template. Include steps, expected vs. actual, browser, OS, Fluxo version (shown in the navigation footer) and logs **with financial details removed**. Never attach real transactions, account numbers, tokens, `.env` or database files. Security issues: see [SECURITY.md](../SECURITY.md).

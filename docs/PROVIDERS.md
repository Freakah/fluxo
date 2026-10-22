# Bank provider setup (Enable Banking)

Fluxo uses [Enable Banking](https://enablebanking.com) for read-only PSD2 account information. No payment
initiation, no screen scraping. You authenticate directly with your bank; Fluxo never sees bank credentials.

## Research summary (checked 2026-10-22 against official pages)

| Topic | Finding | Source |
|---|---|---|
| Millennium bcp | “Millennium BCP (PT)” listed under new integrations in the May 2026 changelog (alongside the existing Banco Comercial Português brand), plus reliability fixes. Redirect login; SCA in the Millennium app. | [May 2026 changelog](https://enablebanking.com/blog/2026/06/12/enable-banking-changelog-may-2026), [Portugal page](https://enablebanking.com/docs/markets/pt/) |
| Accounts/cards | Depends on the bank; personal and business accounts generally available. Card account coverage for Millennium not stated — check `GET /aspsps` and your first connection. | [FAQ](https://enablebanking.com/docs/faq/) |
| History | Most banks ≥ 1 year, many 2–3 years; full history usually only within ~1 hour of consent, afterwards often 90 days. Fluxo uses `strategy=longest` on the first sync. | FAQ |
| Pending | `PDNG` supported; `entry_reference` on pending only if it stays the same after booking. | FAQ, API reference |
| Consent | `valid_until` up to the bank’s `maximum_consent_validity` (180 days for most); sessions can expire early (`EXPIRED_SESSION`). | FAQ, API reference |
| Background refresh | Many banks limit fetches without the user present to ~4/day; on `ASPSP_RATE_LIMIT_EXCEEDED` wait ~6 h. | FAQ |
| Sandbox | Mock banks available before any contract. | FAQ |
| Personal use | “Restricted mode”: register a *production* application and activate it by linking your own accounts; no contract/KYB needed; only linked accounts are returned. Intended for evaluation and individual non-commercial use. | [Linked accounts](https://enablebanking.com/docs/api/linked-accounts) |
| Production for others | Contract + KYB; volume-based pricing with a monthly minimum (quote via info@enablebanking.com). | FAQ |
| Data handling | You are responsible for the data you fetch; Enable Banking terms (“Restriction of Use”) apply. Read them before use. | Linked accounts page |

Not verified by the authors: pricing of restricted mode (the docs do not state a cost), exact Millennium card support, and real-world history depth. **Verify current terms yourself.**

## Set up (personal use, your own Millennium bcp account)

1. Create an account at the Enable Banking Control Panel.
2. Generate an RSA key pair locally (keep the private key outside the repository):
   ```bash
   openssl req -new -x509 -newkey rsa:2048 -nodes -days 730 -keyout enablebanking-private.pem -out enablebanking-cert.pem -subj "/CN=fluxo"
   ```
3. Register a new application, choose **production** (restricted) or **sandbox** for testing, choose “Generate outside the browser and import public certificate”, and paste the **contents** of `enablebanking-cert.pem`. Privacy and Terms URLs are required for production: you can use `docs/PRIVACY.md` and `docs/TERMS.md` from your repository.
   **Redirect URL:** Enable Banking only accepts `https://` URLs, so `http://localhost` is rejected. Options:
   - Local install: register the relay page `https://freakah.github.io/fluxo/callback.html` (from `docs/callback.html`, served by GitHub Pages) and set `BANK_REDIRECT_URL` to the same value. It forwards only `state`, `code` and `error` to `http://localhost:3000/api/connections/callback`; the code is useless without your private key. If you use another port, fork the repo, edit `TARGET` in `docs/callback.html`, enable Pages, and use your own URL.
   - Hosted install with HTTPS: register `<PUBLIC_URL>/api/connections/callback` and leave `BANK_REDIRECT_URL` empty.
4. For production restricted mode: click **Activate by linking accounts** and authorize your Millennium bcp account. This only activates the app; you still connect inside Fluxo.
5. In `.env`:
   ```
   APP_MODE=live
   ENABLE_BANKING_APP_ID=<application id>
   ENABLE_BANKING_KEY_PATH=/absolute/path/enablebanking-private.pem
   ENABLE_BANKING_ENVIRONMENT=production   # or sandbox
   ```
6. Start Fluxo → Accounts → Connect a bank → Portugal → Millennium BCP.

The JWT is RS256 with `kid` = app id, `iss` = `enablebanking.com`, `aud` = `api.enablebanking.com`, 1 h lifetime (max 24 h allowed).

## Sandbox vs. live in the UI
Connections are badged **Simulated** (demo), **Sandbox (test data)** or **Live**. A sandbox connection proves the integration works, not that your bank works.

## Verification status
- Adapter tested against documented response shapes (`tests/enablebanking.test.ts`).
- **Not yet run against the Enable Banking sandbox or a real Millennium account** — requires your application credentials. Suggested first live check: connect, confirm accounts and balances, compare the last 30 days with your bank app, sync twice and confirm no duplicates.

## Adding another provider
Implement `BankProvider` (`server/providers/types.ts`), map errors to `ProviderError` kinds, register it in `server/providers/index.ts`. Keep it read-only.

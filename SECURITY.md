# Security policy

## Reporting a vulnerability
Please **do not open a public issue**. Use GitHub’s private vulnerability reporting: https://github.com/Freakah/fluxo/security/advisories/new

Include affected version, steps to reproduce and impact. Never send real financial data, tokens or database files — synthetic data reproduces everything. We aim to acknowledge within 7 days. Supported version: the latest release.

## Design summary
- **Read-only banking**: account-information access only; no payment initiation, no scraping; bank authentication happens at the bank. Fluxo never receives bank credentials.
- **Authentication**: scrypt (N=2^17, r=8, p=1) password hashes from Node’s crypto; 12+ character passwords; optional TOTP via the maintained `otpauth` library; account recovery through a server-side CLI.
- **Sessions**: 256-bit random tokens in `HttpOnly`, `SameSite=Lax` (and `Secure` over HTTPS) cookies; only SHA-256 hashes stored; 30-day absolute and 7-day idle expiry; server-side revocation, “sign out other sessions”, session rotation after 2-step verification; other sessions are signed out on password change.
- **Authorization**: every query is scoped by the signed-in user id; cross-user access is covered by tests.
- **Input & output**: zod validation on all bodies/queries; parameterized SQL only; React escaping; strict CSP (`script-src 'self'`, `frame-ancestors 'none'`), `nosniff`, referrer policy, HSTS over HTTPS; CSV formula-injection neutralization.
- **CSRF**: SameSite cookies plus rejection of cross-origin `Origin`/`Sec-Fetch-Site` and non-JSON mutations.
- **Rate limits**: sign-in per IP and per email, demo creation, manual sync cooldown.
- **Bank callback**: 256-bit single-use `state`, stored hashed, bound to the user, 15-minute expiry, atomic consumption (replay/duplicate-callback safe), fixed internal redirect targets only.
- **Secrets**: provider session ids and TOTP secrets encrypted with AES-256-GCM; key from `DATA_ENCRYPTION_KEY` (environment, not the database or backups). Provider private key read from a file path outside the repository. Nothing secret reaches the frontend bundle or browser storage.
- **Logs**: structured, no amounts/descriptions/tokens/account numbers; error responses are generic.
- **Webhooks**: none used.

## Known limitations
- Rate limiting is in-memory (single process).
- No email-based verification/recovery (self-hosted, no mail service); recovery requires server access.
- TOTP codes are not tracked for reuse within their 30–60 s window.
- Hosting for multiple people requires your own operational security (OS updates, firewall, backups, monitoring).

## Dependency hygiene
`npm audit` in CI; Dependabot configuration provided. See [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

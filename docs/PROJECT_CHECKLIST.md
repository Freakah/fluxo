# Fluxo — persistent project checklist

Living document for continuity across sessions. Update when work lands.

## Requirements (summary)
Automatic expense tracker: connect bank (read-only AIS), background sync, categorize, budgets,
recurring detection, reports/exports, privacy controls, demo mode, MIT open source.
Defaults: English UI, EUR, Europe/Lisbon, Portuguese demo merchants. Full brief kept in the
original task; this file tracks status.

## Decisions
| # | Decision | Why |
|---|----------|-----|
| D1 | Node 24, TypeScript run natively (type stripping), no server build step | Fewer moving parts; `tsc` used for type-checking only |
| D2 | SQLite via built-in `node:sqlite`, SQL migrations | Relational, zero native deps, single-file backups (`VACUUM INTO`) |
| D3 | Hono HTTP server + zod validation | Small, maintained, built-in secure headers / CSRF origin check |
| D4 | React 19 + Vite + react-router, hand-rolled SVG charts with tables | Few deps; charts always paired with accessible tables |
| D5 | Passwords: Node `crypto.scrypt` (OWASP params); sessions: random 256-bit token, SHA-256 hash stored server-side | Standard primitives from the platform; no custom crypto |
| D6 | TOTP MFA via `otpauth` library | Real second factor, optional |
| D7 | Provider adapter: `demo` (deterministic) and `enablebanking` (sandbox & production share one API, chosen by app credentials) | Enable Banking lists Millennium BCP (PT) — added May 2026 changelog |
| D8 | Money as signed integer minor units (negative = outflow) | Exactness |
| D9 | Months by booking date string (bank calendar date); "now" in user timezone | Booking dates are calendar dates, no tz shift |
| D10 | Refunds reduce spending in the category & month they post | Consistent, documented; can produce negative category spend |
| D11 | In-process scheduler, DB leases per account; `npm run sync` for cron | Single process deployment |
| D12 | Background fetch default every 6h (≤4/day) per Enable Banking FAQ; manual refresh sends real PSU headers only when the user clicked | Respect ASPSP limits honestly |
| D13 | Demo mode = separate DB file + flagged demo user; never mixed with live | Separation |
| D14 | Account recovery: CLI `npm run reset-password` (self-hosted, no email service) | No external messaging cost |
| D15 | Registration: first user only, unless `ALLOW_REGISTRATION=true` | Safe default for self-hosting |

## Completed (2026-10-22)
- [x] All screens: Dashboard, Transactions (+detail, bulk, cash entry), Budgets, Recurring, Reports, Accounts & connections, Categories & rules, Settings & privacy, Notifications, Help, simulated bank consent page
- [x] Exact money (minor units), shared aggregate rules, multi-currency separation, Lisbon month boundaries
- [x] Categorization precedence with explanation/confidence; rules with preview, priority, disable, delete; corrections survive re-sync
- [x] Sync engine: pagination, overlap window, idempotent ids/fingerprints (+occurrence index), pending→posted, disappearing pending, locks, backoff, rate limits, partial failure, interrupted recovery, background limit, honest PSU headers, reconnect identity mapping, undecryptable-session handling
- [x] Transfers (own accounts only), refunds policy, budgets (thresholds, mid-month rule, no rollover), deduplicated notifications, recurring detection
- [x] Enable Banking adapter (JWT RS256, aspsps, auth, sessions, balances, transactions, revoke, error mapping)
- [x] Auth: scrypt, hashed sessions, idle/absolute expiry, revoke others, TOTP, rate limits, CSRF, CSP/HSTS, CLI recovery
- [x] Privacy: full export, CSV export (injection-safe), disconnect (revoke), delete imported, delete account, deletion log
- [x] Backup/restore with deletion re-application; ops scripts; secret scanner
- [x] Demo mode: deterministic Portuguese data incl. failing sync + expired consent; per-visitor workspaces; reset
- [x] Docs, LICENSE (holder placeholder), SECURITY, CONTRIBUTING, CHANGELOG, CI, Dependabot, templates, screenshots

## Remaining / future work
- Portuguese translation file (`web/src/i18n.ts` structure ready)
- Email/push notifications (optional), QR code for TOTP setup, code-splitting the UI bundle (~420 kB)
- Savings goals, household sharing, receipt OCR, forecasting, AI classification (out of scope)

## Verification results (2026-10-22)
| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` (Vitest, 66 tests: money/dates/CSV, categorization, recurring, sync engine, budgets, API security & isolation, backup/restore, Enable Banking adapter) | pass |
| `npm run test:e2e` (16 tests: 8 flows × desktop 1280px + Pixel 7 mobile, axe WCAG A/AA serious/critical scan on 6 pages) | pass |
| `npm run build` | pass |
| `npm audit` | 0 vulnerabilities |
| `npm run scan:secrets` | clean |
| Fresh clone → `npm ci` → build → tests → demo server | pass |
| Live mode without provider; first-user registration; backup + restore CLIs | pass (manual) |
| Rendered UI inspected (desktop light/dark, mobile) | done; fixed contrast, mobile tables, mobile sign-out |
| Enable Banking sandbox | NOT run (no credentials) |
| Real Millennium bcp account | NOT run (requires user authorization) |

Status categories: verified with synthetic data = everything above; verified in provider sandbox = none; verified with real account = none; implemented awaiting external setup = Enable Banking live/sandbox connectivity.

## Current status (2026-10-22, live setup)
- Published: https://github.com/Freakah/fluxo (public, CI green, private vulnerability reporting + Dependabot on). Commits use the GitHub no-reply email.
- Local install: `C:\Users\gusta\Fluxo`, start with `npm.cmd start` (PowerShell blocks `npm.ps1`). Runs in live mode (`.env`, git-ignored).
- Enable Banking: production app "Fluxo (personal)" registered; app ID is in `.env`; key pair in `C:\Users\gusta\fluxo-keys` (private key never leaves that folder).
  Redirect URL registered: https://freakah.github.io/fluxo/callback.html (GitHub Pages relay from `docs/callback.html`, set as `BANK_REDIRECT_URL`).
  A real API call accepted the credentials; it returns "Application is not active" until accounts are linked.
- Next: user activates the app ("Activate by linking accounts" → Millennium BCP, using the online-banking Código de Utilizador), creates the Fluxo login at http://localhost:3000, then Accounts → Connect a bank → Millennium BCP. First real end-to-end test still pending.

## External blockers
- Enable Banking application (app id + private key) — user must register at enablebanking.com, upload a certificate, and link their own Millennium bcp account (restricted mode). Not available to the agent.
- Publication metadata: copyright holder name (LICENSE), GitHub owner/repo URL, security contact, `package.json` author/repository.
- Explicit authorization to create and push a public GitHub repository.

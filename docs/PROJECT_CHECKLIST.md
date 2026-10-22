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

## Completed
(see bottom: updated as milestones land)

## Remaining

## Verification results

## External blockers
- Enable Banking application (app id + private key) — needs the user to register at enablebanking.com and link their own Millennium bcp account (restricted mode). Not available to the agent.
- Publication metadata: copyright holder name, GitHub username/repo URL.

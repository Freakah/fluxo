# Architecture

One Node.js process, one SQLite file. No microservices, no external services except the bank provider.

```
 Browser (React SPA)  ──HTTPS/JSON──▶  Node 24 server (Hono)
   - no financial data in                ├─ auth: scrypt passwords, hashed session tokens, optional TOTP
     localStorage                        ├─ routes: validation (zod), per-user authorization on every query
   - UI prefs live server-side           ├─ domain: categorize · aggregate · budgets · recurring · notifications
                                         ├─ sync engine + in-process scheduler (or `npm run sync` via cron)
                                         ├─ SQLite (node:sqlite, WAL, migrations)  ── data/fluxo-<mode>.sqlite
                                         └─ provider adapter ──HTTPS (JWT RS256)──▶ Enable Banking ──▶ bank (PSD2 AIS)
```

## Layout

| Path | Purpose |
|---|---|
| `server/index.ts` | Entry: config, DB, providers, scheduler, HTTP server |
| `server/app.ts` | HTTP app: security headers, CSRF/origin checks, auth gate, routes, static UI |
| `server/config.ts` | Validated environment configuration |
| `server/db/` | SQLite access helpers and SQL migrations |
| `server/domain/` | Business logic: money totals, categorization, budgets, recurring, notifications, lifecycle, CSV |
| `server/sync/` | Sync engine (pagination, idempotency, reconciliation, locks, backoff) and scheduler |
| `server/providers/` | `types.ts` contract, `enablebanking.ts`, `demo.ts` (deterministic simulated bank) |
| `server/security/` | Passwords, sessions, AES-GCM secret box, rate limiter |
| `server/routes/` | auth, data (transactions/categories/rules), bank (accounts/connections), insights, privacy |
| `shared/` | Code used by server and UI: exact money, calendar dates, settings |
| `web/` | React + Vite UI. `web/src/i18n.ts` holds all copy (ready for a Portuguese file) |
| `scripts/` | CLI: backup, restore, sync, reset-password, gen-key, scan-secrets |
| `tests/`, `e2e/` | Vitest unit/integration tests; Playwright end-to-end tests |

## Data flow

1. **Connect**: the user picks a bank → server creates a single-use random `state` (stored hashed, 15 min, bound to the user) → provider authorization URL → the user authenticates **at the bank** → provider redirects to `/api/connections/callback` → state verified and consumed atomically → `POST /sessions` → the provider session id is encrypted (AES-256-GCM, key from env) and stored; accounts are matched by stable identity hash.
2. **Sync** (scheduled ~every 6 h, or manual): for each account, take a DB lease, fetch all pages, then write everything in one transaction (see [SYNC.md](SYNC.md)).
3. **Derive**: classify new rows, pair own-account transfers, refresh recurring estimates, check budget thresholds → in-app notifications (deduplicated).
4. **Read**: all totals come from `server/domain/aggregate.ts`, so dashboard, budgets, reports, notifications and exports apply the same rules ([FINANCIAL_RULES.md](FINANCIAL_RULES.md)).

## Key decisions

- **Node 24 native TypeScript + `node:sqlite`**: no compile step for the server, no native modules, single-file database → simple installs and simple backups.
- **SQLite**: right-sized for a personal, self-hosted app; relational constraints, transactions, WAL. Multi-instance deployments would need a different store (not a goal).
- **Bank facts vs. user layer**: imported columns (amount, dates, description, status) are written only by the sync engine; user columns (`category_override_id`, `type_override`, `note`, `excluded`) only by the user; derived columns (`auto_*`) are recomputed. Users can always see both.
- **Provider adapter**: `BankProvider` interface with `demo` and `enablebanking` implementations. Demo mode only ever loads the simulated provider; live mode only ever loads real ones.
- **No external AI or analytics.** Categorization is rules + curated merchant list.

## Database

Migrations in `server/db/migrations/*.sql` run automatically at startup, each in a transaction, recorded in `schema_migrations`. Never edit an applied migration; add a new numbered file.

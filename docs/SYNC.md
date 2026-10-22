# Synchronization

Implementation: `server/sync/engine.ts`, scheduler `server/sync/scheduler.ts`. Tests: `tests/sync.test.ts`.

## When it runs
- **Background**: every 5 minutes the scheduler picks connections whose `next_sync_after` has passed. After a success the next sync is scheduled `SYNC_INTERVAL_HOURS` later (default 6 h, minimum 6 h). At most **4 background fetches per connection per day** (Enable Banking FAQ: many banks allow about 4 fetches per day without the user present).
- **Manual** (“Sync now”): allowed every 10 minutes. Because the user is genuinely present, the request carries real PSU headers (`Psu-Ip-Address`, `Psu-User-Agent`). Background requests never send them, so Fluxo never claims a user is present when they are not. If a bank requires a header set we cannot honestly supply, the fetch falls back to a background request.
- **External scheduler**: `npm run sync` runs the same logic once (for cron/systemd). Syncing only happens while the server or that command runs.

## Per account
1. Acquire a 10-minute lease (`accounts.lock_until`); if another worker holds it, skip.
2. Window: first sync uses `strategy=longest` (earliest available history; most banks allow full history only in the first hour after consent). Later syncs fetch from `synced_through − 10 days` (overlap catches late bookings and status changes).
3. Fetch **every page** (continuation keys; loops and > 500 pages are errors). Any page failure aborts the account with nothing written.
4. Write in **one DB transaction**:
   - Match by stable bank id (`entry_reference`/`transaction_id`; pending ids only when the provider says they are stable).
   - Otherwise by fingerprint = hash(status, booking date, amount, currency, description, counterparty) **+ occurrence index** within the response — two identical purchases on the same day stay two rows and stay stable on re-sync.
   - Posted items with no match try to **reconcile with a pending row** (same account, direction and merchant, amount within 25 %, booked 0–7 days later). Exactly one candidate (or several fully identical ones) → the pending row becomes posted, keeping user notes/categories and recording the original pending amount. Several different candidates → nothing merged; all kept and flagged “needs review”.
   - Pending rows inside the window that the bank no longer reports become `cancelled` (“No longer pending”) with an explanation; they are not counted, not deleted, and revert if they reappear.
   - **Posted rows are never deleted** because a later response omits them.
   - Bank facts update; user fields are never touched.
5. Update balance (labelled with its type) and `synced_through`; release lease.

## Errors
| Provider result | Effect |
|---|---|
| Temporary (timeouts, 5xx, network) | status `error`, retry with backoff 15 min → 30 → 60 … max 6 h |
| Rate limited (`ASPSP_RATE_LIMIT_EXCEEDED`/429) | wait `Retry-After` or 6 h; status unchanged |
| Expired/closed session, consent date passed | status `expired`, stop scheduling, ask to reconnect |
| Revoked/access denied | status `revoked`, stop scheduling |
| Stored session undecryptable (key changed) | status `expired`, ask to reconnect |
| One of several accounts fails | run is `partial`; good accounts are saved |

Every attempt is recorded in `sync_runs` (shown under “Recent sync runs”). Runs left `running` by a crash become `interrupted` at startup; expired leases are cleared. `last_attempt_at` and `last_success_at` are tracked separately.

## Reconnection
Re-authorizing (Reconnect, or connecting the same bank again) stores the new session and maps accounts by the provider’s `identification_hash`, so history, categories and notes are kept and nothing is duplicated.

## Notifications
Sync problems, expiring (≤ 14 days) and expired consent, budget thresholds and new recurring suggestions create in-app notifications with dedupe keys, so repeated syncs never repeat an alert.

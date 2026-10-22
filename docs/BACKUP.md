# Backup and restore

Backups are **not automatic** unless you schedule them. Everything Fluxo stores is in one SQLite file
(`data/fluxo-live.sqlite`) plus a small deletion log (`data/deletions.log`).

## What is (not) backed up
| Included in `npm run backup` | Not included — keep separately |
|---|---|
| Users (password hashes), settings, accounts, transactions, categories, rules, budgets, recurring, notifications, connection metadata, **encrypted** bank-session references and 2-step secrets | `DATA_ENCRYPTION_KEY` (in `.env`), the Enable Banking private key, `.env` |

Without the encryption key a restored backup still has all financial history, but bank connections must be re-authorized and 2-step verification reset (`npm run reset-password`). Store the key in a password manager, not next to the backups.

## Make a backup
```bash
npm run backup
```
Writes a consistent snapshot (`VACUUM INTO`, safe while the server runs) to `data/backups/fluxo-<UTC time>.sqlite` with a `.json` metadata file, and keeps the newest 14 (`--keep N` or `BACKUP_KEEP`). Older backups are deleted — **that is the backup expiry**.

Backups contain financial data: copy them off the machine **encrypted** (e.g. `restic`, `age`, an encrypted disk), never into the Git repository.

Schedule daily (Linux cron example):
```
15 3 * * * cd /opt/fluxo && /usr/bin/npm run backup >> data/backup.log 2>&1
```
On Windows use Task Scheduler running `npm run backup` in the project folder.

## Restore
1. Stop the server.
2. Run:
   ```bash
   npm run restore -- data/backups/fluxo-20261022T031500Z.sqlite
   ```
3. Start the server.

The restore: checks the file is a valid Fluxo database (`integrity_check`), saves the current database as `data/pre-restore-<time>.sqlite`, copies the backup in, applies newer migrations, and **re-applies deletions recorded after the backup was taken** (from `data/deletions.log`), so data a user deleted is not silently brought back. The log holds only user/connection ids and timestamps.

Limitations: deletions made before the log existed, or on another machine, are not known; if you restore on a new machine, copy `data/deletions.log` too. Data synced after the backup is re-fetched only within the bank’s available history window.

## Verified
`tests/backup.test.ts` creates a demo dataset, backs it up, deletes a user and changes data, restores, and checks that history returned, the deleted user stayed deleted, later edits were rolled back, and the integrity check passes.

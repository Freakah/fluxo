# Changelog

All notable changes are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-10-22 (unreleased)

First public version.

### Added
- Dashboard, Transactions, Budgets, Recurring, Reports, Accounts & connections, Categories & rules, Settings & privacy, Notifications, Help.
- Enable Banking read-only adapter (RS256 JWT, pagination, pending, balances, documented error handling) — awaiting sandbox/live verification.
- Sync engine: full initial import, overlapping incremental windows, idempotent fingerprints with occurrence index, pending→posted reconciliation, disappearing-pending handling, per-account leases, backoff, rate-limit handling, partial-failure safety, interrupted-run recovery, background fetch limit, account identity mapping on reconnect.
- Automatic categorization with explanation and confidence; user rules with preview, priority, disable/delete; merchant normalization for Portuguese statements.
- Budgets with thresholds and deduplicated in-app notifications; recurring detection; CSV and full JSON export.
- Security: scrypt passwords, hashed sessions, TOTP, rate limits, CSRF defences, CSP, AES-GCM secret storage.
- Demo mode with deterministic Portuguese synthetic data, including a failing connection and an expired consent.
- Backup/restore with deletion re-application; secret scanner; CI workflow.

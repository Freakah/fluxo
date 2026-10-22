# Changelog

All notable changes are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-10-22 (unreleased)

First public version.

### Added
- Full European Portuguese interface with a language switch in Settings and on the sign-in page; Portuguese dates and amounts; default category names follow the language; server messages, notifications and Fluxo's own merchant labels (MB WAY, transfers) are translated too. A test checks every string has a translation.
- “To review” inbox for new payments (one-tap confirm, swipe on phones, change category with an optional rule, mark all as checked) with a count in the menu and a reminder on Home.
- “Paid back”: link incoming money (e.g. a friend’s MB WAY) to the expense it repays; it becomes a refund in that category so only your share counts.
- Hints on Home (a category well above its usual month; a subscription price rise), a monthly recap story, and a 90-day balance chart worked back from the bank balance.
- Text size setting; installable app (web manifest, icons, a service worker that never caches /api data); smaller cents on headline amounts; compact chart axis labels; pinned day headers in Activity; bottom-sheet details and clearer transaction rows on phones.
- Redesigned interface: grouped sidebar with icons (Home, Activity, Budgets, Bills, Insights, Banks, Categories), sync status, notification panel, profile menu, phone bottom tab bar; first-run welcome and guided tour; Ctrl+K quick search; category icons and colours; illustrations for empty states; side panel for transaction details with a visual category picker; budget rings and a guided budget setup with suggestions; bills calendar; donut and interactive bar charts; connect-a-bank guide; plain-language labels (Completed / Processing).
- Categorizer understands Millennium bcp statement wording (MB WAY and incoming transfers, account and foreign-service fees, more merchants).
- Dashboard, Transactions, Budgets, Recurring, Reports, Accounts & connections, Categories & rules, Settings & privacy, Notifications, Help.
- Enable Banking read-only adapter (RS256 JWT, pagination, pending, balances, documented error handling) — awaiting sandbox/live verification.
- Sync engine: full initial import, overlapping incremental windows, idempotent fingerprints with occurrence index, pending→posted reconciliation, disappearing-pending handling, per-account leases, backoff, rate-limit handling, partial-failure safety, interrupted-run recovery, background fetch limit, account identity mapping on reconnect.
- Automatic categorization with explanation and confidence; user rules with preview, priority, disable/delete; merchant normalization for Portuguese statements.
- Budgets with thresholds and deduplicated in-app notifications; recurring detection; CSV and full JSON export.
- Security: scrypt passwords, hashed sessions, TOTP, rate limits, CSRF defences, CSP, AES-GCM secret storage.
- Demo mode with deterministic Portuguese synthetic data, including a failing connection and an expired consent.
- Backup/restore with deletion re-application; secret scanner; CI workflow.

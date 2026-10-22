# Data export formats

## Full export (`GET /api/export/full`, Settings → Download all my data)
JSON object:

| Key | Content |
|---|---|
| `format` | `"fluxo-export"` |
| `version` | `1` (incremented on incompatible changes) |
| `exportedAt` | ISO-8601 UTC timestamp |
| `user` | `{ email, createdAt, settings }` |
| `connections[]` | `id, provider, institution_name, institution_country, status, consent_expires_at, last_success_at, created_at, disconnected_at` |
| `accounts[]` | `id, connection_id, name, display_name, iban_last4, currency, kind, included, balance_minor, balance_label, balance_at` |
| `categories[]` | `id, key (system categories), name, color, is_system, archived_at` |
| `rules[]` | `id, priority, enabled, field, match_type, pattern, direction, account_id, category_id, created_at` |
| `budgets[]` | `category_id (null = total), currency, amount_minor (null = removed), effective_month` |
| `recurring[]` | `merchant, currency, kind, frequency, typical_amount_minor, last_date, next_date, confidence, status, user_kind, user_frequency, user_amount_minor` |
| `transactions[]` | `id, account_id, source (import/manual), status (posted/pending/cancelled), amount_minor, currency, original_pending_amount_minor, booking_date, value_date, description, counterparty, merchant, auto_category_id, auto_source, auto_confidence, auto_type, category_override_id, type_override, note, excluded, transfer_peer_id, needs_review` |
| `notifications[]` | `kind, title, body, created_at, read_at` |

Conventions: `*_minor` are integers in minor units (cents), negative = money out; dates `YYYY-MM-DD`; effective category = `category_override_id ?? auto_category_id`; effective type = `type_override ?? auto_type`.

Never included: password hash, TOTP secret, provider session, encryption keys.

## Transaction CSV (`GET /api/transactions/export.csv`)
UTF-8 with BOM, comma-separated, CRLF, RFC 4180 quoting. Respects all list filters and account scope.

Columns: `booking_date, value_date, status, account, merchant, bank_description, counterparty, amount, currency, pending_amount, type, category, category_source, excluded_from_reports, note, source`.

`amount` is a plain decimal (`-23.85`), never mixed across currencies. Text cells starting with `= + - @`, tab or carriage return are prefixed with `'` so spreadsheets do not execute them as formulas. No account numbers are exported.

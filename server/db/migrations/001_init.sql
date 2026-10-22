-- Money: signed integer minor units (negative = money leaving the account).
-- Dates: booking_date/value_date are bank calendar dates 'YYYY-MM-DD'. Timestamps: ISO-8601 UTC text.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  mfa_pending INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE connections (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  institution_country TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active','expired','revoked','error','disconnected')),
  provider_session_enc TEXT,
  provider_state_json TEXT NOT NULL DEFAULT '{}',
  consent_expires_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  next_sync_after TEXT,
  background_fetches_day TEXT,
  background_fetches_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  disconnected_at TEXT
);
CREATE INDEX connections_user ON connections(user_id);

-- Single-use authorization state for the bank redirect flow (stored hashed).
CREATE TABLE auth_states (
  state_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  institution_country TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
  provider_account_uid TEXT,
  identity_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  iban_last4 TEXT,
  currency TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('current','savings','card','cash','other')),
  included INTEGER NOT NULL DEFAULT 1,
  balance_minor INTEGER,
  balance_type TEXT,
  balance_label TEXT,
  balance_at TEXT,
  synced_through TEXT,
  initial_sync_done INTEGER NOT NULL DEFAULT 0,
  lock_until TEXT,
  lock_owner TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, identity_hash)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, key)
);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  field TEXT NOT NULL CHECK (field IN ('merchant','description')),
  match_type TEXT NOT NULL CHECK (match_type IN ('equals','contains','starts_with')),
  pattern TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'any' CHECK (direction IN ('any','out','in')),
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  created_at TEXT NOT NULL
);
CREATE INDEX rules_user ON rules(user_id, enabled, priority);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('import','manual')),
  -- Bank-supplied facts (only the sync engine writes these).
  provider_tx_id TEXT,
  fingerprint TEXT,
  status TEXT NOT NULL CHECK (status IN ('posted','pending','cancelled')),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  original_pending_amount_minor INTEGER,
  booking_date TEXT NOT NULL,
  value_date TEXT,
  description TEXT NOT NULL,
  counterparty TEXT,
  bank_code TEXT,
  mcc TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missing_since TEXT,
  missing_count INTEGER NOT NULL DEFAULT 0,
  needs_review TEXT,
  -- Derived classification (recomputed; never overwrites user layer).
  merchant TEXT NOT NULL,
  auto_category_id INTEGER REFERENCES categories(id),
  auto_source TEXT NOT NULL DEFAULT 'none',
  auto_confidence TEXT NOT NULL DEFAULT 'none',
  auto_rule_id INTEGER REFERENCES rules(id) ON DELETE SET NULL,
  auto_type TEXT NOT NULL,
  transfer_peer_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  -- User layer.
  category_override_id INTEGER REFERENCES categories(id),
  type_override TEXT CHECK (type_override IN ('expense','income','refund','transfer')),
  note TEXT,
  excluded INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tx_provider_id ON transactions(account_id, provider_tx_id) WHERE provider_tx_id IS NOT NULL;
CREATE UNIQUE INDEX tx_fingerprint ON transactions(account_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX tx_user_date ON transactions(user_id, booking_date DESC, id DESC);
CREATE INDEX tx_account_status ON transactions(account_id, status, booking_date);

CREATE TABLE budgets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id),
  currency TEXT NOT NULL,
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0), -- NULL = budget removed from this month on
  effective_month TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- One row per (scope, month): the latest effective_month <= target month applies. NULL category = total budget.
CREATE UNIQUE INDEX budgets_scope_month ON budgets(user_id, IFNULL(category_id, 0), currency, effective_month);

CREATE TABLE recurring (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_key TEXT NOT NULL,
  merchant TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'out',
  kind TEXT NOT NULL CHECK (kind IN ('subscription','bill','income','other')),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','annual')),
  typical_amount_minor INTEGER NOT NULL,
  min_amount_minor INTEGER NOT NULL,
  max_amount_minor INTEGER NOT NULL,
  occurrences INTEGER NOT NULL,
  last_date TEXT NOT NULL,
  next_date TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  status TEXT NOT NULL CHECK (status IN ('suggested','confirmed','dismissed','inactive')),
  user_kind TEXT,
  user_frequency TEXT,
  user_amount_minor INTEGER,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, merchant_key, currency, direction)
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','success','partial','failed','interrupted','skipped')),
  fetched INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT
);
CREATE INDEX sync_runs_conn ON sync_runs(connection_id, started_at DESC);

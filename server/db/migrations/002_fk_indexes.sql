-- Indexes on foreign-key child columns so deletes and cascades don't scan whole tables.
CREATE INDEX tx_transfer_peer ON transactions(transfer_peer_id) WHERE transfer_peer_id IS NOT NULL;
CREATE INDEX tx_category_override ON transactions(category_override_id) WHERE category_override_id IS NOT NULL;
CREATE INDEX tx_auto_category ON transactions(auto_category_id);
CREATE INDEX tx_auto_rule ON transactions(auto_rule_id) WHERE auto_rule_id IS NOT NULL;
CREATE INDEX accounts_connection ON accounts(connection_id);
CREATE INDEX rules_category ON rules(category_id);
CREATE INDEX rules_account ON rules(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX budgets_category ON budgets(category_id);
CREATE INDEX recurring_account ON recurring(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX auth_states_connection ON auth_states(connection_id);
CREATE INDEX auth_states_user ON auth_states(user_id);
CREATE INDEX notifications_user ON notifications(user_id, created_at);

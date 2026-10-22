export type Tx = {
  id: number; account_id: number; account_name: string; account_display_name: string | null; source: 'import' | 'manual'; status: 'posted' | 'pending' | 'cancelled';
  amount_minor: number; currency: string; original_pending_amount_minor: number | null; booking_date: string; value_date: string | null; description: string;
  counterparty: string | null; merchant: string; note: string | null; excluded: number; type: string; category_id: number | null; category_name: string | null;
  category_color: string | null; category_source: string; confidence: string; type_overridden: number; transfer_peer_id: number | null; needs_review: string | null;
  paid_back_for_id: number | null; paid_back_minor: number | null;
};
export type Category = { id: number; key: string | null; name: string; color: string; icon: string | null; is_system: number; archived_at: string | null; tx_count: number };
export type Account = { id: number; connection_id: number | null; name: string; display_name: string | null; iban_last4: string | null; currency: string; kind: string; included: number; balance_minor: number | null; balance_label: string | null; balance_at: string | null; synced_through: string | null; latest_tx_date: string | null; tx_count: number };
export type Connection = { id: number; provider: string; institution_name: string; institution_country: string; status: string; consent_expires_at: string | null; last_attempt_at: string | null; last_success_at: string | null; last_error_code: string | null; last_error_message: string | null; failure_count: number; next_sync_after: string | null; created_at: string; live: boolean; simulated: boolean; recentRuns: { status: string; started_at: string; inserted: number; updated: number; error_code: string | null }[] };
export type Totals = { currency: string; spending: number; income: number; net: number; pendingOut: number; refunds: number; count: number };
export type BudgetLine = { categoryId: number | null; amount: number; spent: number; pending: number; remaining: number; pct: number; state: 'ok' | 'warning' | 'over'; previousSpent: number; name?: string; color?: string };
export type Recurring = { id: number; merchant: string; currency: string; kind: string; frequency: string; effective_frequency: string; typical_amount_minor: number; effective_amount_minor: number; min_amount_minor: number; max_amount_minor: number; monthly_equivalent_minor: number; occurrences: number; last_date: string; next_date: string | null; confidence: string; status: string; possibly_ended: boolean; user_amount_minor: number | null; user_frequency: string | null };
export type Notification = { id: number; kind: string; title: string; body: string; link: string; severity: string; created_at: string; read_at: string | null };

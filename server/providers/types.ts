// Read-only account-information provider contract. No payment initiation, ever.

export type Institution = { name: string; country: string; logo?: string; maxConsentDays?: number; psuTypes?: string[] };

export type ProviderAccount = {
  uid: string; // provider handle, may change between sessions
  identityHash: string; // stable across sessions (e.g. Enable Banking identification_hash)
  name: string;
  ibanLast4: string | null;
  currency: string;
  kind: 'current' | 'savings' | 'card' | 'other';
};

export type ProviderTx = {
  id: string | null; // stable bank id (entry_reference / transaction_id) when supplied
  status: 'posted' | 'pending' | 'cancelled';
  amount: string; // exact signed decimal string, negative = outflow
  currency: string;
  bookingDate: string; // YYYY-MM-DD (for pending: transaction or value date)
  valueDate: string | null;
  description: string;
  counterparty: string | null;
  bankCode: string | null;
  mcc: string | null;
};

export type ProviderBalance = { amount: string; currency: string; type: string; label: string; at: string | null };

export type PsuContext = { ipAddress: string; userAgent: string } | null;

export type AuthSession = { sessionRef: string; consentExpiresAt: string | null; accounts: ProviderAccount[] };

export type ErrorKind = 'consent_expired' | 'revoked' | 'rate_limited' | 'temporary' | 'invalid' | 'not_configured';

export class ProviderError extends Error {
  kind: ErrorKind;
  code: string;
  retryAfterSec?: number;
  constructor(kind: ErrorKind, code: string, message: string, retryAfterSec?: number) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface BankProvider {
  id: string;
  label: string;
  /** True only for real banking connectivity (sandbox counts as non-live). */
  live: boolean;
  listInstitutions(country: string): Promise<Institution[]>;
  startAuthorization(p: { institution: Institution; state: string; redirectUrl: string; validUntil: Date }): Promise<{ url: string }>;
  completeAuthorization(code: string): Promise<AuthSession>;
  getBalances(sessionRef: string, accountUid: string, psu: PsuContext): Promise<ProviderBalance[]>;
  /** One page. Pass continuationKey back until it is null. dateFrom null = longest history available. */
  getTransactions(sessionRef: string, accountUid: string, p: { dateFrom: string | null; continuationKey: string | null; psu: PsuContext }): Promise<{ transactions: ProviderTx[]; continuationKey: string | null }>;
  revoke(sessionRef: string): Promise<void>;
}

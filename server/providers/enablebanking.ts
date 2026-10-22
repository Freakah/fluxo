// Enable Banking AIS adapter, written against https://enablebanking.com/docs/api/reference (checked 2026-10-22).
// Sandbox and production use the same API; which one you get depends on the application (app id + key).
// NOT verified against a real account by the authors of this file — see docs/PROVIDERS.md.
import fs from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import { ProviderError, type BankProvider, type Institution, type ProviderAccount, type ProviderTx, type ProviderBalance, type PsuContext } from './types.ts';

type Fetch = typeof fetch;
export type EnableBankingOptions = { appId: string; privateKeyPem: string; apiUrl: string; environment: 'sandbox' | 'production'; fetchImpl?: Fetch };

// Preference order for the single balance we show, clearly labelled.
const BALANCE_PREFERENCE: [string, string][] = [
  ['ITAV', 'Available (interim)'], ['CLAV', 'Available (closing)'], ['ITBD', 'Booked (interim)'], ['CLBD', 'Booked (closing)'],
  ['XPCD', 'Expected'], ['OPAV', 'Available (opening)'], ['OPBD', 'Booked (opening)'], ['FWAV', 'Forward available'], ['VALU', 'Value-date'], ['INFO', 'Informational'], ['OTHR', 'Other'],
];

export function createEnableBankingProvider(opts: EnableBankingOptions): BankProvider {
  const f = opts.fetchImpl ?? fetch;
  let keyPromise: ReturnType<typeof importPKCS8> | undefined;
  let cached: { jwt: string; exp: number } | undefined;

  async function token(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.exp - 60 > now) return cached.jwt;
    keyPromise ??= importPKCS8(opts.privateKeyPem, 'RS256');
    const exp = now + 3600; // well under the 24h maximum
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: opts.appId })
      .setIssuer('enablebanking.com').setAudience('api.enablebanking.com').setIssuedAt(now).setExpirationTime(exp)
      .sign(await keyPromise);
    cached = { jwt, exp };
    return jwt;
  }

  async function call<T>(method: string, path: string, body?: unknown, psu?: PsuContext): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await token()}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (psu) { headers['Psu-Ip-Address'] = psu.ipAddress; headers['Psu-User-Agent'] = psu.userAgent; }
    let res: Response;
    try {
      res = await f(opts.apiUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new ProviderError('temporary', 'NETWORK', 'Could not reach Enable Banking');
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!res.ok) throw mapError(res.status, json, res.headers.get('retry-after'));
    return json as T;
  }

  return {
    id: 'enablebanking',
    label: `Enable Banking (${opts.environment})`,
    live: opts.environment === 'production',
    async listInstitutions(country) {
      const r = await call<{ aspsps: { name: string; country: string; logo?: string; maximum_consent_validity?: number; psu_types?: string[] }[] }>('GET', `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal&service=AIS`);
      return r.aspsps.map((a) => ({ name: a.name, country: a.country, logo: a.logo, maxConsentDays: a.maximum_consent_validity ? Math.floor(a.maximum_consent_validity / 86400) : undefined, psuTypes: a.psu_types }));
    },
    async startAuthorization({ institution, state, redirectUrl, validUntil }) {
      const r = await call<{ url: string }>('POST', '/auth', {
        access: { valid_until: validUntil.toISOString(), balances: true, transactions: true },
        aspsp: { name: institution.name, country: institution.country },
        state, redirect_url: redirectUrl, psu_type: 'personal',
      });
      if (!r?.url || !/^https:\/\//.test(r.url)) throw new ProviderError('invalid', 'BAD_AUTH_URL', 'Provider returned an invalid authorization URL');
      return { url: r.url };
    },
    async completeAuthorization(code) {
      const r = await call<{ session_id: string; access?: { valid_until?: string }; accounts: EbAccount[] }>('POST', '/sessions', { code });
      return { sessionRef: r.session_id, consentExpiresAt: r.access?.valid_until ?? null, accounts: r.accounts.map(mapAccount) };
    },
    async getBalances(sessionRef, uid, psu) {
      void sessionRef;
      const r = await call<{ balances: EbBalance[] }>('GET', `/accounts/${encodeURIComponent(uid)}/balances`, undefined, psu);
      return pickBalances(r.balances);
    },
    async getTransactions(sessionRef, uid, { dateFrom, continuationKey, psu }) {
      void sessionRef;
      const q = new URLSearchParams();
      if (continuationKey) q.set('continuation_key', continuationKey);
      if (dateFrom) q.set('date_from', dateFrom); else q.set('strategy', 'longest');
      const r = await call<{ transactions: EbTx[]; continuation_key?: string | null }>('GET', `/accounts/${encodeURIComponent(uid)}/transactions?${q}`, undefined, psu);
      return { transactions: (r.transactions ?? []).map(mapTx).filter((t): t is ProviderTx => t !== null), continuationKey: r.continuation_key || null };
    },
    async revoke(sessionRef) {
      try { await call('DELETE', `/sessions/${encodeURIComponent(sessionRef)}`); } catch (e) {
        if (e instanceof ProviderError && (e.kind === 'consent_expired' || e.kind === 'revoked')) return; // already gone
        throw e;
      }
    },
  };
}

type Amount = { currency: string; amount: string };
type EbAccount = { uid: string; identification_hash?: string; identification_hashes?: string[]; account_id?: { iban?: string; other?: { identification?: string } }; name?: string; product?: string; details?: string; currency: string; cash_account_type?: string };
type EbBalance = { name?: string; balance_amount: Amount; balance_type: string; last_change_date_time?: string; reference_date?: string };
type EbTx = {
  entry_reference?: string | null; transaction_id?: string | null; transaction_amount: Amount; credit_debit_indicator: 'CRDT' | 'DBIT';
  status: string; booking_date?: string | null; value_date?: string | null; transaction_date?: string | null;
  remittance_information?: string[] | null; creditor?: { name?: string } | null; debtor?: { name?: string } | null;
  bank_transaction_code?: { description?: string; code?: string; sub_code?: string } | null; merchant_category_code?: string | null; note?: string | null;
};

export function mapAccount(a: EbAccount): ProviderAccount {
  const ident = a.account_id?.iban ?? a.account_id?.other?.identification ?? '';
  const kind: ProviderAccount['kind'] = a.cash_account_type === 'CARD' ? 'card' : a.cash_account_type === 'SVGS' ? 'savings' : a.cash_account_type === 'CACC' ? 'current' : 'other';
  return {
    uid: a.uid,
    identityHash: a.identification_hash ?? a.identification_hashes?.[0] ?? `uid:${a.uid}`,
    name: a.name || a.product || a.details || 'Account',
    ibanLast4: ident ? ident.replace(/\s/g, '').slice(-4) : null,
    currency: a.currency,
    kind,
  };
}

export function mapTx(t: EbTx): ProviderTx | null {
  const status = t.status === 'BOOK' ? 'posted' : t.status === 'PDNG' || t.status === 'HOLD' ? 'pending' : t.status === 'CNCL' || t.status === 'RJCT' ? 'cancelled' : null;
  if (!status) return null; // SCHD / OTHR: not money that has moved; skip rather than guess
  const date = t.booking_date ?? t.transaction_date ?? t.value_date;
  if (!date || !t.transaction_amount?.amount) return null;
  const abs = t.transaction_amount.amount.replace(/^[+-]/, '');
  const amount = t.credit_debit_indicator === 'DBIT' ? `-${abs}` : abs;
  const counterparty = (t.credit_debit_indicator === 'DBIT' ? t.creditor?.name : t.debtor?.name) ?? null;
  const description = (t.remittance_information ?? []).join(' ').trim() || counterparty || t.bank_transaction_code?.description || 'Transaction';
  const code = t.bank_transaction_code ? [t.bank_transaction_code.code, t.bank_transaction_code.sub_code].filter(Boolean).join('-') || null : null;
  return {
    // Pending ids are only stable when the bank keeps them after booking; Enable Banking only sends entry_reference then.
    id: t.entry_reference || (status === 'posted' ? t.transaction_id : null) || null,
    status, amount, currency: t.transaction_amount.currency, bookingDate: date.slice(0, 10), valueDate: t.value_date?.slice(0, 10) ?? null,
    description, counterparty, bankCode: code, mcc: t.merchant_category_code ?? null,
  };
}

export function pickBalances(list: EbBalance[]): ProviderBalance[] {
  const out: ProviderBalance[] = [];
  for (const [type, label] of BALANCE_PREFERENCE) {
    const b = list.find((x) => x.balance_type === type);
    if (b) out.push({ amount: b.balance_amount.amount, currency: b.balance_amount.currency, type, label, at: b.last_change_date_time ?? b.reference_date ?? null });
  }
  return out;
}

export function mapError(status: number, body: unknown, retryAfter: string | null): ProviderError {
  const b = (body ?? {}) as { error?: string; message?: string };
  const code = b.error ?? `HTTP_${status}`;
  const msg = typeof b.message === 'string' ? b.message.slice(0, 200) : `Provider error (${status})`;
  if (code === 'EXPIRED_SESSION' || code === 'CLOSED_SESSION' || code === 'SESSION_DOES_NOT_EXIST') return new ProviderError('consent_expired', code, msg);
  if (code === 'REVOKED_SESSION' || code === 'ACCESS_DENIED') return new ProviderError('revoked', code, msg);
  if (code === 'ASPSP_RATE_LIMIT_EXCEEDED' || status === 429) return new ProviderError('rate_limited', code, msg, retryAfter && /^\d+$/.test(retryAfter) ? +retryAfter : 6 * 3600);
  if (status >= 500 || status === 408 || code === 'ASPSP_TIMEOUT' || code === 'ASPSP_ERROR') return new ProviderError('temporary', code, msg);
  if (status === 401) return new ProviderError('not_configured', code, 'Enable Banking rejected the application credentials');
  return new ProviderError('invalid', code, msg);
}

export function loadEnableBanking(cfg: { ENABLE_BANKING_APP_ID?: string; ENABLE_BANKING_KEY_PATH?: string; ENABLE_BANKING_API_URL: string; ENABLE_BANKING_ENVIRONMENT: 'sandbox' | 'production' }): BankProvider | null {
  if (!cfg.ENABLE_BANKING_APP_ID || !cfg.ENABLE_BANKING_KEY_PATH) return null;
  return createEnableBankingProvider({ appId: cfg.ENABLE_BANKING_APP_ID, privateKeyPem: fs.readFileSync(cfg.ENABLE_BANKING_KEY_PATH, 'utf8'), apiUrl: cfg.ENABLE_BANKING_API_URL, environment: cfg.ENABLE_BANKING_ENVIRONMENT });
}

export type { Institution };

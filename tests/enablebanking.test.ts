// Adapter tests against documented response shapes (synthetic fixtures — not a live or sandbox call).
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, decodeJwt } from 'jose';
import { createEnableBankingProvider, mapTx, mapAccount, pickBalances, mapError } from '../server/providers/enablebanking.ts';
import { ProviderError } from '../server/providers/types.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('Enable Banking mapping', () => {
  it('maps booked, pending and cancelled transactions with signed exact amounts', () => {
    expect(mapTx({ entry_reference: 'ER1', transaction_amount: { currency: 'EUR', amount: '23.85' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-20', value_date: '2026-10-19', remittance_information: ['COMPRA 4521', 'PINGO DOCE'], creditor: { name: 'PINGO DOCE SA' } }))
      .toMatchObject({ id: 'ER1', status: 'posted', amount: '-23.85', bookingDate: '2026-10-20', valueDate: '2026-10-19', description: 'COMPRA 4521 PINGO DOCE', counterparty: 'PINGO DOCE SA' });
    expect(mapTx({ transaction_id: 'T9', transaction_amount: { currency: 'EUR', amount: '5' }, credit_debit_indicator: 'DBIT', status: 'PDNG', transaction_date: '2026-10-21' }))
      .toMatchObject({ id: null, status: 'pending', amount: '-5', bookingDate: '2026-10-21' }); // pending transaction_id is not trusted as stable
    expect(mapTx({ transaction_amount: { currency: 'EUR', amount: '100.00' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-01', debtor: { name: 'EMPRESA' } })).toMatchObject({ amount: '100.00', counterparty: 'EMPRESA' });
    expect(mapTx({ transaction_amount: { currency: 'EUR', amount: '1.00' }, credit_debit_indicator: 'DBIT', status: 'RJCT', booking_date: '2026-10-01' })!.status).toBe('cancelled');
    expect(mapTx({ transaction_amount: { currency: 'EUR', amount: '1.00' }, credit_debit_indicator: 'DBIT', status: 'SCHD', booking_date: '2026-10-01' })).toBeNull();
  });
  it('maps accounts with a stable identity hash and only the last 4 IBAN digits', () => {
    const a = mapAccount({ uid: 'u1', identification_hash: 'H', account_id: { iban: 'PT00-TEST-ACCOUNT-6789' }, name: 'Conta', currency: 'EUR', cash_account_type: 'CACC' });
    expect(a).toEqual({ uid: 'u1', identityHash: 'H', name: 'Conta', ibanLast4: '6789', currency: 'EUR', kind: 'current' });
  });
  it('labels balances and prefers available over booked', () => {
    const b = pickBalances([{ balance_amount: { currency: 'EUR', amount: '10.00' }, balance_type: 'CLBD' }, { balance_amount: { currency: 'EUR', amount: '9.00' }, balance_type: 'ITAV' }]);
    expect(b[0]).toMatchObject({ type: 'ITAV', label: 'Available (interim)', amount: '9.00' });
  });
  it('maps documented error codes to sync behaviour', () => {
    expect(mapError(400, { error: 'EXPIRED_SESSION', message: 'x' }, null).kind).toBe('consent_expired');
    expect(mapError(403, { error: 'REVOKED_SESSION' }, null).kind).toBe('revoked');
    const rl = mapError(429, { error: 'ASPSP_RATE_LIMIT_EXCEEDED' }, null);
    expect([rl.kind, rl.retryAfterSec]).toEqual(['rate_limited', 21600]);
    expect(mapError(504, { error: 'ASPSP_TIMEOUT' }, null).kind).toBe('temporary');
    expect(mapError(401, {}, null).kind).toBe('not_configured');
  });
});

describe('Enable Banking client', () => {
  it('signs RS256 JWTs with the documented claims and follows continuation keys', async () => {
    const seen: { url: string; auth: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      seen.push({ url, auth: headers.Authorization, headers });
      const u = new URL(url);
      const body = u.searchParams.get('continuation_key') === 'k2'
        ? { transactions: [{ entry_reference: 'B', transaction_amount: { currency: 'EUR', amount: '2.00' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-02' }], continuation_key: null }
        : { transactions: [{ entry_reference: 'A', transaction_amount: { currency: 'EUR', amount: '1.00' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-01' }], continuation_key: 'k2' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const p = createEnableBankingProvider({ appId: 'app-123', privateKeyPem: pem, apiUrl: 'https://api.example.test', environment: 'sandbox', fetchImpl });
    const r1 = await p.getTransactions('s', 'acc 1', { dateFrom: null, continuationKey: null, psu: null });
    const r2 = await p.getTransactions('s', 'acc 1', { dateFrom: null, continuationKey: r1.continuationKey, psu: { ipAddress: '1.2.3.4', userAgent: 'UA' } });
    expect([...r1.transactions, ...r2.transactions].map((t) => t.id)).toEqual(['A', 'B']);
    expect(seen[0].url).toBe('https://api.example.test/accounts/acc%201/transactions?strategy=longest');
    expect(seen[0].headers['Psu-Ip-Address']).toBeUndefined();
    expect(seen[1].headers['Psu-Ip-Address']).toBe('1.2.3.4');
    const jwt = seen[0].auth.replace('Bearer ', '');
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: 'app-123' });
    const claims = decodeJwt(jwt);
    expect(claims).toMatchObject({ iss: 'enablebanking.com', aud: 'api.enablebanking.com' });
    expect(claims.exp! - claims.iat!).toBeLessThanOrEqual(86400);
    expect(p.live).toBe(false);
  });

  it('turns HTTP errors into typed provider errors and rejects non-https auth URLs', async () => {
    const err = createEnableBankingProvider({ appId: 'a', privateKeyPem: pem, apiUrl: 'https://x.test', environment: 'production', fetchImpl: (async () => new Response(JSON.stringify({ error: 'ASPSP_RATE_LIMIT_EXCEEDED', message: 'slow down' }), { status: 429 })) as unknown as typeof fetch });
    await expect(err.getBalances('s', 'u', null)).rejects.toBeInstanceOf(ProviderError);
    const bad = createEnableBankingProvider({ appId: 'a', privateKeyPem: pem, apiUrl: 'https://x.test', environment: 'production', fetchImpl: (async () => new Response(JSON.stringify({ url: 'http://phish.test' }), { status: 200 })) as unknown as typeof fetch });
    await expect(bad.startAuthorization({ institution: { name: 'Millennium BCP', country: 'PT' }, state: 's', redirectUrl: 'https://app/cb', validUntil: new Date() })).rejects.toThrow(/invalid authorization URL/);
  });
});

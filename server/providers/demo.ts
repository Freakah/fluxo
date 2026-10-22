// Deterministic simulated bank for demo mode. All data is synthetic. Never presented as a real connection.
//
// The simulated bank's state is a pure function of (scenario, connection start date, "as of" date):
// each calendar day's activity comes from a PRNG seeded by scenario+date, so re-fetching any window
// returns identical data. Card purchases from the last 2 days are pending (no bank id) and post the next
// day with an id, sometimes with a different amount; one hotel pre-authorisation disappears.
import { addDays, addMonths, monthBounds, monthOf, daysBetween } from '../../shared/dates.ts';
import { minorToDecimal, parseAmountToMinor } from '../../shared/money.ts';
import { ProviderError, type BankProvider, type ProviderAccount, type ProviderTx, type Institution } from './types.ts';

export const DEMO_INSTITUTIONS: Institution[] = [
  { name: 'Millennium bcp (simulated)', country: 'PT', maxConsentDays: 180 },
  { name: 'ActivoBank (simulated)', country: 'PT', maxConsentDays: 180 },
];

type Scenario = 'main' | 'card' | 'flaky';
type Gen = { acct: string; date: string; amount: number; desc: string; counterparty?: string; card?: boolean; id?: string; postedAmount?: number; neverPosts?: boolean; mcc?: string };

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOLS: { p: number; items: [string, number, number][]; card?: boolean }[] = [
  { p: 0.28, card: true, items: [['COMPRA 4521 CONTINENTE BOM DIA', 600, 9500], ['COMPRA 4521 PINGO DOCE ALVALADE', 500, 7000], ['COMPRA 4521 LIDL LISBOA', 800, 6500], ['COMPRA 4521 MERCADONA LOURES', 1500, 8500], ['COMPRA 4521 MINIPRECO ARROIOS', 300, 2500]] },
  { p: 0.4, card: true, items: [['COMPRA 4521 PASTELARIA SAO ROQUE', 120, 450], ['COMPRA 4521 CAFE A PRACA', 90, 380], ['COMPRA 4521 PADARIA PORTUGUESA', 150, 600]] },
  { p: 0.12, card: true, items: [['COMPRA 4521 RESTAURANTE O PATEO', 900, 3500], ['COMPRA 4521 TELEPIZZA SALDANHA', 1200, 2400], ['COMPRA 4521 MCDONALDS CAMPO GRANDE', 650, 1500], ['COMPRA 4521 CERVEJARIA RAMIRO', 2500, 6000]] },
  { p: 0.06, card: true, items: [['COMPRA 4521 UBER EATS PT', 1100, 2800], ['COMPRA 4521 GLOVO LISBOA', 1000, 2500]] },
  { p: 0.08, card: true, items: [['COMPRA 4521 UBER BV TRIP', 550, 1600], ['COMPRA 4521 BOLT.EU RIDE', 450, 1400], ['COMPRA 4521 CP COMBOIOS DE PORTUGAL', 260, 2400]] },
  { p: 0.05, card: true, items: [['COMPRA 4521 GALP ENERGIA AV REPUBLICA', 3500, 7000], ['COMPRA 4521 REPSOL OLIVAIS', 3000, 6500], ['COMPRA 4521 PRIO ODIVELAS', 3000, 6000]] },
  { p: 0.05, card: true, items: [['COMPRA 4521 WORTEN COLOMBO', 1500, 18000], ['COMPRA 4521 FNAC CHIADO', 1200, 6000], ['COMPRA 4521 IKEA ALFRAGIDE', 2000, 15000], ['COMPRA 4521 PRIMARK COLOMBO', 800, 5000], ['COMPRA 4521 AMAZON.ES', 900, 7000]] },
  { p: 0.05, card: true, items: [['COMPRA 4521 STEAMGAMES.COM', 499, 5999], ['COMPRA 4521 NINTENDO ESHOP', 799, 6999], ['COMPRA 4521 PLAYSTATION STORE', 999, 6999], ['COMPRA 4521 EPIC GAMES STORE', 499, 2999]] },
  { p: 0.04, card: true, items: [['COMPRA 4521 FARMACIA ESTACAO', 350, 3200], ['COMPRA 4521 WELLS SALDANHA', 400, 2500]] },
  { p: 0.04, items: [['LEV ATM MULTIBANCO SALDANHA', 2000, 2000], ['LEV ATM MULTIBANCO ROSSIO', 4000, 4000], ['LEV ATM MULTIBANCO ALAMEDA', 6000, 6000]] },
  { p: 0.05, items: [['MBWAY P/ 912***523', 500, 2500], ['MBWAY P/ 936***118', 600, 3000]] },
  { p: 0.03, card: true, items: [['COMPRA 4521 LOJA DO BAIRRO UNIP', 300, 2000], ['PAG SERV ENT 21025 REF 482913571', 1500, 6000], ['COMPRA 4521 SUMUP *TASCA DO ZE', 700, 2200]] },
];

const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function salaryDate(month: string): string {
  // 25th, or the previous Friday if it falls on a weekend.
  let d = `${month}-25`;
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  if (dow === 6) d = addDays(d, -1);
  if (dow === 0) d = addDays(d, -2);
  return d;
}

/** Card account activity for one day (used for the card scenario and to size the monthly repayment). */
function cardDay(date: string): Gen[] {
  const r = rng(`card|${date}`);
  const out: Gen[] = [];
  if (r() < 0.04) { const [d, lo, hi] = [['RYANAIR DAC', 2999, 12999], ['BOOKING.COM HOTEL', 6000, 24000], ['TAP AIR PORTUGAL', 8900, 32000], ['AMAZON.ES MARKETPLACE', 1200, 9000]][between(r, 0, 3)] as [string, number, number]; out.push({ acct: 'card', date, amount: -between(r, lo, hi), desc: d, card: true }); }
  if (r() < 0.05) out.push({ acct: 'card', date, amount: -between(r, 999, 4999), desc: 'XBOX GAME STORE', card: true });
  return out;
}

function monthCardSpend(month: string): number {
  const { from, days } = monthBounds(month);
  let sum = 0;
  for (let i = 0; i < days; i++) for (const g of cardDay(addDays(from, i))) sum += -g.amount;
  return sum;
}

/** All activity for one day in a scenario. `anchor` = connection start date (fixes one-off events). */
function day(scenario: Scenario, date: string, anchor: string): Gen[] {
  const out: Gen[] = [];
  const dom = +date.slice(8, 10);
  const month = monthOf(date);
  const mNum = +date.slice(5, 7);
  const rel = daysBetween(anchor, date); // negative before the anchor
  const r = rng(`${scenario}|${date}`);
  if (scenario === 'card') {
    out.push(...cardDay(date));
    if (dom === 5) out.push({ acct: 'card', date, amount: monthCardSpend(addMonths(month, -1)), desc: 'PAGAMENTO RECEBIDO OBRIGADO' });
    if (rel === -40) out.push({ acct: 'card', date, amount: -1999, desc: 'STEAM PURCHASE', card: true }, { acct: 'card', date, amount: -1999, desc: 'STEAM PURCHASE', card: true }); // two identical, no bank ids
    return out;
  }
  if (scenario === 'flaky') {
    if (dom === 25) out.push({ acct: 'flaky', date, amount: 15000, desc: 'TRF DE FREELANCE CLIENTE EXEMPLO' });
    if (r() < 0.2) out.push({ acct: 'flaky', date, amount: -between(r, 500, 4000), desc: 'COMPRA 4521 AUCHAN AMOREIRAS', card: true });
    return out;
  }
  // Main current account
  const A = 'current';
  if (dom === 1) out.push({ acct: A, date, amount: -75000, desc: 'TRF RENDA HABITACAO', counterparty: 'SENHORIO EXEMPLO' });
  if (dom === 2) out.push({ acct: A, date, amount: -3999, desc: 'DD MEO SA FATURA' });
  if (dom === 3) out.push({ acct: A, date, amount: -1399, desc: 'COMPRA 4521 NETFLIX.COM', card: false });
  if (dom === 5) {
    out.push({ acct: A, date, amount: -520, desc: 'COMISSAO MANUTENCAO CONTA' }, { acct: A, date, amount: -21, desc: 'IMPOSTO SELO S/ COMISSAO' });
    const due = monthCardSpend(addMonths(month, -1));
    if (due > 0) out.push({ acct: A, date, amount: -due, desc: 'PAGAMENTO CARTAO CREDITO MILLENNIUM' });
  }
  if (dom === 8) out.push({ acct: A, date, amount: -between(r, 3800, 7200), desc: 'DD EDP COMERCIAL ELECTRICIDADE' });
  if (dom === 10) out.push({ acct: A, date, amount: -4000, desc: 'COMPRA 4521 NAVEGANTE METROPOLITANO LISBOA' });
  if (dom === 12) out.push({ acct: A, date, amount: -799, desc: 'COMPRA 4521 SPOTIFY P1A2B3' });
  if (dom === 15) out.push({ acct: A, date, amount: -3290, desc: 'DD FITNESS HUT MENSALIDADE' });
  if (dom === 18) out.push({ acct: A, date, amount: -between(r, 1400, 2600), desc: 'DD EPAL AGUAS' });
  if (dom === 20) {
    out.push({ acct: A, date, amount: -20000, desc: 'TRF P/ CONTA POUPANCA 4521' });
    out.push({ acct: 'savings', date, amount: 20000, desc: 'TRF DE CONTA 0012 3456' });
  }
  if (date === salaryDate(month)) out.push({ acct: A, date, amount: 245000, desc: 'TRF SALARIO TECNOLOGIAS EXEMPLO LDA' });
  if (dom === 14 && mNum % 3 === 1) out.push({ acct: A, date, amount: -8950, desc: 'DD FIDELIDADE SEGURO AUTOMOVEL' });
  if (dom === 9 && mNum === +addMonths(monthOf(anchor), -1).slice(5, 7)) out.push({ acct: A, date, amount: -7199, desc: 'COMPRA 4521 PLAYSTATION PLUS 12M' });
  if (dom === 28 && mNum % 3 === 0) out.push({ acct: 'savings', date, amount: between(r, 70, 95), desc: 'JUROS CREDITADOS' });

  // One-off events relative to the connection start date
  if (rel === -60) out.push({ acct: A, date, amount: -4999, desc: 'COMPRA 4521 ZARA CHIADO', card: true });
  if (rel === -54) out.push({ acct: A, date, amount: 4999, desc: 'DEVOLUCAO ZARA CHIADO' });
  if (rel === -33) out.push({ acct: A, date, amount: -12900, desc: 'COMPRA 4521 WORTEN COLOMBO', card: true }, { acct: A, date, amount: -12900, desc: 'COMPRA 4521 WORTEN COLOMBO', card: true });
  if (rel === -30) out.push({ acct: A, date, amount: 12900, desc: 'ESTORNO COMPRA WORTEN COLOMBO' });
  if (rel === -12) out.push({ acct: A, date, amount: -3490, desc: 'COMPRA 4521 AMAZON.ES', card: true });
  if (rel === -5) out.push({ acct: A, date, amount: 3490, desc: 'REEMBOLSO AMAZON EU SARL' });
  if (rel === -6) out.push({ acct: A, date, amount: -180, desc: 'COMPRA 4521 PASTELARIA SAO ROQUE', card: true }, { acct: A, date, amount: -180, desc: 'COMPRA 4521 PASTELARIA SAO ROQUE', card: true });
  if (rel === -4) out.push({ acct: A, date, amount: -15000, desc: 'COMPRA 4521 HOTEL EXEMPLO LISBOA PRE-AUTORIZACAO', card: true, neverPosts: true });
  if (rel === -3) out.push({ acct: A, date, amount: -2340, desc: 'COMPRA 4521 PINGO DOCE AMOREIRAS', card: true, postedAmount: -2385 });

  for (const pool of POOLS) {
    if (r() >= pool.p) continue;
    const [desc, lo, hi] = pool.items[between(r, 0, pool.items.length - 1)];
    const amount = desc.startsWith('MBWAY P/') || pool.card || desc.startsWith('LEV') ? -between(r, lo, hi) : between(r, lo, hi);
    const g: Gen = { acct: A, date, amount, desc, card: pool.card };
    if (pool === POOLS[2] && r() < 0.3) g.postedAmount = amount - between(r, 50, 300); // tip added when it posts
    out.push(g);
  }
  if (r() < 0.03) out.push({ acct: A, date, amount: between(r, 500, 2000), desc: 'MBWAY DE 936***118' });
  return out;
}

function accountsFor(scenario: Scenario): ProviderAccount[] {
  if (scenario === 'main') return [
    { uid: 'demo-current', identityHash: 'demo-id-current', name: 'Conta à Ordem', ibanLast4: '4521', currency: 'EUR', kind: 'current' },
    { uid: 'demo-savings', identityHash: 'demo-id-savings', name: 'Conta Poupança', ibanLast4: '8830', currency: 'EUR', kind: 'savings' },
  ];
  if (scenario === 'card') return [{ uid: 'demo-card', identityHash: 'demo-id-card', name: 'Cartão de Crédito', ibanLast4: '7712', currency: 'EUR', kind: 'card' }];
  return [{ uid: 'demo-flaky', identityHash: 'demo-id-flaky', name: 'Conta Ordenado', ibanLast4: '0391', currency: 'EUR', kind: 'current' }];
}

const ACCT_BY_UID: Record<string, string> = { 'demo-current': 'current', 'demo-savings': 'savings', 'demo-card': 'card', 'demo-flaky': 'flaky' };
const HISTORY_MONTHS = 13;

/** Bank view of one account as of a date: pending items for the last 2 days, posted otherwise. */
export function demoStatement(scenario: Scenario, anchor: string, asOf: string, acct: string): ProviderTx[] {
  const start = `${addMonths(monthOf(anchor), -HISTORY_MONTHS)}-01`;
  const txs: ProviderTx[] = [];
  for (let d = start; d <= asOf; d = addDays(d, 1)) {
    const gens = day(scenario, d, anchor).filter((g) => g.acct === acct);
    gens.forEach((g, i) => {
      const age = daysBetween(d, asOf);
      const isPending = g.card && age < 2;
      if (!isPending && g.neverPosts) return;
      const amount = isPending ? g.amount : (g.postedAmount ?? g.amount);
      txs.push({
        id: isPending || scenario === 'card' ? null : `${scenario}-${acct}-${d}-${i}`, // the card bank supplies no ids
        status: isPending ? 'pending' : 'posted',
        amount: minorToDecimal(amount, 'EUR'), currency: 'EUR',
        bookingDate: isPending || !g.card ? d : addDays(d, 1),
        valueDate: d, description: g.desc, counterparty: g.counterparty ?? null, bankCode: g.desc.startsWith('LEV ATM') ? 'PMNT-CCRD-CWDL' : null, mcc: null,
      });
    });
  }
  return txs;
}

export function demoBalance(scenario: Scenario, anchor: string, asOf: string, acct: string): number {
  const opening: Record<string, number> = { current: 245000, savings: 300000, card: 0, flaky: 80000 };
  let bal = opening[acct] ?? 0;
  for (const t of demoStatement(scenario, anchor, asOf, acct)) bal += parseAmountToMinor(t.amount, t.currency);
  return bal;
}

/** sessionRef format: "demo:<scenario>:<anchor YYYY-MM-DD>". */
export function createDemoProvider(clock: () => string): BankProvider {
  const parse = (ref: string) => {
    const [, scenario, anchor] = ref.split(':') as [string, Scenario, string];
    return { scenario, anchor };
  };
  const PAGE = 50;
  return {
    id: 'demo',
    label: 'Simulated bank (demo)',
    live: false,
    async listInstitutions(country) { return DEMO_INSTITUTIONS.filter((i) => i.country === country.toUpperCase()); },
    async startAuthorization({ institution, state, redirectUrl }) {
      // Simulated consent screen hosted by this app; no real bank is contacted.
      return { url: `/demo-bank?state=${encodeURIComponent(state)}&institution=${encodeURIComponent(institution.name)}&redirect=${encodeURIComponent(redirectUrl)}` };
    },
    async completeAuthorization(code) {
      const m = /^demo-code:(main|card|flaky)$/.exec(code);
      if (!m) throw new ProviderError('invalid', 'BAD_CODE', 'Unknown demo authorization code');
      const scenario = m[1] as Scenario;
      const anchor = clock();
      return { sessionRef: `demo:${scenario}:${anchor}`, consentExpiresAt: new Date(Date.now() + 180 * 86400000).toISOString(), accounts: accountsFor(scenario) };
    },
    async getBalances(ref, uid) {
      const { scenario, anchor } = parse(ref);
      const asOf = clock();
      return [{ amount: minorToDecimal(demoBalance(scenario, anchor, asOf, ACCT_BY_UID[uid]), 'EUR'), currency: 'EUR', type: 'ITAV', label: 'Available (interim)', at: `${asOf}T08:00:00Z` }];
    },
    async getTransactions(ref, uid, { dateFrom, continuationKey }) {
      const { scenario, anchor } = parse(ref);
      const asOf = clock();
      if (scenario === 'flaky' && dateFrom) throw new ProviderError('temporary', 'ASPSP_TIMEOUT', 'The bank did not respond in time (simulated)');
      const all = demoStatement(scenario, anchor, asOf, ACCT_BY_UID[uid]).filter((t) => !dateFrom || t.bookingDate >= dateFrom);
      const offset = continuationKey ? Number(continuationKey) : 0;
      const page = all.slice(offset, offset + PAGE);
      return { transactions: page, continuationKey: offset + PAGE < all.length ? String(offset + PAGE) : null };
    },
    async revoke() { /* nothing to revoke */ },
  };
}

export const DEMO_SCENARIO_FOR: Record<string, Scenario> = { 'Millennium bcp (simulated)': 'main', 'ActivoBank (simulated)': 'flaky' };

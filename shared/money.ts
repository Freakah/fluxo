// Money is always an integer number of minor units (e.g. cents) plus an ISO 4217 currency code.
// Negative = money leaving the account. Never add amounts of different currencies.

const expCache = new Map<string, number>();
export function currencyExponent(currency: string): number {
  let e = expCache.get(currency);
  if (e === undefined) {
    e = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    expCache.set(currency, e);
  }
  return e;
}

/** Thrown for amounts that cannot be stored exactly; the server answers 400 instead of 500. */
export class AmountError extends Error {}

/** Exact decimal string -> minor units. Throws AmountError on malformed input or excess precision. */
export function parseAmountToMinor(value: string, currency: string): number {
  const s = value.trim();
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new AmountError(`Invalid amount: ${JSON.stringify(value)}`);
  const exp = currencyExponent(currency);
  let frac = m[3] ?? '';
  if (frac.length > exp) {
    if (/[^0]/.test(frac.slice(exp))) throw new AmountError(`Amount ${value} has more precision than ${currency} allows`);
    frac = frac.slice(0, exp);
  }
  const big = BigInt(m[2] + frac.padEnd(exp, '0')) * (m[1] === '-' ? -1n : 1n);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < -BigInt(Number.MAX_SAFE_INTEGER)) throw new AmountError('Amount out of range');
  return Number(big);
}

/** Minor units -> exact decimal string, e.g. -1234 EUR -> "-12.34". */
export function minorToDecimal(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new Error('Minor amount must be a safe integer');
  const exp = currencyExponent(currency);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, '0');
  const out = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  return neg ? `-${out}` : out;
}

export function formatMoney(
  minor: number,
  currency: string,
  locale = 'en-PT',
  opts: { signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never' } = {},
): string {
  // Intl accepts decimal strings exactly (no float rounding).
  const nf = new Intl.NumberFormat(locale, { style: 'currency', currency, signDisplay: opts.signDisplay ?? 'auto' });
  return nf.format(minorToDecimal(minor, currency) as unknown as number);
}

export type Totals = Record<string, number>;
export function addTo(totals: Totals, currency: string, minor: number): Totals {
  const next = (totals[currency] ?? 0) + minor;
  if (!Number.isSafeInteger(next)) throw new Error('Total overflow');
  totals[currency] = next;
  return totals;
}

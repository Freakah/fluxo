import { describe, it, expect } from 'vitest';
import { parseAmountToMinor, minorToDecimal, formatMoney, addTo, currencyExponent } from '../shared/money.ts';
import { toCsv, textCell } from '../server/domain/csv.ts';
import { monthBounds, addMonthsToDate, todayIn, addMonths, isDate, daysBetween } from '../shared/dates.ts';

describe('money', () => {
  it('parses exact decimals without floating point error', () => {
    expect(parseAmountToMinor('0.1', 'EUR') + parseAmountToMinor('0.2', 'EUR')).toBe(30);
    expect(parseAmountToMinor('-1234.56', 'EUR')).toBe(-123456);
    expect(parseAmountToMinor('+7', 'EUR')).toBe(700);
    expect(parseAmountToMinor('12.50', 'EUR')).toBe(1250);
    expect(parseAmountToMinor('100', 'JPY')).toBe(100);
    expect(parseAmountToMinor('1.000', 'EUR')).toBe(100);
  });
  it('rejects malformed or over-precise amounts', () => {
    expect(() => parseAmountToMinor('1,50', 'EUR')).toThrow();
    expect(() => parseAmountToMinor('1.005', 'EUR')).toThrow();
    expect(() => parseAmountToMinor('abc', 'EUR')).toThrow();
    expect(() => parseAmountToMinor('1e5', 'EUR')).toThrow();
  });
  it('round-trips minor units to decimal strings', () => {
    for (const v of [0, 1, -1, 99, -100, 123456789, -5]) expect(parseAmountToMinor(minorToDecimal(v, 'EUR'), 'EUR')).toBe(v);
    expect(minorToDecimal(-5, 'EUR')).toBe('-0.05');
    expect(minorToDecimal(1234, 'JPY')).toBe('1234');
  });
  it('formats with locale and keeps currencies apart', () => {
    expect(formatMoney(123456, 'EUR', 'pt-PT')).toMatch(/1\s?234,56\s?€/);
    expect(currencyExponent('EUR')).toBe(2);
    const t = {};
    addTo(t, 'EUR', 100);
    addTo(t, 'USD', 50);
    addTo(t, 'EUR', -30);
    expect(t).toEqual({ EUR: 70, USD: 50 });
  });
});

describe('csv', () => {
  it('starts with a UTF-8 BOM and neutralizes formula-like text', () => {
    expect(toCsv(['a'], [[textCell('@SUM(A1)')]]).charCodeAt(0)).toBe(0xfeff);
    for (const bad of ['=1+1', '+351', '-2', '@x', '\tcmd']) expect(textCell(bad).replace(/^"/, '')).toMatch(/^'/);
    expect(textCell('Café, "Ç"')).toBe('"Café, ""Ç"""');
  });
});

describe('dates', () => {
  it('computes month bounds including leap years', () => {
    expect(monthBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29', days: 29 });
    expect(monthBounds('2026-12').to).toBe('2026-12-31');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('clamps month arithmetic to month end', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2026-03-31', 12)).toBe('2027-03-31');
  });
  it('resolves "today" in the user timezone (Lisbon month boundary)', () => {
    // 23:30 UTC on 31 March 2026 is already 1 April in Lisbon (summer time, UTC+1).
    expect(todayIn('Europe/Lisbon', new Date('2026-03-31T23:30:00Z'))).toBe('2026-04-01');
    expect(todayIn('UTC', new Date('2026-03-31T23:30:00Z'))).toBe('2026-03-31');
    expect(todayIn('Europe/Lisbon', new Date('2026-01-31T23:30:00Z'))).toBe('2026-01-31');
  });
  it('validates dates and counts days across DST', () => {
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-02-28')).toBe(true);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });
});

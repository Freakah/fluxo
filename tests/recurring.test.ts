import { describe, it, expect } from 'vitest';
import { detectPattern, monthlyEquivalent, type Occ } from '../server/domain/recurring.ts';
import { addDays, addMonthsToDate } from '../shared/dates.ts';

const series = (start: string, n: number, step: (d: string) => string, amount: (i: number) => number): Occ[] => {
  const out: Occ[] = [];
  let d = start;
  for (let i = 0; i < n; i++) { out.push({ date: d, amount: amount(i) }); d = step(d); }
  return out;
};

describe('recurring detection', () => {
  it('detects fixed monthly subscriptions with high confidence and estimates the next date', () => {
    const r = detectPattern(series('2026-01-03', 10, (d) => addMonthsToDate(d, 1), () => 1399), '2026-10-22')!;
    expect(r).toMatchObject({ frequency: 'monthly', typical: 1399, confidence: 'high', variable: false, nextDate: '2026-11-03' });
  });
  it('detects weekly, quarterly and annual patterns', () => {
    expect(detectPattern(series('2026-08-03', 10, (d) => addDays(d, 7), () => 500), '2026-10-08')!.frequency).toBe('weekly');
    expect(detectPattern(series('2025-10-14', 5, (d) => addMonthsToDate(d, 3), () => 8950), '2026-10-22')!.frequency).toBe('quarterly');
    expect(detectPattern(series('2025-09-09', 2, (d) => addMonthsToDate(d, 12), () => 7199), '2026-10-22')).toMatchObject({ frequency: 'annual', nextDate: '2027-09-09' });
  });
  it('marks variable bills as variable and not high confidence', () => {
    const amounts = [3800, 7200, 5100, 4400, 6600, 3900, 7000, 5000, 4100];
    const r = detectPattern(series('2026-01-08', 9, (d) => addMonthsToDate(d, 1), (i) => amounts[i]), '2026-10-01')!;
    expect(r.variable).toBe(true);
    expect(r.confidence).not.toBe('high');
  });
  it('ignores irregular repeated purchases', () => {
    let d = '2026-06-01';
    const occ: Occ[] = [2, 9, 1, 15, 4, 30, 3].map((g) => { d = addDays(d, g); return { date: d, amount: 2000 }; });
    expect(detectPattern(occ, '2026-08-20')).toBeNull();
  });
  it('drops patterns that stopped long ago', () => {
    expect(detectPattern(series('2025-01-05', 5, (d) => addMonthsToDate(d, 1), () => 999), '2026-10-22')).toBeNull();
  });
  it('computes monthly equivalents', () => {
    expect(monthlyEquivalent(1200, 'annual')).toBe(100);
    expect(monthlyEquivalent(900, 'quarterly')).toBe(300);
    expect(monthlyEquivalent(1000, 'weekly')).toBe(4333);
  });
});

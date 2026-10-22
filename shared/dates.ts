// Calendar dates are 'YYYY-MM-DD' strings, months are 'YYYY-MM'. Arithmetic is done in UTC
// so no local-timezone shifts sneak in; "today" is resolved in the user's configured timezone.

export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const monthOf = (date: string) => date.slice(0, 7);
export const addDays = (date: string, n: number) => fromUtc(toUtc(date) + n * 86400000);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86400000);

export function addMonths(month: string, n: number): string {
  const total = +month.slice(0, 4) * 12 + (+month.slice(5, 7) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthBounds(month: string): { from: string; to: string; days: number } {
  const from = `${month}-01`;
  const to = addDays(`${addMonths(month, 1)}-01`, -1);
  return { from, to, days: +to.slice(8, 10) };
}

/** Same day-of-month n months later, clamped to month end (Jan 31 + 1 month = Feb 28/29). */
export function addMonthsToDate(date: string, n: number): string {
  const m = addMonths(monthOf(date), n);
  return `${m}-${String(Math.min(+date.slice(8, 10), monthBounds(m).days)).padStart(2, '0')}`;
}

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

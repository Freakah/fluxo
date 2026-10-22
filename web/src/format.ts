import { formatMoney } from '../../shared/money.ts';
import type { Settings } from '../../shared/settings.ts';

export function makeFormat(s: Settings) {
  const dateFmt = new Intl.DateTimeFormat(s.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const shortDate = new Intl.DateTimeFormat(s.locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const monthFmt = new Intl.DateTimeFormat(s.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthShort = new Intl.DateTimeFormat(s.locale, { month: 'short', timeZone: 'UTC' });
  const dtFmt = new Intl.DateTimeFormat(s.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: s.timezone });
  const asUtc = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return {
    hidden: s.hideAmounts,
    money: (minor: number | null | undefined, currency = s.currency, sign: 'auto' | 'always' | 'exceptZero' = 'auto') =>
      minor === null || minor === undefined ? '—' : s.hideAmounts ? '•••••' : formatMoney(minor, currency, s.locale, { signDisplay: sign }),
    date: (d: string | null | undefined) => (d ? dateFmt.format(asUtc(d)) : '—'),
    shortDate: (d: string) => shortDate.format(asUtc(d)),
    month: (m: string) => monthFmt.format(asUtc(`${m}-01`)),
    monthShort: (m: string) => monthShort.format(asUtc(`${m}-01`)),
    dateTime: (iso: string | null | undefined) => (iso ? dtFmt.format(new Date(iso)) : 'never'),
    ago: (iso: string | null | undefined) => {
      if (!iso) return 'never';
      const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins} min ago`;
      if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
      return `${Math.round(mins / 1440)} days ago`;
    },
  };
}
export type Format = ReturnType<typeof makeFormat>;

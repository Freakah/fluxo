import { formatMoney } from '../../shared/money.ts';
import type { Settings } from '../../shared/settings.ts';
import { t, type Lang } from './i18n.ts';

export function makeFormat(s: Settings, lang: Lang = 'en') {
  // Portuguese text always uses Portuguese dates and numbers; the format setting picks among English styles.
  const locale = lang === 'pt' ? 'pt-PT' : s.locale === 'pt-PT' ? 'en-PT' : s.locale;
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: lang === 'pt' ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
  const shortDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: lang === 'pt' ? 'long' : 'short', timeZone: 'UTC' });
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthShort = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const dtFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: s.timezone });
  const asUtc = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return {
    locale,
    hidden: s.hideAmounts,
    currencySymbol: (currency = s.currency) => new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency,
    money: (minor: number | null | undefined, currency = s.currency, sign: 'auto' | 'always' | 'exceptZero' = 'auto') =>
      minor === null || minor === undefined ? '—' : s.hideAmounts ? '•••••' : formatMoney(minor, currency, locale, { signDisplay: sign }),
    /** Short label for chart axes, e.g. €1.6K. */
    compact: (minor: number, currency = s.currency) => s.hideAmounts ? '•••' : new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100),
    date: (d: string | null | undefined) => (d ? dateFmt.format(asUtc(d)) : '—'),
    shortDate: (d: string) => shortDate.format(asUtc(d)),
    month: (m: string) => monthFmt.format(asUtc(`${m}-01`)),
    monthShort: (m: string) => monthShort.format(asUtc(`${m}-01`)),
    dateTime: (iso: string | null | undefined) => (iso ? dtFmt.format(new Date(iso)) : t('never')),
    ago: (iso: string | null | undefined) => {
      if (!iso) return t('never');
      const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
      if (mins < 1) return t('just now');
      if (mins < 60) return t('{n} min ago', { n: mins });
      if (mins < 48 * 60) return t('{n} h ago', { n: Math.round(mins / 60) });
      return t('{n} days ago', { n: Math.round(mins / 1440) });
    },
  };
}
export type Format = ReturnType<typeof makeFormat>;

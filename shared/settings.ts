// Non-sensitive per-user preferences (stored server-side in users.settings_json).
export type Settings = {
  locale: string;
  currency: string;
  timezone: string;
  theme: 'system' | 'light' | 'dark';
  hideAmounts: boolean;
  budgetThresholds: number[];
  notify: { budget: boolean; sync: boolean; consent: boolean; recurring: boolean };
  onboarded: boolean; // first-run welcome seen
  recapSeen: string | null; // last month whose recap was opened or dismissed (YYYY-MM)
  textSize: 'normal' | 'large' | 'xlarge';
};

export const DEFAULT_SETTINGS: Settings = {
  locale: 'en-PT',
  currency: 'EUR',
  timezone: 'Europe/Lisbon',
  theme: 'system',
  hideAmounts: false,
  budgetThresholds: [80, 100],
  notify: { budget: true, sync: true, consent: true, recurring: true },
  onboarded: false,
  recapSeen: null,
  textSize: 'normal',
};

export function mergeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...r, notify: { ...DEFAULT_SETTINGS.notify, ...(r.notify ?? {}) } };
}

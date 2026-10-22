// In-app notifications. Deduplicated by (user, dedupe_key) so repeated syncs never repeat an alert.
// Texts avoid sensitive detail: no amounts, no account numbers, no descriptions.
import { all, get, run, nowIso, type DB } from '../db/db.ts';
import { mergeSettings, type Settings } from '../../shared/settings.ts';
import { budgetStatus } from './budgets.ts';
import { todayIn, monthOf } from '../../shared/dates.ts';

export function userSettings(db: DB, userId: number): Settings {
  const u = get<{ settings_json: string }>(db, 'SELECT settings_json FROM users WHERE id = ?', userId);
  return mergeSettings(u ? JSON.parse(u.settings_json) : {});
}

type Kind = 'budget' | 'sync' | 'consent' | 'recurring';
export function notify(db: DB, userId: number, n: { kind: Kind; key: string; title: string; body: string; link: string; severity?: 'info' | 'warning' }): boolean {
  if (!userSettings(db, userId).notify[n.kind]) return false;
  return run(db, 'INSERT OR IGNORE INTO notifications (user_id, kind, dedupe_key, title, body, link, severity, created_at) VALUES (?,?,?,?,?,?,?,?)',
    userId, n.kind, n.key, n.title.slice(0, 120), n.body.slice(0, 300), n.link, n.severity ?? 'info', nowIso()).changes === 1;
}

export function checkBudgetAlerts(db: DB, userId: number, now = new Date()) {
  const s = userSettings(db, userId);
  const month = monthOf(todayIn(s.timezone, now));
  const st = budgetStatus(db, userId, month, s.currency, s.budgetThresholds);
  const names = new Map(all<{ id: number; name: string }>(db, 'SELECT id, name FROM categories WHERE user_id = ?', userId).map((c) => [c.id, c.name]));
  const lines = [...(st.total ? [st.total] : []), ...st.categories];
  for (const l of lines) {
    for (const th of [...s.budgetThresholds].sort((a, b) => b - a)) {
      if (l.amount <= 0 || l.pct < th) continue;
      const label = l.categoryId === null ? 'Monthly budget' : `${names.get(l.categoryId) ?? 'Category'} budget`;
      notify(db, userId, {
        kind: 'budget', key: `budget:${l.categoryId ?? 'total'}:${month}:${th}`, severity: th >= 100 ? 'warning' : 'info',
        title: th >= 100 ? `${label} reached` : `${label} at ${th}%`,
        body: th >= 100 ? `You have used all of this month's ${label.toLowerCase()}.` : `You have used ${th}% of this month's ${label.toLowerCase()}.`,
        link: '/budgets',
      });
      break; // only the highest threshold crossed; lower ones are implied
    }
  }
}

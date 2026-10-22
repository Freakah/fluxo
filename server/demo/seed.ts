// Builds a complete demo workspace by running the real sync engine against the simulated bank
// at several points in time, so pending->posted reconciliation, refunds, transfers, a failing
// connection and an expired consent all arise naturally.
import { randomBytes } from 'node:crypto';
import { get, run, nowIso, type DB } from '../db/db.ts';
import { addDays, addMonths, monthOf, todayIn } from '../../shared/dates.ts';
import { createUser, deleteUser } from '../domain/lifecycle.ts';
import { createDemoProvider } from '../providers/demo.ts';
import { syncConnection, upsertAccounts, sealSession } from '../sync/engine.ts';
import { setBudget } from '../domain/budgets.ts';
import { categoryResolver, reclassify } from '../domain/reclassify.ts';
import { checkBudgetAlerts } from '../domain/notifications.ts';
import { hashPassword } from '../security/password.ts';
import { DEFAULT_SETTINGS } from '../../shared/settings.ts';

const TZ = DEFAULT_SETTINGS.timezone;
const at = (date: string) => new Date(`${date}T09:00:00Z`);

export async function createDemoUser(db: DB, key: Buffer, now = new Date()): Promise<number> {
  const today = todayIn(TZ, now);
  const userId = createUser(db, `demo-${randomBytes(6).toString('hex')}@demo.invalid`, await hashPassword(randomBytes(24).toString('hex')), true);
  await seedDemoData(db, key, userId, today);
  return userId;
}

export async function seedDemoData(db: DB, key: Buffer, userId: number, today: string) {
  let asOf = today;
  const provider = createDemoProvider(() => asOf);
  const ctxAt = (date: string) => ({ db, providers: { demo: provider }, key, intervalHours: 6, now: () => at(date) });

  const mk = (institution: string, scenario: string, consentDays: number) => {
    const ref = `demo:${scenario}:${today}`;
    const id = run(db, `INSERT INTO connections (user_id, provider, institution_name, institution_country, status, provider_session_enc, consent_expires_at, created_at)
      VALUES (?, 'demo', ?, 'PT', 'active', ?, ?, ?)`, userId, institution, sealSession(key, ref), new Date(at(today).getTime() + consentDays * 86400000).toISOString(), nowIso()).id;
    return id;
  };
  const main = mk('Millennium bcp (simulated)', 'main', 150);
  upsertAccounts(db, userId, main, [
    { uid: 'demo-current', identityHash: 'demo-id-current', name: 'Conta à Ordem', ibanLast4: '4521', currency: 'EUR', kind: 'current' },
    { uid: 'demo-savings', identityHash: 'demo-id-savings', name: 'Conta Poupança', ibanLast4: '8830', currency: 'EUR', kind: 'savings' },
  ]);
  const card = mk('Millennium bcp credit card (simulated)', 'card', -10);
  upsertAccounts(db, userId, card, [{ uid: 'demo-card', identityHash: 'demo-id-card', name: 'Cartão de Crédito', ibanLast4: '7712', currency: 'EUR', kind: 'card' }]);
  const flaky = mk('ActivoBank (simulated)', 'flaky', 120);
  upsertAccounts(db, userId, flaky, [{ uid: 'demo-flaky', identityHash: 'demo-id-flaky', name: 'Conta Ordenado', ibanLast4: '0391', currency: 'EUR', kind: 'current' }]);

  // Card: imported while consent was valid, which then lapsed 10 days ago.
  run(db, 'UPDATE connections SET consent_expires_at = ? WHERE id = ?', at(addDays(today, 30)).toISOString(), card);
  asOf = addDays(today, -12);
  await syncConnection(ctxAt(asOf), card, { trigger: 'initial' });
  run(db, 'UPDATE connections SET consent_expires_at = ? WHERE id = ?', at(addDays(today, -10)).toISOString(), card);

  // Main bank: three syncs over five days (pending items post, one pre-authorisation disappears).
  for (const d of [-5, -3, 0]) {
    asOf = addDays(today, d);
    await syncConnection(ctxAt(asOf), main, { trigger: 'initial' });
  }
  // Flaky bank: first sync works, later ones time out (shows backoff and the problem banner).
  asOf = addDays(today, -3);
  await syncConnection(ctxAt(asOf), flaky, { trigger: 'initial' });
  asOf = today;
  await syncConnection(ctxAt(today), flaky, { trigger: 'scheduled' });
  await syncConnection(ctxAt(today), card, { trigger: 'scheduled' }); // detects the expired consent

  // Budgets from three months ago (restaurants deliberately tight so it shows as overspent).
  const cat = categoryResolver(db, userId);
  const from = addMonths(monthOf(today), -3);
  setBudget(db, userId, null, 'EUR', 180000, from);
  for (const [k, v] of [['groceries', 45000], ['restaurants', 9000], ['entertainment', 6000], ['shopping', 15000], ['subscriptions', 3000]] as const) setBudget(db, userId, cat(k), 'EUR', v, from);

  // A remembered rule and a personal correction, as a returning user would have.
  run(db, "INSERT INTO rules (user_id, priority, enabled, field, match_type, pattern, direction, category_id, created_at) VALUES (?, 100, 1, 'description', 'contains', 'LOJA DO BAIRRO', 'out', ?, ?)", userId, cat('groceries'), nowIso());
  reclassify(db, userId);
  const sumup = get<{ id: number }>(db, "SELECT id FROM transactions WHERE user_id = ? AND description LIKE '%TASCA DO ZE%' ORDER BY booking_date DESC LIMIT 1", userId);
  if (sumup) run(db, "UPDATE transactions SET category_override_id = ?, note = 'Lunch with the team' WHERE id = ?", cat('restaurants'), sumup.id);
  run(db, "UPDATE recurring SET status = 'confirmed' WHERE user_id = ? AND merchant IN ('Netflix', 'Spotify', 'MEO')", userId);
  checkBudgetAlerts(db, userId, at(today));
}

export async function resetDemoUser(db: DB, key: Buffer, userId: number): Promise<number> {
  deleteUser(db, userId);
  return createDemoUser(db, key);
}

/** Removes demo workspaces older than maxAgeHours (hosted demos create one per visitor). */
export function purgeOldDemoUsers(db: DB, maxAgeHours = 24): number {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const rows = db.prepare('SELECT id FROM users WHERE is_demo = 1 AND created_at < ?').all(cutoff) as { id: number }[];
  for (const r of rows) deleteUser(db, r.id);
  return rows.length;
}

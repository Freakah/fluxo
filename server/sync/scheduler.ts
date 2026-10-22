// In-process background scheduler. Requires the server process to be running; for setups where it
// is not always running, call `npm run sync` from cron/systemd timers instead (same engine, same limits).
import { dueConnections, recoverInterrupted, syncConnection, type SyncCtx } from './engine.ts';
import { purgeExpiredSessions } from '../security/sessions.ts';
import { purgeOldDemoUsers } from '../demo/seed.ts';
import { run } from '../db/db.ts';
import { log } from '../log.ts';

export async function runDueSyncs(ctx: SyncCtx): Promise<number> {
  let n = 0;
  for (const id of dueConnections(ctx.db, new Date())) {
    try {
      const r = await syncConnection(ctx, id, { trigger: 'scheduled' });
      log.info('scheduled sync', { connectionId: id, status: r.status, inserted: r.inserted, updated: r.updated });
      n++;
    } catch (e) {
      log.error('scheduled sync crashed', { connectionId: id, err: e instanceof Error ? e.message : 'unknown' });
    }
  }
  return n;
}

export function startScheduler(ctx: SyncCtx, opts: { demo: boolean }) {
  const interrupted = recoverInterrupted(ctx.db);
  if (interrupted) log.warn('marked interrupted sync runs', { count: interrupted });
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      purgeExpiredSessions(ctx.db);
      run(ctx.db, 'DELETE FROM auth_states WHERE expires_at < ?', new Date(Date.now() - 86400000).toISOString());
      if (opts.demo) purgeOldDemoUsers(ctx.db);
      await runDueSyncs(ctx);
    } finally { busy = false; }
  };
  const timer = setInterval(tick, 5 * 60_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

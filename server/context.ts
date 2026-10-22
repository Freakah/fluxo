import type { Context } from 'hono';
import type { DB } from './db/db.ts';
import type { Config } from './config.ts';
import type { BankProvider } from './providers/types.ts';
import type { SessionUser } from './security/sessions.ts';
import type { SyncCtx } from './sync/engine.ts';

export type Deps = { db: DB; config: Config; providers: Record<string, BankProvider>; syncCtx: SyncCtx; version: string };
export type Env = { Variables: { user: SessionUser } };

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const uid = (c: Context<Env>) => c.get('user').userId;

/** Parses JSON body with a zod schema; 400 with a readable message on failure. */
export async function body<T>(c: Context, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }): Promise<T> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new HttpError(400, 'Request body must be valid JSON.'); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xf = c.req.header('x-forwarded-for');
    if (xf) return xf.split(',')[0].trim();
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? '127.0.0.1';
}

import { z } from 'zod';
import { createHash } from 'node:crypto';
import path from 'node:path';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_MODE: z.enum(['demo', 'live']).default('demo'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  DATA_DIR: z.string().default('./data'),
  DATA_ENCRYPTION_KEY: z.string().optional(),
  ALLOW_REGISTRATION: bool.default(false),
  TRUST_PROXY: bool.default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  SYNC_INTERVAL_HOURS: z.coerce.number().min(6).max(168).default(6),
  SCHEDULER_ENABLED: bool.default(true),
  ENABLE_BANKING_APP_ID: z.string().optional(),
  ENABLE_BANKING_KEY_PATH: z.string().optional(),
  ENABLE_BANKING_API_URL: z.url().default('https://api.enablebanking.com'),
  ENABLE_BANKING_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  // https page registered with the provider that forwards to <PUBLIC_URL>/api/connections/callback (providers reject http://localhost).
  BANK_REDIRECT_URL: z.url().refine((u) => u.startsWith('https://'), 'must use https://').optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Demo workspaces one address may start per hour (demo mode only).
  DEMO_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(20),
});

export type Config = z.infer<typeof schema> & { encryptionKey: Buffer; dbPath: string; enableBankingConfigured: boolean };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const c = parsed.data;
  let encryptionKey: Buffer;
  if (c.DATA_ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(c.DATA_ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded (run `npm run gen-key`).');
  } else if (c.APP_MODE === 'live' || c.NODE_ENV === 'production') {
    throw new Error('DATA_ENCRYPTION_KEY is required in live mode and in production (run `npm run gen-key`).');
  } else {
    // Demo/dev only: nothing secret is stored (simulated sessions), so a fixed public key is acceptable
    // and keeps demo data usable across restarts. Live mode always requires a real key.
    encryptionKey = createHash('sha256').update('fluxo-demo-mode-not-secret').digest();
  }
  if (c.NODE_ENV === 'production' && !c.PUBLIC_URL.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(c.PUBLIC_URL)) {
    throw new Error('PUBLIC_URL must use https:// in production (localhost is allowed for local-only use).');
  }
  const enableBankingConfigured = Boolean(c.ENABLE_BANKING_APP_ID && c.ENABLE_BANKING_KEY_PATH);
  const dbPath = c.DATA_DIR === ':memory:' ? ':memory:' : path.resolve(c.DATA_DIR, `fluxo-${c.APP_MODE}.sqlite`);
  return { ...c, encryptionKey, dbPath, enableBankingConfigured };
}

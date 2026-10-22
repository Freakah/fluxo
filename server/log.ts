// Minimal structured logger. Never pass amounts, descriptions, tokens or account identifiers here.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const min = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;
const SECRETISH = /(token|secret|password|authorization|cookie|session_enc|code|iban)/i;

function clean(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  return Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, SECRETISH.test(k) ? '[redacted]' : v]));
}
function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < min || process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...clean(meta) });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}
export const log = {
  debug: (m: string, x?: Record<string, unknown>) => write('debug', m, x),
  info: (m: string, x?: Record<string, unknown>) => write('info', m, x),
  warn: (m: string, x?: Record<string, unknown>) => write('warn', m, x),
  error: (m: string, x?: Record<string, unknown>) => write('error', m, x),
};

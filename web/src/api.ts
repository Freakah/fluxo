// Thin JSON client. All financial data stays in memory only (never localStorage).
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from './i18n.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
    });
  } catch {
    throw new ApiError(0, t(navigator.onLine ? 'Could not reach the Fluxo server. Is it running?' : 'You are offline. Changes were not saved; reconnect and try again.'));
  }
  const json = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
  if (res.status === 401) window.dispatchEvent(new Event('fluxo:unauthorized'));
  if (!res.ok) throw new ApiError(res.status, t((json as { error?: string } | null)?.error ?? 'Request failed ({status}).', { status: res.status }));
  return json as T;
}

/** Loads data for a path; `path = null` skips. Stale responses from earlier paths are ignored. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: !!path });
  const seq = useRef(0);
  const load = useCallback(async (silent = false) => {
    if (!path) return;
    const n = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await api<T>(path);
      if (n === seq.current) setState({ data, loading: false });
    } catch (e) {
      if (n === seq.current) setState((s) => ({ ...s, error: e as ApiError, loading: false }));
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

/** Wraps an async action with a busy flag so buttons can't double-submit. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try { return await fn(); } finally { running.current = false; setBusy(false); }
  }, []);
  return { busy, run };
}

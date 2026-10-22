import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { api, useApi } from './api.ts';
import type { Category } from './types.ts';
import { makeFormat, type Format } from './format.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings.ts';

export type Session = {
  mode: 'demo' | 'live'; version: string; registrationOpen: boolean; mfaPending?: boolean;
  provider: { id: string; label: string; live: boolean } | null;
  user: null | { email: string; isDemo: boolean; totpEnabled: boolean; createdAt: string; settings: Settings };
};

type Ctx = { session: Session | null; refresh: () => Promise<void>; settings: Settings; fmt: Format; updateSettings: (p: Partial<Settings>) => Promise<void> };
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const refresh = useCallback(async () => { setSession(await api<Session>('/session')); }, []);
  useEffect(() => {
    refresh().catch(() => setSession({ mode: 'live', version: '', registrationOpen: false, provider: null, user: null }));
    const onUnauth = () => { void refresh().catch(() => undefined); };
    window.addEventListener('fluxo:unauthorized', onUnauth);
    return () => window.removeEventListener('fluxo:unauthorized', onUnauth);
  }, [refresh]);
  const settings = session?.user?.settings ?? DEFAULT_SETTINGS;
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  useEffect(() => { document.documentElement.dataset.textSize = settings.textSize; }, [settings.textSize]);
  const updateSettings = useCallback(async (p: Partial<Settings>) => {
    const next = await api<Settings>('/me/settings', { method: 'PUT', body: p });
    setSession((s) => (s && s.user ? { ...s, user: { ...s.user, settings: next } } : s));
  }, []);
  const fmt = useMemo(() => makeFormat(settings), [settings]);
  return <SessionCtx.Provider value={{ session, refresh, settings, fmt, updateSettings }}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}

// ---- Categories (shared so every row can show its category icon without refetching)
type CatsCtx = { list: Category[]; byId: Map<number, Category>; reload: () => Promise<void> };
const CategoriesCtx = createContext<CatsCtx>({ list: [], byId: new Map(), reload: async () => undefined });

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const c = useApi<Category[]>('/categories');
  const value = useMemo(() => ({ list: c.data ?? [], byId: new Map((c.data ?? []).map((x) => [x.id, x])), reload: () => c.reload(true) }), [c]);
  return <CategoriesCtx.Provider value={value}>{children}</CategoriesCtx.Provider>;
}
export const useCategories = () => useContext(CategoriesCtx);

// ---- Toasts (announced to screen readers via a polite live region)
type Toast = { id: number; text: string; kind: 'ok' | 'error'; action?: { label: string; run: () => void } };
const ToastCtx = createContext<{ show: (text: string, opts?: { kind?: 'ok' | 'error'; action?: Toast['action'] }) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((text: string, opts: { kind?: 'ok' | 'error'; action?: Toast['action'] } = {}) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-3), { id, text, kind: opts.kind ?? 'ok', action: opts.action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.action ? 9000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'error' ? <TriangleAlert size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />} <span>{t.text}</span>
            {t.action && <button className="link" onClick={() => { t.action!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('ToastProvider missing');
  return c.show;
}

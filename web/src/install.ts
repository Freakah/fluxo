// "Install as an app": registers the service worker and keeps the browser's install prompt for the Settings button.
import { useEffect, useState } from 'react';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as PromptEvent; changed(); });
addEventListener('appinstalled', () => { deferred = null; changed(); });
// Service workers need a secure context (https or localhost); elsewhere Fluxo simply stays a web page.
if ('serviceWorker' in navigator && isSecureContext) addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const state: 'installed' | 'ready' | 'manual' = standalone() ? 'installed' : deferred ? 'ready' : 'manual';
  const install = async () => { if (!deferred) return; await deferred.prompt(); await deferred.userChoice; deferred = null; changed(); };
  return { state, install };
}

/* global self, caches, URL, location, fetch, Response */
// Fluxo service worker. It caches only the app's own static files (code, fonts, icons) so the window opens
// quickly. It never caches /api responses: financial data is always fetched fresh and never stored offline.
const CACHE = 'fluxo-static-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Hashed build files never change: cache first. Everything else (the page itself): network first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) ?? fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fluxo</title><body style="font-family:system-ui;padding:2rem"><h1>Fluxo is not reachable</h1><p>Make sure the computer running Fluxo is on and connected, then try again.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
  }
});

'use strict';
// App-shell cache only. API responses (balances, payments) are never cached, so no financial data is stored on disk by the worker.
const CACHE = 'armapay-shell-v6';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/vendor/qrcode.js', '/vendor/jsqr.js', '/manifest.webmanifest',
  '/img/armapay-logo.webp', '/img/armapay-logo-360.webp', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
  '/fonts/bricolage-grotesque-latin-wght-normal.woff2', '/fonts/figtree-latin-400-normal.woff2',
  '/fonts/figtree-latin-600-normal.woff2', '/fonts/figtree-latin-700-normal.woff2',
  '/fonts/ibm-plex-mono-latin-400-normal.woff2', '/fonts/ibm-plex-mono-latin-500-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Page loads: network first so a new release shows up, cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // Static files: serve from cache, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

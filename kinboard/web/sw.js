// Offline shell for the home-screen app. Bump VERSION whenever app files change.
const VERSION = 'kinboard-v1';
const SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'fonts/fonts.css',
  'fonts/Figtree-7073ac.woff2', 'fonts/YoungSerif-e51b6d.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('kinboard-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // never cache sync traffic
  if (url.pathname.includes('/groundswell/')) return; // Groundswell has its own service worker
  // Network first so updates arrive quickly; fall back to the cached copy when offline.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

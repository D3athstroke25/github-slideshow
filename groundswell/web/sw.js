// Offline shell for the Home Screen app. The deploy workflow stamps VERSION with the commit.
const VERSION = 'groundswell-v1';
const SHELL = ['./', 'index.html', 'app.js', 'app.css', 'config.js', 'manifest.webmanifest', 'fonts/fonts.css',
  'fonts/BricolageGrotesque-latin.woff2', 'fonts/Figtree-latin.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('groundswell-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API and images go straight to the network
  // Network first so updates arrive quickly; fall back to the cached copy when offline.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

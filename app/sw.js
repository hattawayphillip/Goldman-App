/* Goldman Equipment — service worker: installable + works with no signal.
   Shell: cache-first, refreshed in background. data.json: network-first. */
const CACHE = 'goldman-v6';
const SHELL = ['./','./index.html','./office.html','./manifest.json','./logo.png','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('data.json')) {
    e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); return res; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then(cached => {
    const fresh = fetch(req).then(res => { if (res && res.status === 200) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }).catch(() => cached);
    return cached || fresh;
  }));
});

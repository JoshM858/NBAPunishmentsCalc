// Minimal service worker so the site installs as an app and opens instantly. It keeps a copy of the page files only:
// live data (/api/ and the snapshot) always comes from the network, so numbers are never stale. Offline you get the
// app shell and a plain "can't reach the server" message from the page itself.
const CACHE = 'np-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'css/tokens.css', 'icons/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.includes('/data/')) return; // network only
  // Page files: show the saved copy straight away and refresh it in the background
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    }),
  );
});

/* Offline support for the food log. Bump CACHE when a file under vendor/ or cnf.js changes.
   The app's own files are fetched fresh when there is a connection, so a push goes live by itself. */
const CACHE = 'foodlog-v1';
const HEAVY = /\/(vendor\/|cnf\.js|icon-)/;
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'logic.js', 'cnf.js', 'manifest.json', 'icon-192.png']))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const put = res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; };
  if (HEAVY.test(e.request.url)) e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(put)));
  else e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

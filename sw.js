// オフラインでも開けるようにする。町のデータ（data/*.json）は毎日変わるので、まずネットから取り、つながらない時だけ前のを使う。
const CACHE = 'town-v5';
const CORE = ['./', './index.html', './people.html', './villager.html', './vote.html', './history.html',
  './css/style.css', './js/common.js', './js/town.js', './js/character.js', './js/villager.js', './manifest.webmanifest', './icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fresh = url.origin === location.origin && (url.pathname.includes('/data/') || req.mode === 'navigate' || /\.(js|css|html)$/.test(url.pathname));
  if (fresh) {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return r;
    })));
  }
});

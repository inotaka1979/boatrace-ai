// BoatRace Oracle - Service Worker
const CACHE_NAME = 'br-oracle-v1';
const API_CACHE = 'br-api-v1';
const API_BASE = 'https://boatraceopenapi.github.io';

// 静的アセット
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// インストール: 静的アセットをキャッシュ
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// アクティベート: 古いキャッシュを削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== API_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ: APIレスポンスをキャッシュ
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API リクエスト
  if (url.startsWith(API_BASE)) {
    const maxAge = url.includes('/results/') ? 86400000 : 3600000; // results: 24h, others: 1h
    e.respondWith(
      caches.open(API_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) {
          const cachedTime = cached.headers.get('x-cached-time');
          if (cachedTime && Date.now() - parseInt(cachedTime) < maxAge) {
            return cached;
          }
        }
        try {
          const resp = await fetch(e.request);
          if (resp.ok) {
            const cloned = resp.clone();
            const headers = new Headers(cloned.headers);
            headers.set('x-cached-time', Date.now().toString());
            const body = await cloned.blob();
            const cachedResp = new Response(body, { status: cloned.status, statusText: cloned.statusText, headers });
            cache.put(e.request, cachedResp);
          }
          return resp;
        } catch {
          return cached || new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
      })
    );
    return;
  }

  // 静的アセット: Cache First
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

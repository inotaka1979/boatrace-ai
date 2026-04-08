// BoatRace Oracle - Service Worker v4
const CACHE_NAME = 'br-oracle-v4';
const API_CACHE = 'br-api-v4';

// キャッシュする静的アセット（index.htmlは含めない）
const STATIC_ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// インストール: 静的アセットのみキャッシュ
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// アクティベート: 古いキ���ッシュを全て削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== API_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // data/ ディレクトリ: キャッシュしない（常に最新取得）
  if (url.includes('/data/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match(e.request).then(c =>
          c || new Response('{}', {status: 200, headers: {'Content-Type': 'application/json'}})
        )
      )
    );
    return;
  }

  // Open API: Network First（まずネットワーク、失敗時のみキャッシュ）
  if (url.includes('boatraceopenapi.github.io')) {
    e.respondWith(
      caches.open(API_CACHE).then(async cache => {
        try {
          const resp = await fetch(e.request);
          if (resp.ok) {
            cache.put(e.request, resp.clone());
          }
          return resp;
        } catch {
          const cached = await cache.match(e.request);
          return cached || new Response('{"error":"offline"}', {
            status: 503,
            headers: {'Content-Type': 'application/json'}
          });
        }
      })
    );
    return;
  }

  // 静的アセット: Cache First
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request))
  );
});

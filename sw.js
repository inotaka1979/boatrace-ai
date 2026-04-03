// BoatRace Oracle - Service Worker v3
const CACHE_NAME = 'br-oracle-v3';
const API_BASE = 'https://boatraceopenapi.github.io';

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

// アクティベート: 古いキャッシュを全て削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ: index.html と data/ はネットワーク優先、それ以外はキャッシュ優先
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // index.html は常にネットワークから取得（キャッシュしない）
  if (url.endsWith('/') || url.endsWith('/index.html') || url.includes('index.html')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // data/ ディレクトリは常にネットワークから取得（オッズ等の最新データ）
  if (url.includes('/data/')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // Open API は10分キャッシュ（ネットワーク優先）
  if (url.startsWith(API_BASE)) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 静的アセット（アイコン、manifest等）: キャッシュ優先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

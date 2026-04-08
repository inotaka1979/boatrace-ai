// BoatRace Oracle - Service Worker v4
const CACHE_NAME = 'br-oracle-v4';
const API_CACHE = 'br-api-v4';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// インストール: 静的アセットをキャッシュ + 即座にアクティブ化
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(STATIC_ASSETS); })
      .then(function() { return self.skipWaiting(); })
  );
});

// アクティベート: 古いキャッシュを全削除 + 即座にクライアント制御
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) {
          return k !== CACHE_NAME && k !== API_CACHE;
        }).map(function(k) {
          console.log('Deleting old cache:', k);
          return caches.delete(k);
        })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // data/ ディレクトリ: キャッシュしない（常にネットワーク）
  if (url.indexOf('/data/') !== -1) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Open API: Network First（常にネットワークを先に試す）
  if (url.indexOf('boatraceopenapi.github.io') !== -1) {
    e.respondWith(
      fetch(e.request).then(function(resp) {
        if (resp.ok) {
          var clone = resp.clone();
          caches.open(API_CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return resp;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || new Response('{"error":"offline"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
    return;
  }

  // 静的アセット: Network First（コード更新を即反映するため）
  e.respondWith(
    fetch(e.request).then(function(resp) {
      if (resp.ok) {
        var clone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, clone);
        });
      }
      return resp;
    }).catch(function() {
      return caches.match(e.request).then(function(cached) {
        return cached || new Response('Not found', { status: 404 });
      });
    })
  );
});

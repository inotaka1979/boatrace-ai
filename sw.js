// BoatRace Oracle - Service Worker v4 (P4: race condition / fallback / 更新通知)
// 設計書 §6 を参照
//
// 修正内容:
//   W-01 caches.put を await して race を防止
//   W-02 data/ オフライン応答を 503 に変更（空 {} で誤動作するのを防ぐ）
//   W-03 install 時 skipWaiting を撤去、message('SKIP_WAITING') で明示制御
//   W-09 querystring を除いたキーで cache 参照（キャッシュキー分散を防止）

const VERSION = 'br-oracle-v5';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// install: 静的アセットのみキャッシュ（skipWaiting しない）
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(STATIC_ASSETS))
  );
});

// activate: 旧 cache を全削除してから claim
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// クライアントから明示的に新版を有効化 / 緊急 purge
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'PURGE_ALL') {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // 全クライアントに purge 完了を通知
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: 'PURGED' }));
    })());
  }
});

// W-09: キャッシュキーは querystring を除いた URL に正規化
function normalizeRequest(req) {
  const url = new URL(req.url);
  url.search = '';
  return new Request(url.toString(), { method: req.method, headers: req.headers });
}

// network-first 共通関数
async function netFirst(req) {
  const cacheKey = normalizeRequest(req);
  try {
    const resp = await fetch(req);
    if (resp.ok) {
      const cache = await caches.open(VERSION);
      // W-01: await して race condition を防止
      await cache.put(cacheKey, resp.clone());
    }
    return resp;
  } catch (_) {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    // W-02: 空 {} ではなく 503 を返す（呼出側が catch で適切にハンドル可能）
    return new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// PA-7: 介入対象 origin を明示的に許可
const ALLOWED_API_ORIGINS = new Set([
  'https://boatraceopenapi.github.io',
  'https://inotaka1979.github.io',
]);

self.addEventListener('fetch', (e) => {
  // GET 以外（POST/PUT/DELETE）は SW で介入しない
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const isOwnOrigin = url.origin === self.location.origin;
  const isAllowedAPI = ALLOWED_API_ORIGINS.has(url.origin);

  // PA-7: 自オリジンと許可済 API 以外は SW で扱わない（バイパス）
  if (!isOwnOrigin && !isAllowedAPI) return;

  const path = url.pathname;

  // index.html はネットワーク優先
  if (isOwnOrigin && (path.endsWith('/') || path.endsWith('/index.html'))) {
    e.respondWith(netFirst(e.request));
    return;
  }

  // data/ 配下（自前スクレイピング JSON、自オリジンのみ）はネットワーク優先
  if (isOwnOrigin && path.includes('/data/')) {
    e.respondWith(netFirst(e.request));
    return;
  }

  // 許可済 API（外部 Open API）はネットワーク優先
  if (isAllowedAPI) {
    e.respondWith(netFirst(e.request));
    return;
  }

  // 静的アセット: キャッシュ優先
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

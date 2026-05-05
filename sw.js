// BoatRace Oracle - Service Worker v6 (PA-7 + PD-2 + PD-3)
// 設計書 §6 / docs/A_PLUS_化設計書.md PD-2/3 を参照
//
// 変更履歴:
//   W-01 caches.put を await して race を防止
//   W-02 data/ オフライン応答を 503 に変更（空 {} で誤動作するのを防ぐ）
//   W-03 install 時 skipWaiting を撤去、message('SKIP_WAITING') で明示制御
//   W-09 querystring を除いたキーで cache 参照（キャッシュキー分散を防止）
//   PA-7 fetch handler に origin allowlist、GET 以外はバイパス
//   PD-2 CDN (cdnjs / gstatic) を別 cache 名で cache-first + SWR 化
//   PD-3 update 検出時にクライアントへ通知（NEW_VERSION）

const VERSION = 'br-oracle-v25';
const CDN_CACHE = 'br-oracle-cdn-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './assets/app-critical.min.js', // PI-3: critical bundle (33KB)
  './assets/app-rest.min.js',     // PI-3: rest bundle (100KB, lazy)
  './assets/worker.js',           // PF-9 + PG-3: Web Worker entry
  './assets/worker_predictor.js', // PG-2: 予測ロジックモジュール (~50KB)
];

// PD-2: 別 cache 名で永続キャッシュする外部リソース origin
const CDN_ORIGINS = new Set([
  'https://cdnjs.cloudflare.com',
  'https://fonts.gstatic.com',
  'https://fonts.googleapis.com',
]);

// PA-7: 介入対象 origin を明示的に許可
const ALLOWED_API_ORIGINS = new Set([
  'https://boatraceopenapi.github.io',
  'https://inotaka1979.github.io',
]);

// install: 静的アセットをキャッシュ。skipWaiting は addAll の成否に関わらず実行
//   （fail-soft）— iOS で 1 アセットの 404/network glitch で activate が
//   永久に止まる事故を防ぐ。page 側 controllerchange で自動 reload。
self.addEventListener('install', (e) => {
  // skipWaiting は fail-soft で先に呼ぶ
  self.skipWaiting();
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(STATIC_ASSETS))
      .catch((err) => {
        // 1 ファイル失敗でも他のキャッシュは個別 put で救済
        console.warn('[SW] addAll failed, fallback to individual put:', err);
        return caches.open(VERSION).then(async (c) => {
          for (const url of STATIC_ASSETS) {
            try { await c.add(url); } catch (e2) { /* 個別失敗は無視 */ }
          }
        });
      })
  );
});

// activate: 旧 cache（VERSION/CDN_CACHE 以外）を全削除してから claim
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const keep = new Set([VERSION, CDN_CACHE]);
    await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
    // PD-3: 既存クライアントに新バージョンを通知（UI でトースト表示）
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'NEW_VERSION', version: VERSION }));
  })());
});

// クライアントから明示的に新版を有効化 / 緊急 purge
self.addEventListener('message', (e) => {
  const data = e.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
  if (data === 'PURGE_ALL' || (data && data.type === 'PURGE_ALL')) {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
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
      await cache.put(cacheKey, resp.clone());
    }
    return resp;
  } catch (_) {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// PD-2: CDN/Fonts 用 cache-first + Stale-While-Revalidate
async function cacheFirstSWR(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  // バックグラウンドで再取得して更新（fire-and-forget）
  const refresh = fetch(req).then((resp) => {
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  }).catch(() => null);
  if (cached) return cached;
  const resp = await refresh;
  if (resp) return resp;
  return new Response('', { status: 503 });
}

self.addEventListener('fetch', (e) => {
  // GET 以外（POST/PUT/DELETE）は SW で介入しない
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const isOwnOrigin = url.origin === self.location.origin;
  const isAllowedAPI = ALLOWED_API_ORIGINS.has(url.origin);
  const isCDN = CDN_ORIGINS.has(url.origin);

  // PA-7: 自オリジン / 許可済 API / 既知 CDN 以外は SW で扱わない（バイパス）
  if (!isOwnOrigin && !isAllowedAPI && !isCDN) return;

  // PD-2: CDN は cache-first + SWR
  if (isCDN) {
    e.respondWith(cacheFirstSWR(e.request, CDN_CACHE));
    return;
  }

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

// =============================================================================
// boatrace-scrape-trigger — Cloudflare Worker
//
// 2026-05-17: Path C 移行。GHA cron 単独依存を脱却し、Cloudflare Worker を
//   独立スクレイプエンジンとして稼働。99.99% SLA で GHA 障害の影響を受けない。
//
// アーキテクチャ:
//   [Worker Cron 5min] → boatraceopenapi.github.io / boatrace.jp → KV
//                                                                    ↓
//   PWA --- /api/previews (Worker URL)  ← 一次
//        \- data/previews/today.json (Pages) ← 二次 fallback
//        \- boatraceopenapi.github.io           ← 三次 fallback
//
// エンドポイント:
//   GET /health         — 疎通確認
//   GET /api/previews   — previews/today (Worker KV、3-5 分鮮度)
//   GET /api/programs   — programs/today (同上)
//   GET /api/results    — results/today  (同上)
//   GET /odds-proxy     — boatrace.jp odds CORS pass-through (既存)
//
// KV キー:
//   previews:today  — {updated_at, data} JSON
//   programs:today  — 同上
//   results:today   — 同上
// =============================================================================

const UPSTREAM = {
  previews: 'https://boatraceopenapi.github.io/previews/v2/today.json',
  programs: 'https://boatraceopenapi.github.io/programs/v2/today.json',
  results:  'https://boatraceopenapi.github.io/results/v2/today.json',
};

const KV_KEYS = {
  previews: 'previews:today',
  programs: 'programs:today',
  results:  'results:today',
};

// CORS 共通ヘッダ
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

function jsonResponse(obj, opts = {}) {
  return new Response(JSON.stringify(obj), {
    status: opts.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': opts.cacheControl || 'public, max-age=30',
      ...CORS,
    },
  });
}

// 上流から JSON を fetch。boatraceopenapi.github.io はキャッシュが効きやすいので
// cf: cacheTtl=10 で edge 負荷を抑制。
async function fetchUpstream(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'boatrace-scrape-worker/1.0' },
    cf: { cacheTtl: 10, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}: ${url}`);
  return await res.json();
}

// KV に書き込む共通関数。updated_at 付きでラップ。
async function kvWrite(env, key, data) {
  const wrapped = {
    updated_at: new Date().toISOString(),
    data,
  };
  await env.BOATRACE_KV.put(key, JSON.stringify(wrapped), {
    expirationTtl: 86400 * 2, // 2 日で自動失効
  });
  return wrapped;
}

// Cron で呼ばれる. 全 upstream を fetch して KV に格納。
async function refreshAll(env) {
  const results = {};
  for (const kind of ['previews', 'programs', 'results']) {
    try {
      const data = await fetchUpstream(UPSTREAM[kind]);
      const wrapped = await kvWrite(env, KV_KEYS[kind], data);
      results[kind] = { ok: true, updated_at: wrapped.updated_at };
    } catch (e) {
      results[kind] = { ok: false, error: String(e).slice(0, 200) };
    }
  }
  return results;
}

// KV から取得して JSON で返す。KV miss 時は upstream を直接 fetch。
async function serveFromKV(env, kind) {
  try {
    const raw = await env.BOATRACE_KV.get(KV_KEYS[kind]);
    if (raw) {
      const wrapped = JSON.parse(raw);
      return jsonResponse(wrapped.data, {
        cacheControl: 'public, max-age=30',
      });
    }
  } catch (e) {
    console.error('KV read failed:', e);
  }
  // KV miss: upstream 直 fetch
  try {
    const data = await fetchUpstream(UPSTREAM[kind]);
    // 非同期で KV に保存 (応答は待たない)
    if (env.BOATRACE_KV) {
      kvWrite(env, KV_KEYS[kind], data).catch(() => {});
    }
    return jsonResponse(data, { cacheControl: 'public, max-age=30' });
  } catch (e) {
    return jsonResponse({ error: String(e) }, { status: 502, cacheControl: 'no-store' });
  }
}

export default {
  // -----------------------------------------------------------------------
  // Cron entry (Path C: 5 分間隔、JST 08:00-22:55 = UTC 23-13)
  // -----------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    // JST レース時間外は skip (KV 書込節約)
    const utcH = new Date(event.scheduledTime).getUTCHours();
    const inRaceHours = utcH === 23 || (utcH >= 0 && utcH <= 13);
    if (!inRaceHours) {
      console.log('outside race hours, skip refresh');
      return;
    }
    if (!env.BOATRACE_KV) {
      console.error('BOATRACE_KV binding missing — check wrangler.toml');
      return;
    }
    const r = await refreshAll(env);
    console.log('refresh:', JSON.stringify(r));
  },

  // -----------------------------------------------------------------------
  // HTTP entry — /health, /api/{previews,programs,results}, /odds-proxy
  // -----------------------------------------------------------------------
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...CORS, 'access-control-max-age': '86400' },
      });
    }

    if (url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        time: new Date().toISOString(),
        mode: 'scrape-engine-v2',
        kv_bound: !!env.BOATRACE_KV,
      });
    }

    // データ API: KV 経由
    if (url.pathname === '/api/previews') return serveFromKV(env, 'previews');
    if (url.pathname === '/api/programs') return serveFromKV(env, 'programs');
    if (url.pathname === '/api/results')  return serveFromKV(env, 'results');

    // 手動リフレッシュ (デバッグ用、認証なし — abuse 防止のため将来 token 化検討)
    if (url.pathname === '/api/refresh-now') {
      if (!env.BOATRACE_KV) return jsonResponse({ error: 'KV not bound' }, { status: 500 });
      const r = await refreshAll(env);
      return jsonResponse({ refreshed: r });
    }

    // 既存: /odds-proxy
    if (url.pathname === '/odds-proxy') {
      const type = url.searchParams.get('type') || '';
      const sid  = url.searchParams.get('sid') || '';
      const rno  = url.searchParams.get('rno') || '';
      const hd   = url.searchParams.get('hd')  || '';
      const endpoints = { win: 'oddstf', exacta: 'odds2tf', trifecta: 'odds3t' };
      if (!endpoints[type] || !/^\d+$/.test(sid) || !/^\d+$/.test(rno) || !/^\d{8}$/.test(hd)) {
        return new Response('bad params', { status: 400, headers: CORS });
      }
      const sidNum = parseInt(sid);
      if (sidNum < 1 || sidNum > 24) {
        return new Response('bad sid', { status: 400, headers: CORS });
      }
      const jcd = String(sidNum).padStart(2, '0');
      const upstream = `https://www.boatrace.jp/owpc/pc/race/${endpoints[type]}?rno=${parseInt(rno)}&jcd=${jcd}&hd=${hd}`;
      try {
        const res = await fetch(upstream, {
          headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-trigger' },
          cf: { cacheTtl: 15, cacheEverything: true },
        });
        if (!res.ok) {
          return new Response(`upstream ${res.status}`, { status: 502, headers: CORS });
        }
        const html = await res.text();
        return new Response(html, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=15',
            ...CORS,
          },
        });
      } catch (e) {
        return new Response(`error: ${e.message}`, { status: 502, headers: CORS });
      }
    }

    return new Response('boatrace-scrape-trigger (scrape-engine-v2)\n', { headers: CORS });
  },
};

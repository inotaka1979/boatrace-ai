// =============================================================================
// boatrace-scrape-trigger — Cloudflare Worker (Path C — independent scrape engine)
//
// 2026-05-17 改訂 C5: openapi 経由に加え、boatrace.jp の beforeinfo HTML を
//   直接スクレイプして展示データ (exhibition_time / start_timing / course /
//   tilt / propeller / parts_replaced / adjust_weight) を取得・マージ。
//   これにより上流 mirror が遅い場合でも Worker 単独で展示を提供可能。
//
// アーキテクチャ:
//   [Worker Cron 5min]
//      ├─ openapi {programs,previews,results} → JSON 取得
//      └─ programs から「展示窓内」のレースを判定 → boatrace.jp beforeinfo
//         を直接 fetch → HTML parse → previews にマージ
//   KV (previews:today) ← マージ済 previews
//   /api/previews ← KV
//
// エンドポイント:
//   GET /health         — 疎通確認
//   GET /api/previews   — マージ済 previews
//   GET /api/programs   — programs
//   GET /api/results    — results
//   GET /api/refresh-now — 手動 refresh トリガ (デバッグ用)
//   GET /odds-proxy     — boatrace.jp odds CORS pass-through
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
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

// 展示窓: 締切時刻の 30 分前 〜 5 分後 (この間に boatrace.jp に展示データ有)
const EXHIBITION_WINDOW_BEFORE_MIN = 30;
const EXHIBITION_WINDOW_AFTER_MIN  = 5;
const MAX_HTML_SCRAPES_PER_RUN     = 12;   // CPU/subrequest budget 安全圏

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

async function fetchUpstream(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'boatrace-scrape-worker/1.1' },
    cf: { cacheTtl: 10, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}: ${url}`);
  return await res.json();
}

async function kvWrite(env, key, data) {
  const wrapped = { updated_at: new Date().toISOString(), data };
  await env.BOATRACE_KV.put(key, JSON.stringify(wrapped), { expirationTtl: 86400 * 2 });
  return wrapped;
}

// -----------------------------------------------------------------------
// HTML parser for boatrace.jp /owpc/pc/race/beforeinfo
//   Python の scripts/scrape_previews.py parse_beforeinfo() を JS に移植
// -----------------------------------------------------------------------
function stripTags(s) {
  return String(s||'').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseBeforeinfoHTML(html) {
  const boats = {};
  // 出走表+展示テーブル: 1艇 = tbody.is-fs12 (グループ化)
  const tbodyRe = /<tbody[^>]*class="[^"]*is-fs12[^"]*"[^>]*>([\s\S]*?)<\/tbody>/g;
  let tm;
  while ((tm = tbodyRe.exec(html)) !== null) {
    const tbody = tm[1];
    // 全 td を順次取得
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const tds = [];
    let mm;
    while ((mm = tdRe.exec(tbody)) !== null) tds.push(stripTags(mm[1]));
    if (tds.length < 5) continue;
    // tds[0] = 枠 (1-6)、tds[4]=展示タイム、tds[5]=チルト、tds[6]=ペラ、tds[7]=部品交換
    const bn = parseInt(tds[0]);
    if (!(bn >= 1 && bn <= 6)) continue;
    const et   = parseFloat(tds[4]) || 0;
    const tilt = parseFloat(tds[5]) || 0;
    const prop = tds[6] || '';
    const parts = tds[7] || '';
    // 調整重量: メイン行 + 2 行目 (ST 行) の td[0]、tbody 内なので追加 td 走査必要
    // tbody 内の 2 番目以降の <tr> を分解して find
    let adjW = 0;
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    const trs = [];
    let trm;
    while ((trm = trRe.exec(tbody)) !== null) trs.push(trm[1]);
    if (trs.length >= 3) {
      const stTr = trs[2];   // 3 行目 = ST 行
      const stTd = /<td[^>]*>([\s\S]*?)<\/td>/.exec(stTr);
      if (stTd) {
        const txt = stripTags(stTd[1]).replace(/kg/g,'').trim();
        if (txt) adjW = parseFloat(txt) || 0;
      }
    }
    boats[bn] = {
      exhibition_time: et,
      tilt: tilt,
      propeller: prop,
      parts_replaced: parts,
      adjust_weight: adjW,
      start_timing: null,
      course: bn,
    };
  }
  if (!Object.keys(boats).length) return null;

  // スタート展示テーブル: class is-w238 の table
  const stTblRe = /<table[^>]*class="[^"]*is-w238[^"]*"[^>]*>([\s\S]*?)<\/table>/;
  const stTblM = stTblRe.exec(html);
  if (stTblM) {
    const stTbl = stTblM[1];
    const stTrRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    const stTrs = [];
    let stm;
    while ((stm = stTrRe.exec(stTbl)) !== null) stTrs.push(stm[1]);
    // 先頭 2 行 (ヘッダ) skip、3 行目以降が course 1-6
    const courseRows = stTrs.slice(2, 8);
    courseRows.forEach((tr, ci) => {
      const courseNum = ci + 1;
      // 艇番: span.table1_boatImage1Number
      const bnSpanM = /<span[^>]*class="[^"]*table1_boatImage1Number[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(tr);
      const text = stripTags(tr);
      if (!text || text.indexOf('.') < 0) return;
      const isF = text.indexOf('F') >= 0;
      const clean = text.replace(/F/g, '');
      const parts = clean.split('.');
      if (parts.length !== 2) return;
      let boatNum = NaN;
      let stVal = NaN;
      try {
        const boatFromText = parseInt(parts[0]);
        stVal = parseFloat('0.' + parts[1]);
        if (isF) stVal = -stVal;
        if (bnSpanM) {
          const bnT = parseInt(stripTags(bnSpanM[1]));
          boatNum = isFinite(bnT) ? bnT : boatFromText;
        } else {
          boatNum = boatFromText;
        }
      } catch (_) {}
      if (!isFinite(boatNum) || !boats[boatNum]) return;
      boats[boatNum].course = courseNum;
      boats[boatNum].start_timing = isFinite(stVal) ? stVal : null;
    });
  }

  // 1 艇でも exhibition_time > 0 が無ければデータ無し扱い
  const hasData = Object.values(boats).some(b => (b.exhibition_time||0) > 0);
  return hasData ? boats : null;
}

async function scrapeBeforeinfo(sid, rno, hd) {
  const jcd = String(sid).padStart(2, '0');
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${rno}&jcd=${jcd}&hd=${hd}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-worker/1.1' },
    cf: { cacheTtl: 20, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`beforeinfo ${res.status}: stadium=${sid} race=${rno}`);
  const html = await res.text();
  return parseBeforeinfoHTML(html);
}

// JST 「YYYYMMDD」を Date の race_closed_at "YYYY-MM-DD HH:MM:SS" から導出
// 展示窓判定: now が [close - 30min, close + 5min] にあるか
function isInExhibitionWindow(closedAtStr, nowMs) {
  if (!closedAtStr) return false;
  // "2026-05-17 10:47:00" を JST と解釈
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(closedAtStr);
  if (!m) return false;
  // JST 時刻として組み立て (UTC=JST-9h)
  const closeJstMs = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4]-9, +m[5], +m[6]);
  const startMs = closeJstMs - EXHIBITION_WINDOW_BEFORE_MIN * 60_000;
  const endMs   = closeJstMs + EXHIBITION_WINDOW_AFTER_MIN  * 60_000;
  return nowMs >= startMs && nowMs <= endMs;
}

// 展示窓内かつ openapi が boats 空のレースを抽出し、boatrace.jp 直スクレイプ
async function mergeBoatraceJpExhibition(programs, previews, nowMs) {
  const scrapeTargets = [];
  const progByKey = new Map();
  for (const p of (programs.programs || [])) {
    const sid = p.race_stadium_number, rno = p.race_number;
    progByKey.set(`${sid}-${rno}`, p);
    if (!isInExhibitionWindow(p.race_closed_at, nowMs)) continue;
    // hd を抽出 ("2026-05-17" → "20260517")
    const hd = String(p.race_date || '').replace(/-/g, '');
    if (!hd) continue;
    // 該当 preview が boats 空 か確認
    const pv = (previews.previews || []).find(r =>
      r.race_stadium_number === sid && r.race_number === rno
    );
    if (!pv) continue;
    const boats = pv.boats || {};
    const hasEx = Object.values(boats).some(b => (b.racer_exhibition_time||0) > 0);
    if (hasEx) continue;   // 既に展示あり → スキップ
    scrapeTargets.push({ sid, rno, hd, pv });
  }

  // CPU 安全圏 (12 件まで)、締切が近い順
  scrapeTargets.sort((a, b) => {
    const ca = progByKey.get(`${a.sid}-${a.rno}`).race_closed_at;
    const cb = progByKey.get(`${b.sid}-${b.rno}`).race_closed_at;
    return ca < cb ? -1 : 1;
  });
  const picks = scrapeTargets.slice(0, MAX_HTML_SCRAPES_PER_RUN);

  let mergedCount = 0;
  // 並列 fetch (Cloudflare のサブリクエスト最大 50 件以内)
  const results = await Promise.allSettled(
    picks.map(t => scrapeBeforeinfo(t.sid, t.rno, t.hd).then(boats => ({ t, boats })))
  );
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.boats) continue;
    const { t, boats } = r.value;
    // pv.boats に注入 (openapi 形式に変換)
    const newBoats = t.pv.boats || {};
    for (const bn of Object.keys(boats)) {
      const src = boats[bn];
      if (!newBoats[bn]) newBoats[bn] = { racer_boat_number: parseInt(bn) };
      newBoats[bn].racer_exhibition_time = src.exhibition_time;
      newBoats[bn].racer_start_timing    = src.start_timing;
      newBoats[bn].racer_course_number   = src.course;
      newBoats[bn].racer_tilt_adjustment = src.tilt;
      newBoats[bn].racer_propeller       = src.propeller;
      newBoats[bn].racer_parts_replaced  = src.parts_replaced;
      newBoats[bn].racer_adjust_weight   = src.adjust_weight;
    }
    t.pv.boats = newBoats;
    mergedCount++;
  }
  return { targets: scrapeTargets.length, scraped: picks.length, merged: mergedCount };
}

// -----------------------------------------------------------------------
// Cron で呼ばれる。openapi + boatrace.jp 直スクレイプを統合して KV に格納
// -----------------------------------------------------------------------
async function refreshAll(env) {
  const out = {};
  let previews = null, programs = null, results = null;
  try { previews = await fetchUpstream(UPSTREAM.previews); out.previews = { ok: true }; }
  catch (e) { out.previews = { ok: false, error: String(e).slice(0,200) }; }
  try { programs = await fetchUpstream(UPSTREAM.programs); out.programs = { ok: true }; }
  catch (e) { out.programs = { ok: false, error: String(e).slice(0,200) }; }
  try { results  = await fetchUpstream(UPSTREAM.results);  out.results  = { ok: true }; }
  catch (e) { out.results  = { ok: false, error: String(e).slice(0,200) }; }

  // boatrace.jp 直スクレイプで展示データを補完
  if (previews && programs) {
    try {
      const mergeStats = await mergeBoatraceJpExhibition(programs, previews, Date.now());
      out.exhibition_scrape = mergeStats;
    } catch (e) {
      out.exhibition_scrape = { error: String(e).slice(0,200) };
    }
  }

  // KV 書込 (env.BOATRACE_KV があれば)
  if (env.BOATRACE_KV) {
    if (previews) { try { await kvWrite(env, KV_KEYS.previews, previews); out.previews.kv_ok=true; } catch(e) { out.previews.kv_err=String(e).slice(0,100); } }
    if (programs) { try { await kvWrite(env, KV_KEYS.programs, programs); out.programs.kv_ok=true; } catch(e) { out.programs.kv_err=String(e).slice(0,100); } }
    if (results)  { try { await kvWrite(env, KV_KEYS.results,  results);  out.results.kv_ok=true;  } catch(e) { out.results.kv_err=String(e).slice(0,100);  } }
  }
  return out;
}

async function serveFromKV(env, kind) {
  try {
    const raw = await env.BOATRACE_KV.get(KV_KEYS[kind]);
    if (raw) {
      const wrapped = JSON.parse(raw);
      return jsonResponse(wrapped.data, { cacheControl: 'public, max-age=30' });
    }
  } catch (e) {
    console.error('KV read failed:', e);
  }
  try {
    const data = await fetchUpstream(UPSTREAM[kind]);
    if (env.BOATRACE_KV) kvWrite(env, KV_KEYS[kind], data).catch(()=>{});
    return jsonResponse(data, { cacheControl: 'public, max-age=30' });
  } catch (e) {
    return jsonResponse({ error: String(e) }, { status: 502, cacheControl: 'no-store' });
  }
}

export default {
  async scheduled(event, env, ctx) {
    const utcH = new Date(event.scheduledTime).getUTCHours();
    const inRaceHours = utcH === 23 || (utcH >= 0 && utcH <= 13);
    if (!inRaceHours) {
      console.log('outside race hours, skip refresh');
      return;
    }
    if (!env.BOATRACE_KV) {
      console.error('BOATRACE_KV binding missing');
      return;
    }
    const r = await refreshAll(env);
    console.log('refresh:', JSON.stringify(r));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
    }
    if (url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        time: new Date().toISOString(),
        mode: 'scrape-engine-v3-with-html-scrape',
        kv_bound: !!env.BOATRACE_KV,
      });
    }
    if (url.pathname === '/api/previews') return serveFromKV(env, 'previews');
    if (url.pathname === '/api/programs') return serveFromKV(env, 'programs');
    if (url.pathname === '/api/results')  return serveFromKV(env, 'results');
    if (url.pathname === '/api/refresh-now') {
      if (!env.BOATRACE_KV) return jsonResponse({ error: 'KV not bound' }, { status: 500 });
      const r = await refreshAll(env);
      return jsonResponse({ refreshed: r });
    }

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
      if (sidNum < 1 || sidNum > 24) return new Response('bad sid', { status: 400, headers: CORS });
      const jcd = String(sidNum).padStart(2, '0');
      const upstream = `https://www.boatrace.jp/owpc/pc/race/${endpoints[type]}?rno=${parseInt(rno)}&jcd=${jcd}&hd=${hd}`;
      try {
        const res = await fetch(upstream, {
          headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-trigger' },
          cf: { cacheTtl: 15, cacheEverything: true },
        });
        if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502, headers: CORS });
        const html = await res.text();
        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=15', ...CORS },
        });
      } catch (e) {
        return new Response(`error: ${e.message}`, { status: 502, headers: CORS });
      }
    }
    return new Response('boatrace-scrape-trigger (scrape-engine-v3)\n', { headers: CORS });
  },
};

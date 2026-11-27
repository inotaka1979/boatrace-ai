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
//   GET /racer-proxy    — 選手の今後の出場予定・過去 3 節（公式の選手ページ、edge に 3 時間）
//   /push/*             — 締切前通知 (Web Push) の登録・解除・テスト送信（push.js）
//
// cron は 3 本: データ更新（日中 5 分毎・夜間 30 分毎）と、締切前通知の確認（毎分、push.js の pushTick）。
// =============================================================================

// 2026-11-27: Web Push（お気に入り選手の締切前通知を、アプリを閉じていても届ける）。中身は push.js。
//   scheduled() は event.cron で「毎分の通知確認 (PUSH_CRON)」と「データ更新 (MAIN_CRONS)」を振り分ける。
import { MAIN_CRONS, PUSH_CRON, handlePush, pushTick, writePushIndex } from './push.js';

const UPSTREAM = {
  previews: 'https://boatraceopenapi.github.io/previews/v2/today.json',
  programs: 'https://boatraceopenapi.github.io/programs/v2/today.json',
  results:  'https://boatraceopenapi.github.io/results/v2/today.json',
};
// 公式移行 Phase 2 (2026-06-28): 番組表(programs)のベースを「自前公式 data/* → openapi」順に。
//   scrape_programs.py が boatrace.jp 出走表から openapi 互換 programs を生成し repo に commit。
//   raw.githubusercontent は commit 即時反映（Pages build lag 無し）。data-freshness-monitor も
//   data/* を raw で読んでおり「データ真値」URL として既に確立済み。
//   公式が空/別日/壊れ/取得失敗なら openapi に自動フォールバックし silent 劣化を防ぐ。
const OFFICIAL = {
  programs: 'https://raw.githubusercontent.com/inotaka1979/boatrace-ai/main/data/programs/today.json',
};
const KV_KEYS = {
  previews: 'previews:today',
  programs: 'programs:today',
  results:  'results:today',
};
const CORS = {
  // FA-5 (2026-08-11): 既定値は '*' のままだが、fetch() の出口で _applyCors() が
  //   リクエストの Origin に応じて必ず上書き（許可外なら削除）する。ここを個別に
  //   書き換えると 30 箇所以上の呼出を触ることになるため、単一の出口で正規化する。
  'access-control-allow-origin': '*',
  // POST は /push/* だけ（本文は text/plain で送るので、ブラウザの事前確認は起きない）
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

// FA-5: ブラウザから叩けるオリジンの許可リスト。
//   本 Worker は /odds-proxy・/orig-exhibition-proxy 等 boatrace.jp への
//   CORS パススルーを持つため、ACAO='*' のままだと「誰でも使える無料の CORS プロキシ」
//   として第三者サイトから利用でき、CPU / subrequest / KV クォータを消費される。
//   Origin ヘッダを持たない呼出 (curl / GitHub Actions / 外形監視) は CORS の
//   対象外なので、ACAO を付けないだけで従来どおり動作する。
const DEFAULT_ALLOWED_ORIGINS = [
  'https://inotaka1979.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function _allowedOrigins(env) {
  const extra =
    env && typeof env.ALLOWED_ORIGINS === 'string' && env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  return DEFAULT_ALLOWED_ORIGINS.concat(extra);
}

// レスポンスの ACAO を Origin 許可リストで正規化する（出口 1 箇所）。
function _applyCors(request, env, res) {
  let origin = null;
  try { origin = request.headers.get('origin'); } catch (_) { origin = null; }
  const headers = new Headers(res.headers);
  headers.set('vary', 'Origin');
  if (origin && _allowedOrigins(env).indexOf(origin) >= 0) {
    headers.set('access-control-allow-origin', origin);
  } else {
    // Origin 無し = 非ブラウザ (CORS 判定なし、そのまま読める)。
    // Origin 有りで許可外 = ブラウザが弾く。
    headers.delete('access-control-allow-origin');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// FA-5: /api/refresh-now のレート制限。
//   refreshAll() は upstream 3 fetch + 最大 20 HTML scrape + KV write を伴うため、
//   未認証で無制限に叩けると第三者から容易にクォータを枯渇させられる。
//   - TRIGGER_SECRET を提示した呼出 (GitHub Actions watchdog) は無制限
//   - 未認証 (アプリの自動復旧トリガ含む) は最小間隔を強制
//   isolate ローカル変数を第一段、Cache API (無料・コロケーション単位) を第二段に使う。
//   KV は書込クォータ (無料枠 1000/日) を消費するため throttle 用途には使わない。
const REFRESH_MIN_INTERVAL_MS = 300000; // 5 分（アプリ側 _lastEscalateAt と同値）
const REFRESH_THROTTLE_CACHE_URL = 'https://throttle.invalid/api/refresh-now';
let _lastRefreshAt = 0;

// 長さと内容を定数時間で比較する（タイミング攻撃の緩和）。
function _secretEquals(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function _isTriggerAuthorized(request, env, url) {
  const expected = env && env.TRIGGER_SECRET;
  if (!expected) return false; // 未設定なら「認証済み」は存在しない = 常に throttle 側
  let given = '';
  try { given = request.headers.get('x-trigger-secret') || ''; } catch (_) { given = ''; }
  if (!given) given = url.searchParams.get('secret') || '';
  return _secretEquals(given, expected);
}

// throttle 判定。呼んでよいなら null、抑止するなら残り秒数を返す。
async function _refreshThrottleRemainingSec() {
  const now = Date.now();
  if (now - _lastRefreshAt < REFRESH_MIN_INTERVAL_MS) {
    return Math.ceil((REFRESH_MIN_INTERVAL_MS - (now - _lastRefreshAt)) / 1000);
  }
  try {
    const cache = caches.default;
    const hit = await cache.match(new Request(REFRESH_THROTTLE_CACHE_URL));
    if (hit) {
      const at = parseInt(await hit.text(), 10);
      if (Number.isFinite(at) && now - at < REFRESH_MIN_INTERVAL_MS) {
        _lastRefreshAt = at;
        return Math.ceil((REFRESH_MIN_INTERVAL_MS - (now - at)) / 1000);
      }
    }
  } catch (_) { /* Cache API 不可でも isolate ローカルの抑止は効いている */ }
  return null;
}

async function _markRefreshDone() {
  _lastRefreshAt = Date.now();
  try {
    await caches.default.put(
      new Request(REFRESH_THROTTLE_CACHE_URL),
      new Response(String(_lastRefreshAt), {
        headers: {
          'cache-control': `max-age=${Math.ceil(REFRESH_MIN_INTERVAL_MS / 1000)}`,
          'content-type': 'text/plain',
        },
      })
    );
  } catch (_) { /* best effort */ }
}

// 展示窓: 締切時刻の 30 分前 〜 5 分後 (この間に boatrace.jp に展示データ有)
const EXHIBITION_WINDOW_BEFORE_MIN = 30;
const EXHIBITION_WINDOW_AFTER_MIN  = 5;
// 2026-05-24: 12 → 24 へ (= 同時開催最大場数)。CF subrequest 上限 50/invocation:
//   3 openapi fetch + 3 KV writes + exhibition(24) + results(24) = 54 → 50 超
//   → exhibition と results に分けて 20 ずつ (実測 fail なら 18 に下げる)。
// 旧 12 だと 1 run で 12 races しか処理できず、ピーク (12 場同時開催 + モーニング場
// 蓄積) で starve していた。
// 2026-09-06: 20 → 12。実障害: 9/6 (土) 日中は cron が 1 度も完走せず heartbeat が
//   夜間 (05:31 JST, 対象ほぼ 0) の 1 回しか進まなかった。refreshAll は展示 20 + 結果 20 の
//   HTML 取得/解析を **KV 書込より前** に行っていたため、CPU/実行時間の上限で途中 kill
//   されると KV も heartbeat も残らない (RUNBOOK §8.3-2 が警告していた形)。
//   base-first 書込 (下記 refreshAll) と併せて 1 run の重さを下げる。5 分 cadence で
//   12/run = 144/時 は、ピーク (12 場同時 × 約 1.7 R/時 ≒ 20 R/時) に対して十分。
const MAX_HTML_SCRAPES_PER_RUN     = 12;

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

// 公式移行 Phase 2: JST 当日 (YYYY-MM-DD)。
function _jstDayIso(ms) {
  return new Date((typeof ms === 'number' ? ms : Date.now()) + 9 * 3600000)
    .toISOString()
    .slice(0, 10);
}

// programs ベースを「自前公式 data → openapi」の順で解決する。
//   公式 data/programs/today.json が「非空の programs 配列 かつ race_date=JST当日」の時だけ
//   採用し、それ以外（空/別日/壊れ/取得失敗）は openapi にフォールバックする。
//   これにより番組表パーサが boatrace.jp の HTML 変更で壊れても予測が止まらない。
async function fetchProgramsBase() {
  try {
    const off = await fetchUpstream(OFFICIAL.programs);
    const arr = off && Array.isArray(off.programs) ? off.programs : [];
    const dateOk = !off.race_date || off.race_date === _jstDayIso();
    if (arr.length > 0 && dateOk) {
      off._source_base = 'official';
      return off;
    }
  } catch (_) {
    // fall through to openapi
  }
  return await fetchUpstream(UPSTREAM.programs);
}

// kind 別ベース取得。programs のみ公式優先、previews/results は openapi（値は Worker の
//   boatrace.jp 直スクレイプで補完されるため base はリスト/締切時刻取得用途）。
async function fetchKindBase(kind) {
  if (kind === 'programs') return await fetchProgramsBase();
  if (kind === 'previews') return await fetchPreviewsBase();
  return await fetchUpstream(UPSTREAM[kind]);
}

// 2026-11-27: 上流の previews を取り、boats を「艇番で引ける形」にそろえて返す（normalizePreviewsDoc の説明を参照）。
async function fetchPreviewsBase() {
  return normalizePreviewsDoc(await fetchUpstream(UPSTREAM.previews));
}

// 2026-07-17: 上流 openapi previews/v2/today.json が「programs の中身を results キーで
//   包んだ」壊れたファイルを配信する実障害。壊れた base を透過すると
//   (1) クライアントの validateApiPayload('previews') が恒常 fail →「API取得失敗」バナー貼付き、
//   (2) mergeBoatraceJpExhibition が注入先 (previews.previews) を見つけられず展示が全滅する。
//   previews base は形を検証し、壊れて/取れていなければ programs から最小 previews を合成、
//   既存 KV の展示・気象は同一レース(同日)に限り温存する。
function isValidPreviewsShape(d) {
  return !!(d && Array.isArray(d.previews));
}

// 2026-11-27: boats を「艇番で引ける形」（{ "1": {...}, …, "6": {...} }）にそろえる。
//   上流 (openapi) の previews は boats を配列（位置 0 = 1 号艇）で配る。一方、この Worker の展示の補完と
//   アプリは boats[艇番] で読み書きする（もとの形は艇番をキーにしたオブジェクトだった）。配列のまま
//   boats[艇番] に書くと、取得した 1 号艇の値が位置 1（艇番の欄は 2）に入り、6 号艇の分は 7 番目の要素になる。
//   アプリも同じ読み方をするので表示は合っていたが（2026-11-27 鳴門 1R を公式ページと照合）、艇番の欄とは
//   1 つずれており、上流が自分で値を入れた配列はアプリが 1 つずれて読む。入口でそろえて、どちらも無くす。
//
//   KV に残っている旧版の配列（上の「ずれた形」）は、旧版が書き足した要素だけが持つ項目 (racer_propeller) で
//   見分けて、位置 n → n 号艇として読み替える。上流そのままの配列は、艇番の欄どおりに引き直す。
const PREVIEW_BOAT_MERGED_MARK = 'racer_propeller';

function normalizePreviewBoats(boats) {
  const out = {};
  if (!boats || typeof boats !== 'object') return out;
  if (!Array.isArray(boats)) {
    for (const k of Object.keys(boats)) {
      const n = parseInt(k, 10);
      const b = boats[k];
      if (n >= 1 && n <= 6 && b && typeof b === 'object') {
        b.racer_boat_number = n;
        out[n] = b;
      }
    }
    return out;
  }
  const legacy = boats.some(
    (b) => b && typeof b === 'object' && Object.prototype.hasOwnProperty.call(b, PREVIEW_BOAT_MERGED_MARK)
  );
  if (legacy) {
    for (let n = 1; n <= 6; n++) {
      const b = boats[n];
      if (!b || typeof b !== 'object') continue;
      // 体重の欄は上流の「艇番の欄」の艇（= 隣の艇）のものなので引き継がない
      const rest = Object.assign({}, b);
      delete rest.racer_weight;
      delete rest.racer_weight_adjustment;
      rest.racer_boat_number = n;
      out[n] = rest;
    }
    // 位置 0 は上流の 1 号艇の枠。1 号艇の値が無い時だけ使う
    if (!out[1] && boats[0] && typeof boats[0] === 'object') {
      boats[0].racer_boat_number = 1;
      out[1] = boats[0];
    }
    return out;
  }
  for (const b of boats) {
    if (!b || typeof b !== 'object') continue;
    const n = Number(b.racer_boat_number);
    if (Number.isInteger(n) && n >= 1 && n <= 6 && !out[n]) out[n] = b;
  }
  return out;
}

// previews の文書（{ previews: [...] }）の全レースをそろえる。形が違う文書はそのまま返す。
//   行として読めない要素（null など）は落とす（2026-11-27）。残すと、引き継ぎの途中で例外になって
//   ほかのレースの展示を引き継げず、アプリも 1 行ごとに欄を読むので全体が読めなくなる。
function normalizePreviewsDoc(doc) {
  if (!isValidPreviewsShape(doc)) return doc;
  if (doc.previews.some((row) => !row || typeof row !== 'object')) {
    doc.previews = doc.previews.filter((row) => row && typeof row === 'object');
  }
  for (const row of doc.previews) row.boats = normalizePreviewBoats(row.boats);
  return doc;
}

function synthesizePreviewsFromPrograms(programs) {
  const rows = (programs && Array.isArray(programs.programs) ? programs.programs : []).map(p => ({
    race_date: p.race_date,
    race_stadium_number: p.race_stadium_number,
    race_number: p.race_number,
    race_closed_at: p.race_closed_at,
    boats: {},
  }));
  // 2026-07-19: updated_at は now (合成実行時刻)。旧実装は programs.updated_at を
  //   継承していたが、programs は 1 日数回しか再生成されないため /api/previews の
  //   世代表示が凍結し、展示が 5 分毎に流れていても鮮度 SLO が誤発報した
  //   ([STALE] worker-previews issue)。Worker 自身がスクレイパとして生成する
  //   payload なので「最後に合成した時刻」が世代の真値。
  return {
    previews: rows,
    updated_at: new Date().toISOString(),
    _synth: 'programs',
  };
}

const PREVIEW_WEATHER_FIELDS = [
  'race_wind', 'race_wind_direction_number', 'race_wave',
  'race_temperature', 'race_water_temperature', 'race_weather_number',
];

// old (旧 KV previews) の boats / 気象を target (合成 previews) の同一レースへ引き継ぐ。
//   race_date 一致を条件にするため日跨ぎ混入は起きない。
function mergePreviewsBoatsFrom(target, old) {
  if (!isValidPreviewsShape(target) || !isValidPreviewsShape(old)) return;
  normalizePreviewsDoc(old);
  const byKey = new Map();
  for (const r of old.previews) {
    byKey.set(`${r.race_stadium_number}-${r.race_number}`, r);
  }
  for (const row of target.previews) {
    const o = byKey.get(`${row.race_stadium_number}-${row.race_number}`);
    if (!o || o.race_date !== row.race_date) continue;
    if (o.boats && Object.keys(o.boats).length) row.boats = o.boats;
    for (const f of PREVIEW_WEATHER_FIELDS) {
      if (o[f] != null && row[f] == null) row[f] = o[f];
    }
  }
}

// 2026-11-27: 気象が入っているか（上流の「欄はあるが値が無い」= 0 / null は、入っていない扱い）
function hasPreviewWeather(row) {
  if (!row) return false;
  return (
    (row.race_temperature || 0) > 0 ||
    (row.race_water_temperature || 0) > 0 ||
    (row.race_wind || 0) > 0 ||
    (row.race_wave || 0) > 0 ||
    row.race_wind_direction_number != null
  );
}

// 2026-11-20: 展示 (racer_exhibition_time > 0) の艇数
function exhibitionCount(row) {
  const bs = row && row.boats;
  if (!bs) return 0;
  const arr = Array.isArray(bs) ? bs : Object.values(bs);
  let n = 0;
  for (const b of arr) if (b && (b.racer_exhibition_time || 0) > 0) n++;
  return n;
}

// 2026-11-27: この Worker が公式の直前情報ページから足す項目のうち、上流 (openapi) の行には無いもの。
//   上流の行に展示が入ると（展示の艇数が同じになると）上流の行を使うので、艇ごとに引き継がないと消える。
//   この日の本番: 11:10 に Worker が取っていた 33 レースが 11:25 にすべて上流の行に置き換わり、部品交換の記載
//   （「ギヤ」「リング×２」など 15 艇）が消えた。調整重量は、上流が展示の後に取った行の racer_weight_adjustment と
//   同じ値（置き換わった 33 レースの 198 艇すべて一致）。上流が展示の前に取った値とはまれに違うので（323 艇中 3 艇）、
//   展示の時に読んだ値として残す（アプリはこちらを優先して読む）。
const PREVIEW_BOAT_WORKER_FIELDS = ['racer_propeller', 'racer_parts_replaced', 'racer_adjust_weight'];
function carryWorkerBoatFields(row, old) {
  const nb = row && row.boats;
  const ob = old && old.boats;
  if (!nb || !ob || typeof nb !== 'object' || typeof ob !== 'object' || Array.isArray(nb) || Array.isArray(ob)) return;
  for (let n = 1; n <= 6; n++) {
    const a = nb[n];
    const b = ob[n];
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') continue;
    for (const f of PREVIEW_BOAT_WORKER_FIELDS) {
      if (a[f] == null && b[f] != null) a[f] = b[f];
    }
  }
}

// 2026-11-20: 同じ日の前回 KV のほうが展示を多く持つレースは、前回の艇データ・気象を引き継ぐ。
//   従来は上流 previews が壊れている時しか KV の展示を引き継がず、普段は openapi の previews（展示が
//   まだ無い / 欠けている）をそのまま base として KV に上書きしていた。直接スクレイプで足し直すのは
//   締切窓内の最大 20 レースだけなので、窓を過ぎたレースの展示は KV から消えたまま戻らず、アプリでは
//   「表示されていた展示が消える」（2026-11-20 鳴門）。
function carryRicherExhibitions(target, old) {
  if (!isValidPreviewsShape(target) || !isValidPreviewsShape(old)) return 0;
  normalizePreviewsDoc(old);
  const byKey = new Map();
  for (const r of old.previews) byKey.set(`${r.race_stadium_number}-${r.race_number}`, r);
  let carried = 0;
  for (const row of target.previews) {
    const o = byKey.get(`${row.race_stadium_number}-${row.race_number}`);
    if (!o || o.race_date !== row.race_date) continue;
    if (exhibitionCount(o) > exhibitionCount(row)) {
      row.boats = o.boats;
      for (const f of PREVIEW_WEATHER_FIELDS) {
        if (o[f] != null) row[f] = o[f];
      }
      carried++;
    } else {
      // 今回の行（上流）を使う。この Worker だけが持つ項目（プロペラ・部品交換・調整重量）は艇ごとに引き継ぐ
      carryWorkerBoatFields(row, o);
      if (hasPreviewWeather(o) && !hasPreviewWeather(row)) {
        // 2026-11-27: 展示の艇数が同じでも、前回読めた気象は引き継ぐ。上流の行に気象が入るのは遅れるので
        //   （下の parseBeforeinfoWeather の説明）、それまでは前回の値を残す。上流の行に気象があれば上流の値を使う。
        for (const f of PREVIEW_WEATHER_FIELDS) {
          if (o[f] != null) row[f] = o[f];
        }
      }
    }
  }
  return carried;
}

// rt-fix P1-6 (2026-06-04): KV write を「内容が変化した時のみ」に変更。
//   Cloudflare 無料枠 = 1000 writes/日。従来は毎 refresh で無条件 put し
//   948/日と上限に貼り付いていた → わずかな超過で put が throw → catch 握り潰し
//   → KV が古いまま /api/* が古いデータを 200 で返し続ける silent halt の主因。
//   data 部分（updated_at を除く）を前回値と比較し、同一なら put をスキップする。
//   これにより深夜帯など変化の少ない時間の write を大幅削減し、枠に余裕を作る。
// rt-fix2 (2026-06-11): 差分比較を「前回値の全文 get + JSON.parse + 再 stringify」
//   から「metadata のハッシュ比較」に変更。旧方式は MB 級 JSON の parse/stringify を
//   cron 1 回に 3 キー分実行し、無料プランの CPU 10ms/invocation を超過して
//   scheduled が途中 kill される（= cron 登録済みなのに KV が更新されない）リスクが
//   あった。新方式は新 data の stringify 1 回 + FNV-1a ハッシュのみ。
//   metadata には hash / wrote_at / src を載せ、/health が cron 生死を外形観測できる。
function _fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// 2026-11-20: KV 書込失敗の観測（isolate ローカル）。無料枠 (1,000 writes/日) を使い切ると put が失敗し、
//   heartbeat も止まって sentinel が「cron 死亡」と誤判定する。従来は heartbeat の put 失敗を握り潰しており、
//   枠切れと cron 停止を区別できなかった。/health の kv_put_failures で見えるようにする。
let _kvPutFailures = 0;
let _kvLastPutError = null;
function _noteKvPutFailure(e) {
  _kvPutFailures++;
  _kvLastPutError = { at: new Date().toISOString(), error: String(e && e.message ? e.message : e).slice(0, 120) };
}
// heartbeat の最短間隔。日中 5 分毎の cron で毎回書くと ~180 writes/日。sentinel の日中閾値 (1200s) に対し
//   9 分間隔でも最大 ~15 分で収まるので、半分に減らす（夜間 30 分 cron には影響しない）。
const HEARTBEAT_MIN_INTERVAL_MS = 9 * 60 * 1000;

// 2026-11-27: 中身が同じでも、この時間を過ぎたら時刻 (updated_at) だけ書き直す（文書ごとの間隔）。
//   serveFromKV は、文書の updated_at が SERVE_STALE_MS (12 分) より古いと「cron が書けていない」と見て
//   上流を取り直す。ところが kvWrite は中身が変わった時しか書かないので、cron が 5 分おきに動いていても、
//   展示や結果が 12 分出ない時間（昼の開催が終わる頃・夜の開催の合間・夜間）には文書が「古い」と判定され、
//   その経路が KV の展示を上流の素のデータで上書きしていた（serveFromKV の説明。2026-11-27 14:50 に 57 レース分が消えた）。
//   previews / results は 7 分にする: 中身が変わらない間は cron 2 回に 1 回（10 分おき）書くので、
//   cron が動いている限り 12 分を超えない（書いた時刻が run の中で 3 分遅れても、次の次の run で 7 分を超える）。
//   programs は従来どおり 30 分（古いと判定されても、取り直した中身が同じなので害が無い）。
const KV_TOUCH_MS_DEFAULT = 30 * 60 * 1000;
const KV_TOUCH_MS = {
  'previews:today': 7 * 60 * 1000,
  'results:today': 7 * 60 * 1000,
};

// 2026-11-27: KV の文書（{ updated_at, data }）を読む。「読めなかった」と「まだ無い」を区別する。
//   ok: false           = 読めなかった（KV の一時的な失敗）。中身が分からないので、呼ぶ側はこの文書に書かない。
//                         取り違えると、引き継ぎ（展示・確定結果）なしの中身で上書きして、その日に取ったデータを消す
//                         （push.js の kvRead と同じ考え方）。
//   ok: true, doc: null = まだ無い、または JSON として読めない中身（上書きしてよい）。
async function kvReadDoc(env, key) {
  let raw;
  try {
    raw = await env.BOATRACE_KV.get(key);
  } catch (e) {
    return { ok: false, doc: null, error: String(e && e.message ? e.message : e).slice(0, 100) };
  }
  if (!raw) return { ok: true, doc: null };
  try {
    const doc = JSON.parse(raw);
    return { ok: true, doc: doc && typeof doc === 'object' ? doc : null };
  } catch (_) {
    return { ok: true, doc: null };
  }
}

// KV の文書の updated_at が今日 (JST) のものか。読めない日時は「今日」として扱う（従来どおり、引き継ぐ側に倒す）。
function isSameJstDay(iso, nowMs) {
  try {
    return _jstDayIso(new Date(iso).getTime()) === _jstDayIso(nowMs);
  } catch (_) {
    return true;
  }
}

async function kvWrite(env, key, data, src) {
  const now = new Date().toISOString();
  const newBody = JSON.stringify(data);
  // 2026-07-19: ハッシュから top-level updated_at を除外 (regex 1 パス、再 stringify を
  //   避け CPU 節約)。合成 previews が毎 cron updated_at=now を刻むようになったため、
  //   本文ハッシュに含めると「実質不変なのに毎回 write」となり無料枠 (1000/日) を焼く。
  const newHash = _fnv1a(newBody.replace(/"updated_at":"[^"]*",?/, ''));
  let changed = true;
  try {
    // 本文は stream で受けて読まずに捨てる（metadata 比較のみ、CPU を消費しない）
    const prev = await env.BOATRACE_KV.getWithMetadata(key, { type: 'stream' });
    if (prev && prev.metadata && prev.metadata.hash === newHash) {
      changed = false;
      // 2026-07-19: 内容不変でも 30 分毎に stamp refresh。保存済み data.updated_at が
      //   serveFromKV の応答世代になるため、凍結すると鮮度 SLO が誤発報する
      //   (実害: [STALE] worker-previews)。+~48 writes/日/キーで枠内。
      // 2026-11-27: 間隔は文書ごと（KV_TOUCH_MS の説明）。previews / results は 7 分。
      const ageMs = Date.now() - new Date(prev.metadata.wrote_at || 0).getTime();
      if (!(ageMs < (KV_TOUCH_MS[key] || KV_TOUCH_MS_DEFAULT))) changed = true;
    }
    if (prev && prev.value && prev.value.cancel) prev.value.cancel().catch(() => {});
  } catch (_) {
    // 比較失敗時は安全側で書き込む
    changed = true;
  }
  const wrapped = { updated_at: now, data, _kv_skipped: !changed };
  if (changed) {
    try {
      await env.BOATRACE_KV.put(key, JSON.stringify({ updated_at: now, data }), {
        expirationTtl: 86400 * 2,
        metadata: { hash: newHash, wrote_at: now, src: src || 'cron' },
      });
    } catch (e) {
      _noteKvPutFailure(e);
      throw e;
    }
  }
  // 鮮度監視は各キーに保存済みの updated_at（serveFromKV が返す）+ metadata で行うため、
  // ここで別キーへ書き込む必要はない（write 枠を消費しない）。
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

// 2026-11-27: 直前情報ページの「水面気象情報」（気温・天候・風速・風向・水温・波高）。
//   上流 (openapi) の previews の気象は遅れて届く。2026-11-27 は 10:55 JST まで全 168 レースが空（展示・体重・気象とも）で、
//   11:10〜11:25 の間に、開催の始まっていた 9 場の全 12R 分が入った（最初の展示から約 3 時間後）。上流の値は
//   「上流が取りに行った時点の、その場の最新の計測値」で、展示前のレースにも同じ値が入る。
//   この Worker の展示の補完と GitHub Actions の取得は気象を読んでいなかったので、上流の気象が届くまでのレースは
//   アプリの気象欄が「風: --- 0m」のまま、風・波を使う採点も風速 0 で動いていた。展示を取る時に気象も読み、上流を待たずに
//   入れる（展示のために既に取っているページなので、追加の取得は無い）。上流の行に気象が入っていても、展示を取った時に
//   読めた気象（そのレースの締切前の計測値だと分かるもの）で置き換える。
//   （当初この説明は「上流の気象の欄には値が入らない」としていたが、朝 8:47〜9:27 の観測だけに基づく誤りだった。）
//   読めた項目だけを openapi と同じ名前で返す（数値が 1 つも読めなければ null）。
//   風向 (is-windN) は方位ではない: スタンドを下・1 マークを右に描いたコース図の上の矢印で、風の吹いていく
//   向きを表す。1 = 上向き（スタンド側 → バック側）から時計回りに 22.5° 刻み、17 = 無風。艇はホームストレッチを
//   左 → 右に走るので、5（右向き）が追い風、13（左向き）が向かい風。公式の画像 (icon_wind1_N.png) と、
//   2026-11-19 桐生・11-20 宮島の実測（方位の画像 is-directionN と合わせると、どちらも西風）で確かめた。
//   天候 (is-weatherN) も公式ページの番号そのまま。
function parseBeforeinfoWeather(html) {
  const src = String(html || '');
  const at = src.indexOf('weather1_body');
  if (at < 0) return null;
  const block = src.slice(at, at + 4000);
  const out = {};
  const num = (text) => {
    const m = /-?\d+(?:\.\d+)?/.exec(String(text || ''));
    return m ? parseFloat(m[0]) : null;
  };
  const pairRe = /weather1_bodyUnitLabelTitle"[^>]*>([^<]*)<\/span>\s*<span[^>]*weather1_bodyUnitLabelData"[^>]*>([^<]*)</g;
  const NAMES = { 気温: 'race_temperature', 風速: 'race_wind', 水温: 'race_water_temperature', 波高: 'race_wave' };
  let m;
  while ((m = pairRe.exec(block)) !== null) {
    const title = m[1].trim();
    // 表にある見出しだけ（'constructor' のような文字列で Object の既定の項目を拾わない）
    if (!Object.prototype.hasOwnProperty.call(NAMES, title)) continue;
    const v = num(m[2]);
    if (v != null) out[NAMES[title]] = v;
  }
  // 数値が 1 つも読めないページは計測前（展示前は欄が空白で、天候の画像だけ「不明」の番号が付く）
  if (!Object.keys(out).length) return null;
  const wx = /weather1_bodyUnitImage\s+is-weather(\d+)/.exec(block);
  if (wx) out.race_weather_number = parseInt(wx[1], 10);
  const wd = /weather1_bodyUnitImage\s+is-wind(\d+)/.exec(block);
  if (wd) out.race_wind_direction_number = parseInt(wd[1], 10);
  return out;
}

// 2026-11-27: 気象の欄の見出しは、その値がいつの計測かを示す。
//   「水面気象情報　11R時点」= 11R の時点の計測値（過去日のページでも変わらない）
//   「水面気象情報　7:45現在」= その時刻の計測値
//   「水面気象情報　&nbsp;」  = まだ計測値が無い（展示前）
function parseWeatherAsOf(html) {
  const m = /weather1_title"[^>]*>([^<]*)</.exec(String(html || ''));
  if (!m) return null;
  const r = /(\d{1,2})\s*R\s*時点/.exec(m[1]);
  if (r) return { race: parseInt(r[1], 10) };
  const c = /(\d{1,2})\s*[:：]\s*(\d{2})\s*現在/.exec(m[1]);
  if (c) return { minutes: parseInt(c[1], 10) * 60 + parseInt(c[2], 10) };
  return null;
}

// 「現在」の計測値を、そのレースの締切前の気象として使う範囲（締切の何分前から・何分後まで）
const WEATHER_CLOCK_BEFORE_MIN = 180;
const WEATHER_CLOCK_AFTER_MIN = 10;

// その気象を「rno レースの締切前の気象」として使えるか。
//   R時点: それより前のレースの時点の値なら使える。
//   現在:  締切の 3 時間前 〜 10 分後に計測された値だけ使う（締切時刻が分からなければ使わない）。
//          1R のページは、後から開くとその時点の「現在」の値を出す。過去日なら、その日の最後の計測値になる
//          （2026-11-19 桐生 1R = 締切 15 時台のページが、後日は「20:34現在」= 12R の時点の値）。
//   見出しが読めない時は使わない（いつの値か分からないものを入れない）。
function weatherFitsRace(asOf, rno, closeMin) {
  if (!asOf) return false;
  if (asOf.race != null) return asOf.race >= 1 && asOf.race < rno;
  if (asOf.minutes == null || closeMin == null) return false;
  return asOf.minutes >= closeMin - WEATHER_CLOCK_BEFORE_MIN && asOf.minutes <= closeMin + WEATHER_CLOCK_AFTER_MIN;
}

// 締切時刻 "YYYY-MM-DD HH:MM:SS" (JST) → その日の 0 時からの分（読めなければ null）
function closeMinutesOf(closedAtStr) {
  const m = /^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}):\d{2}$/.exec(String(closedAtStr || ''));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// 読めた気象の項目を previews の 1 レースに書く（読めなかった項目は元の値のまま）
function applyBeforeinfoWeather(row, weather) {
  if (!row || !weather) return;
  for (const f of PREVIEW_WEATHER_FIELDS) {
    if (weather[f] != null) row[f] = weather[f];
  }
}

// 1 レースの直前情報。{ boats: 展示（艇番 → 値。展示前は null）, weather: 気象（使える値が無ければ null）}
//   closeMin = そのレースの締切時刻（0 時からの分）。分からなければ null（「現在」の計測値は使わない）。
async function scrapeBeforeinfoFull(sid, rno, hd, closeMin) {
  const jcd = String(sid).padStart(2, '0');
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${rno}&jcd=${jcd}&hd=${hd}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-worker/1.1' },
    cf: { cacheTtl: 20, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`beforeinfo ${res.status}: stadium=${sid} race=${rno}`);
  const html = await res.text();
  const boats = parseBeforeinfoHTML(html);
  // 気象は、展示が出ていて、そのレースの締切前の計測値だと分かる時だけ使う
  const fits = !!boats && weatherFitsRace(parseWeatherAsOf(html), rno, closeMin == null ? null : closeMin);
  return { boats, weather: fits ? parseBeforeinfoWeather(html) : null };
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

// レース終了後ウィンドウ判定: 締切後 N 分 〜 締切 + 6 時間 (D5a: 2h→6h 拡張)
// 締切時刻直後にレース開始 → 数分でレース終了 → 結果ページ生成
// D5a: window を 6h に拡張することで、深夜終了 SG/G1 ナイターで openapi mirror
//   の反映が遅れたケースも翌朝までスクレイプ補完可能。
//   既に openapi が finished のレースは scrapeTargets から除外されるので過剰
//   スクレイプは発生しない。
function isInResultWindow(closedAtStr, nowMs) {
  if (!closedAtStr) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(closedAtStr);
  if (!m) return false;
  const closeJstMs = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4]-9, +m[5], +m[6]);
  // 締切 +3分（レース開始〜終了）〜 +360分（6h、深夜帯 openapi 遅延吸収）
  const startMs = closeJstMs + 3 * 60_000;
  const endMs   = closeJstMs + 360 * 60_000;
  return nowMs >= startMs && nowMs <= endMs;
}

// 全角数字 → 半角数字 ("１" → 1)
function toHalfWidthInt(s) {
  if (s == null) return NaN;
  const half = String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  return parseInt(half);
}

// boatrace.jp /owpc/pc/race/raceresult ページを直接 scrape して結果取得
//   着順構造: 各順位が独立 <tbody> (1 tbody=1 tr)、tds[0]=着順 (全角数字),
//             tds[1]=艇番, tds[2]=選手名, tds[3]=タイム
//   払戻構造: <tbody> 内に複数 <tr>、ヘッダ <th> でジャンル ("3連単" 等)、tds[0]=combo, tds[1]=金額
// 2026-11-20: 決まり手・進入コース・ST・登録番号を読む（scripts/scrape_results.py と同じ）。
//   従来は決まり手を常に 1 (逃げ)、進入 = 枠番、登録番号と ST は null にしており、アプリの結果表示と
//   決まり手の集計がすべて「逃げ」になっていた。
const TECHNIQUE_NUM = { '逃げ': 1, '差し': 2, 'まくり': 3, 'まくり差し': 4, '抜き': 5, '恵まれ': 6 };
function parseStTiming(text) {
  const t = String(text || '').replace(/\s+/g, '');
  const m = /^([FL]?)(\d?\.\d+)/.exec(t);
  if (m) return { st: m[1] === 'F' ? -parseFloat(m[2]) : parseFloat(m[2]), kind: m[1] || null };
  if (t[0] === 'L' || t[0] === 'F') return { st: null, kind: t[0] };
  return { st: null, kind: null };
}
function applyStartInfoAndTechnique(html, out) {
  const i = html.indexOf('スタート情報');
  if (i >= 0) {
    const sec = html.slice(i, html.indexOf('</table>', i) + 1 || undefined);
    const re = /table1_boatImage1Number[^>]*>\s*(\d)\s*<[\s\S]*?table1_boatImage1TimeInner[^>]*>([\s\S]*?)<\/span>/g;
    const byBoat = {};
    for (const b of out.boats) byBoat[b.racer_boat_number] = b;
    let m;
    let course = 0;
    while ((m = re.exec(sec)) !== null) {
      course++;
      const b = byBoat[parseInt(m[1], 10)];
      if (!b) continue;
      const { st, kind } = parseStTiming(stripTags(m[2]));
      b.racer_course_number = course;
      b.racer_start_timing = st;
      if (kind) b.racer_start_kind = kind;
    }
  }
  const k = /決まり手[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/.exec(html);
  if (k) {
    const name = stripTags(k[1]).replace(/\s+/g, '');
    if (name) out.race_technique_name = name;
  }
}

function parseRaceresultHTML(html, stadium, raceNum, raceDate) {
  const out = {
    race_stadium_number: stadium,
    race_number: raceNum,
    race_date: raceDate,
    race_technique_number: null,
    boats: [],
    payouts: { trifecta:[], trio:[], exacta:[], quinella:[], quinella_place:[], win:[], place:[] },
  };
  // 2026-11-20: 中止のレースは「レース中止」の見出しだけが出る（scrape_results.py と同じ判定）
  if (/title12_title[^>]*>\s*レース中止/.test(html)) {
    out.race_cancelled = true;
    return out;
  }
  // 全 tbody を抽出して、各 tbody 内の最初の tr で 着順 + 艇番 が取れるなら採用
  const tbodyRe = /<tbody[^>]*>([\s\S]*?)<\/tbody>/g;
  const tbodies = [];
  let tm;
  while ((tm = tbodyRe.exec(html)) !== null) tbodies.push(tm[1]);

  const placesSeen = new Set();
  const boatsSeen = new Set();
  for (const tbody of tbodies) {
    const trM = /<tr[^>]*>([\s\S]*?)<\/tr>/.exec(tbody);
    if (!trM) continue;
    const tr = trM[1];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const tds = [];
    let mm;
    while ((mm = tdRe.exec(tr)) !== null) tds.push(stripTags(mm[1]));
    if (tds.length < 2) continue;
    const place = toHalfWidthInt(tds[0]);
    const boatNum = toHalfWidthInt(tds[1]);
    if (!(place >= 1 && place <= 6) || !(boatNum >= 1 && boatNum <= 6)) continue;
    if (placesSeen.has(place)) continue;   // 同 place 重複防止
    if (boatsSeen.has(boatNum)) continue;  // 2026-05-24: 同 boat の重複も防止
                                            //  (payouts / 技術 tbody を誤認すると同艇が
                                            //   複数 place に出現する事故 — 常滑 7R 実例)
    placesSeen.add(place);
    boatsSeen.add(boatNum);
    let name = tds.length > 2 ? tds[2] : '';
    // selOr 内 span にレーサー番号 "4199" 等が含まれる。2026-11-20: 番号は捨てずに登録番号として使う
    const rid = /\d{4,5}/.exec(name);
    name = name.replace(/\s*\d{4,5}\s*/, '').trim();
    out.boats.push({
      racer_boat_number: boatNum,
      racer_place_number: place,
      racer_course_number: boatNum,   // スタート情報で上書き (applyStartInfoAndTechnique)
      racer_name: name,
      racer_start_timing: null,
      racer_number: rid ? parseInt(rid[0], 10) : null,
    });
    if (placesSeen.size >= 6) break;
  }

  // 2026-05-24 (致命): parse sanity check。
  //   レース完走判定 (race_technique_number=1) は以下を満たす場合のみ:
  //   - boats.length >= 3 (上位 3 着まで取得済)
  //   - place=1 (1着) が含まれる (技術タイプ "逃げ" 等は 1着必須)
  //   満たさない場合は parse 失敗扱い (race_technique_number=null) で、
  //   Worker は KV に書かない / openapi の最新を待つ。
  //   これにより常滑 7R で観測された「2着 5, 3着 5, 1着 欠落」のような
  //   garbage data が KV に居座る事故を防止。
  const hasFirstPlace = out.boats.some(b => b.racer_place_number === 1);
  if (out.boats.length >= 3 && hasFirstPlace) {
    applyStartInfoAndTechnique(html, out);
    // race_technique_number は「確定」の目印も兼ねる。決まり手が読めない確定レースは 1 + technique_unknown
    const tech = TECHNIQUE_NUM[out.race_technique_name || ''];
    out.race_technique_number = tech || 1;
    if (!tech) out.technique_unknown = true;
  } else {
    // parse 不完全 → 結果未確定扱い、書き込まない
    out.race_technique_number = null;
    if (out.boats.length > 0) {
      // diag フィールド (KV には保存されないが Worker log で原因追跡)
      out._parse_partial = { boats: out.boats.length, places: Array.from(placesSeen) };
    }
  }

  // 払戻テーブル (2026-07-19 markup 変更対応):
  //   旧: <tr><th>3連単</th><td>組番</td><td>金額</td></tr>
  //   新: <tr><td rowspan="2">3連単</td><td><div class="numberSet1">組番spans</div></td>
  //        <td><span class="is-payout1">&yen;1,180</span></td><td>人気</td></tr>
  //   券種ラベルが th→td になり旧パーサは全滅 (openapi ミラーに載る場は base で
  //   隠れ、ミラー欠落場だけ「着順のみ・払戻なし」が露呈する実障害)。
  //   th/td どちらでも「先頭セルが券種名ならラベル行」と解釈し、rowspan 継続行
  //   (同着) は直前ラベルを引き継ぐ。
  const PAYOUT_LABELS = {
    '3連単': 'trifecta', '3連複': 'trio', '2連単': 'exacta',
    '2連複': 'quinella', '拡連複': 'quinella_place', '単勝': 'win', '複勝': 'place',
  };
  for (const tbody of tbodies) {
    if (tbody.indexOf('払戻') < 0 && tbody.indexOf('配当') < 0
        && tbody.indexOf('連単') < 0 && tbody.indexOf('連複') < 0
        && tbody.indexOf('単勝') < 0 && tbody.indexOf('複勝') < 0) continue;
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let trM;
    let currentKey = null;   // rowspan 継続行 (同着) 用
    while ((trM = trRe.exec(tbody)) !== null) {
      const tr = trM[1];
      const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/g;
      const cells = [];
      let mm;
      while ((mm = cellRe.exec(tr)) !== null) cells.push(stripTags(mm[2]));
      if (!cells.length) continue;
      let combo, amountTxt;
      const first = cells[0].replace(/\s+/g, '');
      if (PAYOUT_LABELS[first]) {
        currentKey = PAYOUT_LABELS[first];
        combo = cells[1]; amountTxt = cells[2];
      } else {
        // ラベル無し行: rowspan 継続 (同着の 2 本目) or 空行
        combo = cells[0]; amountTxt = cells[1];
      }
      if (!currentKey || combo == null || amountTxt == null) continue;
      combo = combo.replace(/\s+/g, '');   // "1 - 3 - 5" → "1-3-5"
      if (!/\d/.test(combo)) continue;      // &nbsp; 埋め草行を除外
      const amountM = /\d[\d,]*/.exec(String(amountTxt).replace(/[¥\s]|&yen;|円/g, ''));
      if (!amountM) continue;
      const amount = parseInt(amountM[0].replace(/,/g, ''));
      if (!(amount > 0)) continue;
      out.payouts[currentKey].push({ combination: combo, amount: amount });
    }
  }
  return out;
}

async function scrapeRaceresult(sid, rno, hd, raceDate) {
  const jcd = String(sid).padStart(2, '0');
  const url = `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${rno}&jcd=${jcd}&hd=${hd}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-worker/1.2' },
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`raceresult ${res.status}: stadium=${sid} race=${rno}`);
  const html = await res.text();
  return parseRaceresultHTML(html, sid, rno, raceDate);
}

// 終了済かつ openapi が race_technique_number=null のレースを scrape
async function mergeBoatraceJpResults(programs, results, nowMs, maxScrapes = MAX_HTML_SCRAPES_PER_RUN) {
  // 2026-05-24 fix2: openapi の results entry には race_closed_at が無いため、
  //   旧コードの sort `a.rPtr?.race_closed_at` は常に undefined < undefined === false
  //   で **sort が事実上 noop** (FIFO が機能していなかった)。programs から取った
  //   race_closed_at を target に直接 attach して sort する。
  const scrapeTargets = [];
  for (const p of (programs.programs || [])) {
    const sid = p.race_stadium_number, rno = p.race_number;
    if (!isInResultWindow(p.race_closed_at, nowMs)) continue;
    const hd = String(p.race_date || '').replace(/-/g, '');
    if (!hd) continue;
    // 該当 result entry を確認
    const r = (results.results || []).find(x =>
      x.race_stadium_number === sid && x.race_number === rno
    );
    // 2026-05-24: 完了判定を厳格化。
    //   - race_technique_number が set されている (= 着順は取得済)
    //   - **かつ** 3 連単 payout が取得済 (= 払戻も取得済)
    //   この両方が揃って初めて scrape skip。着順だけで payout 空のレースは
    //   再 scrape 対象 (「3連単的中だが払戻未取得」の警告解消)。
    const hasTechnique = r && r.race_technique_number != null;
    const hasPayouts = r && r.payouts
      && Array.isArray(r.payouts.trifecta) && r.payouts.trifecta.length > 0;
    if ((hasTechnique && hasPayouts) || (r && r.race_cancelled)) continue;
    scrapeTargets.push({ sid, rno, hd, raceDate: p.race_date, rPtr: r, closedAt: p.race_closed_at });
  }
  // FIFO (古い順): 古いレースほど結果が確定している確率が高く + backlog drain 保証
  scrapeTargets.sort((a, b) => {
    const ca = a.closedAt || '';
    const cb = b.closedAt || '';
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return 0;
  });
  const picks = scrapeTargets.slice(0, maxScrapes);
  let mergedCount = 0;
  const settled = await Promise.allSettled(
    picks.map(t => scrapeRaceresult(t.sid, t.rno, t.hd, t.raceDate).then(parsed => ({ t, parsed })))
  );
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !r.value.parsed) continue;
    const { t, parsed } = r.value;
    if (parsed.race_technique_number == null && !parsed.race_cancelled) continue;   // 結果ページがまだ無い
    if (t.rPtr) {
      // 上流 results 配列内のエントリをマージで上書き
      // 2026-05-24 (致命): payouts を smart merge する。
      //   Object.assign(t.rPtr, parsed) は parsed.payouts (empty arrays) で
      //   openapi の payouts を上書きしていた → 「3連単的中だが払戻未取得」
      //   の警告が大量発生していた (常滑/多摩川 等)。
      //   payouts は Worker 側 parse が空でない種別のみ更新、空なら openapi
      //   保持。
      const rPtr = t.rPtr;
      const oldPayouts = rPtr.payouts || {};
      Object.assign(rPtr, parsed);
      if (parsed.payouts && oldPayouts) {
        const mergedPayouts = {};
        const types = ['trifecta','trio','exacta','quinella','quinella_place','win','place'];
        for (const k of types) {
          const newArr = parsed.payouts[k];
          const oldArr = oldPayouts[k];
          // Worker parse が値ありならそれを採用、empty なら openapi 残存値を優先
          if (Array.isArray(newArr) && newArr.length > 0) {
            mergedPayouts[k] = newArr;
          } else if (Array.isArray(oldArr) && oldArr.length > 0) {
            mergedPayouts[k] = oldArr;
          } else {
            mergedPayouts[k] = newArr || [];
          }
        }
        rPtr.payouts = mergedPayouts;
      }
    } else {
      // results 配列に追加
      (results.results || (results.results = [])).push(parsed);
    }
    mergedCount++;
  }
  return { targets: scrapeTargets.length, scraped: picks.length, merged: mergedCount };
}

// 展示窓内かつ openapi が boats 空のレースを抽出し、boatrace.jp 直スクレイプ
//   maxScrapes: 1 invocation で許す HTML スクレイプ上限。cron は MAX_HTML_SCRAPES_PER_RUN(20)、
//   オンデマンド (serveFromKV 経由) は MAX_ONDEMAND_SCRAPES(3) を渡して CPU を厳格に抑える。
async function mergeBoatraceJpExhibition(programs, previews, nowMs, maxScrapes = MAX_HTML_SCRAPES_PER_RUN) {
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
    // 呼ぶ側がそろえていない文書（古い形の KV を読んだ場合など）でも、艇番どおりに書けるようにする
    pv.boats = normalizePreviewBoats(pv.boats);
    const boats = pv.boats;
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
  const picks = scrapeTargets.slice(0, maxScrapes);

  let mergedCount = 0;
  let weatherCount = 0;
  // 並列 fetch (Cloudflare のサブリクエスト最大 50 件以内)
  const results = await Promise.allSettled(
    picks.map(t =>
      scrapeBeforeinfoFull(t.sid, t.rno, t.hd, closeMinutesOf(progByKey.get(`${t.sid}-${t.rno}`).race_closed_at))
        .then(got => ({ t, got }))
    )
  );
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.got || !r.value.got.boats) continue;
    const { t, got } = r.value;
    const boats = got.boats;
    // pv.boats に注入 (openapi 形式に変換)。pv.boats は艇番をキーにした形（上でそろえた）
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
    applyBeforeinfoWeather(t.pv, got.weather);
    if (got.weather) weatherCount++;
    mergedCount++;
  }
  // weather = 展示と一緒に気象も入れられたレース数（0 が続く時は、公式ページの気象の欄の形が変わった可能性）
  return { targets: scrapeTargets.length, scraped: picks.length, merged: mergedCount, weather: weatherCount };
}

// -----------------------------------------------------------------------
// 2026-05-24 (致命バグ修正): KV に保存された "finished" 結果を openapi が
//   巻き戻すのを防ぐ。openapi は時々古いスナップショットを返したり、
//   一時的に race_technique_number=null に戻ったり、レース entry 自体が
//   消えたりする。Worker が素朴に openapi で KV を上書きすると、UI 側で
//   「9/12R → 5/12R」のように完了レースが減ってしまう。
//
// ルール: KV の race_technique_number が non-null (= 結果確定済) なら、
//   openapi が同じレースで null や 不在 を返しても KV 版を保持。
//   openapi が NEW 情報 (KV に無いレース、または KV では null だが
//   openapi で finished) を持っていれば取り込む。
// -----------------------------------------------------------------------
function mergeKVOverOpenapi(openapiResults, kvResults) {
  if (!kvResults || !Array.isArray(kvResults.results)) return openapiResults;
  if (!openapiResults || !Array.isArray(openapiResults.results)) {
    // openapi が空 / 壊れ → KV のままを返す
    return kvResults;
  }
  // openapi の races を key 化
  const openapiByKey = new Map();
  for (const r of openapiResults.results) {
    if (!r || r.race_stadium_number == null || r.race_number == null) continue;
    openapiByKey.set(`${r.race_stadium_number}-${r.race_number}`, r);
  }
  // 2026-11-27: 日付の違う行は重ねない（前日の確定結果・中止を、今日の同じ場・同じ R に出さない）。
  //   呼ぶ側は KV の文書の updated_at で「同じ日か」を見ているが、文書は夜間も時刻だけ書き直されるので、
  //   日付が変わった後は前日の中身でも「今日の文書」に見える。行ごとの race_date でも確かめる
  //   （どちらかに日付が無ければ従来どおり重ねる）。
  const openDate = (openapiResults.results.find((r) => r && r.race_date) || {}).race_date || null;
  // KV の finished entries を openapi 側に上書き / 追加
  let preserved = 0, added = 0, rejected = 0;
  for (const kvr of kvResults.results) {
    if (!kvr || kvr.race_stadium_number == null || kvr.race_number == null) continue;
    if (openDate && kvr.race_date && kvr.race_date !== openDate) {
      rejected++;
      continue;
    }
    // 2026-11-20: 「レース中止」も保持する。捨てると毎 run 中止レースを取り直し、1 run 12 件の取り直し枠を
    //   中止レースが食い潰して他場の中止・結果の判定が回ってこなかった（11/20: 津 10R 分で戸田 3R 以降が未判定）。
    if (kvr.race_cancelled && kvr.race_technique_number == null) {
      const ckey = `${kvr.race_stadium_number}-${kvr.race_number}`;
      const copen = openapiByKey.get(ckey);
      if (copen) {
        if (copen.race_technique_number == null && !copen.race_cancelled) {
          copen.race_cancelled = true;
          preserved++;
        }
      } else {
        openapiResults.results.push(kvr);
        added++;
      }
      continue;
    }
    if (kvr.race_technique_number == null) continue; // unfinished は無視
    // 2026-05-24: KV に bogus データ (重複艇 / 1着欠落 / boats < 3) が
    //   居座っていた場合は preserve しない (常滑 7R で観測された事故対策)。
    if (!_isValidResult(kvr)) {
      rejected++;
      continue;
    }
    const key = `${kvr.race_stadium_number}-${kvr.race_number}`;
    const open = openapiByKey.get(key);
    if (open) {
      // openapi にも entry あり: KV が finished で openapi が unfinished なら KV 優先
      if (open.race_technique_number == null) {
        Object.assign(open, kvr);
        preserved++;
      }
      // openapi も finished の場合は openapi 側を尊重 (より新しい上流データ)
    } else {
      // openapi に entry 無し: KV の finished を保持
      openapiResults.results.push(kvr);
      added++;
    }
  }
  openapiResults._kv_merge = { preserved, added, rejected };
  return openapiResults;
}

// 2026-05-24: result entry が valid か判定 (sanity check)
//   - boats.length >= 3
//   - 1着が含まれる
//   - 艇番に重複が無い
function _isValidResult(r) {
  if (!r || !Array.isArray(r.boats)) return false;
  if (r.boats.length < 3) return false;
  let hasFirst = false;
  const seen = new Set();
  for (const b of r.boats) {
    if (!b) continue;
    if (b.racer_place_number === 1) hasFirst = true;
    if (b.racer_boat_number != null) {
      if (seen.has(b.racer_boat_number)) return false; // 重複艇
      seen.add(b.racer_boat_number);
    }
  }
  return hasFirst;
}

// -----------------------------------------------------------------------
// Cron で呼ばれる。openapi + boatrace.jp 直スクレイプを統合して KV に格納
// -----------------------------------------------------------------------
// opts.onBaseWritten: base (upstream) データの KV 書込が終わった直後に呼ばれる (2026-09-06)。
//   scheduled() はここで heartbeat を書く = 「cron が発火し base データを配信した」証跡。
//   以前は heartbeat が全処理の最後だったため、重い HTML スクレイプで kill されると
//   base 書込ごと失われ、cron が「発火していない」ように見えていた。
async function refreshAll(env, opts) {
  const out = {};
  let previews = null, programs = null, results = null;
  try { previews = await fetchPreviewsBase(); out.previews = { ok: true }; }
  catch (e) { out.previews = { ok: false, error: String(e).slice(0,200) }; }
  try { programs = await fetchProgramsBase(); out.programs = { ok: true }; }
  catch (e) { out.programs = { ok: false, error: String(e).slice(0,200) }; }
  try { results  = await fetchUpstream(UPSTREAM.results);  out.results  = { ok: true }; }
  catch (e) { out.results  = { ok: false, error: String(e).slice(0,200) }; }

  // 2026-07-17: 上流 previews が壊れた形 (previews キー欠落) / 取得失敗なら programs から合成し、
  //   既存 KV の展示・気象を温存する。壊れた base の KV 書込・配信を止める。
  // 2026-11-27: 前回の KV から引き継げなかった文書（KV を読めなかった / 引き継ぎの途中で例外）には、
  //   この回は書かない。従来はそのまま上流の base を書いていたので、KV の読取が 1 回失敗しただけで、
  //   その日に取った展示（締切窓を過ぎたレースは取り直せない）と、上流にまだ無い確定結果が消える形だった。
  //   書かない回のスクレイプも行わない（取っても置けない）。次の回（5 分後）に読めれば元どおり続く。
  let pvSafe = true;
  let rsSafe = true;
  const invalidPreviews = !isValidPreviewsShape(previews);
  if (invalidPreviews && programs) {
    out.previews.invalid_shape = !!previews;
    previews = synthesizePreviewsFromPrograms(programs);
  }
  // 2026-11-20: 正常な上流 previews でも、前回 KV のほうが展示を多く持つレースは引き継ぐ
  //   （carryRicherExhibitions の説明を参照）。合成 previews は boats が空なので、前回の艇データをそのまま引き継ぐ。
  if (env.BOATRACE_KV && isValidPreviewsShape(previews)) {
    try {
      const kvPv = await kvReadDoc(env, KV_KEYS.previews);
      if (!kvPv.ok) throw new Error('kv read: ' + kvPv.error);
      const oldPv = kvPv.doc && kvPv.doc.data ? kvPv.doc.data : null;
      if (oldPv && invalidPreviews) mergePreviewsBoatsFrom(previews, oldPv);
      else if (oldPv) out.previews.kv_carried = carryRicherExhibitions(previews, oldPv);
    } catch (e) {
      pvSafe = false;
      out.previews.kv_carry_err = String(e && e.message ? e.message : e).slice(0, 100);
    }
  }

  // 2026-05-24: openapi 巻き戻り対策 — KV に既存 finished があれば preserve
  if (env.BOATRACE_KV && results) {
    try {
      const kvRs = await kvReadDoc(env, KV_KEYS.results);
      if (!kvRs.ok) throw new Error('kv read: ' + kvRs.error);
      if (kvRs.doc && kvRs.doc.data) {
        // 日跨ぎ判定: KV の updated_at が昨日 (JST) なら preserve しない
        //   (前日 results を本日 results にマージしてしまう事故防止)
        if (isSameJstDay(kvRs.doc.updated_at, Date.now())) {
          results = mergeKVOverOpenapi(results, kvRs.doc.data);
          out.results.kv_preserved = results._kv_merge || null;
        } else {
          out.results.kv_skip = 'day_change';
        }
      }
    } catch (e) {
      rsSafe = false;
      out.results.kv_merge_err = String(e && e.message ? e.message : e).slice(0, 100);
    }
  }

  // 2026-05-24: 内部診断フィールド _kv_merge を KV/レスポンスから除外
  if (results && results._kv_merge) delete results._kv_merge;

  // ---------------------------------------------------------------------------
  // 2026-09-06 base-first 書込 (Phase 1)
  //   upstream 取得 + KV carry merge が終わった時点で、まず KV に書く。
  //   従来は「展示 20 + 結果 20 の HTML スクレイプ → 最後に KV 書込」で、日中の重い run が
  //   CPU/実行時間の上限で途中 kill されると **KV も heartbeat も何も残らなかった**
  //   (実障害 9/6: heartbeat は夜間の軽い run でしか進まず、日中は keys が src=ondemand のまま)。
  //   kvWrite は内容ハッシュが変わった時だけ put するので、書込枠の増分は
  //   「base が変わった時 (openapi の ~30 分 cadence)」に限られ、無料枠 1000/日 に収まる。
  // ---------------------------------------------------------------------------
  const kvAvail = !!env.BOATRACE_KV;
  // 2026-11-27: 引き継げなかった文書（上の pvSafe / rsSafe）と、形の壊れた previews は書かない
  const unsafe = { previews: !pvSafe || !isValidPreviewsShape(previews), results: !rsSafe };
  async function writeKey(kind, data, tag) {
    if (!kvAvail || !data) return;
    if (unsafe[kind]) { out[kind].kv_write_skipped = true; return; }
    try { await kvWrite(env, KV_KEYS[kind], data); out[kind][tag] = true; }
    catch (e) { out[kind][tag + '_err'] = String(e).slice(0, 100); }
  }
  await writeKey('previews', previews, 'kv_base_ok');
  await writeKey('programs', programs, 'kv_base_ok');
  await writeKey('results',  results,  'kv_base_ok');
  if (opts && typeof opts.onBaseWritten === 'function') {
    try { await opts.onBaseWritten(out); } catch (e) { out.on_base_written_err = String(e).slice(0, 100); }
  }
  // 2026-11-27: 締切前通知 (Web Push) 用の索引。番組表から締切時刻と出場選手だけを抜き出して KV に置く
  //   （毎分の確認は 600KB の番組表を読めない）。中身が変わった時だけ書く。base と heartbeat の後ろ。
  if (kvAvail && programs) {
    try { out.push_index = await writePushIndex(env, programs); }
    catch (e) { out.push_index = { error: String(e).slice(0, 100) }; }
  }

  // ---------------------------------------------------------------------------
  // Phase 2: boatrace.jp 直スクレイプで補完 (重い処理は base 書込の後ろへ)
  //   途中で kill されても Phase 1 の base は既に配信されている。
  // ---------------------------------------------------------------------------
  const nowMs = Date.now();
  let exMerged = 0, rsMerged = 0;
  // 展示データを補完（この回 previews を書けない時は取りに行かない: 取っても置けない）
  if (previews && programs && !unsafe.previews) {
    try {
      const mergeStats = await mergeBoatraceJpExhibition(programs, previews, nowMs);
      out.exhibition_scrape = mergeStats;
      exMerged = (mergeStats && mergeStats.merged) || 0;
    } catch (e) {
      out.exhibition_scrape = { error: String(e).slice(0,200) };
    }
  }
  // C6: 結果データを補完
  if (results && programs && !unsafe.results) {
    try {
      const mergeStats = await mergeBoatraceJpResults(programs, results, nowMs);
      out.result_scrape = mergeStats;
      rsMerged = (mergeStats && mergeStats.merged) || 0;
    } catch (e) {
      out.result_scrape = { error: String(e).slice(0,200) };
    }
  }

  // Phase 3: スクレイプで実際に増えた分だけ書き直す (programs はスクレイプで変わらない)。
  //   kvWrite のハッシュ比較で二重 put は起きないが、無変化なら呼出自体を省く。
  if (exMerged > 0) await writeKey('previews', previews, 'kv_ok');
  if (results && results._kv_merge) delete results._kv_merge;
  if (rsMerged > 0) await writeKey('results', results, 'kv_ok');
  return out;
}

// rt-fix (2026-06-04): silent-halt 対策の中核。
//   旧版は「KV にデータがあれば、それが何時間古くても無条件で返す」ため、
//   cron / KV write が失敗 (例: 無料枠 1000 writes/日 の枯渇) すると
//   /api/* が古い KV を 200 で返し続け、クライアントが永久に stale 表示になった。
//   新版は KV の updated_at を見て、STALE_MS より古ければ上流 openapi を
//   live fetch (Cloudflare edge cache 経由 = KV write 枠を一切消費しない) して
//   fresh を返す。これにより KV write が完全に止まっても /api/* は fresh を返す。
// =============================================================================
// 2026-09-06: cron 死亡時のサーブ時セルフヒール (serve-heal)
//
// 実障害: 9/5 22:36 JST に scheduled() が止まった (health:heartbeat が更新されず、
//   watchdog が reason=cron_heartbeat_stale)。Worker 自体は応答し /api/refresh-now も
//   通るのに、cron だけが死んでいた。この状態では
//     - KV は SERVE_STALE_MS (12 分) を超えて初めて key 単位の live fetch + bounded
//       scrape の縮退モードに入る (展示マージは「少数」だけ)
//     - watchdog は GitHub schedule の間引きで 1 日数回しか走らない
//     - アプリの自己復旧 (/api/refresh-now) は「データ世代 25 分 stale」が発火条件
//   となり、体感は「結果・展示の更新が 15-30 分遅れる」に落ちる。
//
// 対策: /api/* を叩く通常のアプリ通信 (90 秒 poll) を cron の代替トリガにする。
//   heartbeat が閾値より古い時だけ、refresh-now と同じ 5 分 throttle
//   (isolate ローカル + Cache API) の下で refreshAll() を waitUntil で走らせる。
//   cron が生きている間は一切動かない (閾値未満で即 return)。
//   heartbeat は **書かない**: heartbeat は cron の生存証跡であり、watchdog の
//   検知 → deploy-worker dispatch による cron 再登録を妨げないため。
// =============================================================================
const CRON_DEAD_MS_DAY = 15 * 60 * 1000;   // JST 08-22: cron 5 分間隔 → 3 tick 欠落で死亡扱い
const CRON_DEAD_MS_NIGHT = 45 * 60 * 1000; // JST 23-07: cron 30 分間隔
const HB_CHECK_INTERVAL_MS = 60 * 1000;    // isolate 毎の heartbeat 再読込間隔 (KV read 節約)
let _hbCheckedAt = 0;
let _hbValueMs = 0;
let _lastServeHealAt = 0;

function _cronDeadThresholdMs(nowMs) {
  const jstHour = new Date(nowMs + 9 * 3600000).getUTCHours();
  return jstHour >= 8 && jstHour <= 22 ? CRON_DEAD_MS_DAY : CRON_DEAD_MS_NIGHT;
}

async function _healIfCronDead(env, ctx) {
  if (!env || !env.BOATRACE_KV || !ctx || typeof ctx.waitUntil !== 'function') return false;
  const now = Date.now();
  if (now - _hbCheckedAt >= HB_CHECK_INTERVAL_MS) {
    _hbCheckedAt = now;
    try {
      const hb = await env.BOATRACE_KV.get('health:heartbeat');
      _hbValueMs = hb ? new Date(hb).getTime() : 0;
    } catch (_) {
      return false;
    }
  }
  if (!_hbValueMs) return false; // heartbeat 未生成 (旧 Worker / 未実行) は watchdog に任せる
  const ageMs = now - _hbValueMs;
  if (ageMs < _cronDeadThresholdMs(now)) return false;
  if ((await _refreshThrottleRemainingSec()) != null) return false;
  await _markRefreshDone();
  _lastServeHealAt = now;
  console.warn(`[serve-heal] cron heartbeat stale ${Math.round(ageMs / 1000)}s → refreshAll`);
  ctx.waitUntil(
    refreshAll(env).catch((e) => console.error('[serve-heal] refreshAll failed:', e))
  );
  return true;
}

const SERVE_STALE_MS = 12 * 60 * 1000; // KV がこれより古ければ live fetch に切替 (cron は 5 分間隔)

// rt-fix3 P1-1 (2026-06-27): 展示の Worker cron 非依存化。
//   従来 boatrace.jp 直スクレイプ (展示マージ) は cron(refreshAll) でしか走らず、
//   Cloudflare 無料枠の CPU 10ms 超過などで cron が静かに kill されると、KV が stale 化し
//   /api/previews は openapi 縮退 (_source:'live', 展示なし ~30 分) に落ちたまま誰も気付けない。
//   対策: KV が stale で live fetch する分岐 (= cron が書けていない兆候) のときに、
//   ctx.waitUntil で「ごく少数 (MAX_ONDEMAND_SCRAPES)」の展示スクレイプを発火し、
//   結果を KV に書き戻す。レスポンスはブロックせず即返し、次の閲覧/poll でリッチ KV が当たる。
//   デバウンス: isolate ローカルのタイムスタンプ + 書込後 KV が SERVE_STALE_MS 新鮮化する
//   自然な抑制で、同時閲覧者による scrape storm を防ぐ。cron 死亡時のみ動くため KV write 枠も
//   cron と競合しない。
const MAX_ONDEMAND_SCRAPES = 3;
let _ondemandExhibitionAt = 0;
let _ondemandResultsAt = 0;

// previews は、serveFromKV が古い KV の展示を引き継いだ後の文書（2026-11-27。引き継がずに書くと KV の展示が消える）。
//   取得の経路が previews を書くのはここだけ（展示が増えた時）。
async function boundedOnDemandExhibition(env, previews, nowMs) {
  try {
    if (nowMs - _ondemandExhibitionAt < 5 * 60 * 1000) return; // debounce (isolate-local)
    _ondemandExhibitionAt = nowMs;
    if (!previews || !Array.isArray(previews.previews)) return;
    const programs = await fetchProgramsBase();
    const stats = await mergeBoatraceJpExhibition(programs, previews, nowMs, MAX_ONDEMAND_SCRAPES);
    // 何も補完できなければ書かない (KV write 枠の節約 + kvWrite のハッシュ diff も効く)
    if (stats && stats.merged > 0) {
      await kvWrite(env, KV_KEYS.previews, previews, 'ondemand');
    }
  } catch (_) {
    // 失敗は無視（次回 poll / cron 復帰で回復）
  }
}

// rt-fix3 (2026-06-27): 結果(results)のオンデマンド補完。
//   「結果が出た後の更新が遅い」対策。openapi results ミラーは ~30 分遅延し、cron の
//   boatrace.jp 直スクレイプ(mergeBoatraceJpResults)が追いつかない時間帯がある。
//   /api/results が stale(=cron が書けていない)の時、締切直後で未確定のレースを少数だけ
//   boatrace.jp raceresult から直スクレイプして KV に反映する。次の poll で確定結果が当たる。
//   既存 finished を巻き戻さない安全マージ(mergeBoatraceJpResults は payouts smart merge、
//   未確定のみ追加)なので KV 退行は起きない。
// 2026-11-27: ↑ が成り立つのは、渡された results に KV の中身が入っている時だけ。従来は serveFromKV が
//   上流の素の結果を渡していたので、ここで書くと、この Worker が先に取った確定結果と「レース中止」が
//   KV から消えていた（結果は締切後 6 時間まで取り直すので、数回の cron で戻る）。
//   今は serveFromKV が KV の結果を重ねてから渡し、KV を読めなかった時はここを呼ばない。
async function boundedOnDemandResults(env, results, nowMs) {
  try {
    if (nowMs - _ondemandResultsAt < 3 * 60 * 1000) return; // debounce (isolate-local)
    _ondemandResultsAt = nowMs;
    if (!results || !Array.isArray(results.results)) return;
    const programs = await fetchProgramsBase();
    const stats = await mergeBoatraceJpResults(programs, results, nowMs, MAX_ONDEMAND_SCRAPES);
    if (stats && stats.merged > 0) {
      if (results._kv_merge) delete results._kv_merge;
      await kvWrite(env, KV_KEYS.results, results, 'ondemand');
    }
  } catch (_) {
    // 失敗は無視（次回 poll / cron 復帰で回復）
  }
}

async function serveFromKV(env, kind, ctx) {
  // D9 (2026-05-17): wrapped.updated_at をレスポンス先頭に merge して
  //   PWA 側の鮮度診断 (j.updated_at) が正しく読めるようにする。
  const kv = await kvReadDoc(env, KV_KEYS[kind]);
  if (!kv.ok) console.error('KV read failed:', kv.error);
  const kvWrapped = kv.doc;

  // KV が十分新しければ (= cron が正常に書けている) それを返す。
  //   boatrace.jp 直スクレイプの exhibition/results merge を含むリッチ版。
  if (kvWrapped && kvWrapped.updated_at && kvWrapped.data) {
    const ageMs = Date.now() - new Date(kvWrapped.updated_at).getTime();
    if (ageMs >= 0 && ageMs < SERVE_STALE_MS) {
      const merged = { updated_at: kvWrapped.updated_at, ...kvWrapped.data };
      return jsonResponse(merged, { cacheControl: 'public, max-age=30' });
    }
  }

  // KV が無い or STALE (cron/KV write 失敗時の silent-halt を回避):
  //   上流 openapi を live fetch (edge cache、write 枠不要) して fresh を返す。
  //
  // 2026-11-27: この経路は、KV が持っているものを消さない・隠さない。
  //   従来は上流の素のデータをそのまま返し、previews はそれを KV にも書いていた（results は、後ろで動く
  //   結果の補完が「上流の素のデータ + 取れた数レース」を書いていた）。上流の previews には、この Worker が
  //   公式ページから取った展示が無い。締切の窓（締切 30 分前〜5 分後）を過ぎたレースの展示は取り直せないので、
  //   一度上書きされると、その日は戻らない。
  //   実害: 2026-11-27 14:50 JST、取ってあった展示 57 レース分が KV から消え、残ったのは上流の 33 レースと、
  //   直後の cron が取り直した締切前の 5 レースだけだった（cron は動いていた）。文書が 12 分書き換わらなかった
  //   （展示が 2 回続けて出なかった）ところへ取得が 1 回来て上書きした、と見ている: その時刻の書込そのものは
  //   記録に残っていないが、残ったレースがその順序と合い、同じ手順で同じ消え方を再現できる
  //   （scripts/tests/test_worker_serve_stale.mjs）。
  //   直し方は 4 つ:
  //     1. 上流のデータに、古い KV の中身を引き継いでから返す
  //        （previews = carryRicherExhibitions、results = mergeKVOverOpenapi。どちらも同じ日の分だけ）。
  //     2. この経路は previews / results をそのまま書かない。書くのは、後ろの補完で展示・結果が増えた時だけ
  //        （引き継いだ後の文書に足して書く）。読んだ KV が少し前の版だった時に、新しい版を古い中身で
  //        上書きしないため（KV の書込がほかの場所から読めるまで、60 秒かそれ以上かかることがある）。
  //     3. KV を読めなかった時は、補完もしない（中身が分からない文書を上書きしない。応答は上流のデータだけになる）。
  //     4. cron が動いている間は、そもそも「古い」と判定されないようにする（kvWrite の KV_TOUCH_MS）。
  try {
    let data = await fetchKindBase(kind);
    const old = kvWrapped && kvWrapped.data ? kvWrapped.data : null;
    if (kind === 'previews') {
      if (!isValidPreviewsShape(data)) {
        // 2026-07-17: 上流 previews 破損 (previews キー欠落) は programs から合成して返す。
        //   壊れた payload の透過はクライアントの schema 検証 fail =「API取得失敗」バナー貼付きの直因。
        //   stale KV に展示が残っていれば温存(合成 base は boats 空のため)。
        const programsBase = await fetchProgramsBase();
        data = synthesizePreviewsFromPrograms(programsBase);
        if (old) mergePreviewsBoatsFrom(data, old);
      } else if (old) {
        carryRicherExhibitions(data, old);
      }
    } else if (kind === 'results' && old && isSameJstDay(kvWrapped.updated_at, Date.now())) {
      // この Worker が先に取った確定結果・「レース中止」を、上流の結果に重ねる（cron の refreshAll と同じ）
      data = mergeKVOverOpenapi(data, old);
      if (data && data._kv_merge) delete data._kv_merge;
    }
    const canWrite = !!env.BOATRACE_KV && kv.ok;
    // rt-fix2 (2026-06-11): results は opportunistic write しない。
    //   素の openapi results で KV を上書きすると、cron が boatrace.jp 直スクレイプで
    //   先取りした確定結果を mergeKVOverOpenapi (巻き戻り対策) を経由せず破壊するため。
    // 2026-11-27: previews も同じ扱いにする（上の 2.）。ここで書くのは programs だけ
    //   （取り直した中身が KV と同じなので、書いても何も失わない）。
    if (canWrite && kind === 'programs') {
      kvWrite(env, KV_KEYS[kind], data, 'serve').catch(() => {});
    }
    // rt-fix3 P1-1: previews が stale (= cron が書けていない) なら、少数の展示スクレイプを
    //   バックグラウンドで実行して KV をリッチ化（cron 死亡時でも展示を提供）。
    if (canWrite && kind === 'previews' && ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(boundedOnDemandExhibition(env, data, Date.now()));
    }
    // rt-fix3: results が stale なら、締切直後で未確定のレースを少数だけ boatrace.jp から
    //   直スクレイプして KV に反映（「結果が出た後の更新が遅い」対策）。次の poll で確定が当たる。
    if (canWrite && kind === 'results' && ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(boundedOnDemandResults(env, data, Date.now()));
    }
    // rt-fix2 (2026-06-11): updated_at の偽装をやめる。
    //   旧版は fetch 時刻 (now) を updated_at に刻んでいたため、上流 openapi 自体が
    //   約 30 分間隔更新なのに「数秒前のデータ」の顔をして返り、クライアントの
    //   正直な stale 表示 (rt-fix P0-1) と cron 死亡検知の両方を打ち消していた。
    //   data 側の updated_at (真のデータ世代) を温存し、fetch 時刻は fetched_at に分離。
    //   _source:'live' は「cron が書いた KV ではなく、上流を取り直して返した」印
    //   （2026-11-27 から、古い KV にあった展示・結果は引き継いで入っている）。
    const merged = { ...data, fetched_at: new Date().toISOString(), _source: 'live' };
    if (!merged.updated_at) merged.updated_at = merged.fetched_at;
    return jsonResponse(merged, { cacheControl: 'public, max-age=30' });
  } catch (e) {
    // live fetch も失敗 → 最後の手段として stale KV を返す (502 より stale の方がマシ)
    if (kvWrapped && kvWrapped.data) {
      const merged = { updated_at: kvWrapped.updated_at, ...kvWrapped.data, _stale: true };
      return jsonResponse(merged, { cacheControl: 'public, max-age=15' });
    }
    return jsonResponse({ error: String(e) }, { status: 502, cacheControl: 'no-store' });
  }
}

// -----------------------------------------------------------------------
// 選手の公式ページ（今後の出場予定 / 過去 3 節 / 直近の優勝）— /racer-proxy (2026-11-25)
//   アプリの選手詳細を開いた時だけ呼ばれる。出場予定は日単位でしか変わらないので、選手 1 人の結果を
//   edge に 3 時間置く（boatrace.jp への取得は、選手 1 人につき 3 時間に 2 ページまで）。
//   プロフィールの固定項目（生年月日・登録期など）はファン手帳から取るので（scripts/build_db.py の
//   racer_ext.json）、ここでは名前と見出しの項目を参考として返すだけ。
// -----------------------------------------------------------------------
const RACER_PROXY_TTL_SEC = 3 * 3600;
const RACER_PROXY_MISS_TTL_SEC = 600; // 「データが存在しない」選手番号（引退・誤り）は短めに置く
// 2026-11-27: 出場予定は取れたが過去 3 節が取れなかった結果は短めに置く（次に開いた時に取り直せるように）。
//   公式サイトは Worker からの取得を、ページ単位で断ることがある（デプロイ run 81 の確認: 選手ページは 9.3 秒で取れ、
//   過去 3 節は 0.1 秒で失敗した）。従来はこの「一部だけ」の結果も 3 時間置いていたので、その拠点では 3 時間
//   「過去 3 節は取得できませんでした」のままになっていた。
const RACER_PROXY_PARTIAL_TTL_SEC = 600;
// edge に無い選手の取得は、この isolate で 1 分に RACER_PROXY_MAX_PER_MIN 人まで。
//   誰でも呼べる口なので、選手番号を総なめにして boatrace.jp へ大量に取りに行かせる使い方を抑える
//   （アプリの使い方は、選手詳細を開いた 1 人 + お気に入り一覧の最大 20 人を 0.3 秒おき）。
const RACER_PROXY_MAX_PER_MIN = 30;
let _racerScrapeLog = [];
function racerScrapeAllowed(nowMs) {
  _racerScrapeLog = _racerScrapeLog.filter((t) => nowMs - t < 60000 && nowMs >= t);
  if (_racerScrapeLog.length >= RACER_PROXY_MAX_PER_MIN) return false;
  _racerScrapeLog.push(nowMs);
  return true;
}
// boatrace.jp が拒否（403）・混雑（429）を返したら、この isolate では 10 分取りに行かない。
//   拒否されている間に、選手を開くたびに叩き続けない（scripts/http_utils.py の SourceBlockDetector と同じ考え方）。
//   edge に置いてある選手はその間も返す。
const RACER_PROXY_BLOCK_PAUSE_MS = 10 * 60000;
let _racerBlockedUntil = 0;
// 過去 3 節のページだけが断られた時（選手ページは取れた）は、そのページだけ 10 分取りに行かない。
//   一部だけの結果を短く置く（上の RACER_PROXY_PARTIAL_TTL_SEC）ぶん、断られている間に同じページを
//   選手ごとに叩き直さないようにする。その間に開いた選手は、選手ページだけ取って返す（back3_ok: false）。
let _racerBack3BlockedUntil = 0;
// 一部だけの結果を edge に置く秒数: 過去 3 節を止めている間はその残り時間（止めるのをやめたら取り直せる）、
//   止めていない時（5xx など一時的な失敗）は RACER_PROXY_PARTIAL_TTL_SEC。
function racerPartialTtlSec(nowMs) {
  const left = Math.ceil((_racerBack3BlockedUntil - nowMs) / 1000);
  return left > 0 ? Math.max(60, left) : RACER_PROXY_PARTIAL_TTL_SEC;
}
// 公式サイトへの 1 回の取得を待つ上限。アプリは 25 秒で待つのをやめるので、それより先に 502 を返す
//   （本番の初回取得は 10.9 秒を実測: 2026-11-25 のデプロイ後確認）。
const RACER_UPSTREAM_TIMEOUT_MS = 20000;
const RACER_PROFILE_KEYS = {
  '登録番号': 'toban', '生年月日': 'birth', '身長': 'height', '体重': 'weight', '血液型': 'blood',
  '支部': 'branch', '出身地': 'birthplace', '登録期': 'ki', '級別': 'cls',
};

// 全角の英数・記号 → 半角、全角空白 → 半角空白（タイトルと節間成績を詰めて返す）
function zenToHan(s) {
  return String(s == null ? '' : s)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

// 見出し（title9_mainLabel）の直後の <table> … </table>。次の見出しより後ろの表は拾わない。
function racerSectionTable(html, label) {
  const i = html.indexOf('title9_mainLabel">' + label + '<');
  if (i < 0) return '';
  const t0 = html.indexOf('<table', i);
  if (t0 < 0) return '';
  const next = html.indexOf('title9_mainLabel">', i + 20);
  if (next >= 0 && t0 > next) return '';
  const t1 = html.indexOf('</table>', t0);
  return t1 < 0 ? '' : html.slice(t0, t1);
}

// 表の本体の行 → セル（属性と中身）の配列
function racerTableRows(tableHtml) {
  const rows = [];
  const body = String(tableHtml || '').replace(/<thead[\s\S]*?<\/thead>/gi, '');
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(body)) !== null) {
    const cells = [];
    const tdRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = tdRe.exec(m[1])) !== null) cells.push({ attr: c[1] || '', html: c[2] || '' });
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// 出場予定 / 過去 3 節 / 優勝情報で共通の先頭 5 列: 期間・場・グレード・時間帯・タイトル
function racerSeriesCells(cells) {
  const dates = ((cells[0] ? cells[0].html : '').match(/\d{4}\/\d{2}\/\d{2}/g) || []).map((d) => d.replace(/\//g, '-'));
  if (!dates.length) return null;
  const placeHtml = cells[1] ? cells[1].html : '';
  const titleHtml = cells[4] ? cells[4].html : '';
  const jcd = (/[?&;]jcd=(\d{1,2})/.exec(titleHtml) || /text_place1_(\d{2})/.exec(placeHtml) || [])[1];
  const sid = jcd ? parseInt(jcd, 10) : 0;
  const marks = (cells[2] ? cells[2].attr : '') + ' ' + (cells[3] ? cells[3].attr : '');
  const g = /is-(SG|G1|G2|G3|ippan)([ab])?/.exec(marks);
  // G1a は PG1（プレミアム G1）。BBC トーナメント・クイーンズクライマックス等
  const grade = !g ? '' : g[1] === 'ippan' ? '一般' : g[1] === 'G1' && g[2] === 'a' ? 'PG1' : g[1];
  const series = /is-lady/.test(marks) ? 'オールレディース' : /is-venus/.test(marks) ? 'ヴィーナス' : /is-rookie/.test(marks) ? 'ルーキー' : '';
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    sid: sid >= 1 && sid <= 24 ? sid : null,
    stadium: (/alt="([^"]*)"/.exec(placeHtml) || [])[1] || '',
    grade,
    series,
    time: (/is-(morning|summer|nighter|midnight)/.exec(marks) || [])[1] || '',
    title: zenToHan(stripTags(titleHtml)),
  };
}

// /owpc/pc/data/racersearch/profile — 名前・見出しの項目・出場予定
function parseRacerProfileHTML(html) {
  const out = { found: false, name: '', kana: '', profile: {}, schedule: [] };
  const nm = /class="racer1_bodyName"[^>]*>([\s\S]*?)<\/p>/.exec(html || '');
  if (!nm) return out; // 「データが存在しないのでページを表示できません」
  out.found = true;
  out.name = stripTags(nm[1]).replace(/[\s　]+/g, ' ').trim();
  const kn = /class="racer1_bodyKana"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  out.kana = kn ? stripTags(kn[1]).replace(/[\s　]+/g, ' ').trim() : '';
  const dl = /<dl class="list3">([\s\S]*?)<\/dl>/.exec(html);
  if (dl) {
    const re = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
    let m;
    while ((m = re.exec(dl[1])) !== null) {
      const k = RACER_PROFILE_KEYS[stripTags(m[1])];
      if (k) out.profile[k] = stripTags(m[2]);
    }
  }
  racerTableRows(racerSectionTable(html, '出場予定')).forEach((cells) => {
    const s = racerSeriesCells(cells);
    if (!s) return;
    s.extra = cells[5] ? stripTags(cells[5].html) : ''; // 追加あっせん
    out.schedule.push(s);
  });
  return out;
}

// /owpc/pc/data/racersearch/back3 — 過去 3 節成績（[ ] は優勝戦）と直近の優勝
function parseRacerBack3HTML(html) {
  const out = { back3: [], wins: [] };
  racerTableRows(racerSectionTable(html || '', '過去3節成績')).forEach((cells) => {
    const s = racerSeriesCells(cells);
    if (!s) return;
    // 着順のリンクの文字だけ残す（全角 → 半角）。日の区切りの全角空白は半角空白 1 つにする
    s.results = zenToHan((cells[5] ? cells[5].html : '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    out.back3.push(s);
  });
  racerTableRows(racerSectionTable(html || '', '直近の優勝情報')).forEach((cells) => {
    const s = racerSeriesCells(cells);
    if (s) out.wins.push(s);
  });
  return out;
}

// 公式サイトが応答に付ける計測値（Server-Timing: edge = 配信側 (CDN) で費やした時間、origin = サーバ本体）。
//   2026-11-26 の早朝 (JST)、どのページも応答に 8〜10 秒かかり、この値は edge 8〜10 秒 / origin 0.01〜0.06 秒だった
//   （遅延は公式の配信側。避ける細工はしない、docs/RUNBOOK.md §11.2）。無ければ null。
function racerUpstreamTiming(res) {
  let v = '';
  try { v = (res && res.headers && res.headers.get('server-timing')) || ''; } catch (_) { v = ''; }
  const pick = (name) => {
    const m = new RegExp('(?:^|,)\\s*' + name + '\\s*;[^,]*?dur=([0-9.]+)', 'i').exec(v);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  return { edge_ms: pick('edge'), origin_ms: pick('origin') };
}

async function scrapeRacerOfficial(toban) {
  const base = 'https://www.boatrace.jp/owpc/pc/data/racersearch/';
  const opt = {
    headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-worker/1.2' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    opt.signal = AbortSignal.timeout(RACER_UPSTREAM_TIMEOUT_MS);
  }
  // 公式サイトの応答にかかった時間を測る（応答の先頭が届くまで）。遅いのがどこかを後から判別できるようにする。
  const t0 = Date.now();
  const timed = async (u) => {
    const res = await fetch(u, opt);
    return { res, ms: Date.now() - t0 };
  };
  // 過去 3 節のページが直前に断られていたら、そのページは取りに行かない（選手ページだけ取る）
  const skipBack3 = Date.now() < _racerBack3BlockedUntil;
  const [p, b] = await Promise.all([
    timed(`${base}profile?toban=${toban}`),
    skipBack3 ? null : timed(`${base}back3?toban=${toban}`),
  ]);
  const pRes = p.res;
  const bRes = b ? b.res : null;
  if (!pRes.ok) {
    const err = new Error(`racer profile ${pRes.status}`);
    err.blocked = pRes.status === 403 || pRes.status === 429;
    throw err;
  }
  if (bRes && (bRes.status === 403 || bRes.status === 429)) {
    _racerBack3BlockedUntil = Date.now() + RACER_PROXY_BLOCK_PAUSE_MS;
  }
  // back3_status = 過去 3 節のページの HTTP 状態（取れた時は 200、断られた時は 403 など、取りに行かなかった時は 0）
  const timing = {
    profile_ms: p.ms,
    back3_ms: b ? b.ms : null,
    back3_status: bRes ? bRes.status : 0,
    ...racerUpstreamTiming(pRes),
  };
  const prof = parseRacerProfileHTML(await pRes.text());
  // 過去 3 節は取れなくても出場予定は返す（back3_ok で区別できる）
  let back = { back3: [], wins: [] };
  let backOk = false;
  if (bRes && bRes.ok) {
    back = parseRacerBack3HTML(await bRes.text());
    backOk = true;
  }
  return {
    toban: String(toban),
    found: prof.found,
    name: prof.name,
    kana: prof.kana,
    profile: prof.profile,
    schedule: prof.schedule,
    back3: back.back3,
    wins: back.wins,
    back3_ok: backOk,
    timing,
    fetched_at: new Date().toISOString(),
  };
}

export default {
  async scheduled(event, env, ctx) {
    // D1a (2026-05-17): 24/7 動作。cron 側で頻度を分岐するので時間外スキップは不要。
    //   JST 08-22: 5 分間隔, JST 23-07: 30 分間隔 (wrangler.toml triggers 参照)
    if (!env.BOATRACE_KV) {
      console.error('BOATRACE_KV binding missing');
      return;
    }
    // 2026-11-27: 毎分の cron は締切前通知 (Web Push) の確認だけを行い、データ更新 (refreshAll) は行わない。
    //   cron が複数あると、Cloudflare は発火した cron ごとに scheduled() を呼び、event.cron にその式を入れる。
    const cron = event && typeof event.cron === 'string' ? event.cron : '';
    if (cron === PUSH_CRON) {
      try {
        const r = await pushTick(env, event.scheduledTime);
        if (r && (r.sent || r.failed || r.gone)) console.log('push:', JSON.stringify(r));
      } catch (e) {
        console.error('push tick failed:', String(e && e.message ? e.message : e).slice(0, 200));
      }
      return;
    }
    // 知らない式で、5 分の区切りでもない時刻なら何もしない（毎分の cron の式が想定と違う形で渡された場合に、
    //   重いデータ更新を毎分走らせないための歯止め）。式が空（手動実行・テスト）は従来どおり実行する。
    if (cron && MAIN_CRONS.indexOf(cron) < 0) {
      const at = typeof event.scheduledTime === 'number' ? event.scheduledTime : Date.now();
      if (Math.floor(at / 60000) % 5 !== 0) {
        console.warn('scheduled: unknown cron, skipped:', cron);
        return;
      }
    }
    // rt-fix3 (2026-06-27): cron 生存ハートビート。内容変化に関わらず毎 run 1 write。
    //   /health?strict=1 はこれ (cron_age_sec) で cron 死活を判定する。
    //   データキー (programs 等) の wrote_at は kvWrite が「内容変化時のみ」更新するため、
    //   静的な programs では常に古くなり strict が false positive (Worker 正常でも 500) を
    //   返していた。cron 専用ハートビートに分離して誤検知を恒久解消する。
    // 2026-09-06: heartbeat は「base データを KV に書いた直後」に打つ (onBaseWritten)。
    //   従来は全処理 (重い HTML スクレイプ含む) の最後だったため、日中に途中 kill されると
    //   heartbeat が進まず「cron が発火していない」ように見え、かつ base も失われていた。
    //   意味は「cron が発火し base データを配信した」に明確化される。スクレイプの成否は
    //   ログ (refresh: ...) と keys.*.src で追う。
    let hbWritten = false;
    const writeHb = async () => {
      if (hbWritten) return;
      hbWritten = true;
      // 2026-11-20: 直近 HEARTBEAT_MIN_INTERVAL_MS 以内に書いていれば書かない（KV 書込枠の節約。読みは無料枠が大きい）
      try {
        const prevHb = await env.BOATRACE_KV.get('health:heartbeat');
        const age = prevHb ? Date.now() - new Date(prevHb).getTime() : Infinity;
        if (age >= 0 && age < HEARTBEAT_MIN_INTERVAL_MS) return;
      } catch (_) { /* 読めなければ書く */ }
      try { await env.BOATRACE_KV.put('health:heartbeat', new Date().toISOString()); } catch (e) { _noteKvPutFailure(e); }
    };
    const r = await refreshAll(env, { onBaseWritten: writeHb });
    await writeHb(); // base が 1 件も無かった等で未実行なら、完走の証跡として最後に打つ
    console.log('refresh:', JSON.stringify(r));
  },

  // FA-5: 全レスポンスの ACAO を出口 1 箇所で正規化する（許可外 Origin は ACAO を付けない）。
  async fetch(request, env, ctx) {
    const res = await this._route(request, env, ctx);
    return _applyCors(request, env, res);
  },

  async _route(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
    }
    if (url.pathname === '/health') {
      // rt-fix2 (2026-06-11): /health を「KV の鮮度と cron 生死が外形観測できる」形に拡張。
      //   旧版は ok/time/kv_bound のみで、KV が空でも cron が死んでいても 200 を返し、
      //   deploy 検証も外部監視も騙される構造だった。
      //   - keys[kind] = { updated_at, age_sec, wrote_at, src } (metadata は put と同時更新)
      //   - src='cron' の最終 wrote_at が cron の生存証跡 (serve は縮退時の opportunistic write)
      //   - ?strict=1 なら、いずれかのキーが max_age_sec 超過で HTTP 500
      //     → healthchecks.io / UptimeRobot 等の無料外形監視をそのまま張れる
      const strict = url.searchParams.get('strict') === '1';
      const maxAgeSec = parseInt(url.searchParams.get('max_age_sec') || '1800', 10);
      const out = {
        ok: true,
        time: new Date().toISOString(),
        mode: 'scrape-engine-v3-with-html-scrape',
        kv_bound: !!env.BOATRACE_KV,
        keys: {},
      };
      if (env.BOATRACE_KV) {
        for (const kind of ['previews', 'programs', 'results']) {
          try {
            const prev = await env.BOATRACE_KV.getWithMetadata(KV_KEYS[kind], { type: 'stream' });
            if (prev && prev.value && prev.value.cancel) prev.value.cancel().catch(() => {});
            const meta = (prev && prev.metadata) || {};
            const wroteAt = meta.wrote_at || null;
            out.keys[kind] = {
              wrote_at: wroteAt,
              age_sec: wroteAt ? Math.round((Date.now() - new Date(wroteAt).getTime()) / 1000) : null,
              src: meta.src || null,
              exists: !!(prev && prev.value),
            };
          } catch (e) {
            out.keys[kind] = { error: String(e).slice(0, 80) };
          }
        }
        // rt-fix3 (2026-06-27): cron 死活は専用ハートビートで判定する。
        //   データキー (とくに programs は朝1回しか変化しない) の wrote_at で strict 判定すると、
        //   Worker / cron が正常でも午後には必ず 500 になる false positive があったため。
        let cronHb = null;
        try { cronHb = await env.BOATRACE_KV.get('health:heartbeat'); } catch (_) {}
        out.cron_heartbeat = cronHb;
        out.cron_age_sec = cronHb ? Math.round((Date.now() - new Date(cronHb).getTime()) / 1000) : null;
        // 2026-09-06 serve-heal の観測: この isolate が最後に cron 代替 refresh を発火した時刻。
        //   isolate ローカルなので null でも「未発火」とは限らない (別 isolate が発火し得る)。
        // 2026-11-20: この isolate での KV put 失敗回数（枠切れの兆候）
        out.kv_put_failures = { count: _kvPutFailures, last: _kvLastPutError };
        out.serve_heal = {
          last_at: _lastServeHealAt ? new Date(_lastServeHealAt).toISOString() : null,
          threshold_sec: Math.round(_cronDeadThresholdMs(Date.now()) / 1000),
        };
        if (strict) {
          // cron が maxAgeSec 以内に走っていれば healthy。ハートビート未生成 (旧 Worker /
          //   一度も cron 未実行) や maxAgeSec 超過なら 500。
          if (out.cron_age_sec == null || out.cron_age_sec > maxAgeSec) {
            out.ok = false;
            out.reason = out.cron_age_sec == null ? 'cron_heartbeat_missing' : 'cron_heartbeat_stale';
            return jsonResponse(out, { status: 500, cacheControl: 'no-store' });
          }
        }
      }
      return jsonResponse(out, { cacheControl: 'no-store' });
    }
    // 2026-11-27: Web Push の登録・解除・テスト送信（push.js）
    if (url.pathname.startsWith('/push/')) {
      return handlePush(request, env, ctx, url, { allowedOrigins: _allowedOrigins(env) });
    }
    // 2026-09-06 serve-heal: cron が死んでいれば、この通常アクセスを代替トリガにして
    //   refreshAll を裏で走らせる (5 分 throttle)。応答は待たせない。
    if (url.pathname === '/api/previews' || url.pathname === '/api/programs' || url.pathname === '/api/results') {
      try {
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(_healIfCronDead(env, ctx));
      } catch (_) { /* never affect the response */ }
    }
    if (url.pathname === '/api/previews') return serveFromKV(env, 'previews', ctx);
    if (url.pathname === '/api/programs') return serveFromKV(env, 'programs', ctx);
    if (url.pathname === '/api/results')  return serveFromKV(env, 'results', ctx);
    if (url.pathname === '/api/refresh-now') {
      if (!env.BOATRACE_KV) return jsonResponse({ error: 'KV not bound' }, { status: 500 });
      // FA-5: 未認証呼出はレート制限。TRIGGER_SECRET 提示時のみ無条件実行。
      const authorized = _isTriggerAuthorized(request, env, url);
      if (!authorized) {
        const remain = await _refreshThrottleRemainingSec();
        if (remain != null) {
          return jsonResponse(
            { refreshed: false, throttled: true, retry_after_sec: remain },
            { status: 429, cacheControl: 'no-store' }
          );
        }
      }
      await _markRefreshDone();
      const r = await refreshAll(env);
      return jsonResponse({ refreshed: r, authorized });
    }

    // 2026-09-13 旅食Navi (tabishoku-navi): ホットペッパーグルメ Web サービスの中継。
    //   同 API はブラウザからの直接呼出 (CORS / JSONP) を受け付けないため、同じ
    //   GitHub Pages origin (inotaka1979.github.io) で動く姉妹アプリの取り次ぎを
    //   本 Worker に相乗りさせる。Origin 許可は出口の _applyCors が担う。
    //   同一位置 (約 100m 単位) の結果は Cache API で 10 分まとめ、API の 1 日上限
    //   (3,000 回目安) を節約する。KV は使わない (書込クォータに影響しない)。
    if (url.pathname === '/hotpepper') {
      const key = url.searchParams.get('key') || '';
      const lat = parseFloat(url.searchParams.get('lat'));
      const lng = parseFloat(url.searchParams.get('lng'));
      let range = parseInt(url.searchParams.get('range') || '3', 10);
      let count = parseInt(url.searchParams.get('count') || '100', 10);
      // 2026-09-17: キーワード検索（店名・住所・駅名・ジャンルキャッチ・紹介文が対象）を転送する
      const keyword = (url.searchParams.get('keyword') || '').trim().slice(0, 100);
      if (!/^[0-9a-f]{16}$/i.test(key)) {
        return jsonResponse({ error: 'bad key' }, { status: 400, cacheControl: 'no-store' });
      }
      if (!(lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154)) {
        return jsonResponse({ error: 'bad latlng' }, { status: 400, cacheControl: 'no-store' });
      }
      if (!(range >= 1 && range <= 5)) range = 3;
      if (!(count >= 1 && count <= 100)) count = 100;
      const cacheKey = new Request(
        `https://hotpepper-cache.invalid/v1?k=${key}&lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}&range=${range}&count=${count}&kw=${encodeURIComponent(keyword)}`
      );
      const cache = caches.default;
      try {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const h = new Headers(hit.headers);
          h.set('x-cache', 'HIT');
          if (keyword) h.set('x-keyword', 'applied');
          h.set('access-control-expose-headers', 'x-cache, x-keyword');
          return new Response(hit.body, { status: hit.status, headers: h });
        }
      } catch (_) { /* cache miss と同じ扱い */ }
      const upstream =
        `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${encodeURIComponent(key)}` +
        `&lat=${lat}&lng=${lng}&range=${range}&count=${count}&format=json` +
        (keyword ? `&keyword=${encodeURIComponent(keyword)}` : '');
      try {
        const res = await fetch(upstream, {
          headers: { 'User-Agent': 'tabishoku-navi-proxy/1.0 (+https://inotaka1979.github.io/tabishoku-navi/)' },
        });
        const text = await res.text();
        const out = new Response(text, {
          status: res.status,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=600',
            'x-cache': 'MISS',
            ...(keyword ? { 'x-keyword': 'applied' } : {}),
            'access-control-expose-headers': 'x-cache, x-keyword',
            ...CORS,
          },
        });
        if (res.ok && ctx && typeof ctx.waitUntil === 'function') {
          try { ctx.waitUntil(cache.put(cacheKey, out.clone())); } catch (_) { /* cache は best effort */ }
        }
        return out;
      } catch (e) {
        return jsonResponse(
          { error: 'upstream', message: String((e && e.message) || e).slice(0, 120) },
          { status: 502, cacheControl: 'no-store' }
        );
      }
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
    // 各場「オリジナル展示」(一周/まわり足/直線)のオンデマンド CORS/Referer プロキシ。
    //   GHA schedule では鮮度が足りない(展示は各レース締切~30分前)ため、閲覧中レースを
    //   その場で取得する。対応場(ajax_yosou 型)のみ。応答 HTML をクライアントが DOMParser で解析。
    if (url.pathname === '/orig-exhibition-proxy') {
      // ajax_yosou 形式で動く場のみ(probe 判定)。別サイト形式の12場+蒲郡は未登録(別途対応)。
      const ORIG_BASES = {
        5: 'https://www.boatrace-tamagawa.com',
        6: 'https://www.boatrace-hamanako.jp',
        8: 'https://www.boatrace-tokoname.jp',
        9: 'https://www.boatrace-tsu.com',
        10: 'https://www.boatrace-mikuni.jp',
        13: 'https://www.boatrace-amagasaki.jp',
        14: 'https://www.n14.jp',
        18: 'https://www.boatrace-tokuyama.jp',
        19: 'https://www.boatrace-shimonoseki.jp',
        20: 'https://www.wmb.jp',
        21: 'https://www.boatrace-ashiya.com',
      };
      const jcd = url.searchParams.get('jcd') || '';
      const race = url.searchParams.get('race') || '';
      const hd = url.searchParams.get('hd') || '';
      if (!/^\d+$/.test(race) || !/^\d{8}$/.test(hd)) {
        return new Response('bad params', { status: 400, headers: CORS });
      }
      const jcdN = parseInt(jcd);
      const rr = String(parseInt(race)).padStart(2, '0');
      // 宮島(17): JS 駆動。kaisai_reload.php に POST し応答全文(####区切り、
      //   オリジナル展示表は part[7])を返す。クライアント側が表を検索して解析する。
      if (jcdN === 17) {
        try {
          const res = await fetch('https://www.boatrace-miyajima.com/race_common/require/kaisai_reload.php', {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0 boatrace-scrape-trigger',
              'Referer': 'https://www.boatrace-miyajima.com/',
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `race=${parseInt(race)}&date=${hd}`,
          });
          if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502, headers: CORS });
          const html = await res.text();
          return new Response(html, {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=20', ...CORS },
          });
        } catch (e) {
          return new Response(`error: ${e.message}`, { status: 502, headers: CORS });
        }
      }
      const base = ORIG_BASES[jcdN];
      // 場の形式に応じて upstream とヘッダを決める。
      //   ajax_yosou(鳴門系): ajax_yosou.php。蒲郡(7): recomend 静的htm。戸田(2): XML。
      let upstream = null;
      let fetchHeaders = { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-trigger' };
      if (base) {
        // オリジナル展示の req は場により異なる。多くは cyokuzen だが
        //   津(9)は「展示情報」タブ=sttenji にオリジナル展示がある。
        const ORIG_REQ = { 9: 'sttenji' };
        const oreq = ORIG_REQ[jcdN] || 'cyokuzen';
        upstream = `${base}/sp/ajax/ajax_yosou.php?targetday=${hd}&race=${parseInt(race)}&req=${oreq}&run=0`;
        fetchHeaders.Referer = base + '/sp/';
        fetchHeaders['X-Requested-With'] = 'XMLHttpRequest';
      } else if (jcdN === 7) {
        upstream = `https://www.gamagori-kyotei.com/asp/gamagori/sp/kyogi/kyogihtml/recomend/recomend${hd}07${rr}.htm`;
        fetchHeaders.Referer = 'https://www.gamagori-kyotei.com/';
      } else if (jcdN === 2) {
        // 戸田の XML パスはイベント/サイト更新でプレフィックスが変わる
        //   (現行は /xml/kaisai/、過去は /race/xml/kaisai/)。両方を順に試す。
        upstream = [
          `https://www.boatrace-toda.jp/xml/kaisai/${hd}/race_table_original_${rr}.xml`,
          `https://www.boatrace-toda.jp/race/xml/kaisai/${hd}/race_table_original_${rr}.xml`,
        ];
        fetchHeaders.Referer = 'https://www.boatrace-toda.jp/';
      } else if (jcdN === 11) {
        // びわこ独自CMS。オリジナル展示はタブ kind=2(col5-8=展示/一周/まわり足/直線)。
        upstream = `https://www.boatrace-biwako.jp/modules/yosou/cyokuzen.php?day=${hd}&race=${parseInt(race)}&if=0&kind=2`;
        fetchHeaders.Referer = 'https://www.boatrace-biwako.jp/';
      } else if (jcdN === 12) {
        // 住之江: SP iframe の直前情報予想タブ = /asp/kyogi/12/sp/yoso05{RR}.htm
        //   (枠/展示/一周/まわり足、直線なし)。
        upstream = `https://www.boatrace-suminoe.jp/asp/kyogi/12/sp/yoso05${rr}.htm`;
        fetchHeaders.Referer = 'https://www.boatrace-suminoe.jp/sp/';
      } else if (jcdN === 16) {
        // 児島: 住之江と同じ kyogi 配信 /asp/kyogi/16/sp/yoso05{RR}.htm (probe 2026-07-03)。
        //   表は 2 行ヘッダ + 位置ベース(waku0N/体重/チルト/展示/一周/まわり足/直線)の変種で、
        //   クライアントは _parseKojima が解析。
        upstream = `https://www.kojimaboat.jp/asp/kyogi/16/sp/yoso05${rr}.htm`;
        fetchHeaders.Referer = 'https://www.kojimaboat.jp/';
      } else if (jcdN === 4) {
        // 平和島: kyogi 配信(トップ iframe /asp/kyogi/04/sp/top_syusso01.htm を確認)。
        //   直前情報は同系の yoso05{RR}.htm。クライアントは住之江型→児島型の順に解析。
        upstream = `https://www.heiwajima.gr.jp/asp/kyogi/04/sp/yoso05${rr}.htm`;
        fetchHeaders.Referer = 'https://www.heiwajima.gr.jp/';
      } else if (jcdN === 24) {
        // 大村(独自ドメイン): /yosou/sp/syussou/?day=&race= に直前展示表がインライン
        //   (枠/ST/展示タイム/一周/まわり足/直線)。
        upstream = `https://omurakyotei.jp/yosou/sp/syussou/?day=${hd}&race=${rr}`;
        fetchHeaders.Referer = 'https://omurakyotei.jp/yosou/sp/syussou/';
      } else if (jcdN === 1 || jcdN === 22 || jcdN === 23) {
        // 桐生(1)/福岡(22)/唐津(23): 同ベンダーの直前情報表(col4=展示/col5-1=一周
        //   (桐生は半周)/col5-2=まわり足/col5-3=直線)。桐生/福岡は ajax_cyokuzen.php?race=N 直接、
        //   唐津は ajax が 404 のため同じ表を含むフルページ(yosou-cyokuzen)から取得(probe 2026-07-02)。
        const cb = jcdN === 1 ? 'https://www.kiryu-kyotei.com'
          : jcdN === 22 ? 'https://www.boatrace-fukuoka.com'
          : 'https://www.boatrace-karatsu.jp';
        upstream = jcdN === 23
          ? `${cb}/sp/index.php?page=yosou-cyokuzen&race=${parseInt(race)}`
          : `${cb}/sp/ajax/ajax_cyokuzen.php?race=${parseInt(race)}`;
        fetchHeaders.Referer = cb + '/sp/';
        fetchHeaders['X-Requested-With'] = 'XMLHttpRequest';
      }
      if (!upstream) {
        return new Response('unsupported jcd', { status: 400, headers: CORS });
      }
      const candidates = Array.isArray(upstream) ? upstream : [upstream];
      try {
        let lastStatus = 0;
        for (const cand of candidates) {
          const res = await fetch(cand, {
            headers: fetchHeaders,
            cf: { cacheTtl: 20, cacheEverything: true },
          });
          if (res.ok) {
            const html = await res.text();
            return new Response(html, {
              headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=20', ...CORS },
            });
          }
          lastStatus = res.status;
        }
        return new Response(`upstream ${lastStatus}`, { status: 502, headers: CORS });
      } catch (e) {
        return new Response(`error: ${e.message}`, { status: 502, headers: CORS });
      }
    }
    // レース結果のオンデマンド取得 (2026-06-29)。
    //   bulk /api/results は openapi ベース + cron 補完(20件/run・締切+360分窓)で、
    //   GHA schedule 間引き + 無料枠上限により夜のナイター場の結果/払戻が「途中で止まる」。
    //   閲覧中レース / 確定済なのに払戻欠落のレースを、クライアントから 1 レース単位で
    //   その場 scrape する。既存 scrapeRaceresult を 1 件公開するだけ(着順+払戻を parse 済 JSON)。
    if (url.pathname === '/result-proxy') {
      const jcd = url.searchParams.get('jcd') || '';
      const race = url.searchParams.get('race') || '';
      const hd = url.searchParams.get('hd') || '';
      if (!/^\d+$/.test(jcd) || !/^\d+$/.test(race) || !/^\d{8}$/.test(hd)) {
        return new Response('bad params', { status: 400, headers: CORS });
      }
      const sidNum = parseInt(jcd);
      if (sidNum < 1 || sidNum > 24) return new Response('bad sid', { status: 400, headers: CORS });
      const raceDate = `${hd.slice(0, 4)}-${hd.slice(4, 6)}-${hd.slice(6, 8)}`;
      try {
        const parsed = await scrapeRaceresult(sidNum, parseInt(race), hd, raceDate);
        // 着順未確定(結果ページがまだ無い/parse 不完全)は pending を返す。
        //   クライアントは pending 時に tried フラグを解除して後で再取得する。
        if (!parsed || (parsed.race_technique_number == null && !parsed.race_cancelled)) {
          return new Response(JSON.stringify({ pending: true }), {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
          });
        }
        return new Response(JSON.stringify(parsed), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30', ...CORS },
        });
      } catch (e) {
        return new Response(`error: ${e.message}`, { status: 502, headers: CORS });
      }
    }
    // 直前情報(展示タイム/ST/チルト/ペラ/部品/調整重量)のオンデマンド取得 (2026-06-30)。
    //   bulk /api/previews は朝の一斉展示で Worker cron(20件/run)が全場を覆いきれず、
    //   一部の場(三国/唐津/児島 等)の「展示情報」テーブルが丸ごと出ない。
    //   既存 scrapeBeforeinfoFull を 1 レース公開し、openapi 互換の boats(object) と気象 (race_*) で返す。
    if (url.pathname === '/beforeinfo-proxy') {
      const jcd = url.searchParams.get('jcd') || '';
      const race = url.searchParams.get('race') || '';
      const hd = url.searchParams.get('hd') || '';
      if (!/^\d+$/.test(jcd) || !/^\d+$/.test(race) || !/^\d{8}$/.test(hd)) {
        return new Response('bad params', { status: 400, headers: CORS });
      }
      const sidNum = parseInt(jcd);
      if (sidNum < 1 || sidNum > 24) return new Response('bad sid', { status: 400, headers: CORS });
      const raceDate = `${hd.slice(0, 4)}-${hd.slice(4, 6)}-${hd.slice(6, 8)}`;
      try {
        // close=HHMM（そのレースの締切時刻。アプリが番組表から付ける）。無い / 形が違う時は null
        const close = url.searchParams.get('close') || '';
        const closeMin = /^([01]\d|2[0-3])[0-5]\d$/.test(close) ? parseInt(close.slice(0, 2), 10) * 60 + parseInt(close.slice(2), 10) : null;
        const got = await scrapeBeforeinfoFull(sidNum, parseInt(race), hd, closeMin);
        const boats = got.boats;
        // 展示前(boats=null)は pending。クライアントは tried を解除して後で再取得。
        if (!boats) {
          return new Response(JSON.stringify({ pending: true }), {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
          });
        }
        const outBoats = {};
        for (const bn of Object.keys(boats)) {
          const src = boats[bn];
          outBoats[bn] = {
            racer_boat_number: parseInt(bn),
            racer_exhibition_time: src.exhibition_time,
            racer_start_timing: src.start_timing,
            racer_course_number: src.course,
            racer_tilt_adjustment: src.tilt,
            racer_propeller: src.propeller,
            racer_parts_replaced: src.parts_replaced,
            racer_adjust_weight: src.adjust_weight,
          };
        }
        const out = { race_stadium_number: sidNum, race_number: parseInt(race), race_date: raceDate, boats: outBoats };
        applyBeforeinfoWeather(out, got.weather); // 気象（race_wind など。読めた項目だけ）
        return new Response(JSON.stringify(out), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=20', ...CORS },
        });
      } catch (e) {
        return new Response(`error: ${e.message}`, { status: 502, headers: CORS });
      }
    }
    // 選手の今後の出場予定・過去 3 節（公式の選手ページ、2026-11-25）。
    //   アプリの選手詳細を開いた時だけ呼ばれる。結果は edge に置く（上の RACER_PROXY_TTL_SEC）。
    if (url.pathname === '/racer-proxy') {
      const toban = url.searchParams.get('toban') || '';
      if (!/^\d{4,5}$/.test(toban)) return new Response('bad params', { status: 400, headers: CORS });
      const cacheKey = new Request(`https://racer-proxy-cache.invalid/v1?toban=${toban}`);
      const cache = caches.default;
      try {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const h = new Headers(hit.headers);
          h.set('x-cache', 'HIT');
          // ブラウザには残り時間だけ置かせる（edge の 3 時間 + ブラウザの 3 時間で 6 時間古くなるのを防ぐ）
          const left = Math.round(((Number(h.get('x-racer-expires')) || 0) - Date.now()) / 1000);
          h.set('cache-control', `public, max-age=${Math.max(60, Math.min(RACER_PROXY_TTL_SEC, left))}`);
          return new Response(hit.body, { status: hit.status, headers: h });
        }
      } catch (_) { /* cache miss と同じ扱い */ }
      const noStore = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS };
      if (Date.now() < _racerBlockedUntil) {
        const wait = Math.max(1, Math.ceil((_racerBlockedUntil - Date.now()) / 1000));
        return new Response(JSON.stringify({ error: 'blocked' }), {
          status: 503,
          headers: { ...noStore, 'retry-after': String(wait) },
        });
      }
      if (!racerScrapeAllowed(Date.now())) {
        return new Response(JSON.stringify({ error: 'busy' }), {
          status: 429,
          headers: { ...noStore, 'retry-after': '60' },
        });
      }
      // 取得 → edge への保存までを 1 つの仕事にして、応答を返す前に waitUntil に載せる。
      //   公式サイトの応答が遅いと、アプリが待ち切れずに接続を切ることがある（本番の初回取得は 10.9 秒）。
      //   そのときも取得と保存を最後までやれば、次に開いた時は edge から即座に返る。
      //   取得だけで終わって保存されないと、遅い間は何度開いても同じ待ち時間で失敗し続ける。
      const job = (async () => {
        let data;
        try {
          data = await scrapeRacerOfficial(toban);
        } catch (e) {
          // 拒否の記録も仕事の中で行う（接続が切れた後でも次の人に効くように）
          if (e && e.blocked) _racerBlockedUntil = Date.now() + RACER_PROXY_BLOCK_PAUSE_MS;
          throw e;
        }
        const ttl = !data.found
          ? RACER_PROXY_MISS_TTL_SEC
          : data.back3_ok
            ? RACER_PROXY_TTL_SEC
            : racerPartialTtlSec(Date.now());
        const body = JSON.stringify(data);
        const headers = {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${ttl}`,
          'x-cache': 'MISS',
          'x-racer-expires': String(Date.now() + ttl * 1000),
          ...CORS,
        };
        try { await cache.put(cacheKey, new Response(body, { headers })); } catch (_) { /* cache は best effort */ }
        return { body, headers };
      })();
      if (ctx && typeof ctx.waitUntil === 'function') {
        try { ctx.waitUntil(job.catch(() => {})); } catch (_) { /* best effort */ }
      }
      try {
        const done = await job;
        return new Response(done.body, { headers: done.headers });
      } catch (e) {
        return jsonResponse(
          { error: 'upstream', message: String((e && e.message) || e).slice(0, 120) },
          { status: 502, cacheControl: 'no-store' }
        );
      }
    }
    return new Response('boatrace-scrape-trigger (scrape-engine-v3)\n', { headers: CORS });
  },
};

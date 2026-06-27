// Phase 2b (Clearwing patterns): src/discovery/openapi_client.js
//
// Discovery 層: read-only データ取得。Open API / Cloudflare Worker / localStorage の
// 3 段 fallback fetch、レスポンス schema 検証、stadium×race index 変換、stale 除外。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:DISCOVERY_OPENAPI:START */ ... /* BUILD:DISCOVERY_OPENAPI:END */
// に注入する。
//
// 依存:
//   - globalThis.capabilities (Clearwing Phase 1 で先に bundle)
//   - _g.cacheKey (app.js 内に残る utility 関数)
//   - globalThis._renderApiHealthBanner (reporting 層へ後で移動予定; 未定義でも動作)
//
// Public (globalThis に export):
//   BC_MAX_BYTES / WORKER_BASE / _apiHealth / _setApiHealth
//   _mapToWorkerUrl / _fetchOne / fetchWithFallback
//   validateApiPayload / indexByStadiumRace / indexPreviews / indexResults
//   _filterStalePreviews

'use strict';

// 型付き globalThis ハンドル (Phase 4: JSDoc strict 整合用)。
//   _g.X で Window インタフェース (src/types/globals.d.ts) 経由の型チェックを受ける。
/** @type {BoatRaceGlobalAPI & typeof globalThis} */
const _g = /** @type {any} */ (globalThis);

// Epic 28b: localStorage 5MB 超過の真因 — fetchWithFallback が programs/previews
//   (各 ~1MB の API response 全体) を毎回 bc_* に保存していた。
//   対策: サイズ上限 (BC_MAX_BYTES=100KB) を設け、超過レスポンスは bc_* 非保存。
const BC_MAX_BYTES = 100 * 1024;

// Path C (2026-05-17): Cloudflare Worker を一次データソースに。
// 3 段 fallback: Worker /api → openapi 直接 → localStorage cache
const WORKER_BASE = 'https://boatrace-scrape-trigger.inotaka1979.workers.dev';

/**
 * API ヘルス状態（programs / previews / results / odds）。
 * 値は 'ok' | 'fail' | 'cached' のいずれか。
 * @type {Record<string, string>}
 */
const _apiHealth = { programs: 'ok', previews: 'ok', results: 'ok', odds: 'ok' };

/**
 * URL を見て対応する API カテゴリの health を更新し、reporting 層に通知。
 * @param {string} url
 * @param {string} state - 'ok' | 'fail' | 'cached'
 */
function _setApiHealth(url, state) {
  const key =
    url.indexOf('/programs/') >= 0
      ? 'programs'
      : url.indexOf('/previews/') >= 0
        ? 'previews'
        : url.indexOf('/results/') >= 0
          ? 'results'
          : url.indexOf('/odds/') >= 0
            ? 'odds'
            : null;
  if (!key) return;
  _apiHealth[key] = state;
  // reporting 層に変更通知（DOM 更新は reporting 側関数の責務）
  if (typeof _g._renderApiHealthBanner === 'function') {
    try {
      _g._renderApiHealthBanner();
    } catch (_) {}
  }
}

/**
 * openapi URL を Worker URL に map (programs/previews/results)。
 * @param {string} openapiUrl
 * @returns {string | null}
 */
function _mapToWorkerUrl(openapiUrl) {
  if (openapiUrl.indexOf('/programs/v2/today.json') >= 0) return WORKER_BASE + '/api/programs';
  if (openapiUrl.indexOf('/previews/v2/today.json') >= 0) return WORKER_BASE + '/api/previews';
  if (openapiUrl.indexOf('/results/v2/today.json') >= 0) return WORKER_BASE + '/api/results';
  return null; // Worker でカバーされない URL (過去日付 等) は openapi 直
}

// 公式移行 Phase 2 (2026-06-28): 自前公式 data/* への map。
//   programs は scrape_programs.py が boatrace.jp 由来で openapi 互換に生成し、GitHub Pages
//   (本アプリと同一 origin) に配信。Worker 不通時、openapi(非公式ミラー)より前に自前公式を
//   試す中間 tier。previews/results は data/* が別スキーマのため当面 map しない（null）。
function _mapToOfficialUrl(openapiUrl) {
  if (openapiUrl.indexOf('/programs/v2/today.json') >= 0) return 'data/programs/today.json';
  return null;
}

/**
 * rt-fix P0-1 (2026-06-04): いずれかの系から fetch が成功した瞬間の時刻を記録。
 *   鮮度バッジ「📡 X分前」はこの「最終 fetch 成功時刻」を表示する。
 *   従来はデータ世代(updated_at, 約30分間隔)を表示しており、正常稼働でも
 *   常時「10〜30分前」と古く見え「更新されない」と誤認させていた。
 */
function _markFetchOk() {
  try {
    _g._lastFetchOkAt = Date.now();
  } catch (_) {}
}

/**
 * 単発 fetch + JSON parse。capabilities.makeTimeoutSignal で iOS Safari 旧版
 * (AbortSignal.timeout 非対応) を吸収。
 * @param {string} url
 * @param {number} [timeoutMs]  既定 10000ms
 * @returns {Promise<unknown>}
 */
function _fetchOne(url, timeoutMs) {
  const signal = _g.capabilities.makeTimeoutSignal(timeoutMs || 10000);
  return fetch(url, { signal: signal, cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
}

/**
 * 3 段 fallback fetch:
 *   Tier 1: Cloudflare Worker /api/* (KV、~5 分鮮度)
 *   Tier 2: openapi 直接
 *   Tier 3: localStorage cache (10 min まで)
 * 成功時は localStorage に bc_* キーで JSON snapshot を保存。
 * @param {string} url
 * @returns {Promise<unknown>}
 */
function fetchWithFallback(url) {
  const baseUrl = url.split('?')[0];
  const workerUrl = _mapToWorkerUrl(baseUrl);

  // 成功時の共通処理: health=ok、最終 fetch 成功時刻を記録、localStorage に snapshot
  function _onOk(d) {
    _setApiHealth(baseUrl, 'ok');
    _markFetchOk(); // rt-fix P0-1
    try {
      const serialized = JSON.stringify({ data: d, time: Date.now() });
      if (serialized.length <= BC_MAX_BYTES) {
        localStorage.setItem(_g.cacheKey(baseUrl), serialized);
      }
    } catch (_) {}
    return d;
  }

  // rt-fix P1-5 (2026-06-04): 3 段 fallback。
  //   Tier 1: Worker /api/* (KV、~5 分鮮度、最速・GHA 独立)  ← timeout 8s→4s に短縮
  //   Tier 2: openapi 直接 (上流公式、~30 分)               ← timeout 15s→8s に短縮
  //   Tier 3: localStorage cache (10 min まで)
  // 注: 自前 GitHub Pages data/*.json は openapi と別スキーマ（previews は `races` キー、
  //     programs は未配信）のためドロップイン代替にできない。Worker は内部で
  //     boatrace.jp を直スクレイプするため openapi 障害時の独立系を既に持つ。
  //     timeout 短縮で「Worker 沈黙時に毎回長く待つ」体感劣化を防止する。
  const primary = workerUrl
    ? _fetchOne(workerUrl + '?_=' + Date.now(), 4000)
    : Promise.reject(new Error('no-worker-mapping'));

  // Tier 3: openapi 直接 + Tier 4: localStorage cache（共通の最終段）。
  function _openapiThenCache() {
    return _fetchOne(url, 8000)
      .then(_onOk)
      .catch(function (e) {
        console.warn('API error:', baseUrl, e.message);
        // Tier 4: localStorage cache (10 min まで)
        try {
          const c = localStorage.getItem(_g.cacheKey(baseUrl));
          if (c) {
            const o = JSON.parse(c);
            if (Date.now() - o.time < 600000) {
              _setApiHealth(baseUrl, 'cached');
              return o.data;
            }
          }
        } catch (_) {}
        _setApiHealth(baseUrl, 'fail');
        return null;
      });
  }

  return primary.then(_onOk).catch(function (workerErr) {
    if (workerErr && workerErr.message !== 'no-worker-mapping') {
      console.warn('[fetch] worker miss:', workerErr.message);
    }
    // 公式移行 Phase 2: Tier 2 = 自前公式 data/*（programs のみ、openapi 互換・同一 origin）。
    //   空/壊れは次段 (openapi) へ。非公式ミラーより前に公式を優先する。
    const officialUrl = _mapToOfficialUrl(baseUrl);
    if (!officialUrl) return _openapiThenCache();
    return _fetchOne(officialUrl + '?_=' + Date.now(), 5000)
      .then(function (/** @type {any} */ d) {
        if (!d || !Array.isArray(d.programs) || d.programs.length === 0) {
          throw new Error('official-empty');
        }
        return _onOk(d);
      })
      .catch(function (offErr) {
        if (offErr && offErr.message !== 'official-empty') {
          console.warn('[fetch] official miss, falling back to openapi:', offErr.message);
        }
        return _openapiThenCache();
      });
  });
}

/**
 * 受信 JSON のスキーマ最小検証 (P4 W-08)。
 * apiJson が object で apiJson[key] が配列であることを確認。
 * @param {unknown} apiJson
 * @param {string} key
 * @returns {boolean}
 */
function validateApiPayload(apiJson, key) {
  if (!apiJson || typeof apiJson !== 'object') return false;
  if (!Array.isArray(apiJson[key])) return false;
  // race_stadium_number / race_number の存在は indexByStadiumRace で String 化 → 最低限の存在チェック
  return true;
}

/**
 * race_stadium_number × race_number で 2 段ハッシュ化。
 * @param {any} apiJson
 * @param {string} key
 * @returns {Record<string, Record<string, unknown>> | null}
 */
function indexByStadiumRace(apiJson, key) {
  if (!validateApiPayload(apiJson, key)) {
    if (apiJson) {
      console.warn('[schema] invalid payload for', key);
      // P0-7: スキーマ不正は API 異常と同等に扱う
      try {
        _setApiHealth('/' + key + '/', 'fail');
      } catch (_) {}
    }
    return null;
  }
  const arr = apiJson[key];
  /** @type {Record<string, Record<string, unknown>>} */
  const result = {};
  // 2026-05-25: upstream openapi が朝早く refresh しきれていない時、
  //   today.json に **昨日の race_date が残る** 事故 (5/25 朝に 5/24 の
  //   多摩川/三国/尼崎 等が "12/12R 終了" として表示される)。
  //   client 側で race_date == 今日 JST のみを通すフィルタを追加。
  //   upstream が refresh されたら自動で fresh データに切替わる。
  let todayIso = null;
  try {
    if (typeof _g.todayStr === 'function') {
      const t = _g.todayStr(); // YYYYMMDD
      if (t && t.length === 8) {
        todayIso = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
      }
    }
  } catch (_) { /* fall back: フィルタなし */ }
  arr.forEach(function (/** @type {any} */ item) {
    // race_date フィールドがある場合、今日 JST と一致しないものは除外
    if (todayIso && item.race_date && item.race_date !== todayIso) return;
    const sid = String(item.race_stadium_number);
    const rn = String(item.race_number);
    if (!result[sid]) result[sid] = {};
    result[sid][rn] = item;
  });
  return result;
}

/**
 * @param {any} apiJson
 * @returns {Record<string, Record<string, unknown>> | null}
 */
function indexPreviews(apiJson) {
  const indexed = indexByStadiumRace(apiJson, 'previews');
  if (!indexed) return null;
  for (const sid in indexed) {
    for (const rn in indexed[sid]) {
      const p = /** @type {any} */ (indexed[sid][rn]);
      p.weather = {
        wind_speed: p.race_wind || 0,
        wind_direction: p.race_wind_direction_number || 0,
        wave_height: p.race_wave || 0,
        temperature: p.race_temperature || 0,
        water_temperature: p.race_water_temperature || 0,
        weather_number: p.race_weather_number || 0,
      };
    }
  }
  return indexed;
}

/**
 * @param {any} apiJson
 * @returns {Record<string, Record<string, unknown>> | null}
 */
function indexResults(apiJson) {
  const indexed = indexByStadiumRace(apiJson, 'results');
  if (!indexed) return null;
  for (const sid in indexed) {
    for (const rn in indexed[sid]) {
      const r = /** @type {any} */ (indexed[sid][rn]);
      const isFinished = r.race_technique_number != null;
      if (isFinished && r.boats && Array.isArray(r.boats)) {
        r.results = r.boats
          .filter(function (/** @type {any} */ b) {
            return b.racer_place_number != null;
          })
          .map(function (/** @type {any} */ b) {
            return {
              place: b.racer_place_number,
              racer_boat_number: b.racer_boat_number,
              racer_course_number: b.racer_course_number,
              racer_number: b.racer_number,
              racer_name: b.racer_name,
              racer_start_timing: b.racer_start_timing,
            };
          });
      }
      if (r.payouts) r.refund = r.payouts;
      r.technique_number = r.race_technique_number;
      r.isFinished = isFinished;
    }
  }
  return indexed;
}

/**
 * 公式 API previews/v2/today.json は (1) 前日データを残す、
 * (2) 当日の race_date に切り替わっても展示走行前は exhibition_time=0 /
 * start_timing=null のままという 2 つの性質がある。
 * レース単位で「展示済みのレースだけ」残す（展示前は前日値が紛れる原因）。
 * @param {any} raw
 * @returns {any}
 */
function _filterStalePreviews(raw) {
  if (!raw || !Array.isArray(raw.previews) || !raw.previews.length) return raw;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const firstDate = raw.previews[0].race_date || '';
  if (firstDate && firstDate !== today) {
    console.warn('公式 API previews は古い(' + firstDate + ' JST), 全件 skip');
    return { previews: [], updated_at: raw.updated_at };
  }
  // 「データが何もない」プレースホルダだけ除外。
  //   PI-fix: 気象が計測済 OR 展示済 ならそのレースは「データあり」と扱う。
  const filtered = raw.previews.filter(function (p) {
    const hasWeather =
      (p.race_wind || 0) > 0 ||
      (p.race_water_temperature || 0) > 0 ||
      (p.race_temperature || 0) > 0 ||
      (p.race_wave || 0) > 0 ||
      p.race_wind_direction_number != null;
    let bs = p.boats || [];
    if (!Array.isArray(bs))
      bs = Object.keys(bs).map(function (k) {
        return bs[k];
      });
    const hasExh = bs.some(function (b) {
      return b && (b.racer_exhibition_time || 0) > 0;
    });
    return hasWeather || hasExh;
  });
  if (filtered.length !== raw.previews.length) {
    console.info('previews: ' + raw.previews.length + ' → ' + filtered.length + ' (データ未取得のレースを除外)');
  }
  return { previews: filtered, updated_at: raw.updated_at };
}

// rt-fix3 P0-6 (2026-06-27): アプリ内 Worker 死活検知（discovery 層 = ネットワーク IO 担当）。
//   非 strict の /health で「Worker が到達可能で ok:true か」だけを判定し、到達不能/エラー時のみ
//   _workerHealthy=false にしてバナー表示する。
//   注: 当初 /health?strict=1 を使ったが、strict は programs(朝1回しか更新されない静的キー)の
//   wrote_at が常に 30 分超で 500 を返すため、Worker が正常稼働中でも「停止中」を誤表示し、
//   再試行しても消えない不具合になっていた（kvWrite は内容変化時のみ書込むため wrote_at が古い）。
//   実データの古さは鮮度バッジ(updated_at 基準) が正直に表示する。cron の真の死活検知は
//   Worker 側の cron ハートビート（/health の cron_age_sec）＋外部死活監視に委ねる。
function _probeWorkerHealth() {
  try {
    if (typeof fetch !== 'function') return;
    fetch(WORKER_BASE + '/health', { cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        _g._workerHealthy = !!(j && j.ok);
      })
      .catch(function () {
        _g._workerHealthy = false;
      })
      .then(function () {
        if (typeof _g._renderApiHealthBanner === 'function') _g._renderApiHealthBanner();
      });
  } catch (_) {}
}

// globalThis export — 冒頭で定義済の _g 経由で Window インタフェースに整合
_g.BC_MAX_BYTES = BC_MAX_BYTES;
_g.WORKER_BASE = WORKER_BASE;
_g._probeWorkerHealth = _probeWorkerHealth;
_g._apiHealth = _apiHealth;
// rt-fix P0-1: 最終 fetch 成功時刻（epoch ms）。鮮度バッジが参照。
if (typeof _g._lastFetchOkAt !== 'number') _g._lastFetchOkAt = 0;
_g._setApiHealth = _setApiHealth;
_g._mapToWorkerUrl = _mapToWorkerUrl;
_g._fetchOne = _fetchOne;
_g.fetchWithFallback = fetchWithFallback;
_g.validateApiPayload = validateApiPayload;
_g.indexByStadiumRace = indexByStadiumRace;
_g.indexPreviews = indexPreviews;
_g.indexResults = indexResults;
_g._filterStalePreviews = _filterStalePreviews;

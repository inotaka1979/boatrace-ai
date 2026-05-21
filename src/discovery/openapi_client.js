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
//   - globalThis.cacheKey (app.js 内に残る utility 関数)
//   - globalThis._renderApiHealthBanner (reporting 層へ後で移動予定; 未定義でも動作)
//
// Public (globalThis に export):
//   BC_MAX_BYTES / WORKER_BASE / _apiHealth / _setApiHealth
//   _mapToWorkerUrl / _fetchOne / fetchWithFallback
//   validateApiPayload / indexByStadiumRace / indexPreviews / indexResults
//   _filterStalePreviews

'use strict';

// Epic 28b: localStorage 5MB 超過の真因 — fetchWithFallback が programs/previews
//   (各 ~1MB の API response 全体) を毎回 bc_* に保存していた。
//   対策: サイズ上限 (BC_MAX_BYTES=100KB) を設け、超過レスポンスは bc_* 非保存。
const BC_MAX_BYTES = 100 * 1024;

// Path C (2026-05-17): Cloudflare Worker を一次データソースに。
// 3 段 fallback: Worker /api → openapi 直接 → localStorage cache
const WORKER_BASE = 'https://boatrace-scrape-trigger.inotaka1979.workers.dev';

// API ヘルス状態（programs / previews / results / odds）
const _apiHealth = { programs:'ok', previews:'ok', results:'ok', odds:'ok' };

function _setApiHealth(url, state){
  const key = (url.indexOf('/programs/')>=0) ? 'programs'
            : (url.indexOf('/previews/')>=0) ? 'previews'
            : (url.indexOf('/results/')>=0) ? 'results'
            : (url.indexOf('/odds/')>=0)     ? 'odds' : null;
  if(!key) return;
  _apiHealth[key] = state;
  // reporting 層に変更通知（DOM 更新は reporting 側関数の責務）
  if (typeof globalThis._renderApiHealthBanner === 'function') {
    try { globalThis._renderApiHealthBanner(); } catch (_) {}
  }
}

// openapi URL を Worker URL に map (programs/previews/results)
function _mapToWorkerUrl(openapiUrl){
  if(openapiUrl.indexOf('/programs/v2/today.json') >= 0) return WORKER_BASE + '/api/programs';
  if(openapiUrl.indexOf('/previews/v2/today.json') >= 0) return WORKER_BASE + '/api/previews';
  if(openapiUrl.indexOf('/results/v2/today.json') >= 0)  return WORKER_BASE + '/api/results';
  return null;   // Worker でカバーされない URL (過去日付 等) は openapi 直
}

function _fetchOne(url, timeoutMs){
  // Clearwing Phase 1: capabilities.makeTimeoutSignal で iOS Safari 旧版 (AbortSignal.timeout 非対応) を吸収
  const signal = globalThis.capabilities.makeTimeoutSignal(timeoutMs||10000);
  return fetch(url, { signal: signal, cache: 'no-store' })
    .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); });
}

function fetchWithFallback(url){
  const baseUrl = url.split('?')[0];
  const workerUrl = _mapToWorkerUrl(baseUrl);
  // Tier 1: Worker /api/* (Cloudflare KV、~ 5 分鮮度、GHA 独立)
  const primary = workerUrl
    ? _fetchOne(workerUrl + '?_=' + Date.now(), 8000)
    : Promise.reject(new Error('no-worker-mapping'));
  return primary
    .then(function(d){
      _setApiHealth(baseUrl, 'ok');
      try{
        const serialized = JSON.stringify({data:d,time:Date.now()});
        if(serialized.length <= BC_MAX_BYTES){
          localStorage.setItem(globalThis.cacheKey(baseUrl), serialized);
        }
      } catch (_) {}
      return d;
    })
    .catch(function(workerErr){
      // Tier 2: openapi 直接 (Worker 失敗時)
      if(workerErr && workerErr.message !== 'no-worker-mapping'){
        console.warn('[fetch] worker miss, falling back to openapi:', workerErr.message);
      }
      return _fetchOne(url, 15000)
        .then(function(d){
          try{
            const serialized = JSON.stringify({data:d,time:Date.now()});
            if(serialized.length <= BC_MAX_BYTES){
              localStorage.setItem(globalThis.cacheKey(baseUrl), serialized);
            }
          } catch (_) {}
          _setApiHealth(baseUrl, 'ok');
          return d;
        })
        .catch(function(e){
          console.warn('API error:', baseUrl, e.message);
          // Tier 3: localStorage cache (10 min まで)
          try{
            const c = localStorage.getItem(globalThis.cacheKey(baseUrl));
            if(c){
              const o = JSON.parse(c);
              if(Date.now()-o.time<600000){
                _setApiHealth(baseUrl, 'cached');
                return o.data;
              }
            }
          } catch (_) {}
          _setApiHealth(baseUrl, 'fail');
          return null;
        });
    });
}

// P4 W-08: 受信 JSON のスキーマ最小検証
function validateApiPayload(apiJson, key){
  if(!apiJson || typeof apiJson !== 'object') return false;
  if(!Array.isArray(apiJson[key])) return false;
  // race_stadium_number / race_number の存在は indexByStadiumRace で String 化 → 最低限の存在チェック
  return true;
}

function indexByStadiumRace(apiJson, key){
  if(!validateApiPayload(apiJson, key)){
    if(apiJson){
      console.warn('[schema] invalid payload for', key);
      // P0-7: スキーマ不正は API 異常と同等に扱う
      try { _setApiHealth('/'+key+'/', 'fail'); } catch (_) {}
    }
    return null;
  }
  const arr = apiJson[key];
  const result = {};
  arr.forEach(function(item){
    const sid = String(item.race_stadium_number);
    const rn = String(item.race_number);
    if(!result[sid]) result[sid] = {};
    result[sid][rn] = item;
  });
  return result;
}

function indexPreviews(apiJson){
  const indexed = indexByStadiumRace(apiJson, 'previews');
  if(!indexed) return null;
  for(const sid in indexed){
    for(const rn in indexed[sid]){
      const p = indexed[sid][rn];
      p.weather = {
        wind_speed:           p.race_wind || 0,
        wind_direction:       p.race_wind_direction_number || 0,
        wave_height:          p.race_wave || 0,
        temperature:          p.race_temperature || 0,
        water_temperature:    p.race_water_temperature || 0,
        weather_number:       p.race_weather_number || 0,
      };
    }
  }
  return indexed;
}

function indexResults(apiJson){
  const indexed = indexByStadiumRace(apiJson, 'results');
  if(!indexed) return null;
  for(const sid in indexed){
    for(const rn in indexed[sid]){
      const r = indexed[sid][rn];
      const isFinished = r.race_technique_number != null;
      if(isFinished && r.boats && Array.isArray(r.boats)){
        r.results = r.boats.filter(function(b){ return b.racer_place_number != null; }).map(function(b){
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
      if(r.payouts) r.refund = r.payouts;
      r.technique_number = r.race_technique_number;
      r.isFinished = isFinished;
    }
  }
  return indexed;
}

// 公式 API previews/v2/today.json は (1) 前日データを残す、
// (2) 当日の race_date に切り替わっても展示走行前は exhibition_time=0 /
// start_timing=null のままという 2 つの性質がある。
// レース単位で「展示済みのレースだけ」残す（展示前は前日値が紛れる原因）。
function _filterStalePreviews(raw){
  if(!raw || !Array.isArray(raw.previews) || !raw.previews.length) return raw;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const firstDate = raw.previews[0].race_date || '';
  if(firstDate && firstDate !== today){
    console.warn('公式 API previews は古い('+firstDate+' JST), 全件 skip');
    return { previews: [], updated_at: raw.updated_at };
  }
  // 「データが何もない」プレースホルダだけ除外。
  //   PI-fix: 気象が計測済 OR 展示済 ならそのレースは「データあり」と扱う。
  const filtered = raw.previews.filter(function(p){
    const hasWeather = (p.race_wind||0) > 0 || (p.race_water_temperature||0) > 0
                    || (p.race_temperature||0) > 0 || (p.race_wave||0) > 0
                    || (p.race_wind_direction_number != null);
    let bs = p.boats || [];
    if(!Array.isArray(bs)) bs = Object.keys(bs).map(function(k){ return bs[k]; });
    const hasExh = bs.some(function(b){ return b && (b.racer_exhibition_time||0) > 0; });
    return hasWeather || hasExh;
  });
  if(filtered.length !== raw.previews.length){
    console.info('previews: ' + raw.previews.length + ' → ' + filtered.length + ' (データ未取得のレースを除外)');
  }
  return { previews: filtered, updated_at: raw.updated_at };
}

// globalThis export
globalThis.BC_MAX_BYTES = BC_MAX_BYTES;
globalThis.WORKER_BASE = WORKER_BASE;
globalThis._apiHealth = _apiHealth;
globalThis._setApiHealth = _setApiHealth;
globalThis._mapToWorkerUrl = _mapToWorkerUrl;
globalThis._fetchOne = _fetchOne;
globalThis.fetchWithFallback = fetchWithFallback;
globalThis.validateApiPayload = validateApiPayload;
globalThis.indexByStadiumRace = indexByStadiumRace;
globalThis.indexPreviews = indexPreviews;
globalThis.indexResults = indexResults;
globalThis._filterStalePreviews = _filterStalePreviews;

// PG-2: Worker 用予測モジュール
// Clearwing Phase 2: src/capabilities-worker.js を BUILD マーカー領域に注入。
//   その他の関数は本ファイルが source-of-truth（手動メンテ）。

'use strict';

/* BUILD:CAPABILITIES_WORKER:START */
"use strict";
(() => {
  // ../src/capabilities-worker.js
  var WorkerCapabilities = class {
    constructor() {
      this._sync = /* @__PURE__ */ new Map();
      this._async = /* @__PURE__ */ new Map();
    }
    detectSync() {
      this._set("abort_timeout", typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function");
      this._set("fetch", typeof fetch === "function");
      this._set("indexed_db", typeof indexedDB !== "undefined");
      this._set("cache_api", typeof caches !== "undefined");
      this._set("local_storage", false);
      this._set("scheduler_post_task", typeof scheduler !== "undefined" && typeof scheduler.postTask === "function");
      this._set("scheduler_yield", typeof scheduler !== "undefined" && typeof scheduler.yield === "function");
      this._set("worker", typeof Worker !== "undefined");
    }
    _set(name, value) {
      this._sync.set(name, value === true);
    }
    has(name) {
      if (this._sync.has(name)) return this._sync.get(name) === true;
      if (this._async.has(name)) return this._async.get(name) === true;
      return false;
    }
    refresh(_name) {
      this.detectSync();
    }
    list() {
      return Array.from(this._sync.keys()).concat(Array.from(this._async.keys()));
    }
    makeTimeoutSignal(ms) {
      if (this.has("abort_timeout")) {
        return AbortSignal.timeout(ms);
      }
      const c = new AbortController();
      setTimeout(() => {
        try {
          c.abort();
        } catch (_) {
        }
      }, ms);
      return c.signal;
    }
    runIdle(fn, opts) {
      if (this.has("scheduler_post_task")) {
        return scheduler.postTask(fn, { priority: "background", ...opts || {} });
      }
      return setTimeout(fn, opts && opts.delay || 0);
    }
  };
  var workerCaps = new WorkerCapabilities();
  workerCaps.detectSync();
  var _g = (
    /** @type {any} */
    globalThis
  );
  _g.capabilities = workerCaps;
  _g.WorkerCapabilities = WorkerCapabilities;
})();

/* BUILD:CAPABILITIES_WORKER:END */

var COURSE_WIN_RATE={1:0.55,2:0.14,3:0.12,4:0.11,5:0.06,6:0.02};
var COURSE_MULTIPLIER=35;
var ET_COURSE_DECAY={1:1.0,2:1.0,3:0.9,4:0.8,5:0.6,6:0.5};
var DEFAULT_COURSE_TECHNIQUE={
  1:{nige:0.88,sashi:0.02,makuri:0,makuriSashi:0,nuki:0.08,megumare:0.02},
  2:{nige:0,sashi:0.60,makuri:0.25,makuriSashi:0,nuki:0.10,megumare:0.05},
  3:{nige:0,sashi:0.15,makuri:0.40,makuriSashi:0.35,nuki:0.07,megumare:0.03},
  4:{nige:0,sashi:0.20,makuri:0.30,makuriSashi:0.35,nuki:0.10,megumare:0.05},
  5:{nige:0,sashi:0.10,makuri:0.45,makuriSashi:0.30,nuki:0.10,megumare:0.05},
  6:{nige:0,sashi:0.15,makuri:0.35,makuriSashi:0.30,nuki:0.10,megumare:0.10}
};
// 場別風向プロファイル（PG-2 抽出漏れ修正: isHeadWind / isTailWind が参照）
var STADIUM_WIND_PROFILE = {
  '02': { headWindDirs:[3,4,5],  tailWindDirs:[11,12,13] },
  '03': { headWindDirs:[5,6,7],  tailWindDirs:[13,14,15] },
  '14': { headWindDirs:[9,10,11],tailWindDirs:[1,2,3]   },
  '12': { headWindDirs:[7,8,9],  tailWindDirs:[15,16,1] },
};
var GLOBAL_HEAD_DIRS = [7,8,9,10,11];
var GLOBAL_TAIL_DIRS = [15,16,1,2,3,4,5];

var L2_INIT_WEIGHTS=[3.0,1.5,-1.0,-4.0,-1.5,0.5,4.0,-0.8,1.0,1.5,0.3,3.5];
var L2_BIAS=0;
var FEATURE_DIM = 12;
var COURSE_LOG_PRIOR = [
  Math.log(COURSE_WIN_RATE[1]||0.55),
  Math.log(COURSE_WIN_RATE[2]||0.14),
  Math.log(COURSE_WIN_RATE[3]||0.12),
  Math.log(COURSE_WIN_RATE[4]||0.11),
  Math.log(COURSE_WIN_RATE[5]||0.06),
  Math.log(COURSE_WIN_RATE[6]||0.02)
];
var TUNING = Object.freeze({
  // レースタイプ判定（top1 確率 / top2 累積 / 環境ペナルティ）
  RACE_TYPE: Object.freeze({
    HONMEI_TOP1_MIN: 0.40,        // top1 これ以上で本命候補
    HONMEI_TOP2_MIN: 0.55,        // 本命は top1+top2 ≥ 0.55 を満たす必要
    ANA_TOP1_MAX: 0.25,           // top1 これ未満は穴候補
    ANA_WAVE_HEIGHT_CM: 7,        // 波高 cm 以上で穴判定
    ANA_WIND_SPEED_MS: 5,         // 風速 m/s 以上で穴判定
  }),
  // EV / Kelly（X1 設計）
  KELLY: Object.freeze({
    DEFAULT_FRAC: 0.5,            // half-Kelly を既定（過大ベット抑止）
    MIN_FRAC: 0.0,                // 最低 fraction（負ベット禁止）
    MAX_STAKE_RATIO: 1.0,         // bankroll 比 stake 上限
  }),
  // L2 ロジ回帰（PB で改善予定: LR decay / L2 正則化）
  L2: Object.freeze({
    LR: 0.01,
    BIAS_INIT: 0,
  }),
  // PB-5/6/7: 予測パイプライン拡張（既定値で互換性維持）
  PREDICTION: Object.freeze({
    ENABLE_ZSCORE: false,        // PB-7: z-score 正規化（既存重みと整合しないため既定 OFF）
    ENABLE_PLATT: true,          // PB-6: Platt scaling（identity 初期値で常時 ON 安全）
    STACKING_MODE: 'shrinkage',  // PB-5: 'shrinkage' | 'residual'（既定は線形融合）
    PLATT_MIN_SAMPLES: 200,      // Platt fit に必要な履歴最低件数
    ZSCORE_WARMUP_N: 100,        // z-score 適用開始までの観測数
  }),
});

// PG-3: Worker state (init/sync メッセージで main thread から受信)
var racerDB = {};
var stadiumDB = {};
var pairwiseDB = {};
var stadiumMotorStats = {};
var stadiumExhibitionStats = {};
var l2weights = L2_INIT_WEIGHTS.slice();
var _featureStats = { mean: new Array(FEATURE_DIM).fill(0), m2: new Array(FEATURE_DIM).fill(0), n: 0 };
var _plattCoeffs = { a: 1.0, b: 0.0, fittedAt: 0, n: 0 };
var _stackingGamma = 0.0;
var tideData = null;

// ダミー data accessors (worker は programData / previewData を main から受取)
var programData = null;
var previewData = null;
var oddsData = null;

// safeSet shim — Worker は localStorage 非対応 (DedicatedWorker spec)。
//   src/analysis/* と等価な l2Update 等を sync するため、本シムを no-op として定義。
//   永続化は batchLearnFromResults が postMessage で main に state を返す経路で行う。
//   (Phase 2 完遂続編: scripts/tests/test_worker_twin_sync.js で main / worker 関数等価性を保証)
function safeSet(_k, _v) { /* no-op in worker; main thread persists via batchLearnFromResults */ }

// math helpers (src/utils/math.js から手動コピー、worker self-contained のため)
function softmax(logits) {
  if (!Array.isArray(logits) || logits.length === 0) return [];
  const clean = logits.map((v) => (Number.isFinite(v) ? v : 0));
  let max = clean.reduce((a, b) => (b > a ? b : a), -Infinity);
  if (!Number.isFinite(max)) max = 0;
  const exps = clean.map((v) => Math.exp(Math.min(v - max, 50)));
  const sum = exps.reduce((a, b) => a + b, 0);
  if (sum === 0 || !Number.isFinite(sum)) return clean.map(() => 1 / clean.length);
  return exps.map((x) => x / sum);
}
function safeDiv(num, den, fallback) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return fallback == null ? 0 : fallback;
  }
  return num / den;
}


function _applyPlattCalibration(p){
  if(!TUNING.PREDICTION.ENABLE_PLATT) return p;
  var a = _plattCoeffs.a, b = _plattCoeffs.b;
  if(a === 1 && b === 0) return p;   // 高速 path: identity
  // ロジット変換 (clip で 0/1 を回避)
  var clipped = Math.min(0.9999, Math.max(0.0001, p));
  var logit = Math.log(clipped / (1 - clipped));
  var z = a * logit + b;
  // sigmoid (overflow 安全)
  if(z > 30) return 1.0;
  if(z < -30) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
}

function _computeClassAttenuation(allBoats) {
  if (!Array.isArray(allBoats) || !allBoats.length) return 1.0;
  var avgClass = 0;
  allBoats.forEach(function (b) {
    avgClass += (b && b.racer_class_number) || 3;
  });
  avgClass /= allBoats.length;
  if (avgClass >= 3.5) return 0.55;
  if (avgClass >= 3.0) return 0.7;
  if (avgClass >= 2.5) return 0.85;
  return 1.0;
}

function _normalizeFeatures(featRow){
  if(!TUNING.PREDICTION.ENABLE_ZSCORE) return featRow;
  var n = _featureStats.n;
  if(n < TUNING.PREDICTION.ZSCORE_WARMUP_N) return featRow;
  var means = _featureStats.mean;
  var m2s = _featureStats.m2;
  var divisor = n > 1 ? n - 1 : 1;
  var out = new Array(FEATURE_DIM);
  for(var i=0;i<FEATURE_DIM;i++){
    var variance = m2s[i] / divisor;
    var std = Math.sqrt(variance + 1e-6);
    var x = featRow[i] || 0;   // PF-5: Number.isFinite を省略（NaN→0 を || で代用）
    out[i] = (x - means[i]) / std;
  }
  return out;
}

function _plackettLuceExactaProb(p, i, j) {
  const pi = p[i] || 0,
    pj = p[j] || 0;
  if (pi <= 0 || pj <= 0) return 0;
  const denom = 1 - pi;
  if (denom <= 1e-9) return 0;
  const prob = pi * (pj / denom);
  return Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
}

function _plackettLuceTrifectaProb(p, i, j, k) {
  const pi = p[i] || 0,
    pj = p[j] || 0,
    pk = p[k] || 0;
  if (pi <= 0 || pj <= 0 || pk <= 0) return 0;
  const denom1 = 1 - pi;
  if (denom1 <= 1e-9) return 0;
  const denom2 = 1 - pi - pj;
  if (denom2 <= 1e-9) return 0;
  const prob = pi * (pj / denom1) * (pk / denom2);
  return Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
}

function _resolveCourse(boat, preview, predictedEntries) {
  var bn = boat.racer_boat_number;
  if (preview && preview.racer_course_number != null) {
    return { course: preview.racer_course_number, entryConf: 1.0, source: 'preview' };
  }
  if (predictedEntries && predictedEntries.byBoat && predictedEntries.byBoat[bn]) {
    return {
      course: predictedEntries.byBoat[bn],
      entryConf: predictedEntries.conf[bn] || 0.5,
      source: 'predicted',
    };
  }
  return { course: preview ? preview.racer_boat_number : bn, entryConf: 1.0, source: 'frame' };
}

function buildExactaProbDist(marks){
  var p = marks.map(function(m){return m.prob||0;});
  var dist = {};
  for(var i=0;i<marks.length;i++){
    for(var j=0;j<marks.length;j++){
      if(j===i) continue;
      var key = marks[i].boat + '-' + marks[j].boat;
      dist[key] = _plackettLuceExactaProb(p, i, j);
    }
  }
  return dist;
}

// B14 (2026-05-17): main app.js の _pickAnaCandidates と同等。worker 経由 backfill
//   でも bets.ana が attach されるよう同コードを持ち込む。
function _pickAnaCandidates(marks, oddsMap, opts){
  if(!Array.isArray(marks) || marks.length<3 || !oddsMap || typeof oddsMap !== 'object') {
    return { primary: [], fallback: [] };
  }
  var o = opts || {};
  var minOdds = o.minOdds != null ? o.minOdds : 30;
  var minEV = o.minEV != null ? o.minEV : 1.0;
  var minOddsLoose = o.minOddsLoose != null ? o.minOddsLoose : 15;
  var topN = o.topN != null ? o.topN : 3;
  var excludeSet = {};
  if(Array.isArray(o.excludeCombos)){
    o.excludeCombos.forEach(function(c){ if(c) excludeSet[String(c)] = true; });
  }
  var dist = buildTrifectaProbDist(marks);
  var primary = [], loose = [];
  for(var combo in dist){
    if(!Object.prototype.hasOwnProperty.call(dist, combo)) continue;
    if(excludeSet[combo]) continue;
    var odds = oddsMap[combo];
    if(odds == null) continue;
    var prob = dist[combo];
    if(prob <= 0) continue;
    var ev = prob * odds;
    var pick = {combo: combo, prob: prob, odds: odds, ev: ev};
    if(odds >= minOdds && ev >= minEV) primary.push(pick);
    if(odds >= minOddsLoose) loose.push(pick);
  }
  primary.sort(function(a,b){ return b.ev - a.ev; });
  loose.sort(function(a,b){ return b.ev - a.ev; });
  return {
    primary: primary.slice(0, topN),
    fallback: loose.slice(0, topN),
  };
}

function buildTrifectaProbDist(marks){
  var p = marks.map(function(m){return m.prob||0;});
  var dist = {};
  for(var i=0;i<marks.length;i++){
    for(var j=0;j<marks.length;j++){
      if(j===i) continue;
      for(var k=0;k<marks.length;k++){
        if(k===i || k===j) continue;
        var key = marks[i].boat + '-' + marks[j].boat + '-' + marks[k].boat;
        dist[key] = _plackettLuceTrifectaProb(p, i, j, k);
      }
    }
  }
  return dist;
}

function cacheKey(url){var cleanUrl=url.split('?')[0];var h=0;for(var i=0;i<cleanUrl.length;i++){h=((h<<5)-h)+cleanUrl.charCodeAt(i);h|=0}return'bc_'+Math.abs(h)}
// F10: ヘッダー右「更新」ボタン用フルリロード
//   旧バグ: SW がページを制御し続けていたため、unregister 直後の location.replace でも
//          古いキャッシュが intercept されていた。
//   解決: 1) SW に PURGE_ALL を送信し全 cache 削除を SW 側で待機
//        2) クライアント側でも cache + bc_* localStorage を削除
//        3) すべての SW を unregister
//        4) cache:'reload' を使って index.html を一度 fetch し HTTP キャッシュも無効化
//        5) location.assign で再ナビゲート（履歴に残してデバッグ容易に）
async function hardReload(){
  var btn = event && event.target;
  if(btn){ btn.disabled=true; btn.textContent='⏳ 削除中...'; }
  try{
    // 1) アクティブな SW に purge を依頼（cache を SW が握っている場合の救済）
    if('serviceWorker' in navigator && navigator.serviceWorker.controller){
      try{
        var purged = new Promise(function(resolve){
          var to = setTimeout(resolve, 1500);  // タイムアウト 1.5s
          navigator.serviceWorker.addEventListener('message', function _h(e){
            if(e.data && e.data.type==='PURGED'){
              clearTimeout(to);
              navigator.serviceWorker.removeEventListener('message', _h);
              resolve();
            }
          });
          navigator.serviceWorker.controller.postMessage('PURGE_ALL');
        });
        await purged;
      }catch(_){}
    }
    // 2) クライアント側でも全 cache を削除（念のため重複実行）
    if('caches' in window){
      var keys = await caches.keys();
      await Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }
    // 3) 全 SW を unregister
    if('serviceWorker' in navigator){
      var regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(function(r){ return r.unregister(); }));
    }
    // 4) bc_* localStorage を削除
    var bcKeys=[];
    for(var i=0;i<localStorage.length;i++){
      var k = localStorage.key(i);
      if(k && k.indexOf('bc_')===0) bcKeys.push(k);
    }
    bcKeys.forEach(function(k){ try{ localStorage.removeItem(k); }catch(_){} });
    // 5) HTTP キャッシュも no-store で叩いて無効化（SW 解除後の素の fetch）
    try{
      var burst = new URL(location.href);
      burst.searchParams.set('_warm', Date.now());
      await fetch(burst.toString(), {cache:'reload', mode:'same-origin'});
    }catch(_){}
  }catch(e){ console.warn('hardReload prep error:', e); }
  // 6) cache-busting query で再ナビゲート
  var url = new URL(location.href);
  url.searchParams.set('_r', Date.now());
  location.assign(url.toString());
}

function calcOddsDivergence(aiProbsByBoat, oddsWin){
  if(!oddsWin) return null;
  var sumInv = 0;
  for(var b=1; b<=6; b++){ if(oddsWin[String(b)]) sumInv += 1 / oddsWin[String(b)]; }
  if(sumInv === 0) return null;
  var result = {};
  for(var b2=1; b2<=6; b2++){
    var ai = aiProbsByBoat[b2-1] || 0;
    var market = oddsWin[String(b2)] ? (1/oddsWin[String(b2)]) / sumInv : 0;
    result[b2] = {
      ai_prob: ai,
      market_prob: market,
      delta: ai - market,
      ev: oddsWin[String(b2)] ? ai * oddsWin[String(b2)] : null,
    };
  }
  return result;
}

function classifyTidePhase(tideEntry, raceTimeJst){
  if(!tideEntry || tideEntry.type !== 'saltwater' || !Array.isArray(tideEntry.today)) return null;
  // raceTimeJst: 'HH:MM' or hour as int
  var hour;
  if(typeof raceTimeJst === 'string'){
    hour = parseInt(raceTimeJst.split(':')[0], 10);
  } else if(typeof raceTimeJst === 'number'){
    hour = raceTimeJst;
  } else {
    return null;
  }
  if(!isFinite(hour)) return null;
  // 当該時刻と前後 1h の潮位
  var nowLv = (tideEntry.today.find(function(x){return x.hour===hour}) || {}).level_cm;
  var prevLv = (tideEntry.today.find(function(x){return x.hour===hour-1}) || {}).level_cm;
  var nextLv = (tideEntry.today.find(function(x){return x.hour===hour+1}) || {}).level_cm;
  if(nowLv == null) return null;
  // 単純分類: 潮位の変化方向 + 絶対位置
  var rising = (nextLv != null && nextLv > nowLv) || (prevLv != null && nowLv > prevLv);
  var falling = (nextLv != null && nextLv < nowLv) || (prevLv != null && nowLv < prevLv);
  // 高潮位 / 低潮位の閾値（cm 単位、日中の最大値の上位 20% を high とみなす簡易判定）
  var levels = tideEntry.today.map(function(x){return x.level_cm}).filter(function(v){return v!=null});
  if(levels.length === 0) return null;
  var sortedLv = levels.slice().sort(function(a,b){return a-b});
  var p80 = sortedLv[Math.floor(levels.length * 0.8)];
  var p20 = sortedLv[Math.floor(levels.length * 0.2)];
  if(nowLv >= p80) return 'high';
  if(nowLv <= p20) return 'low';
  if(rising) return 'rising';
  if(falling) return 'falling';
  return null;
}

function escText(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}

// P3 L-11: JST日付計算を 1 関数に集約（旧 todayStr/formatDate のロジックを内部利用）
function getJSTDate(offsetDays){
  var t = Date.now() + 9*3600000 + (offsetDays||0)*86400000;
  return new Date(t);
}

function exhibitionZScore(etTime, sid){
  var s = stadiumExhibitionStats[String(sid)];
  if(!s || s.count < 50 || !etTime || etTime > 8) return 0;
  return (etTime - s.mean) / s.std;   // 速いほど負（良い）
}

function generateBetsV2(marks,method,count3,count2){
  var trifecta=[],exacta=[],quinella=[];
  for(var i=0;i<marks.length;i++){
    for(var j=0;j<marks.length;j++){
      if(j===i) continue;
      exacta.push({combo:marks[i].boat+'-'+marks[j].boat,prob:marks[i].prob*marks[j].prob*2});
      if(i<j) quinella.push({combo:marks[i].boat+'='+marks[j].boat,prob:(marks[i].prob*marks[j].prob+marks[j].prob*marks[i].prob)*2});
      for(var k=0;k<marks.length;k++){
        if(k===i||k===j) continue;
        trifecta.push({combo:marks[i].boat+'-'+marks[j].boat+'-'+marks[k].boat,prob:marks[i].prob*marks[j].prob*marks[k].prob*6});
      }
    }
  }
  trifecta.sort(function(a,b){return b.prob-a.prob});
  exacta.sort(function(a,b){return b.prob-a.prob});
  quinella.sort(function(a,b){return b.prob-a.prob});

  var selTri,methodLabel;

  // X1: EV モード
  if(method==='ev' && arguments.length>=5){
    var raceOdds = arguments[4];   // { trifecta: {...}, exacta: {...}, win: {...} }
    var evOpt = arguments[5] || {};
    if(raceOdds && raceOdds.trifecta){
      var triProbDist = buildTrifectaProbDist(marks);
      selTri = selectBetsByEV(triProbDist, raceOdds.trifecta, evOpt);
    } else {
      selTri = trifecta.slice(0, count3);   // オッズ未取得時は確率順フォールバック
    }
    var selExa = [];
    if(raceOdds && raceOdds.exacta){
      var exaProbDist = buildExactaProbDist(marks);
      selExa = selectBetsByEV(exaProbDist, raceOdds.exacta, evOpt);
    } else {
      selExa = exacta.slice(0, count2);
    }
    return {
      trifecta: selTri,
      exacta: selExa.slice(0, count2),
      quinella: quinella.slice(0, count2),
      methodLabel: 'EV(≥' + (evOpt.evMin||1.15) + ')',
    };
  } else if(method==='formation'){
    var top2=marks.slice(0,2).map(function(m){return m.boat});
    var top4=marks.slice(0,4).map(function(m){return m.boat});
    var top5=marks.slice(0,5).map(function(m){return m.boat});
    var formBets={};
    top2.forEach(function(a){
      top4.forEach(function(b){
        if(b===a) return;
        top5.forEach(function(c){
          if(c===a||c===b) return;
          var key=a+'-'+b+'-'+c;
          var tp=trifecta.find(function(t){return t.combo===key});
          formBets[key]=tp?tp.prob:0;
        });
      });
    });
    selTri=Object.keys(formBets).map(function(k){return{combo:k,prob:formBets[k]}}).sort(function(a,b){return b.prob-a.prob}).slice(0,count3);
    methodLabel='フォーメーション';
  } else if(method==='box'){
    var topN=count3<=6?3:4;
    var boxBoats=marks.slice(0,topN).map(function(m){return m.boat});
    var boxBets=[];
    for(var bi=0;bi<boxBoats.length;bi++){
      for(var bj=0;bj<boxBoats.length;bj++){
        if(bj===bi) continue;
        for(var bk=0;bk<boxBoats.length;bk++){
          if(bk===bi||bk===bj) continue;
          var key=boxBoats[bi]+'-'+boxBoats[bj]+'-'+boxBoats[bk];
          var tp=trifecta.find(function(t){return t.combo===key});
          boxBets.push({combo:key,prob:tp?tp.prob:0});
        }
      }
    }
    selTri=boxBets.sort(function(a,b){return b.prob-a.prob}).slice(0,count3);
    methodLabel='BOX('+topN+'艇)';
  } else {
    selTri=trifecta.slice(0,count3);
    methodLabel='確率順';
  }

  return{
    trifecta:selTri,
    exacta:exacta.slice(0,count2),
    quinella:quinella.slice(0,count2),
    methodLabel:methodLabel
  };
}

function getEntryDist(rid, boat, sid){
  // 1. 選手個人データ
  if(rid && racerDB[rid] && racerDB[rid].entryPattern && racerDB[rid].entryPattern.byBoat){
    var personal = racerDB[rid].entryPattern.byBoat[String(boat)];
    if(personal && Object.keys(personal).length > 0){
      var personalSamples = racerDB[rid].entryPattern.samples || 0;
      // 個人サンプル >= 8 で個人データのみ使用、それ未満は混合
      if(personalSamples >= 8) return personal;
      // 混合: w_personal = samples/8
      var defaultD = (DEFAULT_ENTRY_BY_STADIUM[String(sid).padStart(2,'0')] || GLOBAL_DEFAULT_ENTRY)[boat] || {};
      var w = Math.min(1, personalSamples / 8);
      var mixed = {};
      var allKeys = new Set(Object.keys(personal).concat(Object.keys(defaultD)));
      allKeys.forEach(function(k){
        mixed[k] = w * (personal[k]||0) + (1-w) * (defaultD[k]||0);
      });
      return mixed;
    }
  }
  // 2. 場別デフォルト
  var sidPad = String(sid).padStart(2,'0');
  if(DEFAULT_ENTRY_BY_STADIUM[sidPad] && DEFAULT_ENTRY_BY_STADIUM[sidPad][boat]){
    return DEFAULT_ENTRY_BY_STADIUM[sidPad][boat];
  }
  // 3. グローバルデフォルト
  return GLOBAL_DEFAULT_ENTRY[boat] || {};
}

function getJSTDate(offsetDays){
  var t = Date.now() + 9*3600000 + (offsetDays||0)*86400000;
  return new Date(t);
}

function getL2Features(boat, preview, weather, etRank, stRank, sid) {
  var course =
    preview && preview.racer_course_number != null
      ? preview.racer_course_number
      : preview
        ? preview.racer_boat_number
        : boat.racer_boat_number;
  var rid = boat.racer_number || 0;
  var racerCWR = getRacerCourseWinRate(rid, course);
  var stadCWR = getStadiumCourseWinRate(String(sid), course);
  var myPv = preview || {};
  var st = myPv.racer_start_timing != null ? pf(myPv.racer_start_timing) : 99;
  var tilt = pf(myPv.racer_tilt_adjustment);

  var windCourse = 0;
  if (weather) {
    var ws = weather.wind_speed || weather.race_wind || 0;
    var wd = weather.wind_direction || weather.race_wind_direction_number || 0;
    var isHead = wd >= 7 && wd <= 11;
    if (isHead && course === 1) windCourse = -ws / 10;
    else if (isHead && course >= 4) windCourse = ws / 20;
  }

  var etComp = 0;
  if (etRank <= 1 && st > 0 && st <= 0.1) etComp = 1;
  else if (etRank >= 4 && st >= 0.15) etComp = -1;

  var formScore = 0;
  var form = getRacerForm(rid);
  if (form) formScore = form.score / 10;

  var tiltAlign = 0;
  if (course <= 2 && tilt <= -0.5) tiltAlign = 1;
  else if (course >= 4 && tilt >= 0.5) tiltAlign = 1;
  else if ((course <= 2 && tilt >= 0.5) || (course >= 4 && tilt <= -0.5)) tiltAlign = -1;

  return [
    pf(boat.racer_national_top_1_percent) / 10,
    pf(boat.racer_assigned_motor_top_2_percent) / 100,
    (etRank + 1) / 6,
    course / 6,
    (boat.racer_class_number || 3) / 4,
    windCourse,
    racerCWR || pf(boat.racer_national_top_1_percent) / 100,
    (stRank + 1) / 6,
    etComp,
    formScore,
    tiltAlign,
    stadCWR,
  ];
}

function getRacerCourseStyle(rid,course){
  var rdb=racerDB[rid];
  if(!rdb||!rdb.courseStyle||!rdb.courseStyle[course]) return null;
  return rdb.courseStyle[course];
}

function getRacerCourseWinRate(rid,course){
  var rdb=racerDB[rid];
  if(!rdb||!rdb.courseStats||!rdb.courseStats[course]) return null;
  var cs=rdb.courseStats[course];
  if(cs.races<5) return null;
  return cs.win/cs.races;
}

function getRacerForm(rid){
  var rdb=racerDB[rid];
  if(!rdb||!rdb.recentResults||rdb.recentResults.length<5) return null;
  var recent5=rdb.recentResults.slice(-5);
  var avg=recent5.reduce(function(a,b){return a+b},0)/5;
  var top2=recent5.filter(function(r){return r<=2}).length/5;
  var result={avg:avg,top2Rate:top2,score:0,trend:0,label:''};
  if(avg<=2.0){result.score=6;result.label='絶好調'}
  else if(avg<=3.0){result.score=3;result.label='好調'}
  else if(avg<=4.0){result.score=0;result.label='普通'}
  else if(avg<=5.0){result.score=-3;result.label='不調'}
  else{result.score=-6;result.label='絶不調'}
  if(top2>=0.6) result.score+=2;
  else if(top2>=0.4) result.score+=1;
  else if(top2<=0.2) result.score-=2;
  if(rdb.recentResults.length>=10){
    var prev5=rdb.recentResults.slice(-10,-5);
    var prevAvg=prev5.reduce(function(a,b){return a+b},0)/5;
    result.trend=prevAvg-avg;
    if(result.trend>0.5) result.score+=1;
    else if(result.trend<-0.5) result.score-=1;
  }
  return result;
}

function getStadiumCourseWinRate(sid,course){
  var sdb=stadiumDB[sid];
  if(!sdb||!sdb.courseWinRate||!sdb.courseWinRate[course]) return COURSE_WIN_RATE[course]||0;
  var cw=sdb.courseWinRate[course];
  if(cw.races<10) return COURSE_WIN_RATE[course]||0;
  return cw.win/cw.races;
}

function isHeadWind(wd, sid){
  var p = STADIUM_WIND_PROFILE[String(sid).padStart(2,'0')];
  var arr = p ? p.headWindDirs : GLOBAL_HEAD_DIRS;
  return arr.indexOf(wd) >= 0;
}

function isTailWind(wd, sid){
  var p = STADIUM_WIND_PROFILE[String(sid).padStart(2,'0')];
  var arr = p ? p.tailWindDirs : GLOBAL_TAIL_DIRS;
  return arr.indexOf(wd) >= 0;
}

function l2Predict(features6) {
  // PF-5: ホットパス最適化 — for ループ + 一時配列削減
  //   従来: map で new array x2 + closure 6 回 = ~12 オブジェクト生成
  //   新版: for で in-place 計算、logits 配列のみ生成 = ~1 オブジェクト
  var enableZ = TUNING.PREDICTION.ENABLE_ZSCORE;
  var warmupOk = enableZ && _featureStats.n >= TUNING.PREDICTION.ZSCORE_WARMUP_N;
  var w = l2weights;
  var wlen = w.length;
  var prior = COURSE_LOG_PRIOR;
  var bias = L2_BIAS;
  var logits = new Array(6);
  for (var b = 0; b < 6; b++) {
    var feat = features6[b];
    if (warmupOk) feat = _normalizeFeatures(feat);
    var z = bias + (prior[b] || 0);
    for (var i = 0; i < wlen; i++) {
      var fi = feat[i];
      if (fi) z += fi * (w[i] || 0); // PF-5: 0 値は早期 skip（ホットループ短縮）
    }
    logits[b] = z;
  }
  return softmax(logits);
}

function linearSlope(values){
  if(!Array.isArray(values) || values.length < 2) return 0;
  var n = values.length;
  var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for(var i=0; i<n; i++){
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  var den = n * sumXX - sumX * sumX;
  if(den === 0) return 0;
  return (n * sumXY - sumX * sumY) / den;
}

function motorScoreNormalized(motorRate, sid){
  var s = stadiumMotorStats[String(sid)];
  if(!s || s.count < 50){
    // フォールバック: 旧 5 段階閾値
    if(motorRate>=50) return {score:12, label:'超抜', emoji:'A'};
    if(motorRate>=43) return {score: 8, label:'好機', emoji:'B'};
    if(motorRate>=36) return {score: 4, label:'並機', emoji:'C'};
    if(motorRate>=28) return {score: 0, label:'低調', emoji:'D'};
    return {score:-3, label:'整備要', emoji:'E'};
  }
  var z = (motorRate - s.mean) / s.std;
  if(z >= 1.5)  return {score:12, label:'超抜', emoji:'A', z:z};
  if(z >= 0.7)  return {score: 8, label:'好機', emoji:'B', z:z};
  if(z >= -0.7) return {score: 4, label:'並機', emoji:'C', z:z};
  if(z >= -1.5) return {score: 0, label:'低調', emoji:'D', z:z};
  return            {score:-3, label:'整備要', emoji:'E', z:z};
}

function pairwiseScore(rid, sid, opponentRids){
  if(!rid || !opponentRids || opponentRids.length === 0) return { score: 0, hits: 0 };
  if(!pairwiseDB) return { score: 0, hits: 0 };
  var totalScore = 0, hits = 0;
  opponentRids.forEach(function(oid){
    if(!oid || oid === rid) return;
    var key = (rid < oid) ? rid+'-'+oid : oid+'-'+rid;
    var rec = pairwiseDB[key];
    if(!rec || rec.races < 5) return;
    var myWins = rec.head2head[String(rid)] || 0;
    var oppWins = rec.head2head[String(oid)] || 0;
    var diff = (myWins - oppWins) / rec.races;
    // |diff| が大きい時のみ寄与（ノイズ回避）
    if(Math.abs(diff) >= 0.2){
      totalScore += diff * 1.0;   // ±1pt 程度
      hits++;
    }
  });
  return { score: Math.max(-2, Math.min(2, totalScore)), hits: hits };
}

function pf(v){return parseFloat(v)||0}

function fetchWithFallback(url){
  // キャッシュキーはクエリパラメータを除いたベースURL
  var baseUrl=url.split('?')[0];
  // Clearwing Phase 2: capabilities (worker) で AbortSignal.timeout 互換性を吸収
  var signal=capabilities.makeTimeoutSignal(15000);
  return fetch(url,{signal:signal,cache:'no-store'})
    .then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})
    .then(function(d){try{localStorage.setItem(cacheKey(baseUrl),JSON.stringify({data:d,time:Date.now()}))}catch(e){}return d})
    .catch(function(e){
      console.warn('API error:',baseUrl,e.message);
      try{var c=localStorage.getItem(cacheKey(baseUrl));if(c){var o=JSON.parse(c);if(Date.now()-o.time<600000)return o.data}}catch(ex){}
      return null;
    });
}

function predictEntryCourses(boats, sid) {
  // 各艇の枠→コース確率を取得
  var dists = boats.map(function (b) {
    return {
      boat: b.racer_boat_number,
      rid: b.racer_number,
      dist: getEntryDist(b.racer_number, b.racer_boat_number, sid),
    };
  });

  // ハンガリアン: 全艇 × 全コース の割当を確率最大化
  // 6 艇 6 コースなら 6! = 720 通り全列挙で十分
  var permutations = [];
  function perm(arr, current) {
    if (arr.length === 0) {
      permutations.push(current);
      return;
    }
    for (var i = 0; i < arr.length; i++) {
      var rest = arr.slice(0, i).concat(arr.slice(i + 1));
      perm(rest, current.concat([arr[i]]));
    }
  }
  perm([1, 2, 3, 4, 5, 6], []);

  var best = null,
    bestScore = -Infinity;
  permutations.forEach(function (p) {
    var s = 0;
    var valid = true;
    for (var i = 0; i < dists.length; i++) {
      var pr = dists[i].dist[String(p[i])] || 0;
      if (pr <= 0) {
        valid = false;
        break;
      }
      s += Math.log(pr);
    }
    if (valid && s > bestScore) {
      bestScore = s;
      best = p;
    }
  });

  if (!best) {
    // フォールバック: 枠通り
    var by = {};
    var c = {};
    boats.forEach(function (b) {
      by[b.racer_boat_number] = b.racer_boat_number;
      c[b.racer_boat_number] = 0.5;
    });
    return { byBoat: by, conf: c };
  }
  var byBoat = {},
    conf = {};
  for (var i = 0; i < dists.length; i++) {
    byBoat[dists[i].boat] = best[i];
    conf[dists[i].boat] = dists[i].dist[String(best[i])] || 0;
  }
  return { byBoat: byBoat, conf: conf };
}

function predictRace(sid, raceNum) {
  if (!programData) return null;
  var stadiumProg = programData[String(sid)];
  if (!stadiumProg) return null;
  var race = stadiumProg[String(raceNum)];
  if (!race || !race.boats) return null;

  var preview = null,
    weather = null;
  if (previewData && previewData[String(sid)] && previewData[String(sid)][String(raceNum)]) {
    preview = previewData[String(sid)][String(raceNum)];
    weather = preview.weather || preview;
  }

  var boats = race.boats;
  if (!Array.isArray(boats)) return null;

  // X3: preview の進入が無ければ予測を使う
  var predictedEntries = null;
  if (
    !preview ||
    !preview.boats ||
    Object.keys(preview.boats).every(function (k) {
      return preview.boats[k].racer_course_number == null;
    })
  ) {
    predictedEntries = predictEntryCourses(boats, sid);
  }
  var l1scores = [];
  boats.forEach(function (b) {
    var pv = preview && preview.boats ? preview.boats[String(b.racer_boat_number)] : null;
    var s = scoreBoatV2(b, pv, weather, boats, preview, sid, predictedEntries);
    l1scores.push(s);
  });

  var l1total = l1scores.reduce(function (a, s) {
    return a + Math.exp(s.score / 15);
  }, 0);
  var l1probs = l1scores.map(function (s) {
    return Math.exp(s.score / 15) / l1total;
  });

  var stRanks = [];
  if (preview && preview.boats) {
    var sts = [];
    for (var si = 1; si <= 6; si++) {
      var spv = preview.boats[String(si)];
      var stVal = spv && spv.racer_start_timing != null ? pf(spv.racer_start_timing) : 99;
      sts.push({ boat: si, st: stVal });
    }
    sts.sort(function (a, b) {
      return a.st - b.st;
    });
    for (var sr = 0; sr < sts.length; sr++) stRanks[sts[sr].boat] = sr;
  }

  var features6 = boats.map(function (b) {
    var pv = preview && preview.boats ? preview.boats[String(b.racer_boat_number)] : null;
    var l1s = l1scores.find(function (s) {
      return s.boat === b.racer_boat_number;
    });
    return getL2Features(b, pv, weather, l1s ? l1s.etRank : 5, stRanks[b.racer_boat_number] || 5, sid);
  });
  var l2probs = l2Predict(features6);

  // PB-8: Bayesian shrinkage で L1/L2 融合比を連続化
  //       α = N0 / (N0 + n)  ─ n が 0 なら α=1（L1 のみ）、n→∞ で α→0（L2 のみ）
  //       N0=300 は「L1 を 300 サンプル相当として信用する」事前
  var dbSize = Object.keys(racerDB).length;
  var alpha = 300 / (300 + dbSize);
  var beta = 1 - alpha;

  var finalProbs = boats.map(function (b, i) {
    var l1s = l1scores.find(function (s) {
      return s.boat === b.racer_boat_number;
    });
    var idx = boats.indexOf(b);
    var fp = alpha * l1probs[idx] + beta * l2probs[idx];
    return {
      boat: b.racer_boat_number,
      prob: fp,
      score: l1s.score,
      course: l1s.course,
      etRank: l1s.etRank,
      etTime: l1s.etTime,
      reasons: l1s.reasons,
      risks: l1s.risks,
      motorLabel: l1s.motorLabel,
      motorEmoji: l1s.motorEmoji,
      motorRate: l1s.motorRate,
      boatRate: l1s.boatRate,
      form: l1s.form,
      classNum: l1s.classNum,
    };
  });
  // PB-6: Platt scaling で確率を post-hoc 校正（identity 初期では no-op）
  //       fitting 後は ECE が改善する想定。再正規化で Σp=1 を維持
  finalProbs.forEach(function (p) {
    p.prob = _applyPlattCalibration(p.prob);
  });
  // P1-A4: F/L ペナルティを 1着確率乗数として post-hoc 適用
  //   既存の score 減点 (-25/-15/-5) は L1 段階の減衰、本層は確率の心理的補正:
  //   F2 持ちは斡旋停止リスクで 2 着狙いに走り、1 着確率は更に 0.75 倍程度になる経験則。
  //   l1scores から fc/lc を引き、p.prob に乗算（再正規化で Σp=1 を維持）
  finalProbs.forEach(function (p) {
    var l1 = l1scores.find(function (s) {
      return s.boat === p.boat;
    });
    var fc = l1 ? l1.fc || 0 : 0;
    var lc = l1 ? l1.lc || 0 : 0;
    var mult = fc >= 2 ? 0.75 : fc >= 1 ? 0.85 : lc >= 1 ? 0.95 : 1.0;
    p.prob *= mult;
  });
  var _sumCalib = finalProbs.reduce(function (a, p) {
    return a + p.prob;
  }, 0);
  if (_sumCalib > 0 && Math.abs(_sumCalib - 1) > 1e-6) {
    finalProbs.forEach(function (p) {
      p.prob = p.prob / _sumCalib;
    });
  }
  finalProbs.sort(function (a, b) {
    return b.prob - a.prob;
  });

  var marks = finalProbs.map(function (p, i) {
    p.mark = i === 0 ? '◎' : i === 1 ? '○' : i === 2 ? '▲' : i === 3 ? '△' : '×';
    return p;
  });

  var topProb = marks[0].prob;
  var top2Prob = marks[0].prob + marks[1].prob;
  var raceType, typeLabel, typeCls;
  var wh = weather ? weather.wave_height || weather.race_wave || 0 : 0;
  var ws2 = weather ? weather.wind_speed || weather.race_wind || 0 : 0;
  // PC-3: TUNING.RACE_TYPE 集約定数を使用
  var RT = TUNING.RACE_TYPE;
  if (topProb > RT.HONMEI_TOP1_MIN && top2Prob > RT.HONMEI_TOP2_MIN) {
    raceType = 'honmei';
    typeLabel = '本命';
    typeCls = 'type-honmei';
  } else if (topProb < RT.ANA_TOP1_MAX || wh >= RT.ANA_WAVE_HEIGHT_CM || ws2 >= RT.ANA_WIND_SPEED_MS) {
    raceType = 'ana';
    typeLabel = '穴';
    typeCls = 'type-ana';
  } else {
    raceType = 'middle';
    typeLabel = '混戦';
    typeCls = 'type-middle';
  }

  var betCount3 = parseInt(settings.betCount3) || 10;
  var betCount2 = parseInt(settings.betCount2) || 5;
  var method = settings.betMethod || 'auto';
  // X1: EV モード優先（オッズが揃っていれば）
  var evMode = settings.evMode === true || settings.evMode === 'true';
  // P0-3: KPI モードによる race_type 別 evMin/maxBets プリセット（off で従来挙動）
  var kpiMode = settings.kpiMode || 'balanced';
  var TYPE_EVMIN = {
    roi: { honmei: 1.2, middle: 1.25, ana: 1.35 },
    balanced: { honmei: 1.1, middle: 1.15, ana: 1.25 },
    hit: { honmei: 1.0, middle: 1.05, ana: 1.1 },
  };
  var TYPE_MAXBETS = {
    roi: { honmei: 4, middle: 5, ana: 3 },
    balanced: { honmei: 6, middle: 8, ana: 5 },
    hit: { honmei: 10, middle: 12, ana: 8 },
  };
  var defEvMin = parseFloat(settings.evMin) || 1.15;
  var modeEvMin = kpiMode !== 'off' && TYPE_EVMIN[kpiMode] ? TYPE_EVMIN[kpiMode][raceType] : null;
  var modeMaxBets = kpiMode !== 'off' && TYPE_MAXBETS[kpiMode] ? TYPE_MAXBETS[kpiMode][raceType] : null;
  var evOpt = {
    evMin: modeEvMin != null ? modeEvMin : defEvMin,
    maxBets: modeMaxBets != null ? modeMaxBets : betCount3,
    kellyFrac: parseFloat(settings.kellyFrac) || 0.5,
    bankroll: parseInt(settings.bankroll) || 10000,
  };
  // 当該レースのオッズを取得
  var raceOddsForEV = null;
  if (oddsData && oddsData.odds) {
    var found = oddsData.odds.find(function (o) {
      return o.stadium === parseInt(sid) && o.race === parseInt(raceNum);
    });
    if (found) raceOddsForEV = found;
  }
  if (method === 'auto') {
    if (evMode && raceOddsForEV && raceOddsForEV.trifecta) method = 'ev';
    else if (raceType === 'honmei') method = 'prob';
    else if (raceType === 'ana') method = 'box';
    else method = 'formation';
  }

  // X5: シナリオ展開予測（局面別 1-2-3 着分布）
  var grade = race.race_grade_number || 0;
  var scenarioRes = predictWithScenarios(boats, preview, weather, sid, grade);

  var bets = generateBetsV2(marks, method, betCount3, betCount2, raceOddsForEV, evOpt);
  bets.marks = marks;
  bets.evApplied = method === 'ev';
  bets.scenarios = scenarioRes.scenarios; // {nige:0.55, sashi:0.18, ...}
  bets.scenarioDist = scenarioRes.dist; // {"1-2-3": 0.18, ...}
  bets.grade = grade;
  // X1: 単勝オッズ乖離を計算
  if (raceOddsForEV && raceOddsForEV.win) {
    var aiByBoat = [];
    for (var bi = 1; bi <= 6; bi++) {
      var fp = finalProbs.find(function (p) {
        return p.boat === bi;
      });
      aiByBoat.push(fp ? fp.prob : 0);
    }
    bets.divergence = calcOddsDivergence(aiByBoat, raceOddsForEV.win);
  }
  bets.raceType = raceType;
  bets.typeLabel = typeLabel;
  bets.typeCls = typeCls;
  bets.weather = weather;
  bets.method = method;
  bets.features6 = features6;

  var conf = Math.round(topProb * 100);
  bets.confidence = conf;
  bets.confStars = conf >= 40 ? 5 : conf >= 30 ? 4 : conf >= 22 ? 3 : conf >= 15 ? 2 : 1;

  // B14 (2026-05-17): 詳細画面で表示される 🔥穴予想 (高EV chip) を bets.ana に
  //   組込んで savePrediction で履歴追跡できるようにする。EV>=1.0 が無ければ
  //   AI 確率分布の top N (1コース絡み以外) を fallback で入れる。
  bets.ana = (function () {
    var anaTopN = parseInt(settings.betCountAna) || 3;
    if (anaTopN < 1) anaTopN = 1;
    else if (anaTopN > 6) anaTopN = 6;
    var excludeCombos = (bets.trifecta || []).map(function (t) {
      return t.combo;
    });
    if (raceOddsForEV && raceOddsForEV.trifecta && Object.keys(raceOddsForEV.trifecta).length > 0) {
      var anaRes = _pickAnaCandidates(marks, raceOddsForEV.trifecta, {
        minOdds: 30,
        minEV: 1.0,
        minOddsLoose: 15,
        topN: anaTopN,
        excludeCombos: excludeCombos,
      });
      var picks = anaRes.primary.length > 0 ? anaRes.primary : anaRes.fallback;
      return picks.map(function (p) {
        return p.combo;
      });
    }
    // オッズ未取得: AI 確率分布の上位（1着が1番人気でないもの）を穴候補に
    if (marks && marks.length >= 3) {
      var dist = buildTrifectaProbDist(marks);
      var top1Boat = marks[0].boat;
      var excludeSet = {};
      excludeCombos.forEach(function (c) {
        if (c) excludeSet[String(c)] = true;
      });
      var cands = [];
      for (var k in dist) {
        if (!Object.prototype.hasOwnProperty.call(dist, k)) continue;
        if (k.split('-')[0] === String(top1Boat)) continue;
        if (excludeSet[k]) continue;
        cands.push({ combo: k, prob: dist[k] });
      }
      cands.sort(function (a, b) {
        return b.prob - a.prob;
      });
      return cands.slice(0, anaTopN).map(function (c) {
        return c.combo;
      });
    }
    return [];
  })();

  return bets;
}

function predictScenarios(boats, preview, weather, sid, grade){
  var prior = SCENARIO_PRIORS_BY_GRADE[grade || 0] || SCENARIO_PRIORS_BY_GRADE[0];
  var scen = Object.assign({}, prior);

  // 場別補正（場別 1コース勝率を使う）
  var sdb = stadiumDB[String(sid)];
  if(sdb && sdb.courseWinRate && sdb.courseWinRate[1]){
    var cwr = sdb.courseWinRate[1];
    if(cwr.races >= 30){
      var rate = cwr.win / cwr.races;
      // 1コース勝率 0.55 を基準に scen.nige を調整
      var delta = (rate - 0.55) * 0.5;   // ±0.1 程度
      scen.nige = Math.max(0.2, Math.min(0.8, scen.nige + delta));
    }
  }

  // 風波で穴度合い調整
  if(weather){
    var ws = weather.wind_speed || weather.race_wind || 0;
    var wh = weather.wave_height || weather.race_wave || 0;
    if(ws >= 5 || wh >= 7){
      scen.nige *= 0.7;
      scen.makuri *= 1.3;
      scen.other *= 1.5;
    }
  }

  // 正規化
  var sum = 0;
  for(var k in scen) sum += scen[k];
  if(sum > 0){ for(var k2 in scen) scen[k2] = scen[k2] / sum; }
  return scen;
}

function predictWithScenarios(boats, preview, weather, sid, grade){
  var sc = predictScenarios(boats, preview, weather, sid, grade);
  var dist = {};
  Object.keys(SCENARIO_DIST).forEach(function(scKey){
    var w = sc[scKey] || 0;
    var template = SCENARIO_DIST[scKey];
    Object.keys(template).forEach(function(combo){
      dist[combo] = (dist[combo] || 0) + w * template[combo];
    });
  });
  // 残りの 1-2-3 組合せに薄く確率を散らす（ゼロ確率を避ける）
  var allCombos = [];
  for(var i=1;i<=6;i++) for(var j=1;j<=6;j++) for(var k=1;k<=6;k++){
    if(i!==j && j!==k && i!==k) allCombos.push(i+'-'+j+'-'+k);
  }
  var residual = 0.05 / allCombos.length;
  allCombos.forEach(function(c){ if(dist[c] == null) dist[c] = residual; });
  // 正規化
  var s = 0;
  for(var c in dist) s += dist[c];
  if(s > 0) for(var c2 in dist) dist[c2] = dist[c2] / s;
  return { dist: dist, scenarios: sc };
}

function scoreBoatV2(boat, preview, weather, allBoats, allPreviews, sid, predictedEntries) {
  var score = 0;
  var reasons = [];
  var risks = [];
  var bn = boat.racer_boat_number;
  // PC-2b: 進入コース解決を _resolveCourse に委譲
  var resolved = _resolveCourse(boat, preview, predictedEntries);
  var course = resolved.course;
  var entryConf = resolved.entryConf;
  if (resolved.source === 'predicted' && course !== bn && entryConf >= 0.6) {
    reasons.push('進入予想: ' + bn + '枠→' + course + 'コース(' + (entryConf * 100).toFixed(0) + '%)');
  }
  var rid = boat.racer_number || 0;

  var scwr = getStadiumCourseWinRate(String(sid), course);
  var baseCoursePt = scwr * COURSE_MULTIPLIER;

  // PC-2b: 階級減衰係数を _computeClassAttenuation に委譲
  var attn = _computeClassAttenuation(allBoats);
  // P0-1: 自艇の class × course の相互作用係数を追加（A1の1コースとB2の1コースを区別）
  var classCM = _classCourseMult(boat.racer_class_number, course);
  var coursePt;
  // P1-A2: 進入予想の二値判定をやめ、entryConf による加重平均化
  //   予想コースと枠コースの coursePt を信頼度で smooth に補間。
  //   データ蓄積に応じて段階的に予想を反映できる（旧: 0.6閾値で binary 切替）
  if (resolved.source === 'predicted' && course !== bn && entryConf > 0 && entryConf < 1) {
    var scwrFrame = getStadiumCourseWinRate(String(sid), bn);
    var classCMFrame = _classCourseMult(boat.racer_class_number, bn);
    var ptPred = scwr * COURSE_MULTIPLIER * attn * classCM;
    var ptFrame = scwrFrame * COURSE_MULTIPLIER * attn * classCMFrame;
    coursePt = ptPred * entryConf + ptFrame * (1 - entryConf);
  } else {
    coursePt = baseCoursePt * attn * classCM;
  }
  score += coursePt;

  // P0-2 + P1-A5: 1コースのみ「レース全体の逃げ成功確率」を log_odds 換算で加算。
  //   sid と raceHour（programData 経由で取得試行）を渡し、潮汐補正も活かす。
  if (course === 1 && allBoats) {
    var _rh = null;
    try {
      if (typeof programData !== 'undefined' && programData && programData[String(sid)]) {
        var _races = programData[String(sid)];
        var _firstKey = Object.keys(_races)[0];
        var _ca = _firstKey ? _races[_firstKey].race_closed_at || '' : '';
        if (_ca) {
          var _hh = _ca.split(' ')[1] || '';
          if (_hh) _rh = parseInt(_hh.split(':')[0], 10);
        }
      }
    } catch (_) {}
    var sc = _computeRaceScenario(allBoats, allPreviews, sid, _rh);
    if (sc && Number.isFinite(sc.nigeSuccess)) {
      var lodd = Math.log(sc.nigeSuccess / (1 - sc.nigeSuccess));
      score += lodd * 4;
      if (sc.nigeSuccess >= 0.65) reasons.push('逃げ成功率推定 ' + Math.round(sc.nigeSuccess * 100) + '%');
      else if (sc.nigeSuccess <= 0.35) risks.push('逃げ阻止リスク(' + Math.round((1 - sc.nigeSuccess) * 100) + '%)');
    }
  }

  if (preview && preview.racer_course_number != null) {
    if (bn > course) {
      score += 3;
      reasons.push('前付け成功(' + bn + '→' + course + 'コース)');
    } else if (bn < course) {
      score -= 2;
      risks.push('押し出され(' + bn + '→' + course + 'コース)');
    }
  }
  if (course === 1) reasons.push(course + 'コース(場勝率' + Math.round(scwr * 100) + '%)');

  var racerCWR = getRacerCourseWinRate(rid, course);
  if (racerCWR !== null) {
    score += racerCWR * 25;
    var rdb = racerDB[rid];
    if (rdb && rdb.courseStats && rdb.courseStats[course]) {
      var cs = rdb.courseStats[course];
      score += (cs.top3 / cs.races) * 0.08 * 100;
      if (racerCWR > 0.5 && course <= 2) reasons.push('コース別1着率' + Math.round(racerCWR * 100) + '%');
    }
  } else {
    var wr = pf(boat.racer_national_top_1_percent);
    score += wr * 2.5;
    var lr = pf(boat.racer_local_top_2_percent);
    score += lr * 0.15;
  }
  // F13: 自分のコース別決まり手プロファイル
  var selfStyle = selfStyleScore(rid, course);
  if (selfStyle.score !== 0) {
    score += selfStyle.score;
    if (selfStyle.reason) reasons.push(selfStyle.reason);
    if (selfStyle.risk) risks.push(selfStyle.risk);
  }
  var classBonus = { 1: 6, 2: 3, 3: 0, 4: -3 };
  score += classBonus[boat.racer_class_number] || 0;

  if (allPreviews && allPreviews.boats) {
    for (var ci = 1; ci <= 6; ci++) {
      if (ci === bn) continue;
      var cpv = allPreviews.boats[String(ci)];
      var cCourse = cpv && cpv.racer_course_number != null ? cpv.racer_course_number : ci;
      var cBoat = allBoats.find(function (b) {
        return b.racer_boat_number === ci;
      });
      if (!cBoat) continue;
      var cRid = cBoat.racer_number || 0;
      var style = getRacerCourseStyle(cRid, cCourse);
      if (!style) {
        style = DEFAULT_COURSE_TECHNIQUE[cCourse];
      }
      if (!style) continue;
      var total = style.nige + style.sashi + style.makuri + style.makuriSashi + style.nuki + (style.megumare || 0);
      if (total < 3) continue;
      var sashiRate = style.sashi / total;
      var makuriRate = style.makuri / total;
      var makuriSashiRate = style.makuriSashi / total;

      if (cCourse === 2 && course === 1) {
        if (sashiRate > 0.5) {
          score += 3;
          reasons.push('2コース差し主体→逃げ残りやすい');
        } else if (makuriRate > 0.3) {
          score -= 5;
          risks.push('2コースまくり傾向(脅威)');
        }
      }
      if (cCourse === 3) {
        if (course === 1 && makuriRate > 0.3) {
          score -= 3;
          risks.push('3コースまくり傾向');
        }
        if (course === 2 && makuriSashiRate > 0.3) {
          score -= 4;
        }
        if (course === 1 && sashiRate > 0.4) score += 2;
      }
      if (cCourse === 4 && makuriRate > 0.3) {
        if (course <= 3) score -= 3;
      }
      if (cCourse >= 5 && makuriRate > 0.4) {
        if (course <= 2) score -= 2;
      }
    }
  }

  // X2 R-05: 場別 z-score でモーター評価（フォールバック付き）
  var motorRate = pf(boat.racer_assigned_motor_top_2_percent);
  var motorEval = motorScoreNormalized(motorRate, sid);
  score += motorEval.score;
  var motorLabel = motorEval.label;
  var motorEmoji = motorEval.emoji;
  if (motorEval.label === '超抜')
    reasons.push('超抜モーター(' + motorRate + '%' + (motorEval.z != null ? ' z=' + motorEval.z.toFixed(1) : '') + ')');
  else if (motorEval.label === '整備要') risks.push('モーター不調(' + motorRate + '%)');
  var boatRate = pf(boat.racer_assigned_boat_top_2_percent);
  score += boatRate * 0.08;

  var etRank = 5,
    etTime = 99;
  if (allPreviews && allPreviews.boats) {
    var times = [];
    for (var ei = 1; ei <= 6; ei++) {
      var epv = allPreviews.boats[String(ei)];
      var etime =
        epv && epv.racer_exhibition_time != null && epv.racer_exhibition_time > 0 ? pf(epv.racer_exhibition_time) : 99;
      times.push({ boat: ei, time: etime });
    }
    times.sort(function (a, b) {
      return a.time - b.time;
    });
    etRank = times.findIndex(function (t) {
      return t.boat === bn;
    });
    var myPv = allPreviews.boats[String(bn)];
    etTime = myPv ? pf(myPv.racer_exhibition_time) : 99;
    var bestTime = times[0].time;

    var decay = ET_COURSE_DECAY[course] || 1;
    var etBonus = 0;
    if (etRank === 0) etBonus = 6;
    else if (etRank === 1) etBonus = 4;
    else if (etRank === 2) etBonus = 2;
    else if (etRank >= 4) {
      var diff = etTime - bestTime;
      if (diff >= 0.08) etBonus = -5;
      else if (diff >= 0.03) etBonus = -Math.round(diff * 60);
    }
    score += etBonus * decay;
    if (etRank === 0) reasons.push('展示タイム最速(' + etTime + 's)');
    // X2 R-06: 展示タイム場別 z-score 補助（速いほど負 → +スコア）
    var ezAux = exhibitionZScore(etTime, sid);
    if (ezAux !== 0) score += -ezAux * 2 * decay;
    if (ezAux <= -1.0) reasons.push('展示タイム場相対的に超速(z=' + ezAux.toFixed(1) + ')');

    if (myPv && myPv.racer_start_timing != null) {
      var st = pf(myPv.racer_start_timing);
      // X2 R-08: 絶対値判定 + 個人平均との乖離（max を取る）
      var absScore = st < 0 ? -6 : st <= 0.05 ? 4 : st <= 0.1 ? 2 : st >= 0.2 ? -2 : 0;
      var perScore = stDivergenceScore(st, rid, course);
      var stScore = Math.max(absScore, perScore);
      score += stScore;
      if (stScore >= 4) reasons.push('ST鋭い(' + st + 's)');
      else if (stScore <= -2 && st > 0) risks.push('ST出遅れ(' + st + 's)');
      else if (st < 0) risks.push('Fスタート気味(' + st + 's)');

      if (etRank <= 1 && st > 0 && st <= 0.1) score += 3;
      else if (etRank <= 1 && st > 0.15) score += 1;
      else if (etRank >= 4 && st > 0 && st <= 0.1) score += 1;
      else if (etRank >= 4 && st >= 0.15) score -= 3;

      var tilt = pf(myPv.racer_tilt_adjustment);
      if (course <= 2 && tilt <= -0.5) score += 2;
      else if (course >= 4 && tilt >= 0.5) score += 2;
      else if (course <= 2 && tilt >= 0.5) score -= 1;
      else if (course >= 4 && tilt <= -0.5) score -= 1;

      // F12: 調整重量（規定体重未達の重り）
      // > 0 で重い荷物 → ボート加速悪化、特にアウトコースで影響大
      var adjW = pf(myPv.racer_adjust_weight);
      if (adjW >= 1.0) {
        if (course >= 4) {
          score -= 3;
          risks.push('調整重量+' + adjW.toFixed(1) + 'kg(アウト不利)');
        } else {
          score -= 1;
          risks.push('調整重量+' + adjW.toFixed(1) + 'kg');
        }
      } else if (adjW >= 0.5) {
        if (course >= 4) score -= 1;
      }

      // F12: 部品交換（ペラ調整等）
      // 当たれば +、外せば - で読みにくい → 既存スコアには加減せず情報のみ表示
      // ただし「ペラ」交換はモーター不調シグナルとしてマイルドな - を付与
      var partsTxt = String(myPv.racer_parts_replaced || '');
      if (partsTxt.indexOf('ペラ') >= 0) {
        score -= 1;
        risks.push('レース直前ペラ交換(' + escText(partsTxt) + ')');
      } else if (partsTxt) {
        // ペラ以外の部品交換 → 整備内容を reasons に表示のみ
        reasons.push('整備実施: ' + escText(partsTxt));
      }
    }

    if (boat.racer_class_number === 1 && etRank >= 4) {
      score -= 4;
      risks.push('A1だが展示下位(モーター不安)');
    }
    if ((boat.racer_class_number === 3 || boat.racer_class_number === 4) && etRank === 0) {
      score += 3;
      reasons.push('好モーター発見(展示1位)');
    }

    if (weather) {
      var wt = weather.water_temperature || weather.race_water_temperature || 20;
      if (wt <= 15) score += etBonus * 0.2 * decay;
      else if (wt >= 25) score -= etBonus * 0.2 * decay;
    }
  }

  if (weather) {
    var ws = weather.wind_speed || weather.race_wind || 0;
    var wd = weather.wind_direction || weather.race_wind_direction_number || 0;
    // X4 R-10: 場別風向プロファイルを使用
    var isHead = isHeadWind(wd, sid);
    var isTail = isTailWind(wd, sid);
    if (isHead && ws >= 5) {
      if (course === 1) {
        score -= 8;
        risks.push('向かい風' + ws + 'm(イン不利)');
      } else if (course === 2) score -= 3;
      else if (course >= 4) score += 4;
    } else if (isHead && ws >= 3) {
      if (course === 1) score -= 4;
      if (course >= 4) score += 2;
    }
    if (isTail && ws >= 3) {
      if (course === 1) {
        score += 4;
        reasons.push('追い風' + ws + 'm(イン有利)');
      }
      if (course >= 4) score -= 2;
    }
    var wh = weather.wave_height || weather.race_wave || 0;
    if (wh >= 7 && course <= 2) {
      score -= 4;
      risks.push('波高' + wh + 'cm(荒れ模様)');
    } else if (wh >= 4 && course <= 2) score -= 2;
    // X4 R-14: 風×波交差項
    var stormDelta = stormBonus(ws, wh, course);
    if (stormDelta !== 0) {
      score += stormDelta;
      if (stormDelta <= -4) risks.push('荒天交差項' + stormDelta);
      else if (stormDelta >= 4) reasons.push('荒れ展開で恩恵+' + stormDelta);
    }
  }
  // X4 R-02: 潮汐補正（海水場のみ、preview から race_closed_at の時刻を取得）
  if (preview && preview.race_closed_at) {
    try {
      var hour = parseInt(String(preview.race_closed_at).split(' ')[1].split(':')[0], 10);
      var tideDelta = tideScore(sid, course, hour);
      if (tideDelta !== 0) {
        score += tideDelta;
        if (tideDelta >= 4) reasons.push('潮位がコース有利(+' + tideDelta + ')');
        else if (tideDelta <= -4) risks.push('潮位不利(' + tideDelta + ')');
      }
    } catch (_) {}
  }

  // X6 R-07/R-13: 節間調整スコア + モーター急変警告
  var seriesAdj = seriesAdjustmentScore(rid, sid);
  if (seriesAdj.score !== 0) {
    score += seriesAdj.score;
    if (seriesAdj.score >= 3) reasons.push('節間モーター上昇中(slope+' + seriesAdj.slope.toFixed(1) + ')');
    else if (seriesAdj.score <= -3) risks.push('節間モーター下降中(slope' + seriesAdj.slope.toFixed(1) + ')');
  }
  // X6 R-09: 対戦相性
  if (allBoats && allBoats.length > 0) {
    var oppRids = allBoats
      .map(function (b) {
        return b.racer_number;
      })
      .filter(function (o) {
        return o && o !== rid;
      });
    var pair = pairwiseScore(rid, sid, oppRids);
    if (Math.abs(pair.score) >= 0.5) {
      score += pair.score;
      if (pair.score >= 1) reasons.push('対戦相性◎(+' + pair.score.toFixed(1) + ', ' + pair.hits + '件)');
      else if (pair.score <= -1) risks.push('対戦相性×(' + pair.score.toFixed(1) + ', ' + pair.hits + '件)');
    }
  }

  var fc = boat.racer_flying_count || 0; // P3 L-02: 自己参照typo修正
  var lc = boat.racer_late_start_count_in_current_term || boat.racer_late_count || 0;
  if (fc >= 2) {
    score -= 25;
    risks.push('F2持ち');
  } else if (fc >= 1) {
    score -= 15;
    risks.push('F1持ち');
  }
  if (lc >= 1) score -= 5;

  var form = getRacerForm(rid);
  if (form) {
    score += form.score;
    if (form.avg <= 2.5) reasons.push('好調(直近5R平均' + form.avg.toFixed(1) + '着)');
    if (form.avg >= 4.0) risks.push('不調(直近5R平均' + form.avg.toFixed(1) + '着)');
    if (form.trend > 0.5) reasons.push('上り調子');
    if (form.trend < -0.5) risks.push('下り調子');
  }

  return {
    boat: bn,
    score: Math.max(0, score),
    course: course,
    etRank: etRank,
    etTime: etTime,
    reasons: reasons,
    risks: risks,
    motorLabel: motorLabel,
    motorEmoji: motorEmoji,
    motorRate: motorRate,
    boatRate: boatRate,
    form: form,
    classNum: boat.racer_class_number,
    fc: fc,
    lc: lc, // P1-A4: F/L 確率乗数で使用
  };
}

function selectBetsByEV(probs, odds, opt){
  opt = opt || {};
  var evMin = opt.evMin != null ? opt.evMin : 1.15;
  var maxBets = opt.maxBets != null ? opt.maxBets : 8;
  var kellyFrac = opt.kellyFrac != null ? opt.kellyFrac : 0.5;
  var bankroll = opt.bankroll != null ? opt.bankroll : 10000;
  if(!probs || !odds) return [];
  var ranked = Object.keys(probs)
    .filter(function(k){ return odds[k] && probs[k] > 0; })
    .map(function(k){
      return { combo: k, prob: probs[k], odds: odds[k], ev: probs[k] * odds[k] };
    })
    .filter(function(b){ return b.ev >= evMin; })
    .sort(function(a, b){ return b.ev - a.ev; })
    .slice(0, maxBets);
  // Kelly: f* = (b·p - q) / b, ただし b = odds-1, q = 1-p
  ranked.forEach(function(b){
    var bn = b.odds - 1;
    if(bn <= 0){ b.stakeRatio = 0; b.stakeYen = 0; return; }
    var f = (bn * b.prob - (1 - b.prob)) / bn;
    b.stakeRatio = Math.max(0, f * kellyFrac);
  });
  // PB-9: 排他事象 Kelly — 同一レース内 3連単 N 点は最大 1 点しか当たらない
  //       単純合計 ∑f_i は資金全投入を超える可能性があるため、
  //       上限 KELLY.MAX_STAKE_RATIO（=1.0）を超えたら比例縮小
  var sumRatio = ranked.reduce(function(s,b){return s + (b.stakeRatio||0);}, 0);
  var maxRatio = (TUNING && TUNING.KELLY) ? TUNING.KELLY.MAX_STAKE_RATIO : 1.0;
  if(sumRatio > maxRatio && sumRatio > 0){
    var scale = maxRatio / sumRatio;
    ranked.forEach(function(b){ b.stakeRatio *= scale; });
  }
  ranked.forEach(function(b){
    b.stakeYen = Math.max(100, Math.round(bankroll * b.stakeRatio / 100) * 100);
  });
  return ranked;
}

function selfStyleScore(rid, course, courseStats){
  var style = getRacerCourseStyle(rid, course);
  if(!style) return { score: 0 };
  var total = (style.nige||0) + (style.sashi||0) + (style.makuri||0)
            + (style.makuriSashi||0) + (style.nuki||0) + (style.megumare||0);
  if(total < 8) return { score: 0 };

  // 1着の母数（コース別出走数）が多いほど信頼度高い → 重み線形補間
  // total / cs.races が「1着率」と一致するため、ここでは比率だけ見る
  var nige = (style.nige||0) / total;
  var sashi = (style.sashi||0) / total;
  var makuri = (style.makuri||0) / total;
  var makuriSashi = (style.makuriSashi||0) / total;
  var aggressive = makuri + makuriSashi;   // 攻撃的決まり手の合計

  // サンプル数の信頼度（8〜30 で線形補間、30 以上で 100%）
  var conf = Math.min(1.0, total / 30);

  if(course === 1){
    // 1コース: 逃げ率がすべて
    if(nige >= 0.85) return { score: +5*conf, reason: '自己逃げ率 '+(nige*100).toFixed(0)+'%(超鉄板)' };
    if(nige >= 0.70) return { score: +3*conf, reason: '自己逃げ率 '+(nige*100).toFixed(0)+'%(強)' };
    if(nige <= 0.40) return { score: -5*conf, risk:  '自己逃げ率 '+(nige*100).toFixed(0)+'%(イン弱い)' };
    if(nige <= 0.55) return { score: -2*conf, risk:  '自己逃げ率 '+(nige*100).toFixed(0)+'%(やや弱)' };
    return { score: 0 };
  }
  if(course === 2){
    // 2コース: 差し主体は 2-3着、まくりは 1着
    if(sashi >= 0.50) return { score: +3*conf, reason: '自己差し率 '+(sashi*100).toFixed(0)+'%(差し巧者)' };
    if(makuri >= 0.30) return { score: +3*conf, reason: '自己まくり率 '+(makuri*100).toFixed(0)+'%(2コース捲り)' };
    if(sashi + makuri <= 0.25) return { score: -2*conf, risk: '2コースでの決め手乏しい' };
    return { score: 0 };
  }
  if(course === 3){
    // 3コース: 攻撃多彩
    if(aggressive >= 0.45) return { score: +4*conf, reason: '自己攻撃率 '+(aggressive*100).toFixed(0)+'%(センター強)' };
    if(makuri >= 0.30) return { score: +3*conf, reason: '自己まくり率 '+(makuri*100).toFixed(0)+'%(3コース捲り)' };
    if(sashi >= 0.30) return { score: +1*conf, reason: '自己差し率 '+(sashi*100).toFixed(0)+'%(3コース差し)' };
    if(aggressive <= 0.15) return { score: -2*conf, risk: '3コースで攻めの決め手乏しい' };
    return { score: 0 };
  }
  if(course === 4){
    // 4コース: カド受けの典型、まくり/まくり差しが命
    if(aggressive >= 0.40) return { score: +4*conf, reason: '自己攻撃率 '+(aggressive*100).toFixed(0)+'%(カド強)' };
    if(makuri >= 0.30) return { score: +3*conf, reason: '自己まくり率 '+(makuri*100).toFixed(0)+'%(カド捲り)' };
    if(aggressive <= 0.15) return { score: -3*conf, risk: 'カドで攻めれない' };
    return { score: 0 };
  }
  if(course === 5 || course === 6){
    // 5-6コース: 穴を空けるのは攻撃的決まり手のみ
    if(aggressive >= 0.30) return { score: +3*conf, reason: 'アウトで攻撃率 '+(aggressive*100).toFixed(0)+'%(穴開け)' };
    if(aggressive <= 0.10) return { score: -1*conf };   // 期待度低めで risks には載せない
    return { score: 0 };
  }
  return { score: 0 };
}

function seriesAdjustmentScore(rid, sid){
  var rdb = racerDB[rid];
  if(!rdb || !rdb.seriesProgress) return { score: 0, slope: 0, samples: 0 };
  // 当該場の seriesProgress のみ
  var key = String(sid);
  var progress = rdb.seriesProgress[key];
  if(!progress || progress.length < 2) return { score: 0, slope: 0, samples: progress ? progress.length : 0 };
  var motorRates = progress.map(function(d){return d.motorRate || 0;}).filter(function(v){return v>0;});
  if(motorRates.length < 2) return { score: 0, slope: 0, samples: motorRates.length };
  var slope = linearSlope(motorRates);
  var score = 0;
  if(slope >= +3) score = +3;
  else if(slope <= -3) score = -3;
  else if(slope >= +1.5) score = +1;
  else if(slope <= -1.5) score = -1;
  return { score: score, slope: slope, samples: motorRates.length };
}

function stDivergenceScore(thisSt, rid, course){
  if(thisSt < 0) return -6;   // フライング
  var rdb = racerDB[rid];
  var key = String(course);
  if(!rdb || !rdb.stStats || !rdb.stStats[key] || rdb.stStats[key].count < 5){
    // フォールバック: 旧絶対値判定
    if(thisSt <= 0.05) return +4;
    if(thisSt <= 0.10) return +2;
    if(thisSt >= 0.20) return -2;
    return 0;
  }
  var personalAvg = rdb.stStats[key].mean;
  var z = (thisSt - personalAvg) / 0.04;
  if(z <= -1.0) return +5;   // 自己平均より +1σ 以上鋭い → 神スタ
  if(z <= -0.5) return +3;
  if(z <= +0.5) return 0;
  if(z <= +1.0) return -2;
  return -4;
}

function stormBonus(ws, wh, course){
  var base = 0;
  if(ws >= 5 && wh >= 5) base = -8;
  else if(ws >= 4 && wh >= 4) base = -4;
  else if(ws >= 3 && wh >= 3) base = -2;
  if(course <= 2) return base;          // インほど荒れに弱い
  if(course >= 4) return -base / 2;     // アウトはむしろ有利になる
  return 0;
}

function tideScore(sid, course, raceHour){
  if(!tideData || !tideData.stadiums) return 0;
  var entry = tideData.stadiums[String(sid)];
  if(!entry || entry.type !== 'saltwater') return 0;
  var phase = classifyTidePhase(entry, raceHour);
  if(!phase) return 0;
  return (TIDE_COURSE_BIAS[phase] || {})[course] || 0;
}
// =============================================================================
// PG-9: 学習関数 (Worker 内で完結、main は state を post で受け取る)
// =============================================================================

// 学習用ハイパパラメータ (app.js と同期、変更時は両方更新)
var L2_LR0 = 0.05;
var L2_LR_TAU = 5000;
var L2_LAMBDA = 1e-4;
var L2_KEY_LIMIT = 10000;

var l2trainStep = 0;
var l2learnedKeys = {};

function _updateFeatureStats(featRow){
  if(!Array.isArray(featRow)) return;
  _featureStats.n += 1;
  var n = _featureStats.n;
  for(var i=0;i<FEATURE_DIM;i++){
    var x = Number.isFinite(featRow[i]) ? featRow[i] : 0;
    var delta = x - _featureStats.mean[i];
    _featureStats.mean[i] += delta / n;
    var delta2 = x - _featureStats.mean[i];
    _featureStats.m2[i]   += delta * delta2;
  }
}

function l2Update(features6, winnerIdx) {
  var probs = l2Predict(features6);
  // PB-2: LR を t で減衰、L2 正則化を加算
  var lr = L2_LR0 / (1 + l2trainStep / L2_LR_TAU);
  for (var b = 0; b < 6; b++) {
    var target = b === winnerIdx ? 1 : 0;
    var err = probs[b] - target;
    for (var i = 0; i < l2weights.length; i++) {
      var grad = err * (features6[b][i] || 0) + L2_LAMBDA * l2weights[i];
      l2weights[i] -= lr * grad;
    }
    // PB-7: 各艇の特徴量を rolling 統計に追加
    _updateFeatureStats(features6[b]);
  }
  l2trainStep += 1;
  safeSet('boatrace_weights', l2weights); // P3 L-05
  safeSet('boatrace_trainstep', l2trainStep); // PB-2
  // PB-7: rolling stats を永続化（毎回 save は重いので 50 step に 1 回）
  if (l2trainStep % 50 === 0) safeSet('boatrace_featurestats', _featureStats);
}

// PG-9: バッチ学習 — main から resultData / programData / previewData / 既存 state を受信
//   返却: 更新後の l2weights / featureStats / trainStep / learnedKeys
function batchLearnFromResults(input){
  // input.state で state を上書き
  if(input.state){
    if(Array.isArray(input.state.l2weights)) l2weights = input.state.l2weights.slice();
    if(input.state.featureStats) _featureStats = JSON.parse(JSON.stringify(input.state.featureStats));
    if(typeof input.state.trainStep === 'number') l2trainStep = input.state.trainStep;
    if(input.state.learnedKeys) l2learnedKeys = Object.assign({}, input.state.learnedKeys);
  }
  // 入力データ
  var resultData = input.resultData;
  var programData = input.programData;
  var previewData = input.previewData;
  if(!resultData || !programData || !previewData) return null;

  // dateKey
  var dateKey = '';
  for(var s in programData){
    var stadiums = programData[s];
    for(var r in stadiums){
      var pgm = stadiums[r];
      if(pgm && pgm.race_date){ dateKey = String(pgm.race_date).replace(/-/g,''); break; }
    }
    if(dateKey) break;
  }

  var learnedThisCall = 0;
  for(var sid in resultData){
    var races = resultData[sid];
    for(var rn in races){
      var race = races[rn];
      if(!race || !race.isFinished || !race.results || !race.results.length) continue;
      var prog = programData[sid] && programData[sid][rn];
      var prev = previewData[sid] && previewData[sid][rn];
      if(!prog || !prog.boats || !Array.isArray(prog.boats)) continue;

      var key = dateKey + '_' + sid + '_' + rn;
      if(l2learnedKeys[key]) continue;

      var sorted = race.results.slice().sort(function(a,b){return a.place-b.place});
      var winnerBoat = sorted[0].racer_boat_number;

      var stRanks = {};
      if(prev && prev.boats){
        var sts = [];
        for(var si=1;si<=6;si++){
          var spv = prev.boats[String(si)];
          var stVal = (spv && spv.racer_start_timing != null) ? pf(spv.racer_start_timing) : 99;
          sts.push({boat:si, st:stVal});
        }
        sts.sort(function(a,b){return a.st-b.st});
        sts.forEach(function(s,idx){stRanks[s.boat] = idx});
      }
      var etRanks = {};
      if(prev && prev.boats){
        var ets = [];
        for(var ei=1;ei<=6;ei++){
          var epv = prev.boats[String(ei)];
          var etVal = (epv && epv.racer_exhibition_time != null && epv.racer_exhibition_time > 0) ? pf(epv.racer_exhibition_time) : 99;
          ets.push({boat:ei, time:etVal});
        }
        ets.sort(function(a,b){return a.time-b.time});
        ets.forEach(function(e,idx){etRanks[e.boat] = idx});
      }
      var weather = prev ? prev.weather || prev : null;
      var features6 = prog.boats.map(function(b){
        var pv = prev && prev.boats ? prev.boats[String(b.racer_boat_number)] : null;
        return getL2Features(b, pv, weather, etRanks[b.racer_boat_number]||5, stRanks[b.racer_boat_number]||5, sid);
      });
      var winnerIdx = prog.boats.findIndex(function(b){return b.racer_boat_number === winnerBoat});
      if(winnerIdx >= 0){
        l2Update(features6, winnerIdx);
        l2learnedKeys[key] = 1;
        learnedThisCall++;
      }
    }
  }
  // 上限超過は trim
  var keys = Object.keys(l2learnedKeys);
  if(keys.length > L2_KEY_LIMIT){
    var keep = keys.slice(-L2_KEY_LIMIT);
    var trimmed = {};
    for(var i=0;i<keep.length;i++) trimmed[keep[i]] = 1;
    l2learnedKeys = trimmed;
  }
  return {
    l2weights: l2weights.slice(),
    featureStats: { mean: _featureStats.mean.slice(), m2: _featureStats.m2.slice(), n: _featureStats.n },
    trainStep: l2trainStep,
    learnedKeys: l2learnedKeys,
    learnedThisCall: learnedThisCall,
  };
}

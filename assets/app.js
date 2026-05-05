'use strict';   // PC-5: strict モードで暗黙のグローバル代入 / 8進リテラル / with 等を禁止
// ===============================================
// CONSTANTS (PRESERVED)
// ===============================================
var STADIUMS={1:"桐生",2:"戸田",3:"江戸川",4:"平和島",5:"多摩川",6:"浜名湖",7:"蒲郡",8:"常滑",9:"津",10:"三国",11:"びわこ",12:"住之江",13:"尼崎",14:"鳴門",15:"丸亀",16:"児島",17:"宮島",18:"徳山",19:"下関",20:"若松",21:"芦屋",22:"福岡",23:"唐津",24:"大村"};
var CLASS_NAME={1:"A1",2:"A2",3:"B1",4:"B2"};
var CLASS_COLOR={1:"#FF2244",2:"#FF6644",3:"#2288FF",4:"#888888"};
var BOAT_COLORS={1:"#FFFFFF",2:"#000000",3:"#FF1122",4:"#2255FF",5:"#FFD700",6:"#22CC44"};
var BOAT_TEXT={1:"#000000",2:"#FFFFFF",3:"#FFFFFF",4:"#FFFFFF",5:"#000000",6:"#FFFFFF"};
var COURSE_WIN_RATE={1:0.55,2:0.14,3:0.12,4:0.11,5:0.06,6:0.02};
var TECHNIQUE={1:"逃げ",2:"差し",3:"まくり",4:"まくり差し",5:"抜き",6:"恵まれ"};
var WIND_DIR={1:"N",2:"NNE",3:"NE",4:"ENE",5:"E",6:"ESE",7:"SE",8:"SSE",9:"S",10:"SSW",11:"SW",12:"WSW",13:"W",14:"WNW",15:"NW",16:"NNW",17:"無風"};
var GRADE_CLASS={1:{name:"SG",cls:"grade-sg"},2:{name:"G1",cls:"grade-g1"},3:{name:"G2",cls:"grade-g2"},4:{name:"G3",cls:"grade-g3"},5:{name:"一般",cls:"grade-general"}};
var API_BASE='https://boatraceopenapi.github.io';
// F19: RPi serve_data 機能撤去（GitHub Pages 配信のみで運用）
// var LOCAL_RPI_URL=...; は削除済

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

var L2_INIT_WEIGHTS=[3.0,1.5,-1.0,-4.0,-1.5,0.5,4.0,-0.8,1.0,1.5,0.3,3.5];
var L2_BIAS=0;
var L2_LR=0.01;

// PB-2: 学習則ハイパーパラメータ（LR decay + L2 正則化）
var L2_LR0       = 0.05;     // 初期 LR（旧固定値 0.01 より高めに、decay と組合せ）
var L2_LR_TAU    = 5000;     // LR 半減のスケール: lr = LR0 / (1 + t/TAU)
var L2_LAMBDA    = 1e-4;     // L2 正則化係数（重み暴走防止）
var L2_KEY_LIMIT = 10000;    // learnedKeys 保持上限（古いキー切り捨て）

/* BUILD:SAFE_STORAGE:START */
"use strict";
(() => {
  // ../src/utils/safe_storage.js
  var FEATURE_DIM = 12;
  var ERROR_BUF_MAX = 100;
  function _validateLS(key, value) {
    if (value === null || value === void 0) return null;
    switch (key) {
      case "boatrace_settings":
        return typeof value === "object" && !Array.isArray(value) ? value : null;
      case "boatrace_racerDB":
      case "boatrace_stadiumDB":
      case "boatrace_motorStats":
      case "boatrace_exhibitionStats":
      case "boatrace_pairwiseDB":
        if (typeof value !== "object" || Array.isArray(value)) return null;
        if (Object.keys(value).length > 1e4) return null;
        return value;
      case "boatrace_weights":
        if (!Array.isArray(value)) return null;
        const expectedLen = typeof L2_INIT_WEIGHTS !== "undefined" ? L2_INIT_WEIGHTS.length : 12;
        if (value.length !== expectedLen) return null;
        for (let i = 0; i < value.length; i++) {
          if (!Number.isFinite(value[i]) || Math.abs(value[i]) > 1e3) return null;
        }
        return value;
      case "boatrace_history":
        if (!Array.isArray(value)) return null;
        return value.length > 5e4 ? value.slice(-1e3) : value;
      case "boatrace_learned":
        if (typeof value !== "object" || Array.isArray(value)) return null;
        if (Object.keys(value).length > 5e4) return null;
        return value;
      case "boatrace_trainstep":
        return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e10 ? value : null;
      case "boatrace_featurestats":
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        if (!Array.isArray(value.mean) || value.mean.length !== FEATURE_DIM) return null;
        if (!Array.isArray(value.m2) || value.m2.length !== FEATURE_DIM) return null;
        if (typeof value.n !== "number" || !Number.isFinite(value.n) || value.n < 0) return null;
        for (let i = 0; i < FEATURE_DIM; i++) {
          if (!Number.isFinite(value.mean[i]) || !Number.isFinite(value.m2[i])) return null;
        }
        return value;
      case "boatrace_platt":
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        if (!Number.isFinite(value.a) || !Number.isFinite(value.b)) return null;
        if (Math.abs(value.a) > 10 || Math.abs(value.b) > 10) return null;
        return value;
      default:
        return value;
    }
  }
  function _bootParseLS(key, fallback) {
    let raw;
    try {
      raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      const validated = _validateLS(key, v);
      if (validated === null && v !== null) {
        try {
          localStorage.setItem(key + "__corrupt_" + Date.now(), raw);
        } catch (_) {
        }
        try {
          localStorage.removeItem(key);
        } catch (_) {
        }
        console.warn("[boot] schema invalid, restored fallback:", key);
        return fallback;
      }
      return validated !== null ? validated : fallback;
    } catch (e) {
      console.warn("[boot] parse failed", key, e);
      try {
        if (raw) localStorage.setItem(key + "__corrupt_" + Date.now(), raw);
      } catch (_) {
      }
      return fallback;
    }
  }
  function safeParse(key, fallback) {
    let raw;
    try {
      raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      if (v === null || v === void 0) return fallback;
      const validated = _validateLS(key, v);
      if (validated === null) {
        try {
          localStorage.setItem(key + "__corrupt_" + Date.now(), raw);
        } catch (_) {
        }
        try {
          localStorage.removeItem(key);
        } catch (_) {
        }
        console.warn("[storage] schema invalid, restored fallback:", key);
        return fallback;
      }
      return validated;
    } catch (e) {
      console.warn("[storage] parse failed", key, e);
      try {
        if (raw) localStorage.setItem(key + "__corrupt_" + Date.now(), raw);
      } catch (_) {
      }
      return fallback;
    }
  }
  function safeSet(key, value) {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    try {
      localStorage.setItem(key, s);
      return true;
    } catch (e) {
      if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
        try {
          const hist = JSON.parse(localStorage.getItem("boatrace_history") || "[]");
          if (hist.length > 1e3) {
            localStorage.setItem("boatrace_history", JSON.stringify(hist.slice(-1e3)));
          }
          const keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf("bc_") === 0) keys.push(k);
          }
          keys.forEach(function(k) {
            try {
              localStorage.removeItem(k);
            } catch (_) {
            }
          });
          localStorage.setItem(key, s);
          return true;
        } catch (_) {
        }
      }
      console.warn("[storage] set failed", key, e);
      return false;
    }
  }
  function reportError(payload) {
    try {
      const raw = localStorage.getItem("boatrace_errors");
      let buf = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) buf = parsed;
        } catch (_) {
        }
      }
      const entry = { ts: Date.now(), iso: (/* @__PURE__ */ new Date()).toISOString() };
      for (const k in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, k)) entry[k] = payload[k];
      }
      buf.push(entry);
      if (buf.length > ERROR_BUF_MAX) buf = buf.slice(-ERROR_BUF_MAX);
      try {
        localStorage.setItem("boatrace_errors", JSON.stringify(buf));
      } catch (_) {
      }
    } catch (_) {
    }
  }
  globalThis._validateLS = _validateLS;
  globalThis._bootParseLS = _bootParseLS;
  globalThis.safeParse = safeParse;
  globalThis.safeSet = safeSet;
  globalThis.reportError = reportError;
  globalThis.ERROR_BUF_MAX = ERROR_BUF_MAX;
})();

/* BUILD:SAFE_STORAGE:END */

// =====================================================================
// PI-fix: 診断オーバーレイ（iOS standalone PWA タップ不能問題の調査用）
//   - capture-phase で touchstart/touchend/click/pointerdown を全て記録
//   - タイトル「BOATRACE AI」(.logo) を 5 連打で debug overlay 表示
//   - リング 100 件、stadium-card 関連は別セクションで強調表示
//   - 「クリア」ボタンでバッファ初期化 → ノイズ無しの再採取が可能
// =====================================================================
(function(){
  var DIAG_MAX = 100;
  var ring = [];
  function pushDiag(o){
    o.t = Date.now();
    ring.push(o);
    if(ring.length > DIAG_MAX) ring.shift();
    try { localStorage.setItem('boatrace_diag', JSON.stringify(ring)); }catch(_){}
  }
  function targetInfo(t){
    if(!t || !t.tagName) return '<none>';
    var s = t.tagName.toLowerCase();
    if(t.id) s += '#'+t.id;
    if(t.className && typeof t.className==='string') s += '.'+t.className.split(/\s+/).slice(0,2).join('.');
    var card = t.closest && t.closest('.stadium-card');
    if(card){
      s += ' [card sid='+(card.getAttribute('data-sid')||'none')
        + ' onclick='+(card.hasAttribute('onclick')?'YES':'NO')
        + ' pe='+getComputedStyle(card).pointerEvents+']';
    }
    return s;
  }
  ['touchstart','touchend','click','pointerdown'].forEach(function(ev){
    document.addEventListener(ev, function(e){
      var t = e.target;
      var x = (e.touches && e.touches[0] ? e.touches[0].clientX :
               (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : e.clientX)) || 0;
      var y = (e.touches && e.touches[0] ? e.touches[0].clientY :
               (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : e.clientY)) || 0;
      var top = '';
      try{
        var el = document.elementFromPoint(x,y);
        if(el) top = el.tagName.toLowerCase()+(el.className?'.'+String(el.className).split(/\s+/)[0]:'');
      }catch(_){}
      pushDiag({ev:ev, tg:targetInfo(t), x:x|0, y:y|0, top:top,
        ostype:typeof openStadium, hasCtrl:!!(navigator.serviceWorker && navigator.serviceWorker.controller)});
    }, true);
  });
  var headerTaps = [];
  document.addEventListener('click', function(e){
    var hd = e.target.closest && e.target.closest('.logo');
    if(!hd) return;
    var now = Date.now();
    headerTaps = headerTaps.filter(function(t){ return now-t < 2000; });
    headerTaps.push(now);
    if(headerTaps.length >= 5){
      headerTaps = [];
      showDiagOverlay();
    }
  }, true);
  function showDiagOverlay(){
    if(document.getElementById('diagOverlay')) return;
    var dm = matchMedia('(display-mode: standalone)').matches;
    var sw = navigator.serviceWorker;
    var ctrl = sw && sw.controller;
    function rectOf(sel){
      var el = document.querySelector(sel);
      if(!el) return '<no '+sel+'>';
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      return sel+' rect='+(r.left|0)+','+(r.top|0)+' '+(r.width|0)+'x'+(r.height|0)
        +' pos='+cs.position+' z='+cs.zIndex+' pe='+cs.pointerEvents;
    }
    function elAt(x,y){
      try {
        var el = document.elementFromPoint(x,y);
        if(!el) return '@'+x+','+y+'=null';
        var s = el.tagName.toLowerCase();
        if(el.id) s += '#'+el.id;
        if(el.className && typeof el.className==='string') s += '.'+el.className.split(/\s+/).slice(0,2).join('.');
        var card = el.closest && el.closest('.stadium-card');
        if(card) s += ' [card sid='+(card.getAttribute('data-sid')||'none')+']';
        return '@'+x+','+y+'='+s;
      } catch(e){ return '@'+x+','+y+'=ERR:'+e.message; }
    }
    var W = window.innerWidth, H = window.innerHeight;
    var staticProbes = [
      rectOf('.logo'),
      rectOf('.header'),
      rectOf('#stadiumList'),
      'window:'+W+'x'+H,
      'topAt(card area): ' + elAt((W/2)|0, 400),
      'topAt(card area2):' + elAt(80, 400),
      'topAt(card area3):' + elAt((W-80)|0, 600),
      'topAt(logo area): ' + elAt(80, 80)
    ].join('\n');
    var summary = [
      'standalone:'+dm,
      'sw.controller:'+(ctrl?ctrl.scriptURL.split('/').slice(-1)[0]+' state='+ctrl.state:'NONE'),
      'openStadium:'+typeof openStadium,
      'cards:'+document.querySelectorAll('.stadium-card[data-sid]').length,
      'cards.onclick:'+document.querySelectorAll('.stadium-card[onclick]').length,
      'delegation:'+(typeof _setupStadiumDelegation),
      'UA:'+navigator.userAgent.slice(0,80)
    ].join('\n');
    function fmt(d){
      return new Date(d.t).toISOString().slice(11,19)+' '+d.ev+' '+d.tg+' @'+d.x+','+d.y+' top='+d.top+' os='+d.ostype;
    }
    var cardEvents = ring.filter(function(d){ return d.tg && d.tg.indexOf('[card')>=0; });
    var cardLines = cardEvents.length === 0
      ? '(NO STADIUM-CARD EVENTS — タップしても記録されていません)'
      : cardEvents.map(fmt).join('\n');
    var otherLines = ring.slice(-25).map(fmt).join('\n');
    var ov = document.createElement('div');
    ov.id = 'diagOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.95);color:#0f0;font:11px monospace;padding:12px;overflow:auto;z-index:2147483647;white-space:pre-wrap;-webkit-user-select:text;user-select:text';
    ov.textContent = '=== DIAG ===\n'+summary
      +'\n\n=== STATIC PROBES ===\n'+staticProbes
      +'\n\n=== STADIUM-CARD EVENTS ('+cardEvents.length+') ===\n'+cardLines
      +'\n\n=== ALL EVENTS (last 25 of '+ring.length+') ===\n'+otherLines;
    var close = document.createElement('button');
    close.textContent = '× 閉じる';
    close.style.cssText = 'position:fixed;top:10px;right:10px;background:#f00;color:#fff;border:0;padding:8px 14px;font:14px sans-serif;border-radius:6px;z-index:2147483648';
    close.onclick = function(){ ov.remove(); close.remove(); clearBtn.remove(); };
    var clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 クリア';
    clearBtn.style.cssText = 'position:fixed;top:10px;right:100px;background:#f80;color:#fff;border:0;padding:8px 14px;font:14px sans-serif;border-radius:6px;z-index:2147483648';
    clearBtn.onclick = function(){
      ring.length = 0;
      try { localStorage.removeItem('boatrace_diag'); }catch(_){}
      ov.remove(); close.remove(); clearBtn.remove();
    };
    document.body.appendChild(ov);
    document.body.appendChild(close);
    document.body.appendChild(clearBtn);
  }
  globalThis.showDiagOverlay = showDiagOverlay;
})();

// PB-11: クラス不均衡対策 — 全国コース別 1着率を log prior としてロジットに加算
//        softmax(log_prior + w·x) で base rate に揃える Bayesian 風の初期化
var COURSE_LOG_PRIOR = [
  Math.log(COURSE_WIN_RATE[1]||0.55),
  Math.log(COURSE_WIN_RATE[2]||0.14),
  Math.log(COURSE_WIN_RATE[3]||0.12),
  Math.log(COURSE_WIN_RATE[4]||0.11),
  Math.log(COURSE_WIN_RATE[5]||0.06),
  Math.log(COURSE_WIN_RATE[6]||0.02)
];

// PB-7: 特徴量 z-score 正規化用 rolling 統計（Welford's online algorithm）
//   既定: mean=0, var=1 → z(x) ≈ x（identity）。学習が進むと真の z-score へ収束。
//   ENABLE_ZSCORE が true で初めて適用される（既存重みとの整合性のため既定 OFF）
var FEATURE_DIM = 12;
function _initFeatureStats(){
  return {
    mean: new Array(FEATURE_DIM).fill(0),
    m2:   new Array(FEATURE_DIM).fill(0),   // Welford's M2 (sum of squared diffs)
    n:    0
  };
}
var _featureStats = (function(){
  var raw = _bootParseLS('boatrace_featurestats', null);
  if(raw && Array.isArray(raw.mean) && raw.mean.length===FEATURE_DIM
        && Array.isArray(raw.m2) && typeof raw.n==='number'){ return raw; }
  return _initFeatureStats();
})();

// PB-6: Platt scaling 係数 — 既定は a=1, b=0（identity = no calibration）
//   将来 _refitPlattCoeffs(history) で auto-tune
var _plattCoeffs = (function(){
  var raw = _bootParseLS('boatrace_platt', null);
  if(raw && Number.isFinite(raw.a) && Number.isFinite(raw.b)
        && Number.isFinite(raw.fittedAt)){ return raw; }
  return { a: 1.0, b: 0.0, fittedAt: 0, n: 0 };
})();

// PB-5: Stacking 重み — L2 が L1 logit を補正する係数
//   既定 γ=0 で stacking 無効（線形融合のみ）
//   STACKING_MODE='residual' のとき active
var _stackingGamma = 0.0;

// PC-3: 主要しきい値の集約（マジックナンバー撲滅、変更履歴の追跡性向上）
//       根拠: CLAUDE.md 修正履歴の Review 系 / X1 EV/Kelly 改善設計を参照
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

// ===============================================
// STATE (PRESERVED)
// ===============================================
var programData=null,previewData=null,resultData=null;
var oddsData=null,raceData=null;   // P3 L-17: oddsHistory 死コード削除
var currentStadium=null,currentRace=null;
// PF-2: _validateLS は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）

// PF-2: _bootParseLS は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）
var settings=_bootParseLS('boatrace_settings', {betCount3:10, betCount2:5, betMethod:'auto'});
var racerDB=_bootParseLS('boatrace_racerDB', {});
var stadiumDB=_bootParseLS('boatrace_stadiumDB', {});
// X2: 場別正規化用統計（モーター / 展示タイム）
var stadiumMotorStats=_bootParseLS('boatrace_motorStats', {});
var stadiumExhibitionStats=_bootParseLS('boatrace_exhibitionStats', {});
// X4: 潮汐データ（cron で 1日1回更新）
var tideData=null;
// X6: 対戦相性 DB
var pairwiseDB=_bootParseLS('boatrace_pairwiseDB', {});
var l2weights=_bootParseLS('boatrace_weights', null) || L2_INIT_WEIGHTS.slice();
// PB-1: 学習済レースキーセット（同レース二重学習を防ぐ）。Set ではなく
//       JSON 互換の object 形式 { "20260504_22_1": 1, ... } で永続化
var l2learnedKeys=_bootParseLS('boatrace_learned', {});
// PB-2: 学習更新カウンタ（LR decay 用）
var l2trainStep=(function(){ var v=_bootParseLS('boatrace_trainstep', 0); return (typeof v==='number'&&Number.isFinite(v))?v:0; })();
var statsChart=null;
var oddsAutoRefreshTimer=null;
var oddsLastFetched=null;

// PA-5 / PC-6: エラー観測用バッファ（最大 100 件、循環）
var ERROR_BUF_MAX = 100;
// PF-2: reportError は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）
// PC-6: 未捕捉エラー / Promise reject の自動収集
window.addEventListener('error', function(e){
  reportError({type:'error', msg:String(e.message||''), src:String(e.filename||''), line:e.lineno|0, col:e.colno|0, stack:(e.error&&e.error.stack)?String(e.error.stack).slice(0,800):''});
});
window.addEventListener('unhandledrejection', function(e){
  var reason = e.reason; var msg=''; var stack='';
  try{ msg = (reason && reason.message) ? reason.message : String(reason); }catch(_){}
  try{ stack = (reason && reason.stack) ? String(reason.stack).slice(0,800) : ''; }catch(_){}
  reportError({type:'reject', msg:msg, stack:stack});
});

// ===============================================
// UTILITIES (P3 共通ヘルパ拡張版)
// ===============================================
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
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

// F9: 強制更新を全面修正
//   - 全 SW cache を削除（旧 'api' 名チェックは新 v4 cache に当たらない）
//   - bc_* localStorage キャッシュも削除（最大 10分 stale 防止）
//   - 自前 data/previews/today.json を fetch & merge（finished/result の最新化）
//   - 鮮度バッジを再描画
//   - 視覚フィードバック（ボタン → ⏳更新中…）
async function forceRefresh(){
  var navBtn = document.getElementById('navRefresh');
  var origText = navBtn ? navBtn.innerHTML : '';
  if(navBtn){ navBtn.disabled=true; navBtn.innerHTML='<span class="nav-icon">⏳</span>更新中'; }
  try {
    // 1) Service Worker cache を全削除
    if('caches' in window){
      var keys = await caches.keys();
      await Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }
    // 2) bc_* localStorage キャッシュを削除
    var bcKeys=[];
    for(var i=0;i<localStorage.length;i++){
      var k = localStorage.key(i);
      if(k && k.indexOf('bc_')===0) bcKeys.push(k);
    }
    bcKeys.forEach(function(k){ try{ localStorage.removeItem(k); }catch(_){} });

    // 3) Open API + 自前 data/* を再取得
    var t = Date.now();
    var rawP  = await fetchWithFallback(API_BASE+'/programs/v2/today.json?_='+t);
    if(rawP){ programData=indexByStadiumRace(rawP,'programs'); _noteUpdatedAt(rawP.updated_at); }
    var rawPv = _filterStalePreviews(await fetchWithFallback(API_BASE+'/previews/v2/today.json?_='+t));
    if(rawPv){ previewData=indexPreviews(rawPv); _noteUpdatedAt(rawPv.updated_at); }
    // results: 自前 data/results/today.json を優先、fallback で Open API
    var rawR = null;
    try{
      var rR = await fetch('data/results/today.json?t='+t, {cache:'no-store'});
      if(rR.ok){
        var rd = await rR.json();
        var todayJst = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        if(rd && Array.isArray(rd.results) && rd.results.length > 0
           && rd.results.some(function(r){return r.race_date===todayJst})){
          rawR = rd;
        }
      }
    }catch(_){}
    if(!rawR) rawR = await fetchWithFallback(API_BASE+'/results/v2/today.json?_='+t);
    if(rawR){
      resultData=indexResults(rawR);
      _noteUpdatedAt(rawR.updated_at);
      if(programData) updateDBFromResults(resultData, programData);
      await learnFromResults();
      updateHistoryWithResults();
    }
    try{
      var o = await fetch('data/odds/today.json?t='+t, {cache:'no-store'});
      if(o.ok){ var od=await o.json(); oddsData=od; oddsLastFetched=Date.now(); _noteUpdatedAt(od.updated_at); }
    }catch(e){}
    // 自前 previews を merge（finished/result の最新化）
    try{
      var p = await fetch('data/previews/today.json?t='+t, {cache:'no-store'});
      if(p.ok){
        var pd = await p.json();
        if(pd && Array.isArray(pd.races)) _applyLiveDataMerge(pd);
        _noteUpdatedAt(pd.updated_at);
      }
    }catch(e){}
    updateHistoryWithResults();   // 二回目: マージ後の最新 resultData で payout 補完
    // F17: 全場の確定レースに対して予想 backfill
    if(typeof _backfillTodayPredictions === 'function') await _backfillTodayPredictions();   // PE-9
    // F18: backfill で新規追加された的中エントリの payout3/payout2 を再度補完
    updateHistoryWithResults();

    // 4) 鮮度表示と現在ページを再描画
    if(typeof _renderFreshness==='function') _renderFreshness();
    var currentPage = document.querySelector('.page.active');
    if(currentPage){
      var pid = currentPage.id;
      if(pid==='pageTop') renderStadiums();
      else if(pid==='pageRaces' && currentStadium) openStadium(currentStadium);
      else if(pid==='pageDetail' && currentStadium && currentRace) openRace(currentStadium, currentRace);
      else if(pid==='pageStats' && typeof renderStats==='function') renderStats();
    }
  } catch(e){
    console.warn('Refresh error:', e);
  } finally {
    if(navBtn){ navBtn.disabled=false; navBtn.innerHTML=origText; }
  }
}
function escText(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}

// P3 L-11: JST日付計算を 1 関数に集約（旧 todayStr/formatDate のロジックを内部利用）
function getJSTDate(offsetDays){
  var t = Date.now() + 9*3600000 + (offsetDays||0)*86400000;
  return new Date(t);
}
function jstYmd(offsetDays){
  var d=getJSTDate(offsetDays);
  return d.getUTCFullYear()+('0'+(d.getUTCMonth()+1)).slice(-2)+('0'+d.getUTCDate()).slice(-2);
}
function todayStr(){return jstYmd(0)}
function formatDate(){var d=getJSTDate(0);return(d.getUTCMonth()+1)+'/'+d.getUTCDate()+' ('+['日','月','火','水','木','金','土'][d.getUTCDay()]+')';}

// PF-2: safeParse は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）

// PF-2: safeSet は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）

// PE-10: softmax / safeDiv は src/utils/math.js から bundle 注入される
//        ↓ MARKER 領域で MATH bundle が globalThis に export
/* BUILD:MATH:START */
"use strict";
(() => {
  // ../src/utils/math.js
  function softmax(logits) {
    if (!Array.isArray(logits) || logits.length === 0) return [];
    const clean = logits.map((v) => Number.isFinite(v) ? v : 0);
    let max = clean.reduce((a, b) => b > a ? b : a, -Infinity);
    if (!Number.isFinite(max)) max = 0;
    const exps = clean.map((v) => Math.exp(Math.min(v - max, 50)));
    const sum = exps.reduce((a, b) => a + b, 0);
    if (sum === 0 || !Number.isFinite(sum)) return clean.map(() => 1 / clean.length);
    return exps.map((x) => x / sum);
  }
  function sigmoid(z) {
    if (z > 30) return 1;
    if (z < -30) return 0;
    return 1 / (1 + Math.exp(-z));
  }
  function safeDiv(num, den, fallback) {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
      return fallback == null ? 0 : fallback;
    }
    return num / den;
  }
  function _plackettLuceTrifectaProb(p, i, j, k) {
    const pi = p[i] || 0, pj = p[j] || 0, pk = p[k] || 0;
    if (pi <= 0 || pj <= 0 || pk <= 0) return 0;
    const denom1 = 1 - pi;
    if (denom1 <= 1e-9) return 0;
    const denom2 = 1 - pi - pj;
    if (denom2 <= 1e-9) return 0;
    const prob = pi * (pj / denom1) * (pk / denom2);
    return Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
  }
  function _plackettLuceExactaProb(p, i, j) {
    const pi = p[i] || 0, pj = p[j] || 0;
    if (pi <= 0 || pj <= 0) return 0;
    const denom = 1 - pi;
    if (denom <= 1e-9) return 0;
    const prob = pi * (pj / denom);
    return Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
  }
  globalThis.softmax = softmax;
  globalThis.sigmoid = sigmoid;
  globalThis.safeDiv = safeDiv;
  globalThis._plackettLuceTrifectaProb = _plackettLuceTrifectaProb;
  globalThis._plackettLuceExactaProb = _plackettLuceExactaProb;
})();

/* BUILD:MATH:END */

// PF-2: softmax は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）

// PF-2: safeDiv は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）

function boatBadge(num){return'<span class="boat-badge" style="background:'+BOAT_COLORS[num]+';color:'+BOAT_TEXT[num]+';border:1px solid '+(num===1?'#ccc':'transparent')+'">'+num+'</span>'}
// PF-6: boatBadgeLg は未使用（grep で 0 callsite）→ 削除
function starsHtml(n){var s='';for(var i=0;i<5;i++)s+=i<n?'★':'☆';return s}
function pf(v){return parseFloat(v)||0}

function fetchWithFallback(url){
  // キャッシュキーはクエリパラメータを除いたベースURL
  var baseUrl=url.split('?')[0];
  var controller=new AbortController();
  var tid=setTimeout(function(){controller.abort()},15000);
  return fetch(url,{signal:controller.signal,cache:'no-store'})
    .then(function(r){clearTimeout(tid);if(!r.ok)throw new Error(r.status);return r.json()})
    .then(function(d){try{localStorage.setItem(cacheKey(baseUrl),JSON.stringify({data:d,time:Date.now()}))}catch(e){}return d})
    .catch(function(e){
      clearTimeout(tid);
      console.warn('API error:',baseUrl,e.message);
      try{var c=localStorage.getItem(cacheKey(baseUrl));if(c){var o=JSON.parse(c);if(Date.now()-o.time<600000)return o.data}}catch(ex){}
      return null;
    });
}

// P4 W-08: 受信 JSON のスキーマ最小検証
function validateApiPayload(apiJson, key){
  if(!apiJson || typeof apiJson !== 'object') return false;
  if(!Array.isArray(apiJson[key])) return false;
  // race_stadium_number / race_number があるかは indexByStadiumRace 内で String 化されるので最低限の存在チェック
  return true;
}

function indexByStadiumRace(apiJson, key){
  if(!validateApiPayload(apiJson, key)){
    if(apiJson) console.warn('[schema] invalid payload for', key);
    return null;
  }
  var arr=apiJson[key];
  var result={};
  arr.forEach(function(item){
    var sid=String(item.race_stadium_number);
    var rn=String(item.race_number);
    if(!result[sid]) result[sid]={};
    result[sid][rn]=item;
  });
  return result;
}

function indexPreviews(apiJson){
  var indexed=indexByStadiumRace(apiJson,'previews');
  if(!indexed) return null;
  for(var sid in indexed){
    for(var rn in indexed[sid]){
      var p=indexed[sid][rn];
      p.weather={
        wind_speed:p.race_wind||0,
        wind_direction:p.race_wind_direction_number||0,
        wave_height:p.race_wave||0,
        temperature:p.race_temperature||0,
        water_temperature:p.race_water_temperature||0,
        weather_number:p.race_weather_number||0
      };
    }
  }
  return indexed;
}

function indexResults(apiJson){
  var indexed=indexByStadiumRace(apiJson,'results');
  if(!indexed) return null;
  for(var sid in indexed){
    for(var rn in indexed[sid]){
      var r=indexed[sid][rn];
      var isFinished=r.race_technique_number!=null;
      if(isFinished&&r.boats&&Array.isArray(r.boats)){
        r.results=r.boats.filter(function(b){return b.racer_place_number!=null}).map(function(b){
          return{
            place:b.racer_place_number,
            racer_boat_number:b.racer_boat_number,
            racer_course_number:b.racer_course_number,
            racer_number:b.racer_number,
            racer_name:b.racer_name,
            racer_start_timing:b.racer_start_timing
          };
        });
      }
      if(r.payouts) r.refund=r.payouts;
      r.technique_number=r.race_technique_number;
      r.isFinished=isFinished;
    }
  }
  return indexed;
}

// ===============================================
// DB MANAGEMENT (PRESERVED)
// ===============================================
// ===============================================
// X7: バックテスト (R-16)
// ===============================================
//
// 保存履歴（boatrace_history）を「もし EV>=N かつ Kelly 比率 K で買っていたら」の前提で
// 後付け評価し、ROI / 的中率 / 投資総額 / 払戻総額 / 最大連敗 / シャープレシオ を算出。
//
// 制約: history に odds スナップショットが無いため、当時の EV は厳密再現できない。
// → 簡易シミュレーション: 推奨済の trifecta_bets / exacta_bets を「3連単 100円ずつ均等買い」
//   と仮定した参照値、および「現在保存されている payout3 / payout2」で集計。
//
// より精緻な EV 再現は odds アーカイブが揃ってから X7+α で実装。

function _btParseDate(yyyymmdd){
  if(!yyyymmdd || typeof yyyymmdd !== 'string' || yyyymmdd.length !== 8) return null;
  return new Date(
    parseInt(yyyymmdd.slice(0,4),10),
    parseInt(yyyymmdd.slice(4,6),10) - 1,
    parseInt(yyyymmdd.slice(6,8),10)
  );
}

function runBacktestEngine(history, opt){
  opt = opt || {};
  var periodDays = opt.periodDays != null ? opt.periodDays : 14;
  var stakePerBet = opt.stakePerBet || 100;
  var ledger = [];

  // 期間フィルタ
  var cutoff = null;
  if(periodDays > 0){
    var d = new Date();
    d.setDate(d.getDate() - periodDays);
    cutoff = d;
  }
  history.forEach(function(h){
    if(!h.actual) return;
    if(cutoff){
      var hd = _btParseDate(h.date);
      if(!hd || hd < cutoff) return;
    }
    ledger.push(h);
  });

  // 集計
  var totalBets = 0, totalStake = 0, totalPayout = 0;
  var hits3 = 0, hits2 = 0;
  var dailyROI = {};
  var maxDD = 0, currentLoss = 0, balance = 0;
  var byType = { honmei: {n:0, hits:0, payout:0}, middle: {n:0, hits:0, payout:0}, ana: {n:0, hits:0, payout:0} };

  ledger.sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});
  ledger.forEach(function(h){
    var bets3n = (h.trifecta_bets || []).length;
    var bets2n = (h.exacta_bets || []).length;
    var stake = (bets3n + bets2n) * stakePerBet;
    var payout = (h.payout3 || 0) + (h.payout2 || 0);
    totalBets += bets3n + bets2n;
    totalStake += stake;
    totalPayout += payout;
    if(h.trifecta_hit) hits3++;
    if(h.exacta_hit) hits2++;
    var rt = h.raceType || 'middle';
    if(byType[rt]){
      byType[rt].n++;
      if(h.trifecta_hit) byType[rt].hits++;
      byType[rt].payout += (h.payout3 || 0);
    }
    var net = payout - stake;
    balance += net;
    if(net < 0){
      currentLoss += -net;
      maxDD = Math.max(maxDD, currentLoss);
    } else {
      currentLoss = 0;
    }
    var d = h.date || 'unknown';
    if(!dailyROI[d]) dailyROI[d] = { stake: 0, payout: 0, n: 0 };
    dailyROI[d].stake += stake;
    dailyROI[d].payout += payout;
    dailyROI[d].n++;
  });

  var roi = totalStake > 0 ? totalPayout / totalStake : 0;
  var hitRate3 = ledger.length > 0 ? hits3 / ledger.length : 0;
  var hitRate2 = ledger.length > 0 ? hits2 / ledger.length : 0;

  // シャープレシオ（日次 net return / std）
  var dailyReturns = Object.keys(dailyROI).map(function(d){
    var s = dailyROI[d].stake;
    return s > 0 ? (dailyROI[d].payout - s) / s : 0;
  });
  var meanR = dailyReturns.length > 0 ? dailyReturns.reduce(function(a,b){return a+b;}, 0) / dailyReturns.length : 0;
  var varR = dailyReturns.length > 1
    ? dailyReturns.reduce(function(a,r){ return a + (r-meanR)*(r-meanR); }, 0) / (dailyReturns.length - 1)
    : 0;
  var stdR = Math.sqrt(varR);
  var sharpe = stdR > 0 ? meanR / stdR : 0;

  // PB-10: log loss / Brier / ECE（mark_probs を保存している履歴のみ）
  var calibration = _computeCalibrationMetrics(ledger);

  return {
    samples: ledger.length,
    totalBets: totalBets,
    totalStake: totalStake,
    totalPayout: totalPayout,
    netProfit: totalPayout - totalStake,
    roi: roi,
    hitRate3: hitRate3,
    hitRate2: hitRate2,
    maxDrawdown: maxDD,
    sharpe: sharpe,
    byType: byType,
    dailyROI: dailyROI,
    period: periodDays,
    // PB-10: calibration metrics
    logLoss: calibration.logLoss,
    brier: calibration.brier,
    ece: calibration.ece,
    calibratedSamples: calibration.n,
    // PB-3: leakage 注意
    leakageNote: 'NOTE: 既存履歴は予想時点で既に L2 学習が反映済みのため look-ahead leakage の可能性あり。完全な forward-chain 評価には runForwardChainBacktest() を使用',
  };
}

// PB-3: Forward-chaining backtest（現状は履歴の logloss/brier/ece を時系列順で集計）
//       完全な再予想には programData/previewData の保存が必要なため、暫定的に
//       「保存済 mark_probs を時系列順で評価」する形で leakage を最小化
function runForwardChainBacktest(history, opt){
  opt = opt || {};
  var warmup = opt.warmupRaces != null ? opt.warmupRaces : 30;
  var sorted = (history||[]).slice().filter(function(h){
    return h.actual && h.actual.length>0 && Array.isArray(h.mark_probs);
  });
  sorted.sort(function(a,b){
    var d = (a.date||'').localeCompare(b.date||'');
    if(d !== 0) return d;
    return ((a.stadium||0)-(b.stadium||0)) || ((a.race||0)-(b.race||0));
  });
  var evalSet = sorted.slice(warmup);
  var cal = _computeCalibrationMetrics(evalSet);
  return {
    totalSamples: sorted.length,
    warmupSkipped: Math.min(warmup, sorted.length),
    evaluatedSamples: evalSet.length,
    logLoss: cal.logLoss,
    brier: cal.brier,
    ece: cal.ece,
    note: '時系列順で warmup 後のレースのみ評価。完全な forward-chain 再学習にはレース時点の features 保存が必要',
  };
}

// PB-10 ヘルパ: 各エントリの mark_probs と actual から calibration metrics を計算
function _computeCalibrationMetrics(entries){
  var logLossSum = 0, brierSum = 0, n = 0;
  var bins = []; for(var i=0;i<10;i++) bins.push({sum:0,hit:0,n:0});
  entries.forEach(function(h){
    if(!h.actual || !h.actual.length || !Array.isArray(h.mark_probs)) return;
    var winner = h.actual[0];
    var probs = {};
    h.mark_probs.forEach(function(mp){ probs[mp.boat] = mp.prob; });
    var pWin = probs[winner];
    if(!Number.isFinite(pWin) || pWin <= 0 || pWin >= 1) return;
    logLossSum += -Math.log(pWin);
    // Brier: Σ(p_i - y_i)^2 （6 艇 multi-class）
    for(var b=1;b<=6;b++){
      var p = probs[b]||0; var y = (b===winner)?1:0;
      brierSum += (p-y)*(p-y);
    }
    // ECE: 1 着確率 vs 1 着率を 10 分位 bin で
    var binIdx = Math.min(9, Math.floor(pWin*10));
    bins[binIdx].sum += pWin;
    bins[binIdx].hit += 1;
    bins[binIdx].n   += 1;
    n++;
  });
  var logLoss = n>0 ? logLossSum/n : 0;
  var brier   = n>0 ? brierSum/n : 0;
  var ece = 0;
  bins.forEach(function(b){
    if(b.n===0) return;
    var avgP = b.sum/b.n; var actRate = b.hit/b.n;
    ece += (b.n/Math.max(1,n)) * Math.abs(avgP-actRate);
  });
  return {logLoss: logLoss, brier: brier, ece: ece, n: n};
}

function runBacktest(){
  var resultDiv = document.getElementById('btResult');
  var detailsDiv = document.getElementById('btDetails');
  resultDiv.innerHTML = '<div class="card"><div style="padding:12px;text-align:center">⏳ 計算中...</div></div>';
  detailsDiv.innerHTML = '';

  var opt = {
    periodDays: parseInt(document.getElementById('btPeriod').value, 10),
    evMin: parseFloat(document.getElementById('btEvMin').value),
    kellyFrac: parseFloat(document.getElementById('btKellyFrac').value),
    bankroll: parseInt(document.getElementById('btBankroll').value, 10),
    stakePerBet: 100,
  };
  var history = safeParse('boatrace_history', []);

  setTimeout(function(){
    var r = runBacktestEngine(history, opt);
    var roiPct = (r.roi * 100).toFixed(1);
    var roiColor = r.roi >= 1.0 ? 'var(--success)' : r.roi >= 0.85 ? 'var(--warn)' : 'var(--danger)';
    var html = '<div class="card"><div style="padding:12px">';
    html += '<div style="font-weight:700;font-size:13px;margin-bottom:8px">📈 バックテスト結果</div>';
    html += '<table style="width:100%;font-size:12px"><tbody>';
    html += '<tr><td>対象レース</td><td style="text-align:right">'+r.samples+' R</td></tr>';
    html += '<tr><td>投資総額</td><td style="text-align:right">¥'+r.totalStake.toLocaleString()+'</td></tr>';
    html += '<tr><td>払戻総額</td><td style="text-align:right">¥'+r.totalPayout.toLocaleString()+'</td></tr>';
    html += '<tr><td>純損益</td><td style="text-align:right;color:'+(r.netProfit>=0?'var(--success)':'var(--danger)')+';font-weight:700">'
            +(r.netProfit>=0?'+':'')+'¥'+r.netProfit.toLocaleString()+'</td></tr>';
    html += '<tr><td><b>回収率</b></td><td style="text-align:right;color:'+roiColor+';font-weight:700;font-size:14px">'+roiPct+'%</td></tr>';
    html += '<tr><td>3連単的中率</td><td style="text-align:right">'+(r.hitRate3*100).toFixed(1)+'%</td></tr>';
    html += '<tr><td>2連単的中率</td><td style="text-align:right">'+(r.hitRate2*100).toFixed(1)+'%</td></tr>';
    html += '<tr><td>最大ドローダウン</td><td style="text-align:right">¥'+r.maxDrawdown.toLocaleString()+'</td></tr>';
    html += '<tr><td>シャープレシオ</td><td style="text-align:right">'+r.sharpe.toFixed(2)+'</td></tr>';
    html += '</tbody></table>';
    html += '</div></div>';
    resultDiv.innerHTML = html;

    // タイプ別内訳
    var dh = '<div class="card"><div style="padding:12px">';
    dh += '<div style="font-weight:700;font-size:13px;margin-bottom:8px">レースタイプ別</div>';
    dh += '<table style="width:100%;font-size:12px"><thead><tr><th>タイプ</th><th>R数</th><th>3連単的中</th><th>払戻合計</th></tr></thead><tbody>';
    ['honmei','middle','ana'].forEach(function(t){
      var tt = r.byType[t];
      var lbl = t==='honmei'?'⚡本命':t==='middle'?'📊混戦':'🔥穴';
      dh += '<tr><td>'+lbl+'</td><td style="text-align:right">'+tt.n+'</td>'
         +'<td style="text-align:right">'+tt.hits+' ('+(tt.n>0?(tt.hits/tt.n*100).toFixed(1):0)+'%)</td>'
         +'<td style="text-align:right">¥'+tt.payout.toLocaleString()+'</td></tr>';
    });
    dh += '</tbody></table>';
    dh += '<div style="font-size:9px;color:var(--text-dim);margin-top:8px">'
       + '※ 簡易バックテスト: 各推奨買い目を ¥'+opt.stakePerBet+' ずつ均等購入したと仮定。'
       + '<br>※ EV/Kelly モードの精密再現には当時オッズの履歴アーカイブが必要（X7+α で実装予定）。'
       + '</div>';
    dh += '</div></div>';
    detailsDiv.innerHTML = dh;
  }, 50);
}

// ===============================================
// X6: 節間調整 / モーター急変警告 / 対戦相性
// ===============================================

// 線形回帰の slope（最小二乗）
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

// 節間調整スコア (R-07): 同一節中のモーター 2連率 / 着順の推移
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

// R-13: モーター急変警告 — 現在 UI 未使用だがテスト (test_series_pairwise.js) でカバー済
function motorTrendWarning(rid, sid){
  var r = seriesAdjustmentScore(rid, sid);
  if(r.samples < 3) return null;
  if(r.slope >= +3) return { kind: 'up', text: 'モーター上昇中(+'+r.slope.toFixed(1)+'/日)' };
  if(r.slope <= -3) return { kind: 'down', text: 'モーター下降中('+r.slope.toFixed(1)+'/日)' };
  return null;
}

// R-09: 対戦相性スコア（他艇との pairwise 履歴）
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

// 節間調整 / 対戦相性データを results から学習
function learnSeriesAndPairwiseFromResults(resultsJson){
  if(!resultsJson) return;
  var today = todayStr();
  for(var sid in resultsJson){
    var races = resultsJson[sid];
    for(var rn in races){
      var race = races[rn];
      if(!race || !race.results) continue;
      var sortedRes = race.results.slice().sort(function(a,b){return a.place-b.place});
      var ridsInRace = sortedRes.map(function(r){return r.racer_number || 0;});

      sortedRes.forEach(function(r, idx){
        var rid = r.racer_number || 0;
        if(!rid || !racerDB[rid]) return;
        var rdb = racerDB[rid];

        // 節間追跡（場ごとに最大 7 日分保存、当日重複排除）
        if(!rdb.seriesProgress) rdb.seriesProgress = {};
        if(!rdb.seriesProgress[String(sid)]) rdb.seriesProgress[String(sid)] = [];
        var prog = rdb.seriesProgress[String(sid)];
        // 当日エントリが既にあれば motorRate 更新、なければ追加
        var existing = prog.find(function(p){return p.date===today;});
        var motorRate = pf(r.racer_assigned_motor_top_2_percent);
        if(existing){
          if(motorRate > 0) existing.motorRate = (existing.motorRate || 0) * 0.5 + motorRate * 0.5;
          existing.lastFinish = r.place;
        } else {
          prog.push({ date: today, motorRate: motorRate, finish: [r.place], lastFinish: r.place });
        }
        // 7 日以上前を削除
        if(prog.length > 7) rdb.seriesProgress[String(sid)] = prog.slice(-7);

        // 対戦相性（pair-wise: 場の同レース内）
        ridsInRace.forEach(function(oid){
          if(!oid || oid === rid) return;
          var key = (rid < oid) ? rid+'-'+oid : oid+'-'+rid;
          if(!pairwiseDB[key]) pairwiseDB[key] = { races: 0, head2head: {} };
          var pr = pairwiseDB[key];
          pr.races++;
          // 着順比較で勝者カウント（自分の着が相手より上なら +1）
          var myPlace = r.place;
          var oppRes = sortedRes.find(function(x){return x.racer_number===oid;});
          if(!oppRes) return;
          var winner = (myPlace < oppRes.place) ? rid : oid;
          pr.head2head[String(winner)] = (pr.head2head[String(winner)] || 0) + 1;
        });
      });
    }
  }
  // 保存
  safeSet('boatrace_pairwiseDB', pairwiseDB);
  saveDB();
}

// ===============================================
// X5: 局面別予測（シナリオ展開モデル R-12 / グレード別補正 R-15）
// ===============================================
//
// 1着確率を直接出すのではなく、
//   1) 展開シナリオ（逃げ / 差し / まくり / まくり差し / その他）の確率分布を予測
//   2) 各シナリオ条件下の 2着 / 3着分布を加重平均
// で 1-2-3 着の同時分布を組み立てる。

// グレード別シナリオ事前分布
// グレード番号: 0=一般, 1=G3, 2=G2, 3=G1, 4=SG, 5=女子戦
var SCENARIO_PRIORS_BY_GRADE = {
  0:  { nige: 0.55, sashi: 0.15, makuri: 0.15, makuriSashi: 0.10, other: 0.05 },  // 一般
  1:  { nige: 0.55, sashi: 0.18, makuri: 0.13, makuriSashi: 0.10, other: 0.04 },
  2:  { nige: 0.50, sashi: 0.18, makuri: 0.17, makuriSashi: 0.10, other: 0.05 },
  3:  { nige: 0.48, sashi: 0.20, makuri: 0.17, makuriSashi: 0.10, other: 0.05 },
  4:  { nige: 0.45, sashi: 0.22, makuri: 0.18, makuriSashi: 0.10, other: 0.05 },  // SG はトップ選手で逃げ崩れも多い
  5:  { nige: 0.65, sashi: 0.13, makuri: 0.10, makuriSashi: 0.07, other: 0.05 },  // 女子戦は逃げ率高
};

// シナリオ × 1-2-3 着分布のテンプレート
// key: 1-2-3 形式の艇番号並び
// 6艇すべてが同等と仮定した時の代表例
var SCENARIO_DIST = {
  nige: {       // 1コース逃げ
    '1-2-3': 0.20, '1-3-2': 0.15, '1-2-4': 0.10, '1-4-2': 0.08,
    '1-3-4': 0.08, '1-4-3': 0.06, '1-2-5': 0.05, '1-5-2': 0.04,
    '1-3-5': 0.04, '1-5-3': 0.03, '1-2-6': 0.03, '1-6-2': 0.02,
    '1-3-6': 0.02, '1-4-5': 0.02, '1-5-4': 0.02, '1-4-6': 0.02,
    '1-6-3': 0.02, '1-6-4': 0.02,
  },
  sashi: {      // 2コース差し
    '2-1-3': 0.18, '2-1-4': 0.12, '2-3-1': 0.10, '2-1-5': 0.08,
    '2-4-1': 0.08, '2-3-4': 0.06, '2-1-6': 0.05, '2-4-3': 0.05,
    '2-5-1': 0.05, '2-3-5': 0.04, '2-4-5': 0.04, '2-5-3': 0.03,
    '2-6-1': 0.03, '2-5-4': 0.03, '2-6-3': 0.03, '2-6-4': 0.03,
  },
  makuri: {     // 3-4 コースまくり (主に4コース)
    '4-2-3': 0.10, '4-1-2': 0.10, '4-2-1': 0.08, '4-3-2': 0.08,
    '4-1-3': 0.07, '4-3-1': 0.06, '3-1-2': 0.08, '3-2-1': 0.07,
    '3-2-4': 0.05, '3-1-4': 0.05, '4-2-5': 0.04, '4-5-2': 0.04,
    '3-4-2': 0.03, '3-1-5': 0.03, '4-1-5': 0.03, '4-5-1': 0.03,
    '3-5-1': 0.03, '3-2-5': 0.03,
  },
  makuriSashi: {  // 3-4 コースまくり差し
    '3-1-2': 0.12, '3-2-1': 0.10, '4-1-2': 0.10, '4-2-1': 0.08,
    '3-1-4': 0.08, '3-2-4': 0.06, '4-1-3': 0.07, '4-3-1': 0.06,
    '3-4-1': 0.05, '4-2-3': 0.05, '3-2-5': 0.04, '4-1-5': 0.04,
    '3-1-5': 0.03, '4-2-5': 0.03, '3-5-1': 0.03, '4-3-2': 0.03,
  },
  other: {      // 5/6 コース穴含む
    '5-1-2': 0.08, '5-2-1': 0.07, '6-1-2': 0.07, '6-2-1': 0.06,
    '5-1-3': 0.05, '5-3-1': 0.05, '6-1-3': 0.05, '6-3-1': 0.04,
    '5-2-3': 0.04, '5-4-1': 0.04, '6-2-4': 0.04, '6-4-1': 0.03,
    '5-3-2': 0.03, '5-4-2': 0.03, '6-1-4': 0.03, '6-4-2': 0.03,
    '5-2-4': 0.03, '5-1-4': 0.03, '6-3-2': 0.03,
  },
};

// シナリオ確率を場・選手の状況から推定
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

// シナリオ加重で 1-2-3 着分布を作る
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

// ===============================================
// X4: 環境データ（潮汐 R-02 / 場別風向 R-10 / 風×波交差項 R-14）
// ===============================================

// 場別風向プロファイル（イン不利になる風向の角度番号）
// JMA / 公式の風向番号は 1=北 → 16=北北西 と仮定
var STADIUM_WIND_PROFILE = {
  '02': { headWindDirs:[3,4,5],  tailWindDirs:[11,12,13], note:'北東風がイン不利（戸田）' },
  '03': { headWindDirs:[5,6,7],  tailWindDirs:[13,14,15], note:'東風がイン不利（江戸川）' },
  '14': { headWindDirs:[9,10,11],tailWindDirs:[1,2,3],   note:'南西風で荒れる（唐津）' },
  '12': { headWindDirs:[7,8,9],  tailWindDirs:[15,16,1], note:'南東風で展開難（蒲郡）' },
};
var GLOBAL_HEAD_DIRS = [7,8,9,10,11];
var GLOBAL_TAIL_DIRS = [15,16,1,2,3,4,5];

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

// 潮位×コース補正（mm の coarse 影響）
var TIDE_COURSE_BIAS = {
  rising:  {1:-3, 2:-2, 3:0, 4:+2, 5:+3, 6:+2},   // 上げ潮: センター/アウト有利
  falling: {1:+4, 2:+2, 3:0, 4:-2, 5:-3, 6:-2},   // 下げ潮: イン残り
  high:    {1:-5, 2:-3, 3:0, 4:+3, 5:+4, 6:+3},
  low:     {1:+5, 2:+3, 3:0, 4:-3, 5:-4, 6:-3},
};

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

function tideScore(sid, course, raceHour){
  if(!tideData || !tideData.stadiums) return 0;
  var entry = tideData.stadiums[String(sid)];
  if(!entry || entry.type !== 'saltwater') return 0;
  var phase = classifyTidePhase(entry, raceHour);
  if(!phase) return 0;
  return (TIDE_COURSE_BIAS[phase] || {})[course] || 0;
}

// 風×波交差項（嵐スコア）
function stormBonus(ws, wh, course){
  var base = 0;
  if(ws >= 5 && wh >= 5) base = -8;
  else if(ws >= 4 && wh >= 4) base = -4;
  else if(ws >= 3 && wh >= 3) base = -2;
  if(course <= 2) return base;          // インほど荒れに弱い
  if(course >= 4) return -base / 2;     // アウトはむしろ有利になる
  return 0;
}

// ===============================================
// X3: 進入予想エンジン (R-01)
// ===============================================
//
// 選手別「枠 → 進入コース」の確率分布を学習し、出走表段階で進入を予測する。
// データソース: 結果ファイルの racer_boat_number (枠) と racer_course_number (進入)
// 個人データ不足時は場別デフォルト分布を使用
//
// 場別デフォルト進入分布: 過去データから推定（前付け頻度の高い場で枠と進入のズレが多い）
// 値は P(course=C | boat=B) で行方向に sum=1
var DEFAULT_ENTRY_BY_STADIUM = {
  // 桐生 / 平和島 / 江戸川 / 戸田: 前付け少なめ
  '01': {1:{1:0.99,2:0.01},2:{2:0.97,1:0.02,3:0.01},3:{3:0.95,2:0.03,4:0.02},4:{4:0.94,3:0.04,5:0.02},5:{5:0.92,4:0.05,6:0.03},6:{6:0.95,5:0.04,4:0.01}},
  // 平和島 / 多摩川 / 浜名湖 / 蒲郡: 中程度
  '02': {1:{1:0.85,2:0.10,3:0.05},2:{2:0.80,1:0.10,3:0.10},3:{3:0.75,2:0.15,4:0.10},4:{4:0.70,3:0.15,2:0.10,5:0.05},5:{5:0.70,4:0.20,6:0.10},6:{6:0.75,5:0.20,4:0.05}},
  // 住之江 / 尼崎 / 鳴門 / 丸亀: 前付け多い
  '12': {1:{1:0.75,2:0.15,3:0.10},2:{2:0.70,1:0.15,3:0.15},3:{3:0.65,2:0.20,4:0.15},4:{4:0.60,3:0.20,2:0.15,5:0.05},5:{5:0.60,4:0.25,6:0.10,3:0.05},6:{6:0.65,5:0.25,4:0.10}},
};
// それ以外の場のデフォルト
var GLOBAL_DEFAULT_ENTRY = {1:{1:0.92,2:0.05,3:0.03},2:{2:0.88,1:0.08,3:0.04},3:{3:0.85,2:0.08,4:0.05,1:0.02},4:{4:0.82,3:0.10,5:0.05,2:0.03},5:{5:0.78,4:0.13,6:0.07,3:0.02},6:{6:0.85,5:0.10,4:0.05}};

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

/**
 * 6艇の進入コースを予測（ハンガリアン式割当）
 * @param boats Array of {boat:1-6, racer_number, racer_class_number}
 * @param sid stadium id
 * @returns {byBoat: {1:course,2:course,...}, conf: {1:p,2:p,...}}
 */
function predictEntryCourses(boats, sid){
  // 各艇の枠→コース確率を取得
  var dists = boats.map(function(b){
    return {
      boat: b.racer_boat_number,
      rid: b.racer_number,
      dist: getEntryDist(b.racer_number, b.racer_boat_number, sid),
    };
  });

  // ハンガリアン: 全艇 × 全コース の割当を確率最大化
  // 6 艇 6 コースなら 6! = 720 通り全列挙で十分
  var permutations = [];
  function perm(arr, current){
    if(arr.length === 0){ permutations.push(current); return; }
    for(var i=0; i<arr.length; i++){
      var rest = arr.slice(0,i).concat(arr.slice(i+1));
      perm(rest, current.concat([arr[i]]));
    }
  }
  perm([1,2,3,4,5,6], []);

  var best = null, bestScore = -Infinity;
  permutations.forEach(function(p){
    var s = 0;
    var valid = true;
    for(var i=0; i<dists.length; i++){
      var pr = (dists[i].dist[String(p[i])] || 0);
      if(pr <= 0){ valid = false; break; }
      s += Math.log(pr);
    }
    if(valid && s > bestScore){
      bestScore = s;
      best = p;
    }
  });

  if(!best){
    // フォールバック: 枠通り
    var by = {}; var c = {};
    boats.forEach(function(b){ by[b.racer_boat_number] = b.racer_boat_number; c[b.racer_boat_number] = 0.5; });
    return {byBoat: by, conf: c};
  }
  var byBoat = {}, conf = {};
  for(var i=0; i<dists.length; i++){
    byBoat[dists[i].boat] = best[i];
    conf[dists[i].boat] = dists[i].dist[String(best[i])] || 0;
  }
  return {byBoat: byBoat, conf: conf};
}

// 進入パターンを results から学習
function learnEntryPatternFromResults(resultsJson){
  if(!resultsJson) return;
  for(var sid in resultsJson){
    var races = resultsJson[sid];
    for(var rn in races){
      var race = races[rn];
      if(!race || !race.results) continue;
      race.results.forEach(function(r){
        var rid = r.racer_number || 0;
        var boat = r.racer_boat_number || 0;
        var course = r.racer_course_number || boat;
        if(!rid || !boat || !course) return;
        if(!racerDB[rid]) return;
        if(!racerDB[rid].entryPattern) racerDB[rid].entryPattern = { byBoat: {}, samples: 0 };
        var ep = racerDB[rid].entryPattern;
        if(!ep.byBoat[String(boat)]) ep.byBoat[String(boat)] = {};
        var d = ep.byBoat[String(boat)];
        d[String(course)] = (d[String(course)] || 0) + 1;
        ep.samples = (ep.samples || 0) + 1;
      });
    }
  }
  // 確率に正規化（保存時のみ）
  for(var rid in racerDB){
    var ep = racerDB[rid].entryPattern;
    if(!ep || !ep.byBoat) continue;
    for(var b in ep.byBoat){
      var d = ep.byBoat[b];
      var sum = 0;
      for(var c in d) sum += d[c];
      if(sum > 0) for(var c2 in d) d[c2] = d[c2] / sum;
    }
  }
}

// ===============================================
// X2: 場別正規化用の統計学習
// ===============================================

// 場別モーター 2連率の mean/std を Welford 法で日次更新
function learnMotorStatsFromPrograms(programsJson){
  if(!programsJson || !Array.isArray(programsJson.programs)) return;
  var today = todayStr();
  var byStadium = {};
  programsJson.programs.forEach(function(p){
    var sid = String(p.race_stadium_number);
    if(!byStadium[sid]) byStadium[sid] = [];
    (p.boats || []).forEach(function(b){
      var r = pf(b.racer_assigned_motor_top_2_percent);
      if(r > 0) byStadium[sid].push(r);
    });
  });
  Object.keys(byStadium).forEach(function(sid){
    if(!stadiumMotorStats[sid]){
      stadiumMotorStats[sid] = { sum:0, sumSq:0, count:0, mean:0, std:0, lastDate:'' };
    }
    var s = stadiumMotorStats[sid];
    if(s.lastDate === today) return;   // 同日重複集計を防ぐ
    byStadium[sid].forEach(function(r){
      s.sum += r;
      s.sumSq += r * r;
      s.count++;
    });
    if(s.count > 0){
      s.mean = s.sum / s.count;
      var variance = (s.sumSq / s.count) - (s.mean * s.mean);
      s.std = Math.sqrt(Math.max(0.5, variance));   // std 最低 0.5（過剰な z-score 暴発防止）
    }
    s.lastDate = today;
  });
  safeSet('boatrace_motorStats', stadiumMotorStats);
}

// 場別展示タイムの mean/std を Welford 法で日次更新
function learnExhibitionStatsFromPreviews(previewsJson){
  if(!previewsJson || !previewsJson.previews) return;
  var today = todayStr();
  var byStadium = {};
  (previewsJson.previews || []).forEach(function(pv){
    var sid = String(pv.race_stadium_number);
    if(!byStadium[sid]) byStadium[sid] = [];
    var boats = pv.boats || {};
    for(var bn in boats){
      var et = pf(boats[bn].racer_exhibition_time);
      if(et > 6.0 && et < 8.0) byStadium[sid].push(et);
    }
  });
  Object.keys(byStadium).forEach(function(sid){
    if(!stadiumExhibitionStats[sid]){
      stadiumExhibitionStats[sid] = { sum:0, sumSq:0, count:0, mean:0, std:0, lastDate:'' };
    }
    var s = stadiumExhibitionStats[sid];
    if(s.lastDate === today) return;
    byStadium[sid].forEach(function(t){
      s.sum += t;
      s.sumSq += t * t;
      s.count++;
    });
    if(s.count > 0){
      s.mean = s.sum / s.count;
      var variance = (s.sumSq / s.count) - (s.mean * s.mean);
      s.std = Math.sqrt(Math.max(0.02, variance));   // 最低 0.02s で発散防止
    }
    s.lastDate = today;
  });
  safeSet('boatrace_exhibitionStats', stadiumExhibitionStats);
}

// 選手×コース別の平均 ST（Welford）— previews から学習
function learnRacerStFromPreviews(previewsJson, programsJson){
  if(!previewsJson || !previewsJson.previews || !programsJson) return;
  // 出走表から racer_number → boat マップ作成（コース番号取得用）
  (previewsJson.previews || []).forEach(function(pv){
    var sid = String(pv.race_stadium_number);
    var rno = String(pv.race_number);
    var prog = programsJson.programs && programsJson.programs.find(function(p){
      return String(p.race_stadium_number)===sid && String(p.race_number)===rno;
    });
    if(!prog) return;
    var boats = pv.boats || {};
    for(var bn in boats){
      var st = pf(boats[bn].racer_start_timing);
      var course = boats[bn].racer_course_number || parseInt(bn);
      // racer_number を出走表から特定
      var pBoat = (prog.boats || []).find(function(pb){return pb.racer_boat_number===parseInt(bn)});
      var rid = pBoat ? pBoat.racer_number : null;
      if(!rid || !course || st <= -0.5 || st >= 0.5) continue;
      if(!racerDB[rid]) return;   // 既存選手のみ
      if(!racerDB[rid].stStats) racerDB[rid].stStats = {};
      var key = String(course);
      if(!racerDB[rid].stStats[key]){
        racerDB[rid].stStats[key] = { sum:0, sumSq:0, count:0, mean:0.16 };
      }
      var s = racerDB[rid].stStats[key];
      s.sum += st;
      s.sumSq += st * st;
      s.count++;
      s.mean = s.sum / s.count;
    }
  });
}

// X2: モーター z-score スコア（場別正規化）
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

// X2: 展示タイム場別 z-score（補助スコア。順位ベースの etBonus と併用）
function exhibitionZScore(etTime, sid){
  var s = stadiumExhibitionStats[String(sid)];
  if(!s || s.count < 50 || !etTime || etTime > 8) return 0;
  return (etTime - s.mean) / s.std;   // 速いほど負（良い）
}

// X2: ST 個人乖離スコア（自分の平均 ST との比較）
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

function updateDBFromResults(resultsJson, programsJson){
  if(!resultsJson) return;
  for(var sid in resultsJson){
    var races=resultsJson[sid];
    if(!stadiumDB[sid]) stadiumDB[sid]={courseWinRate:{},techniqueRate:{},courseTechnique:{}};
    var sdb=stadiumDB[sid];

    for(var rn in races){
      var race=races[rn];
      if(!race||!race.isFinished||!race.results||!race.results.length) continue;
      var sortedRes=race.results.slice().sort(function(a,b){return a.place-b.place});
      var techNum=race.technique_number||0;
      var winner=sortedRes[0];

      sortedRes.forEach(function(r){
        var rid=r.racer_number||0;   // P3 L-01: 自己参照typo修正
        if(!rid) return;
        if(!racerDB[rid]) racerDB[rid]={courseStats:{},courseStyle:{},recentResults:[],lastUpdated:''};
        var rdb=racerDB[rid];
        if(r.racer_name) rdb.name=r.racer_name;

        var course=r.racer_course_number||r.racer_boat_number;
        if(!rdb.courseStats[course]) rdb.courseStats[course]={races:0,win:0,top2:0,top3:0};
        var cs=rdb.courseStats[course];
        cs.races++;
        if(r.place===1) cs.win++;
        if(r.place<=2) cs.top2++;
        if(r.place<=3) cs.top3++;

        if(r.place===1 && techNum){
          if(!rdb.courseStyle[course]) rdb.courseStyle[course]={nige:0,sashi:0,makuri:0,makuriSashi:0,nuki:0,megumare:0};
          var cst=rdb.courseStyle[course];
          if(techNum===1) cst.nige++;
          else if(techNum===2) cst.sashi++;
          else if(techNum===3) cst.makuri++;
          else if(techNum===4) cst.makuriSashi++;
          else if(techNum===5) cst.nuki++;
          else if(techNum===6) cst.megumare++;
        }

        rdb.recentResults.push(r.place);
        if(rdb.recentResults.length>30) rdb.recentResults.shift();
        rdb.lastUpdated=todayStr();
      });

      if(winner){
        var wCourse=winner.racer_course_number||winner.racer_boat_number;
        if(!sdb.courseWinRate[wCourse]) sdb.courseWinRate[wCourse]={races:0,win:0};
        sdb.courseWinRate[wCourse].win++;
      }
      sortedRes.forEach(function(r){
        var c=r.racer_course_number||r.racer_boat_number;
        if(!sdb.courseWinRate[c]) sdb.courseWinRate[c]={races:0,win:0};
        sdb.courseWinRate[c].races++;
      });

      if(techNum){
        if(!sdb.techniqueRate) sdb.techniqueRate={};
        sdb.techniqueRate[techNum]=(sdb.techniqueRate[techNum]||0)+1;
      }
    }
    sdb.lastUpdated=todayStr();
  }
  saveDB();
}

function cleanOldData(){
  var cutoff=new Date(Date.now()-60*86400000);
  var cutoffStr=cutoff.getFullYear()+('0'+(cutoff.getMonth()+1)).slice(-2)+('0'+cutoff.getDate()).slice(-2);
  var delR=0,delS=0;
  for(var rid in racerDB){
    var lu=racerDB[rid].lastUpdated||'';
    if(!lu||lu<cutoffStr){delete racerDB[rid];delR++;}
  }
  for(var sid in stadiumDB){
    var lu=stadiumDB[sid].lastUpdated||'';
    if(!lu||lu<cutoffStr){delete stadiumDB[sid];delS++;}
  }
  if(delR>0||delS>0){
    saveDB();
    console.log('古いDBエントリを削除: 選手'+delR+'人, 場'+delS+'場');
  }
}

function saveDB(){
  // P3 L-05: QuotaExceededError は safeSet が history を間引いてリトライ
  safeSet('boatrace_racerDB', racerDB);
  safeSet('boatrace_stadiumDB', stadiumDB);
}

function getRacerCourseWinRate(rid,course){
  var rdb=racerDB[rid];
  if(!rdb||!rdb.courseStats||!rdb.courseStats[course]) return null;
  var cs=rdb.courseStats[course];
  if(cs.races<5) return null;
  return cs.win/cs.races;
}

function getRacerCourseStyle(rid,course){
  var rdb=racerDB[rid];
  if(!rdb||!rdb.courseStyle||!rdb.courseStyle[course]) return null;
  return rdb.courseStyle[course];
}

// F13: 自分のコース別決まり手プロファイルからスコア補正を返す
//   1着確率に直接効く（決まり手 = 1着取った時の手のため、count はそのコースでの 1着回数）
//   サンプル数 < 8 はスコアゼロ（信頼度不足）
//   返り値: {score, reason?, risk?}
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

// ===============================================
// PREDICTION ENGINE V2: Layer 1 (PRESERVED)
// ===============================================
// PC-2b: scoreBoatV2 から抽出した純粋計算ヘルパ
//   経緯: scoreBoatV2 は 287 行で UI 状態と密結合のため全分割は高リスク。
//   純粋関数 (no DOM / no global mutation) のみ段階的に切り出してテスト可能化。

// 平均クラスから階級減衰係数を計算
//   B2 多 → 0.55, B1 多 → 0.70, A2 多 → 0.85, A1 多 → 1.00
function _computeClassAttenuation(allBoats){
  if(!Array.isArray(allBoats) || !allBoats.length) return 1.0;
  var avgClass = 0;
  allBoats.forEach(function(b){ avgClass += (b && b.racer_class_number) || 3; });
  avgClass /= allBoats.length;
  if(avgClass >= 3.5) return 0.55;
  if(avgClass >= 3.0) return 0.70;
  if(avgClass >= 2.5) return 0.85;
  return 1.0;
}

// X3 進入予想 → 採用コースと信頼度を決定
//   preview.racer_course_number > predictedEntries > 枠番 の優先順
function _resolveCourse(boat, preview, predictedEntries){
  var bn = boat.racer_boat_number;
  if(preview && preview.racer_course_number != null){
    return { course: preview.racer_course_number, entryConf: 1.0, source: 'preview' };
  }
  if(predictedEntries && predictedEntries.byBoat && predictedEntries.byBoat[bn]){
    return {
      course: predictedEntries.byBoat[bn],
      entryConf: predictedEntries.conf[bn] || 0.5,
      source: 'predicted'
    };
  }
  return { course: preview ? preview.racer_boat_number : bn, entryConf: 1.0, source: 'frame' };
}

function scoreBoatV2(boat, preview, weather, allBoats, allPreviews, sid, predictedEntries){
  var score=0;
  var reasons=[];
  var risks=[];
  var bn=boat.racer_boat_number;
  // PC-2b: 進入コース解決を _resolveCourse に委譲
  var resolved = _resolveCourse(boat, preview, predictedEntries);
  var course = resolved.course;
  var entryConf = resolved.entryConf;
  if(resolved.source === 'predicted' && course !== bn && entryConf >= 0.6){
    reasons.push('進入予想: '+bn+'枠→'+course+'コース('+(entryConf*100).toFixed(0)+'%)');
  }
  var rid=boat.racer_number||0;

  var scwr=getStadiumCourseWinRate(String(sid),course);
  var baseCoursePt=scwr*COURSE_MULTIPLIER;

  // PC-2b: 階級減衰係数を _computeClassAttenuation に委譲
  var attn = _computeClassAttenuation(allBoats);
  var coursePt=baseCoursePt*attn;
  score+=coursePt;

  if(preview&&preview.racer_course_number!=null){
    if(bn>course){score+=3;reasons.push('前付け成功('+bn+'→'+course+'コース)')}
    else if(bn<course){score-=2;risks.push('押し出され('+bn+'→'+course+'コース)')}
  }
  if(course===1) reasons.push(course+'コース(場勝率'+Math.round(scwr*100)+'%)');

  var racerCWR=getRacerCourseWinRate(rid,course);
  if(racerCWR!==null){
    score+=racerCWR*25;
    var rdb=racerDB[rid];
    if(rdb&&rdb.courseStats&&rdb.courseStats[course]){
      var cs=rdb.courseStats[course];
      score+=(cs.top3/cs.races)*0.08*100;
      if(racerCWR>0.5&&course<=2) reasons.push('コース別1着率'+Math.round(racerCWR*100)+'%');
    }
  } else {
    var wr=pf(boat.racer_national_top_1_percent);
    score+=wr*2.5;
    var lr=pf(boat.racer_local_top_2_percent);
    score+=lr*0.15;
  }
  // F13: 自分のコース別決まり手プロファイル
  var selfStyle = selfStyleScore(rid, course);
  if(selfStyle.score !== 0){
    score += selfStyle.score;
    if(selfStyle.reason) reasons.push(selfStyle.reason);
    if(selfStyle.risk) risks.push(selfStyle.risk);
  }
  var classBonus={1:6,2:3,3:0,4:-3};
  score+=classBonus[boat.racer_class_number]||0;

  if(allPreviews&&allPreviews.boats){
    for(var ci=1;ci<=6;ci++){
      if(ci===bn) continue;
      var cpv=allPreviews.boats[String(ci)];
      var cCourse=(cpv&&cpv.racer_course_number!=null)?cpv.racer_course_number:ci;
      var cBoat=allBoats.find(function(b){return b.racer_boat_number===ci});
      if(!cBoat) continue;
      var cRid=cBoat.racer_number||0;
      var style=getRacerCourseStyle(cRid,cCourse);
      if(!style){
        style=DEFAULT_COURSE_TECHNIQUE[cCourse];
      }
      if(!style) continue;
      var total=style.nige+style.sashi+style.makuri+style.makuriSashi+style.nuki+(style.megumare||0);
      if(total<3) continue;
      var sashiRate=style.sashi/total;
      var makuriRate=style.makuri/total;
      var makuriSashiRate=style.makuriSashi/total;

      if(cCourse===2&&course===1){
        if(sashiRate>0.5){score+=3;reasons.push('2コース差し主体→逃げ残りやすい')}
        else if(makuriRate>0.3){score-=5;risks.push('2コースまくり傾向(脅威)')}
      }
      if(cCourse===3){
        if(course===1&&makuriRate>0.3){score-=3;risks.push('3コースまくり傾向')}
        if(course===2&&makuriSashiRate>0.3){score-=4}
        if(course===1&&sashiRate>0.4) score+=2;
      }
      if(cCourse===4&&makuriRate>0.3){
        if(course<=3) score-=3;
      }
      if(cCourse>=5&&makuriRate>0.4){
        if(course<=2) score-=2;
      }
    }
  }

  // X2 R-05: 場別 z-score でモーター評価（フォールバック付き）
  var motorRate=pf(boat.racer_assigned_motor_top_2_percent);
  var motorEval = motorScoreNormalized(motorRate, sid);
  score += motorEval.score;
  var motorLabel = motorEval.label;
  var motorEmoji = motorEval.emoji;
  if(motorEval.label === '超抜') reasons.push('超抜モーター('+motorRate+'%' + (motorEval.z!=null ? ' z='+motorEval.z.toFixed(1) : '') + ')');
  else if(motorEval.label === '整備要') risks.push('モーター不調('+motorRate+'%)');
  var boatRate=pf(boat.racer_assigned_boat_top_2_percent);
  score+=boatRate*0.08;

  var etRank=5,etTime=99;
  if(allPreviews&&allPreviews.boats){
    var times=[];
    for(var ei=1;ei<=6;ei++){
      var epv=allPreviews.boats[String(ei)];
      var etime=(epv&&epv.racer_exhibition_time!=null&&epv.racer_exhibition_time>0)?pf(epv.racer_exhibition_time):99;
      times.push({boat:ei,time:etime});
    }
    times.sort(function(a,b){return a.time-b.time});
    etRank=times.findIndex(function(t){return t.boat===bn});
    var myPv=allPreviews.boats[String(bn)];
    etTime=myPv?pf(myPv.racer_exhibition_time):99;
    var bestTime=times[0].time;

    var decay=ET_COURSE_DECAY[course]||1;
    var etBonus=0;
    if(etRank===0) etBonus=6;
    else if(etRank===1) etBonus=4;
    else if(etRank===2) etBonus=2;
    else if(etRank>=4){
      var diff=etTime-bestTime;
      if(diff>=0.08) etBonus=-5;
      else if(diff>=0.03) etBonus=-Math.round(diff*60);
    }
    score+=etBonus*decay;
    if(etRank===0) reasons.push('展示タイム最速('+etTime+'s)');
    // X2 R-06: 展示タイム場別 z-score 補助（速いほど負 → +スコア）
    var ezAux = exhibitionZScore(etTime, sid);
    if(ezAux !== 0) score += -ezAux * 2 * decay;
    if(ezAux <= -1.0) reasons.push('展示タイム場相対的に超速(z='+ezAux.toFixed(1)+')');

    if(myPv&&myPv.racer_start_timing!=null){
      var st=pf(myPv.racer_start_timing);
      // X2 R-08: 絶対値判定 + 個人平均との乖離（max を取る）
      var absScore = (st<0) ? -6 : (st<=0.05 ? 4 : st<=0.10 ? 2 : st>=0.20 ? -2 : 0);
      var perScore = stDivergenceScore(st, rid, course);
      var stScore = Math.max(absScore, perScore);
      score += stScore;
      if(stScore >= 4) reasons.push('ST鋭い('+st+'s)');
      else if(stScore <= -2 && st > 0) risks.push('ST出遅れ('+st+'s)');
      else if(st < 0) risks.push('Fスタート気味('+st+'s)');

      if(etRank<=1&&st>0&&st<=0.10) score+=3;
      else if(etRank<=1&&st>0.15) score+=1;
      else if(etRank>=4&&st>0&&st<=0.10) score+=1;
      else if(etRank>=4&&st>=0.15) score-=3;

      var tilt=pf(myPv.racer_tilt_adjustment);
      if(course<=2&&tilt<=-0.5) score+=2;
      else if(course>=4&&tilt>=0.5) score+=2;
      else if(course<=2&&tilt>=0.5) score-=1;
      else if(course>=4&&tilt<=-0.5) score-=1;

      // F12: 調整重量（規定体重未達の重り）
      // > 0 で重い荷物 → ボート加速悪化、特にアウトコースで影響大
      var adjW = pf(myPv.racer_adjust_weight);
      if(adjW >= 1.0){
        if(course >= 4) { score -= 3; risks.push('調整重量+'+adjW.toFixed(1)+'kg(アウト不利)'); }
        else { score -= 1; risks.push('調整重量+'+adjW.toFixed(1)+'kg'); }
      } else if(adjW >= 0.5){
        if(course >= 4) score -= 1;
      }

      // F12: 部品交換（ペラ調整等）
      // 当たれば +、外せば - で読みにくい → 既存スコアには加減せず情報のみ表示
      // ただし「ペラ」交換はモーター不調シグナルとしてマイルドな - を付与
      var partsTxt = String(myPv.racer_parts_replaced || '');
      if(partsTxt.indexOf('ペラ') >= 0){
        score -= 1;
        risks.push('レース直前ペラ交換('+escText(partsTxt)+')');
      } else if(partsTxt){
        // ペラ以外の部品交換 → 整備内容を reasons に表示のみ
        reasons.push('整備実施: '+escText(partsTxt));
      }
    }

    if(boat.racer_class_number===1&&etRank>=4){score-=4;risks.push('A1だが展示下位(モーター不安)')}
    if((boat.racer_class_number===3||boat.racer_class_number===4)&&etRank===0){score+=3;reasons.push('好モーター発見(展示1位)')}

    if(weather){
      var wt=weather.water_temperature||weather.race_water_temperature||20;
      if(wt<=15) score+=etBonus*0.2*decay;
      else if(wt>=25) score-=etBonus*0.2*decay;
    }
  }

  if(weather){
    var ws=weather.wind_speed||weather.race_wind||0;
    var wd=weather.wind_direction||weather.race_wind_direction_number||0;
    // X4 R-10: 場別風向プロファイルを使用
    var isHead = isHeadWind(wd, sid);
    var isTail = isTailWind(wd, sid);
    if(isHead&&ws>=5){
      if(course===1){score-=8;risks.push('向かい風'+ws+'m(イン不利)')}
      else if(course===2) score-=3;
      else if(course>=4) score+=4;
    } else if(isHead&&ws>=3){
      if(course===1) score-=4;
      if(course>=4) score+=2;
    }
    if(isTail&&ws>=3){
      if(course===1){score+=4;reasons.push('追い風'+ws+'m(イン有利)')}
      if(course>=4) score-=2;
    }
    var wh=weather.wave_height||weather.race_wave||0;
    if(wh>=7&&course<=2){score-=4;risks.push('波高'+wh+'cm(荒れ模様)')}
    else if(wh>=4&&course<=2) score-=2;
    // X4 R-14: 風×波交差項
    var stormDelta = stormBonus(ws, wh, course);
    if(stormDelta !== 0){
      score += stormDelta;
      if(stormDelta <= -4) risks.push('荒天交差項'+stormDelta);
      else if(stormDelta >= 4) reasons.push('荒れ展開で恩恵+'+stormDelta);
    }
  }
  // X4 R-02: 潮汐補正（海水場のみ、preview から race_closed_at の時刻を取得）
  if(preview && preview.race_closed_at){
    try{
      var hour = parseInt(String(preview.race_closed_at).split(' ')[1].split(':')[0], 10);
      var tideDelta = tideScore(sid, course, hour);
      if(tideDelta !== 0){
        score += tideDelta;
        if(tideDelta >= 4) reasons.push('潮位がコース有利(+'+tideDelta+')');
        else if(tideDelta <= -4) risks.push('潮位不利('+tideDelta+')');
      }
    }catch(_){}
  }

  // X6 R-07/R-13: 節間調整スコア + モーター急変警告
  var seriesAdj = seriesAdjustmentScore(rid, sid);
  if(seriesAdj.score !== 0){
    score += seriesAdj.score;
    if(seriesAdj.score >= 3) reasons.push('節間モーター上昇中(slope+'+seriesAdj.slope.toFixed(1)+')');
    else if(seriesAdj.score <= -3) risks.push('節間モーター下降中(slope'+seriesAdj.slope.toFixed(1)+')');
  }
  // X6 R-09: 対戦相性
  if(allBoats && allBoats.length > 0){
    var oppRids = allBoats
      .map(function(b){ return b.racer_number; })
      .filter(function(o){ return o && o !== rid; });
    var pair = pairwiseScore(rid, sid, oppRids);
    if(Math.abs(pair.score) >= 0.5){
      score += pair.score;
      if(pair.score >= 1) reasons.push('対戦相性◎(+'+pair.score.toFixed(1)+', '+pair.hits+'件)');
      else if(pair.score <= -1) risks.push('対戦相性×('+pair.score.toFixed(1)+', '+pair.hits+'件)');
    }
  }

  var fc=boat.racer_flying_count||0;   // P3 L-02: 自己参照typo修正
  var lc=boat.racer_late_start_count_in_current_term||boat.racer_late_count||0;
  if(fc>=2){score-=25;risks.push('F2持ち')}
  else if(fc>=1){score-=15;risks.push('F1持ち')}
  if(lc>=1) score-=5;

  var form=getRacerForm(rid);
  if(form){
    score+=form.score;
    if(form.avg<=2.5) reasons.push('好調(直近5R平均'+form.avg.toFixed(1)+'着)');
    if(form.avg>=4.0) risks.push('不調(直近5R平均'+form.avg.toFixed(1)+'着)');
    if(form.trend>0.5) reasons.push('上り調子');
    if(form.trend<-0.5) risks.push('下り調子');
  }

  return{
    boat:bn,score:Math.max(0,score),course:course,etRank:etRank,etTime:etTime,
    reasons:reasons,risks:risks,
    motorLabel:motorLabel,motorEmoji:motorEmoji,motorRate:motorRate,
    boatRate:boatRate,form:form,
    classNum:boat.racer_class_number
  };
}

// ===============================================
// PREDICTION ENGINE V2: Layer 2 (PRESERVED)
// ===============================================
function getL2Features(boat,preview,weather,etRank,stRank,sid){
  var course=(preview&&preview.racer_course_number!=null)?preview.racer_course_number:(preview?preview.racer_boat_number:boat.racer_boat_number);
  var rid=boat.racer_number||0;
  var racerCWR=getRacerCourseWinRate(rid,course);
  var stadCWR=getStadiumCourseWinRate(String(sid),course);
  var myPv=preview||{};
  var st=(myPv.racer_start_timing!=null)?pf(myPv.racer_start_timing):99;
  var tilt=pf(myPv.racer_tilt_adjustment);

  var windCourse=0;
  if(weather){
    var ws=weather.wind_speed||weather.race_wind||0;
    var wd=weather.wind_direction||weather.race_wind_direction_number||0;
    var isHead=(wd>=7&&wd<=11);
    if(isHead&&course===1) windCourse=-ws/10;
    else if(isHead&&course>=4) windCourse=ws/20;
  }

  var etComp=0;
  if(etRank<=1&&st>0&&st<=0.10) etComp=1;
  else if(etRank>=4&&st>=0.15) etComp=-1;

  var formScore=0;
  var form=getRacerForm(rid);
  if(form) formScore=form.score/10;

  var tiltAlign=0;
  if(course<=2&&tilt<=-0.5) tiltAlign=1;
  else if(course>=4&&tilt>=0.5) tiltAlign=1;
  else if((course<=2&&tilt>=0.5)||(course>=4&&tilt<=-0.5)) tiltAlign=-1;

  return[
    pf(boat.racer_national_top_1_percent)/10,
    pf(boat.racer_assigned_motor_top_2_percent)/100,
    (etRank+1)/6,
    course/6,
    (boat.racer_class_number||3)/4,
    windCourse,
    racerCWR||pf(boat.racer_national_top_1_percent)/100,
    (stRank+1)/6,
    etComp,
    formScore,
    tiltAlign,
    stadCWR
  ];
}

// P3 L-06/L-10: 旧 softmax 実装は撤去、上部の共通実装（Number.isFinite ガード付き）を利用

// PB-7: Welford's online algorithm で 特徴量 mean/variance を更新
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

// PB-7 + PF-5: 特徴量を z-score 正規化（warmup 前は identity）
//   PF-5: divisor を pre-compute、Number.isFinite 呼出を || 0 に置換
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

function l2Predict(features6){
  // PF-5: ホットパス最適化 — for ループ + 一時配列削減
  //   従来: map で new array x2 + closure 6 回 = ~12 オブジェクト生成
  //   新版: for で in-place 計算、logits 配列のみ生成 = ~1 オブジェクト
  var enableZ = TUNING.PREDICTION.ENABLE_ZSCORE;
  var warmupOk = enableZ && (_featureStats.n >= TUNING.PREDICTION.ZSCORE_WARMUP_N);
  var w = l2weights;
  var wlen = w.length;
  var prior = COURSE_LOG_PRIOR;
  var bias = L2_BIAS;
  var logits = new Array(6);
  for(var b=0; b<6; b++){
    var feat = features6[b];
    if(warmupOk) feat = _normalizeFeatures(feat);
    var z = bias + (prior[b] || 0);
    for(var i=0; i<wlen; i++){
      var fi = feat[i];
      if(fi) z += fi * (w[i] || 0);   // PF-5: 0 値は早期 skip（ホットループ短縮）
    }
    logits[b] = z;
  }
  return softmax(logits);
}

function l2Update(features6,winnerIdx){
  var probs=l2Predict(features6);
  // PB-2: LR を t で減衰、L2 正則化を加算
  var lr = L2_LR0 / (1 + l2trainStep / L2_LR_TAU);
  for(var b=0;b<6;b++){
    var target=(b===winnerIdx)?1:0;
    var err=probs[b]-target;
    for(var i=0;i<l2weights.length;i++){
      var grad = err * (features6[b][i]||0) + L2_LAMBDA * l2weights[i];
      l2weights[i] -= lr * grad;
    }
    // PB-7: 各艇の特徴量を rolling 統計に追加
    _updateFeatureStats(features6[b]);
  }
  l2trainStep += 1;
  safeSet('boatrace_weights', l2weights);   // P3 L-05
  safeSet('boatrace_trainstep', l2trainStep);   // PB-2
  // PB-7: rolling stats を永続化（毎回 save は重いので 50 step に 1 回）
  if((l2trainStep % 50) === 0) safeSet('boatrace_featurestats', _featureStats);
}

// PB-6: Platt scaling — 確率の post-hoc 校正
//   p' = sigmoid(a * logit(p) + b)
//   既定 a=1, b=0 で identity（変化なし）。データ蓄積後 _refitPlattCoeffs で auto-tune
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

// PB-5: Stacking 予測 — L2 が L1 確率を補正する形式
//   p_stacked[b] = softmax( logit(L1[b]) + γ * residual_b ) where residual_b は L2 の輸出 logit
//   既定 γ=0 で stacking 無効（純粋に L1 を返す）。STACKING_MODE='residual' で active
function _stackedPredict(features6, l1probs){
  if(TUNING.PREDICTION.STACKING_MODE !== 'residual') return l1probs;
  // L2 logit を別ルートで計算（softmax 適用前）
  var feats = features6.map(_normalizeFeatures);
  var l2Logits = feats.map(function(feat,b){
    var z = L2_BIAS + (COURSE_LOG_PRIOR[b]||0);
    for(var i=0;i<feat.length;i++) z+=feat[i]*(l2weights[i]||0);
    return z;
  });
  // L1 logit + γ * L2 logit
  var combinedLogits = l1probs.map(function(p,b){
    var clipped = Math.min(0.9999, Math.max(0.0001, p));
    var l1Logit = Math.log(clipped/(1-clipped));
    return l1Logit + _stackingGamma * l2Logits[b];
  });
  return softmax(combinedLogits);
}

// PB-6: Platt 係数を既存履歴から re-fit
//   2 パラメータ (a, b) のみなので grid search で十分
// PF-9 + PG-3: Web Worker への分離
//   _refitPlattCoeffs の grid search、PG では予測も Worker 経由
//   Worker は単一インスタンス、'sync_state' で main 状態を同期、
//   'predict' でレース予測を委譲、'platt_refit' で校正
var _appWorker = null;
var _appWorkerReqId = 0;
var _appWorkerCallbacks = new Map();
function _getAppWorker(){
  if(_appWorker) return _appWorker;
  if(typeof Worker === 'undefined') return null;
  try {
    _appWorker = new Worker('assets/worker.js');
    _appWorker.addEventListener('message', function(e){
      var msg = e.data || {};
      if(msg.reqId != null && _appWorkerCallbacks.has(msg.reqId)){
        var cb = _appWorkerCallbacks.get(msg.reqId);
        _appWorkerCallbacks.delete(msg.reqId);
        cb(msg);
      }
    });
    _appWorker.addEventListener('error', function(e){
      console.warn('[PG-3] worker error', e);
    });
    return _appWorker;
  } catch(e) {
    console.warn('[PG-3] Worker init failed:', e);
    return null;
  }
}
// PF-9 互換 alias
function _getPlattWorker(){ return _getAppWorker(); }

// PG-3 + PG-7: state を Worker に同期
//   重量 DB (racerDB ~5MB, stadiumDB ~50KB) は Worker 自前 fetch、
//   軽量項目のみ postMessage で送信
//   呼出契機: l2Update / 学習完了 / DB 読込完了
function _syncWorkerState(){
  var w = _getAppWorker();
  if(!w) return;
  w.postMessage({
    type: 'sync_state',
    state: {
      // PG-7: racerDB / stadiumDB は worker が fetch するため省略
      pairwiseDB: pairwiseDB,
      stadiumMotorStats: stadiumMotorStats,
      stadiumExhibitionStats: stadiumExhibitionStats,
      l2weights: l2weights,
      featureStats: _featureStats,
      plattCoeffs: _plattCoeffs,
      stackingGamma: _stackingGamma,
      tideData: tideData,
      programData: programData,
      previewData: previewData,
      oddsData: oddsData,
    }
  });
  // PG-7: worker に「重量 DB を自分で fetch しろ」と指示（並列 load）
  if(!_workerHeavyLoaded){
    w.postMessage({ type: 'load_heavy_dbs' });
    _workerHeavyLoaded = true;   // 1 回だけ
  }
}
var _workerHeavyLoaded = false;

// PG-4: 予測を Worker に委譲する async 版
//   既存 predictRace は同期維持（onclick ハンドラ互換）
//   呼出側で「await できる場面」では predictRaceAsync を使う
function predictRaceAsync(sid, raceNum){
  var w = _getAppWorker();
  if(!w){
    // Worker 不可時は main thread fallback
    return Promise.resolve(predictRace(sid, raceNum));
  }
  var reqId = ++_appWorkerReqId;
  return new Promise(function(resolve, reject){
    _appWorkerCallbacks.set(reqId, function(msg){
      if(msg.type === 'predict_done') resolve(msg.result);
      else if(msg.type === 'error'){
        console.warn('[PG-4] worker predict error:', msg.error, msg.stack);
        // フォールバック: main thread 実行
        try { resolve(predictRace(sid, raceNum)); }
        catch(e){ reject(e); }
      } else {
        reject(new Error('unexpected worker message: ' + JSON.stringify(msg).slice(0,200)));
      }
    });
    w.postMessage({
      type: 'predict',
      reqId: reqId,
      input: {
        sid: sid,
        raceNum: raceNum,
        // state を毎回送るのは重いので省略、init/sync_state で同期済み前提
      }
    });
  });
}

// pairs 抽出は同期で実行（軽量）、grid search のみ Worker
function _extractPlattPairs(history){
  if(!Array.isArray(history)) return [];
  var samples = history.filter(function(h){
    return h.actual && h.actual.length>0 && Array.isArray(h.mark_probs);
  });
  if(samples.length < TUNING.PREDICTION.PLATT_MIN_SAMPLES) return [];
  var pairs = [];
  samples.forEach(function(h){
    var winner = h.actual[0];
    var probs = {};
    h.mark_probs.forEach(function(mp){ probs[mp.boat] = mp.prob; });
    var pWin = probs[winner];
    if(!Number.isFinite(pWin) || pWin <= 0 || pWin >= 1) return;
    pairs.push({p: pWin, y: 1});
    for(var b=1;b<=6;b++){
      if(b===winner) continue;
      var pb = probs[b];
      if(Number.isFinite(pb) && pb > 0 && pb < 1) pairs.push({p: pb, y: 0});
    }
  });
  return pairs;
}

// PF-9: async 化、Worker があれば使う、無ければ main thread fallback
async function _refitPlattCoeffs(history){
  var pairs = _extractPlattPairs(history);
  if(pairs.length < 100) return null;
  var w = _getPlattWorker();
  if(w){
    return new Promise(function(resolve){
      var onMsg = function(e){
        if(!e.data || e.data.type !== 'platt_refit_done') return;
        w.removeEventListener('message', onMsg);
        var r = e.data.result;
        if(!r){ resolve(null); return; }
        _plattCoeffs = { a: r.a, b: r.b, fittedAt: Date.now(), n: r.n };
        safeSet('boatrace_platt', _plattCoeffs);
        resolve(_plattCoeffs);
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'platt_refit', samples: pairs });
    });
  }
  // フォールバック: main thread で実行
  var bestA = 1.0, bestB = 0.0, bestLoss = Infinity;
  for(var a = 0.5; a <= 2.0; a += 0.1){
    for(var b = -1.0; b <= 1.0; b += 0.1){
      var loss = 0;
      for(var i=0;i<pairs.length;i++){
        var pi = pairs[i];
        var clipped = Math.min(0.9999, Math.max(0.0001, pi.p));
        var logit = Math.log(clipped/(1-clipped));
        var z = a*logit + b;
        var pp = (z > 30) ? 1.0 : (z < -30) ? 0.0 : 1.0/(1.0+Math.exp(-z));
        pp = Math.min(0.9999, Math.max(0.0001, pp));
        loss += pi.y ? -Math.log(pp) : -Math.log(1 - pp);
      }
      if(loss < bestLoss){ bestLoss = loss; bestA = a; bestB = b; }
    }
  }
  _plattCoeffs = { a: bestA, b: bestB, fittedAt: Date.now(), n: pairs.length };
  safeSet('boatrace_platt', _plattCoeffs);
  return _plattCoeffs;
}

// ===============================================
// PREDICTION ENGINE V2: INTEGRATION (PRESERVED)
// ===============================================
function predictRace(sid,raceNum){
  if(!programData) return null;
  var stadiumProg=programData[String(sid)];
  if(!stadiumProg) return null;
  var race=stadiumProg[String(raceNum)];
  if(!race||!race.boats) return null;

  var preview=null,weather=null;
  if(previewData&&previewData[String(sid)]&&previewData[String(sid)][String(raceNum)]){
    preview=previewData[String(sid)][String(raceNum)];
    weather=preview.weather||preview;
  }

  var boats=race.boats;
  if(!Array.isArray(boats)) return null;

  // X3: preview の進入が無ければ予測を使う
  var predictedEntries = null;
  if(!preview || !preview.boats || Object.keys(preview.boats).every(function(k){return preview.boats[k].racer_course_number == null})){
    predictedEntries = predictEntryCourses(boats, sid);
  }
  var l1scores=[];
  boats.forEach(function(b){
    var pv=preview&&preview.boats?preview.boats[String(b.racer_boat_number)]:null;
    var s=scoreBoatV2(b,pv,weather,boats,preview,sid,predictedEntries);
    l1scores.push(s);
  });

  var l1total=l1scores.reduce(function(a,s){return a+Math.exp(s.score/15)},0);
  var l1probs=l1scores.map(function(s){return Math.exp(s.score/15)/l1total});

  var stRanks=[];
  if(preview&&preview.boats){
    var sts=[];
    for(var si=1;si<=6;si++){
      var spv=preview.boats[String(si)];
      var stVal=(spv&&spv.racer_start_timing!=null)?pf(spv.racer_start_timing):99;
      sts.push({boat:si,st:stVal});
    }
    sts.sort(function(a,b){return a.st-b.st});
    for(var sr=0;sr<sts.length;sr++) stRanks[sts[sr].boat]=sr;
  }

  var features6=boats.map(function(b){
    var pv=preview&&preview.boats?preview.boats[String(b.racer_boat_number)]:null;
    var l1s=l1scores.find(function(s){return s.boat===b.racer_boat_number});
    return getL2Features(b,pv,weather,l1s?l1s.etRank:5,stRanks[b.racer_boat_number]||5,sid);
  });
  var l2probs=l2Predict(features6);

  // PB-8: Bayesian shrinkage で L1/L2 融合比を連続化
  //       α = N0 / (N0 + n)  ─ n が 0 なら α=1（L1 のみ）、n→∞ で α→0（L2 のみ）
  //       N0=300 は「L1 を 300 サンプル相当として信用する」事前
  var dbSize=Object.keys(racerDB).length;
  var alpha=300/(300+dbSize);
  var beta=1-alpha;

  var finalProbs=boats.map(function(b,i){
    var l1s=l1scores.find(function(s){return s.boat===b.racer_boat_number});
    var idx=boats.indexOf(b);
    var fp=alpha*l1probs[idx]+beta*l2probs[idx];
    return{
      boat:b.racer_boat_number,
      prob:fp,
      score:l1s.score,
      course:l1s.course,
      etRank:l1s.etRank,
      etTime:l1s.etTime,
      reasons:l1s.reasons,
      risks:l1s.risks,
      motorLabel:l1s.motorLabel,
      motorEmoji:l1s.motorEmoji,
      motorRate:l1s.motorRate,
      boatRate:l1s.boatRate,
      form:l1s.form,
      classNum:l1s.classNum
    };
  });
  // PB-6: Platt scaling で確率を post-hoc 校正（identity 初期では no-op）
  //       fitting 後は ECE が改善する想定。再正規化で Σp=1 を維持
  finalProbs.forEach(function(p){ p.prob = _applyPlattCalibration(p.prob); });
  var _sumCalib = finalProbs.reduce(function(a,p){return a+p.prob;}, 0);
  if(_sumCalib > 0 && Math.abs(_sumCalib - 1) > 1e-6){
    finalProbs.forEach(function(p){ p.prob = p.prob / _sumCalib; });
  }
  finalProbs.sort(function(a,b){return b.prob-a.prob});

  var marks=finalProbs.map(function(p,i){
    p.mark=i===0?'◎':i===1?'○':i===2?'▲':i===3?'△':'×';
    return p;
  });

  var topProb=marks[0].prob;
  var top2Prob=marks[0].prob+marks[1].prob;
  var raceType,typeLabel,typeCls;
  var wh=(weather?weather.wave_height||weather.race_wave||0:0);
  var ws2=(weather?weather.wind_speed||weather.race_wind||0:0);
  // PC-3: TUNING.RACE_TYPE 集約定数を使用
  var RT=TUNING.RACE_TYPE;
  if(topProb>RT.HONMEI_TOP1_MIN && top2Prob>RT.HONMEI_TOP2_MIN){raceType='honmei';typeLabel='本命';typeCls='type-honmei'}
  else if(topProb<RT.ANA_TOP1_MAX || wh>=RT.ANA_WAVE_HEIGHT_CM || ws2>=RT.ANA_WIND_SPEED_MS){raceType='ana';typeLabel='穴';typeCls='type-ana'}
  else{raceType='middle';typeLabel='混戦';typeCls='type-middle'}

  var betCount3=parseInt(settings.betCount3)||10;
  var betCount2=parseInt(settings.betCount2)||5;
  var method=settings.betMethod||'auto';
  // X1: EV モード優先（オッズが揃っていれば）
  var evMode = settings.evMode === true || settings.evMode === 'true';
  var evOpt = {
    evMin: parseFloat(settings.evMin)||1.15,
    maxBets: betCount3,
    kellyFrac: parseFloat(settings.kellyFrac)||0.5,
    bankroll: parseInt(settings.bankroll)||10000,
  };
  // 当該レースのオッズを取得
  var raceOddsForEV = null;
  if(oddsData && oddsData.odds){
    var found = oddsData.odds.find(function(o){
      return o.stadium===parseInt(sid) && o.race===parseInt(raceNum);
    });
    if(found) raceOddsForEV = found;
  }
  if(method==='auto'){
    if(evMode && raceOddsForEV && raceOddsForEV.trifecta) method='ev';
    else if(raceType==='honmei') method='prob';
    else if(raceType==='ana') method='box';
    else method='formation';
  }

  // X5: シナリオ展開予測（局面別 1-2-3 着分布）
  var grade = race.race_grade_number || 0;
  var scenarioRes = predictWithScenarios(boats, preview, weather, sid, grade);

  var bets=generateBetsV2(marks, method, betCount3, betCount2, raceOddsForEV, evOpt);
  bets.marks=marks;
  bets.evApplied = (method==='ev');
  bets.scenarios = scenarioRes.scenarios;   // {nige:0.55, sashi:0.18, ...}
  bets.scenarioDist = scenarioRes.dist;     // {"1-2-3": 0.18, ...}
  bets.grade = grade;
  // X1: 単勝オッズ乖離を計算
  if(raceOddsForEV && raceOddsForEV.win){
    var aiByBoat = [];
    for(var bi=1; bi<=6; bi++){
      var fp = finalProbs.find(function(p){ return p.boat===bi; });
      aiByBoat.push(fp ? fp.prob : 0);
    }
    bets.divergence = calcOddsDivergence(aiByBoat, raceOddsForEV.win);
  }
  bets.raceType=raceType;
  bets.typeLabel=typeLabel;
  bets.typeCls=typeCls;
  bets.weather=weather;
  bets.method=method;
  bets.features6=features6;

  var conf=Math.round(topProb*100);
  bets.confidence=conf;
  bets.confStars=conf>=40?5:conf>=30?4:conf>=22?3:conf>=15?2:1;

  return bets;
}

// ===============================================
// 番組予想（展示・風なし、出走表データのみ）
// ===============================================
function predictRaceProgram(sid,raceNum){
  if(!programData) return null;
  var stadiumProg=programData[String(sid)];
  if(!stadiumProg) return null;
  var race=stadiumProg[String(raceNum)];
  if(!race||!race.boats) return null;
  var boats=race.boats;
  if(!Array.isArray(boats)) return null;

  // preview=null, weather=null で scoreBoatV2 を呼ぶ → E(展示)とF(風)がスキップ
  // X3: 出走表段階でも進入予測を効かせる
  var predictedEntries = predictEntryCourses(boats, sid);
  var l1scores=[];
  boats.forEach(function(b){
    var s=scoreBoatV2(b,null,null,boats,null,sid,predictedEntries);
    l1scores.push(s);
  });

  var l1total=l1scores.reduce(function(a,s){return a+Math.exp(s.score/15)},0);
  var l1probs=l1scores.map(function(s){return Math.exp(s.score/15)/l1total});

  // Layer2（展示なしの特徴量）
  var features6=boats.map(function(b){
    var l1s=l1scores.find(function(s){return s.boat===b.racer_boat_number});
    return getL2Features(b,null,null,l1s?l1s.etRank:5,5,sid);
  });
  var l2probs=l2Predict(features6);

  // PB-8: Bayesian shrinkage（番組予想は展示情報なしのため L1 比率高め: N0=600）
  var dbSize=Object.keys(racerDB).length;
  var alpha=600/(600+dbSize);
  var beta=1-alpha;

  var finalProbs=boats.map(function(b,i){
    var l1s=l1scores.find(function(s){return s.boat===b.racer_boat_number});
    var idx=boats.indexOf(b);
    var fp=alpha*l1probs[idx]+beta*l2probs[idx];
    return{
      boat:b.racer_boat_number,prob:fp,score:l1s.score,course:l1s.course,
      reasons:l1s.reasons,risks:l1s.risks,
      motorLabel:l1s.motorLabel,motorEmoji:l1s.motorEmoji,motorRate:l1s.motorRate,classNum:l1s.classNum
    };
  });
  // PB-6: Platt scaling（番組予想にも同じく適用）
  finalProbs.forEach(function(p){ p.prob = _applyPlattCalibration(p.prob); });
  var _sum2 = finalProbs.reduce(function(a,p){return a+p.prob;}, 0);
  if(_sum2 > 0 && Math.abs(_sum2 - 1) > 1e-6){
    finalProbs.forEach(function(p){ p.prob = p.prob / _sum2; });
  }
  finalProbs.sort(function(a,b){return b.prob-a.prob});
  finalProbs.forEach(function(p,i){
    p.mark=i===0?'◎':i===1?'○':i===2?'▲':i===3?'△':'×';
  });

  var topProb=finalProbs[0].prob;
  var top2Prob=finalProbs[0].prob+finalProbs[1].prob;
  var raceType,typeLabel;
  // PC-3: TUNING.RACE_TYPE 集約定数を使用（環境補正は呼出側で済んでいる前提）
  var RT2=TUNING.RACE_TYPE;
  if(topProb>RT2.HONMEI_TOP1_MIN && top2Prob>RT2.HONMEI_TOP2_MIN){raceType='honmei';typeLabel='本命'}
  else if(topProb<RT2.ANA_TOP1_MAX){raceType='ana';typeLabel='穴'}
  else{raceType='middle';typeLabel='混戦'}

  return{marks:finalProbs,raceType:raceType,typeLabel:typeLabel,confidence:Math.round(topProb*100)};
}

// ===============================================
// 番組予想 vs 直前予想の差分分析
// ===============================================
function comparePredictions(progPred,livePred){
  if(!progPred||!livePred) return null;
  var changes=[];
  livePred.marks.forEach(function(live){
    var prog=progPred.marks.find(function(p){return p.boat===live.boat});
    if(!prog) return;
    var progRank=progPred.marks.indexOf(prog)+1;
    var liveRank=livePred.marks.indexOf(live)+1;
    var rankDiff=progRank-liveRank;
    var probDiff=live.prob-prog.prob;
    // 変化の要因推定
    var addedReasons=[],addedRisks=[];
    if(live.reasons){live.reasons.forEach(function(r){if(!prog.reasons||prog.reasons.indexOf(r)<0) addedReasons.push(r)})}
    if(live.risks){live.risks.forEach(function(r){if(!prog.risks||prog.risks.indexOf(r)<0) addedRisks.push(r)})}
    changes.push({boat:live.boat,progRank:progRank,liveRank:liveRank,rankDiff:rankDiff,
      progProb:prog.prob,liveProb:live.prob,probDiff:probDiff,progMark:prog.mark,liveMark:live.mark,
      addedReasons:addedReasons,addedRisks:addedRisks});
  });
  changes.sort(function(a,b){return Math.abs(b.rankDiff)-Math.abs(a.rankDiff)});
  return{
    changes:changes,
    biggestRiser:changes.find(function(c){return c.rankDiff>0}),
    biggestFaller:changes.find(function(c){return c.rankDiff<0}),
    typeChanged:progPred.raceType!==livePred.raceType,
    progType:progPred.typeLabel,
    liveType:livePred.typeLabel
  };
}

// ===============================================
// X1: EV / Kelly / オッズ乖離 ヘルパ
// ===============================================
/**
 * EV ベースで買い目を選定。
 * @param probs   {Object<combo, prob>}
 * @param odds    {Object<combo, odds>}
 * @param opt     {evMin, maxBets, kellyFrac, bankroll}
 * @returns       Array<{combo, ev, prob, odds, stakeRatio, stakeYen}>
 */
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

/**
 * 各艇の AI 確率 vs 市場確率（人気）の乖離を計算。
 * delta > 0 → AI が高評価（過小評価＝妙味）
 * delta < 0 → AI が低評価（過大評価＝危険）
 */
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

/**
 * PB-4: Plackett–Luce モデルで 3連単 / 2連単確率を計算
 *   旧: p_i * p_j * p_k * 6 （簡易補正） → 順序付き選択時の系統バイアス
 *   新: p_i * p_j/(1-p_i) * p_k/(1-p_i-p_j)
 *       1 着が決まった後の残り 5 艇に確率を再分配する正攻法
 *   これにより EV/Kelly が「美味しく見える組合せ」を選ぶバイアスを除去
 */
function _plackettLuceTrifectaProb(p, i, j, k){
  var pi = p[i]||0, pj = p[j]||0, pk = p[k]||0;
  if(pi <= 0 || pj <= 0 || pk <= 0) return 0;
  var denom1 = 1 - pi;
  if(denom1 <= 1e-9) return 0;
  var denom2 = 1 - pi - pj;
  if(denom2 <= 1e-9) return 0;
  var prob = pi * (pj / denom1) * (pk / denom2);
  return Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
}
function _plackettLuceExactaProb(p, i, j){
  var pi = p[i]||0, pj = p[j]||0;
  if(pi <= 0 || pj <= 0) return 0;
  var denom = 1 - pi;
  if(denom <= 1e-9) return 0;
  var prob = pi * (pj / denom);
  return Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
}

/**
 * 確率順マーク列から { "1-2-3": prob, ... } 形式の3連単確率分布を生成（PL モデル）
 */
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

// ===============================================
// BET GENERATION V2 (PRESERVED)
// ===============================================
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

// ===============================================
// HISTORY MANAGEMENT (PRESERVED)
// ===============================================
// F17: 全場の確定レースに対して predictRace + savePrediction を一括実行
// ユーザーが開いていない場の成績も「本日の場別」に反映されるようにする
// 一度だけ実行する migration: 過去の garbage を一括除去
// （前日の _backfillTodayPredictions バグで「entry.date=今日」と
// 書き込まれた entry を、resultData の有無に関係なく一律削除する）。
// 1 度実行したら localStorage キーで二度と走らない。
// 削除しても、修正後の _backfillTodayPredictions が今日の正規 entry を
// 再構築するので最終状態は正しい。
function _migrateDropStaleTodayHistory(){
  var key = 'boatrace_history_migrated_v20';
  try { if(localStorage.getItem(key)) return; } catch(e){ return; }
  var today = todayStr();
  var hist = safeParse('boatrace_history', []);
  var before = hist.length;
  hist = hist.filter(function(h){
    if(h.date !== today) return true;
    if(!h.actual || h.actual.length === 0) return true;
    return false;   // entry.date=今日 かつ actual あり = 削除
  });
  if(hist.length !== before){
    safeSet('boatrace_history', hist);
    console.warn('[migration v20] dropped '+(before-hist.length)+' stale today entries');
  }
  try { localStorage.setItem(key, '1'); } catch(e){}
}

// 起動時に呼ばれる: history 内の「entry.date=今日 だが内容は別日」の
// 不整合エントリを除去（昨日の _backfillTodayPredictions が「今日」として
// 保存してしまった garbage を一掃）。resultData ロード後のみ実行。
function _cleanStaleHistoryToday(){
  if(!resultData || Object.keys(resultData).length===0) return;
  var today = todayStr();
  var hist = safeParse('boatrace_history', []);
  var before = hist.length;
  hist = hist.filter(function(h){
    if(h.date !== today) return true;            // 今日扱い以外はそのまま
    if(!h.actual || h.actual.length === 0) return true; // 予想のみで結果未出は touch しない
    var res = resultData[h.stadium] && resultData[h.stadium][h.race];
    if(!res) return false;                       // 今日の resultData に存在しない = 古い
    var rdate = (res.race_date||'').replace(/-/g,'');
    return !rdate || rdate === today;
  });
  if(hist.length !== before){
    safeSet('boatrace_history', hist);
    console.warn('[history] cleaned '+(before-hist.length)+' stale "today" entries');
  }
}

async function _backfillTodayPredictions(){
  if(!programData || !resultData) return;
  _cleanStaleHistoryToday();   // 古いゴミを掃除してから backfill
  var today = todayStr();
  var saved = 0;
  var iter = 0;
  // PG-4: Worker 利用可能なら state を同期、predictRaceAsync で並列度を上げる
  var useWorker = !!_getAppWorker();
  if(useWorker) _syncWorkerState();

  for(var sid in programData){
    var stadium = programData[sid];
    for(var rn in stadium){
      var res = resultData[sid] && resultData[sid][rn];
      var hasResult = res && res.isFinished;
      if(!hasResult) continue;
      // race_date が今日 (JST) と一致しないレースは skip
      // （API が前日結果を返すケースで「entry.date=今日 / 中身=昨日」を防ぐ）
      var rdate = (res.race_date || '').replace(/-/g,'');
      if(rdate && rdate !== today) continue;
      try {
        // PG-4: Worker 経由（並列で main thread 解放）or 同期 fallback
        var pred = useWorker
          ? await predictRaceAsync(sid, parseInt(rn))
          : predictRace(sid, parseInt(rn));
        if(pred){
          savePrediction(today, sid, rn, pred, res);
          saved++;
        }
      } catch(e){
        // 予想計算エラーは黙殺（特定レースのデータ欠損で続行）
      }
      // PE-9: yield (Worker 利用時は不要だが念のため、4 反復毎)
      iter++;
      if(!useWorker && iter % 4 === 0) await _yieldToMain();
    }
  }
  if(saved > 0) console.log('[backfill] saved predictions for', saved, 'finished races (worker=' + useWorker + ')');
}

function savePrediction(date,sid,rn,pred,result){
  try{
    var key='boatrace_history';
    var history=safeParse(key, []);   // PA-5: 検証付き parse
    var exists=history.some(function(h){return h.date===date&&h.stadium===sid&&h.race===rn});
    if(exists) return;
    var entry={
      date:date,stadium:sid,race:rn,
      predicted:pred.marks.map(function(m){return m.boat}),
      // PB-3 / PB-10: forward-chain backtest と calibration metrics 用に
      //   各艇の 1 着確率を [{boat, prob}, ...] で保存（boat 1..6 の順を保証）
      mark_probs: (function(){
        var byBoat = {};
        (pred.marks||[]).forEach(function(m){ if(m && m.boat) byBoat[m.boat] = m.prob; });
        var out = [];
        for(var b=1;b<=6;b++) out.push({boat:b, prob: Number.isFinite(byBoat[b]) ? byBoat[b] : 1/6});
        return out;
      })(),
      trifecta_bets:pred.trifecta.map(function(t){return t.combo}),
      exacta_bets:pred.exacta.map(function(t){return t.combo}),
      raceType:pred.raceType,
      actual:null,trifecta_hit:false,exacta_hit:false,quinella_hit:false
    };
    if(result&&result.isFinished&&result.results){
      var sorted=result.results.slice().sort(function(a,b){return a.place-b.place});
      entry.actual=sorted.map(function(r){return r.racer_boat_number});
      checkHit(entry);
      if(result.refund){
        // F6: Open API / 自前スクレイパーともに payout フィールド。旧 amount は念のため互換維持
        if(entry.trifecta_hit&&result.refund.trifecta&&result.refund.trifecta[0])
          entry.payout3 = result.refund.trifecta[0].payout || result.refund.trifecta[0].amount || 0;
        if(entry.exacta_hit&&result.refund.exacta&&result.refund.exacta[0])
          entry.payout2 = result.refund.exacta[0].payout || result.refund.exacta[0].amount || 0;
      }
    }
    history.push(entry);
    if(history.length>2000) history.splice(0, history.length-2000);   // P3 L-15: 過剰push後の整列
    safeSet(key, history);   // P3 L-05
  }catch(e){console.warn('savePrediction error:',e)}
}

function checkHit(entry){
  if(!entry.actual||entry.actual.length<3) return;
  var a3=entry.actual[0]+'-'+entry.actual[1]+'-'+entry.actual[2];
  entry.trifecta_hit=entry.trifecta_bets&&entry.trifecta_bets.indexOf(a3)>=0;
  var a2=entry.actual[0]+'-'+entry.actual[1];
  entry.exacta_hit=entry.exacta_bets&&entry.exacta_bets.indexOf(a2)>=0;
}

function updateHistoryWithResults(){
  try{
    var history=safeParse('boatrace_history', []);   // PA-5
    var updated=false;
    history.forEach(function(h){
      if(!resultData||!resultData[String(h.stadium)]||!resultData[String(h.stadium)][String(h.race)]) return;
      var res=resultData[String(h.stadium)][String(h.race)];
      if(!res.isFinished||!res.results||res.results.length===0) return;

      // F6: 既に actual がある場合でも payout が欠けていれば遡及補完
      if(!h.actual){
        h.actual=res.results.slice().sort(function(a,b){return a.place-b.place}).map(function(r){return r.racer_boat_number});
        checkHit(h);
        updated=true;
      }
      if(res.refund){
        if(h.trifecta_hit && (!h.payout3 || h.payout3===0) &&
           res.refund.trifecta && res.refund.trifecta[0]){
          h.payout3 = res.refund.trifecta[0].payout || res.refund.trifecta[0].amount || 0;
          if(h.payout3) updated=true;
        }
        if(h.exacta_hit && (!h.payout2 || h.payout2===0) &&
           res.refund.exacta && res.refund.exacta[0]){
          h.payout2 = res.refund.exacta[0].payout || res.refund.exacta[0].amount || 0;
          if(h.payout2) updated=true;
        }
      }
    });
    if(updated) safeSet('boatrace_history', history);   // P3 L-05
  }catch(e){console.warn('history update error:', e)}   // R2-07: silent pass を解消
}

function getAccuracy(){
  if(typeof _migrateDropStaleTodayHistory==='function') _migrateDropStaleTodayHistory();
  if(typeof _cleanStaleHistoryToday==='function') _cleanStaleHistoryToday();
  var today=todayStr();
  var history=safeParse('boatrace_history', []);   // PA-5
  var verified=history.filter(function(h){return h.date===today&&h.actual&&h.actual.length>0});
  if(!verified.length) return{trifectaRate:'0.0',exactaRate:'0.0',total:0,trifectaHit:0,exactaHit:0,totalPayout3:0,totalPayout2:0};
  var th=0,eh=0,tp3=0,tp2=0;
  verified.forEach(function(h){
    if(h.trifecta_hit){th++;tp3+=(h.payout3||0)}
    if(h.exacta_hit){eh++;tp2+=(h.payout2||0)}
  });
  return{
    trifectaRate:(th/verified.length*100).toFixed(1),
    exactaRate:(eh/verified.length*100).toFixed(1),
    total:verified.length,trifectaHit:th,exactaHit:eh,
    totalPayout3:tp3,totalPayout2:tp2
  };
}

// ===============================================
// DB BUILD (PRESERVED)
// ===============================================
async function buildInitialDB(){
  if(Object.keys(racerDB).length>100) return;
  var days=14;
  for(var d=1;d<=days;d++){
    try{
      var date=new Date(Date.now()-d*86400000);
      var yyyymmdd=date.getFullYear()+('0'+(date.getMonth()+1)).slice(-2)+('0'+date.getDate()).slice(-2);
      var yyyy=yyyymmdd.slice(0,4);
      var rawRes=await fetchWithFallback(API_BASE+'/results/v2/'+yyyy+'/'+yyyymmdd+'.json');
      var resData=indexResults(rawRes);
      if(resData) updateDBFromResults(resData,null);
      await sleep(1500);
    }catch(e){
      continue;
    }
  }
  console.log('DB構築完了: 選手'+Object.keys(racerDB).length+'人');
}

// ===============================================
// L2 ONLINE LEARNING (PRESERVED)
// ===============================================
// PE-9 + PH-5: メインスレッドに譲る共通ヘルパ
//   long-running loop の途中で 1 tick browser に処理時間を返す → INP / TBT 改善
//   PH-5: scheduler.postTask が yield より「明確な task 境界」を作るため優先
async function _yieldToMain(){
  // postTask は新しい task として実行されるため、TBT 計上の long task を確実に分割
  if(typeof scheduler !== 'undefined' && scheduler.postTask){
    return scheduler.postTask(function(){}, {priority:'user-blocking'});
  }
  if(typeof scheduler !== 'undefined' && scheduler.yield){
    await scheduler.yield();
    return;
  }
  // フォールバック: MessageChannel は setTimeout(0) より高速で確実
  await new Promise(function(r){
    var mc = new MessageChannel();
    mc.port1.onmessage = function(){ r(); };
    mc.port2.postMessage(0);
  });
}

// PG-9: Worker 経由学習。Worker 失敗時は main thread fallback
async function learnFromResultsViaWorker(){
  var w = _getAppWorker();
  if(!w || !resultData || !programData || !previewData) return null;
  return new Promise(function(resolve){
    var reqId = ++_appWorkerReqId;
    _appWorkerCallbacks.set(reqId, function(msg){
      if(msg.type !== 'batch_learn_done' || !msg.result){ resolve(null); return; }
      var r = msg.result;
      // worker からの更新を main state に反映
      if(Array.isArray(r.l2weights)) l2weights = r.l2weights;
      if(r.featureStats) _featureStats = r.featureStats;
      if(typeof r.trainStep === 'number') l2trainStep = r.trainStep;
      if(r.learnedKeys) l2learnedKeys = r.learnedKeys;
      // 永続化
      try{ safeSet('boatrace_weights', l2weights); }catch(_){}
      try{ safeSet('boatrace_trainstep', l2trainStep); }catch(_){}
      try{ safeSet('boatrace_featurestats', _featureStats); }catch(_){}
      try{ safeSet('boatrace_learned', l2learnedKeys); }catch(_){}
      console.log('[PG-9] worker learned '+r.learnedThisCall+' new races');
      resolve(r);
    });
    w.postMessage({
      type: 'batch_learn',
      reqId: reqId,
      input: {
        resultData: resultData,
        programData: programData,
        previewData: previewData,
        state: {
          l2weights: l2weights,
          featureStats: _featureStats,
          trainStep: l2trainStep,
          learnedKeys: l2learnedKeys,
        }
      }
    });
  });
}

async function learnFromResults(){
  if(!resultData||!programData||!previewData) return;
  // PG-9: Worker 利用可能なら Worker 経由
  if(_getAppWorker()){
    var workerResult = await learnFromResultsViaWorker();
    if(workerResult) return;
    // Worker 失敗時は main thread fallback (下に続く)
  }
  // PB-1: 当日（programData の race_date）を学習キーの一部に採用
  var dateKey = (function(){
    try{
      for(var s in programData){
        var stadiums=programData[s];
        for(var r in stadiums){
          var pgm=stadiums[r];
          if(pgm && pgm.race_date) return String(pgm.race_date).replace(/-/g,'');
        }
      }
    }catch(_){}
    return jstYmd(0);
  })();
  var learnedThisCall = 0;
  var iterCount = 0;   // PE-9: yield カウンタ
  for(var sid in resultData){
    var races=resultData[sid];
    for(var rn in races){
      var race=races[rn];
      if(!race||!race.isFinished||!race.results||!race.results.length) continue;
      var prog=programData[sid]&&programData[sid][rn];
      var prev=previewData[sid]&&previewData[sid][rn];
      if(!prog||!prog.boats||!Array.isArray(prog.boats)) continue;

      // PB-1: 同レースの二重学習を防ぐ
      var key = dateKey+'_'+sid+'_'+rn;
      if(l2learnedKeys[key]) continue;

      var sorted=race.results.slice().sort(function(a,b){return a.place-b.place});
      var winnerBoat=sorted[0].racer_boat_number;

      var stRanks={};
      if(prev&&prev.boats){
        var sts=[];
        for(var si=1;si<=6;si++){
          var spv=prev.boats[String(si)];
          var stVal=(spv&&spv.racer_start_timing!=null)?pf(spv.racer_start_timing):99;
          sts.push({boat:si,st:stVal});
        }
        sts.sort(function(a,b){return a.st-b.st});
        sts.forEach(function(s,idx){stRanks[s.boat]=idx});
      }

      var etRanks={};
      if(prev&&prev.boats){
        var ets=[];
        for(var ei=1;ei<=6;ei++){
          var epv=prev.boats[String(ei)];
          var etVal=(epv&&epv.racer_exhibition_time!=null&&epv.racer_exhibition_time>0)?pf(epv.racer_exhibition_time):99;
          ets.push({boat:ei,time:etVal});
        }
        ets.sort(function(a,b){return a.time-b.time});
        ets.forEach(function(e,idx){etRanks[e.boat]=idx});
      }

      var weather=prev?prev.weather||prev:null;
      var features6=prog.boats.map(function(b){
        var pv=prev&&prev.boats?prev.boats[String(b.racer_boat_number)]:null;
        return getL2Features(b,pv,weather,etRanks[b.racer_boat_number]||5,stRanks[b.racer_boat_number]||5,sid);
      });

      var winnerIdx=prog.boats.findIndex(function(b){return b.racer_boat_number===winnerBoat});
      if(winnerIdx>=0){
        l2Update(features6,winnerIdx);
        l2learnedKeys[key] = 1;   // PB-1: 学習済としてマーク
        learnedThisCall++;
      }
      // PE-9: 6 レース毎にメインスレッドへ譲る (TBT/INP 改善)
      iterCount++;
      if(iterCount % 6 === 0) await _yieldToMain();
    }
  }
  if(learnedThisCall > 0){
    // PB-1: 上限超過時は古いキーから切り捨て（FIFO 風: 単純に keys[].slice）
    var keys = Object.keys(l2learnedKeys);
    if(keys.length > L2_KEY_LIMIT){
      var keep = keys.slice(-L2_KEY_LIMIT);
      var trimmed = {};
      for(var i=0;i<keep.length;i++) trimmed[keep[i]] = 1;
      l2learnedKeys = trimmed;
    }
    safeSet('boatrace_learned', l2learnedKeys);   // PB-1
    console.log('[L2] learned '+learnedThisCall+' new races (total t='+l2trainStep+', tracked keys='+Object.keys(l2learnedKeys).length+')');
  }
}

// ===============================================
// LIVE DATA MERGE HELPER
// ===============================================

// 公式 API previews/v2/today.json は (1) 前日データを残す、
// (2) 当日の race_date に切り替わっても展示走行前は exhibition_time=0 /
// start_timing=null のままという 2 つの性質がある。
// レース単位で「展示済みのレースだけ」残す（展示前は前日値が紛れる原因）。
function _filterStalePreviews(raw){
  if(!raw || !Array.isArray(raw.previews) || !raw.previews.length) return raw;
  var today = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  var firstDate = raw.previews[0].race_date || '';
  if(firstDate && firstDate !== today){
    console.warn('公式 API previews は古い('+firstDate+' JST), 全件 skip');
    return { previews: [], updated_at: raw.updated_at };
  }
  // 「データが何もない」プレースホルダだけ除外。
  //   PI-fix: 気象が計測済 OR 展示済 ならそのレースは「データあり」と扱う。
  var filtered = raw.previews.filter(function(p){
    var hasWeather = (p.race_wind||0)>0 || (p.race_water_temperature||0)>0
                  || (p.race_temperature||0)>0 || (p.race_wave||0)>0
                  || (p.race_wind_direction_number!=null);
    var bs = p.boats || [];
    if(!Array.isArray(bs)) bs = Object.keys(bs).map(function(k){return bs[k]});
    var hasExh = bs.some(function(b){ return b && (b.racer_exhibition_time||0) > 0; });
    return hasWeather || hasExh;
  });
  if(filtered.length !== raw.previews.length){
    console.info('previews: '+raw.previews.length+' → '+filtered.length+' (データ未取得のレースを除外)');
  }
  return { previews: filtered, updated_at: raw.updated_at };
}

function _applyLiveDataMerge(liveData){
  if(!liveData||!liveData.races||!liveData.races.length) return 0;
  var liveDate=liveData.updated_at?new Date(new Date(liveData.updated_at).getTime()+9*3600000).toISOString().slice(0,10):'';
  var todayDate=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  if(liveDate&&liveDate!==todayDate){console.warn('公式展示データは古い('+liveDate+' JST), スキップ');return 0;}
  liveData.races.forEach(function(lr){
    var sid=String(lr.stadium);var rn=String(lr.race);
    if(lr.boats&&previewData&&previewData[sid]&&previewData[sid][rn]){
      var pv=previewData[sid][rn];
      for(var bn in lr.boats){
        var lb=lr.boats[bn];
        if(!pv.boats) pv.boats={};
        if(!pv.boats[bn]) pv.boats[bn]={racer_boat_number:parseInt(bn)};
        if(lb.racer_exhibition_time>0) pv.boats[bn].racer_exhibition_time=lb.racer_exhibition_time;
        if(lb.racer_start_timing!==null&&lb.racer_start_timing!==undefined) pv.boats[bn].racer_start_timing=lb.racer_start_timing;
        if(lb.racer_tilt_adjustment!==null&&lb.racer_tilt_adjustment!==undefined) pv.boats[bn].racer_tilt_adjustment=lb.racer_tilt_adjustment;
        if(lb.racer_course_number) pv.boats[bn].racer_course_number=lb.racer_course_number;
      }
    } else if(lr.boats&&previewData){
      if(!previewData[sid]) previewData[sid]={};
      previewData[sid][rn]={race_stadium_number:lr.stadium,race_number:lr.race,boats:lr.boats,
        weather:{wind_speed:0,wind_direction:0,wave_height:0,temperature:0,water_temperature:0}};
    }
    if(lr.finished&&lr.result&&lr.result.places&&resultData){
      if(!resultData[sid]) resultData[sid]={};
      if(!resultData[sid][rn]||!resultData[sid][rn].isFinished){
        resultData[sid][rn]={race_stadium_number:lr.stadium,race_number:lr.race,
          race_technique_number:lr.result.technique||null,isFinished:true,
          results:lr.result.places.map(function(p){return{place:p.place,racer_boat_number:p.boat,racer_place_number:p.place}}),
          refund:lr.result.payouts||{}};
      }
    }
  });
  return liveData.races.length;
}

// ===============================================
// DATA LOADING (PRESERVED)
// ===============================================
// PE-8: loadAllData は Phase 1 (Critical) のみ、Phase 2 は loadDeferredData() に分離
//   - Phase 1: programs + previews を並列 fetch、results は最低限のみ
//   - 第 1 描画の TBT を最小化、LCP 改善
//   - racerDB / stadiumDB / odds / racedata / tide は requestIdleCallback で deferred
async function loadAllData(){
  var prog=document.getElementById('progressFill');
  var msg=document.getElementById('progressMsg');
  // PH-5f: topLoading 表示は撤去 (CLS 主原因)
  //   prerender HTML が既に stadium grid を表示しているため、
  //   loading spinner を出すと layout shift が発生
  // var topLoading=document.getElementById('topLoading');
  // if(topLoading) topLoading.style.display='block';

  try{
  if(msg) msg.textContent='出走表・直前情報を取得中...';
  if(prog) prog.style.width='30%';

  // PE-8: Phase 1 — 起動 critical fetch を並列化（programs + previews）
  // PH-5: 各 fetch / 重い同期処理の前後で yield、long task 化を回避
  var ts='?t='+Date.now();
  var phase1 = await Promise.all([
    fetchWithFallback(API_BASE+'/programs/v2/today.json'+ts),
    fetchWithFallback(API_BASE+'/previews/v2/today.json'+ts),
  ]);
  var rawPrograms = phase1[0];
  var rawPreviews = _filterStalePreviews(phase1[1]);
  await _yieldToMain();   // PH-5
  programData = indexByStadiumRace(rawPrograms, 'programs');
  await _yieldToMain();   // PH-5
  previewData = indexPreviews(rawPreviews);
  await _yieldToMain();   // PH-5
  if(rawPrograms && typeof _noteUpdatedAt==='function') _noteUpdatedAt(rawPrograms.updated_at);
  if(rawPreviews && typeof _noteUpdatedAt==='function') _noteUpdatedAt(rawPreviews.updated_at);
  if(prog) prog.style.width='70%';

  // PE-8: 結果 — 自前 → Open API fallback（Critical: ヘッダーバー的中表示用）
  if(msg) msg.textContent='結果を取得中...';
  var rawResults=null;
  try{
    var resResp=await fetch('data/results/today.json?t='+Date.now());
    if(resResp.ok){
      var resData=await resResp.json();
      if(resData.results&&resData.results.length>0){
        var resDate=resData.results[0].race_date;
        var todayRes=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        if(resDate===todayRes){rawResults=resData;}
      }
    }
  }catch(e){}
  if(!rawResults){rawResults=await fetchWithFallback(API_BASE+'/results/v2/today.json'+ts)}
  await _yieldToMain();   // PH-5
  resultData=indexResults(rawResults);
  await _yieldToMain();   // PH-5
  if(rawResults&&typeof _noteUpdatedAt==='function') _noteUpdatedAt(rawResults.updated_at);

  // F5: 自前スマートスケジューラ出力 (races 配列形式) を merge
  try{
    var localPv=await fetch('data/previews/today.json?t='+Date.now());
    if(localPv.ok){
      var localData=await localPv.json();
      if(localData&&Array.isArray(localData.races)){
        await _yieldToMain();   // PH-5
        _applyLiveDataMerge(localData);
        if(typeof _noteUpdatedAt==='function') _noteUpdatedAt(localData.updated_at);
      }
    }
  }catch(e){console.warn('local previews merge failed:', e)}

  if(prog) prog.style.width='100%';
  if(msg) msg.textContent='完了';

  // PE-8: Phase 2 — 非クリティカル DB / 学習を idle time に deferred
  //   起動 LCP/FCP に影響しないよう requestIdleCallback (フォールバック setTimeout)
  var schedule = (typeof requestIdleCallback === 'function')
    ? function(fn){ requestIdleCallback(fn, {timeout: 3000}); }
    : function(fn){ setTimeout(fn, 100); };
  schedule(function(){ loadDeferredData(rawPrograms, rawPreviews).catch(function(e){
    console.warn('[PE-8] deferred load failed:', e);
  }); });

  }catch(e){
    console.error('loadAllData error:',e);
    if(msg) msg.textContent='一部データの取得に失敗しました';
  }

  // ★ エラーが起きても必ず画面を表示
  // PH-5: render 直前に yield、新しい task で render を実行（long task 化回避）
  await _yieldToMain();
  var activePage=document.querySelector('.page.active');
  var activeId=activePage?activePage.id:'';
  if(activeId==='pageDetail'&&currentStadium&&currentRace){
    openRace(currentStadium,currentRace);
  } else if(activeId==='pageRaces'&&currentStadium){
    openStadium(currentStadium);
  } else {
    renderStadiums();
  }

  // PE-8: buildInitialDB は loadDeferredData で扱うため、ここからは削除
}

// PE-8: 非クリティカル DB / 学習を idle time に逐次ロード
//   呼出: loadAllData() 内の Phase 2 から
//   引数: Phase 1 で取得済の raw データ（学習関数用）
async function loadDeferredData(rawPrograms, rawPreviews){
  console.log('[PE-8] loading deferred data...');

  // 非クリティカル fetch を並列化
  var tasks = [];

  // 選手 DB（推奨: 予測詳細時にだけ必要、最大 ~5MB）
  tasks.push((async function(){
    try{
      var dbResp=await fetch('data/db/racerDB.json?t='+Date.now());
      if(!dbResp.ok) return;
      var dbData=await dbResp.json();
      if(!dbData.racers) return;
      for(var rn in dbData.racers){
        var r=dbData.racers[rn];
        if(!racerDB[rn]) racerDB[rn]={courseStats:{},courseStyle:{},recentResults:[],lastUpdated:''};
        racerDB[rn].name=r.name;
        racerDB[rn].classNum=r.classNum;
        if(r.courseStats){
          if(!racerDB[rn].courseStats) racerDB[rn].courseStats={};
          for(var c in r.courseStats){
            var cs=r.courseStats[c];
            racerDB[rn].courseStats[c]={
              races:cs.entries||0,
              win:cs.wins||0,
              top2:Math.round((cs.entries||0)*(cs.top2Rate||0)/100),
              top3:Math.round((cs.entries||0)*(cs.top2Rate||0)/100*1.3),
              avgST:cs.avgST||0
            };
          }
        }
        if(r.recentResults&&r.recentResults.length>0){
          racerDB[rn].recentResults=r.recentResults;
        }
        racerDB[rn].lastUpdated=dbData.updated_at?dbData.updated_at.slice(0,10).replace(/-/g,''):'';
      }
      try{localStorage.setItem('boatrace_racerDB',JSON.stringify(racerDB))}catch(e){}
    }catch(e){console.warn('[PE-8] racerDB skip:', e.message);}
  })());

  // 場別統計 DB
  tasks.push((async function(){
    try{
      var sdbResp=await fetch('data/db/stadiumDB.json?t='+Date.now());
      if(!sdbResp.ok) return;
      var sdbData=await sdbResp.json();
      if(!sdbData.stadiums) return;
      for(var sid in sdbData.stadiums){
        var s=sdbData.stadiums[sid];
        if(!stadiumDB[sid]) stadiumDB[sid]={courseWinRate:{},techniqueRate:{},courseTechnique:{}};
        if(s.courseWinRate){
          for(var c in s.courseWinRate){
            stadiumDB[sid].courseWinRate[c]={races:s.totalRaces||100,win:Math.round((s.totalRaces||100)*s.courseWinRate[c])};
          }
        }
      }
      try{localStorage.setItem('boatrace_stadiumDB',JSON.stringify(stadiumDB))}catch(e){}
    }catch(e){}
  })());

  // オッズ
  tasks.push((async function(){
    try{
      var oddsResp=await fetch('data/odds/today.json?t='+Date.now());
      if(!oddsResp.ok) return;
      var od=await oddsResp.json();
      if(od.updated_at){
        var oddsDate=new Date(new Date(od.updated_at).getTime()+9*3600000).toISOString().slice(0,10);
        var todayDate=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        if(oddsDate===todayDate){oddsData=od;oddsLastFetched=Date.now();}
      }
    }catch(e){}
  })());

  // racedata（今節成績、部品交換、写真）
  tasks.push((async function(){
    try{
      var rdResp=await fetch('data/racedata/today.json?t='+Date.now());
      if(rdResp.ok) raceData=await rdResp.json();
    }catch(e){raceData=null}
  })());

  // 潮汐
  tasks.push((async function(){
    try{
      var tideResp=await fetch('data/tide/today.json?t='+Date.now());
      if(tideResp.ok) tideData=await tideResp.json();
    }catch(e){tideData=null}
  })());

  await Promise.allSettled(tasks);
  console.log('[PE-8] deferred fetch complete');

  // PE-8 + PE-9: 軽量な学習を deferred で実行
  //   PF-3: _backfillTodayPredictions は重いので「成績タブ open 時 / 60秒 idle」まで遅延
  try {
    if(resultData) updateDBFromResults(resultData, programData);
    if(rawPrograms) learnMotorStatsFromPrograms(rawPrograms);
    if(rawPreviews) learnExhibitionStatsFromPreviews(rawPreviews);
    if(rawPreviews && rawPrograms) learnRacerStFromPreviews(rawPreviews, rawPrograms);
    if(resultData) learnEntryPatternFromResults(resultData);
    if(resultData) learnSeriesAndPairwiseFromResults(resultData);
    await learnFromResults();              // PE-9: async + yield
    updateHistoryWithResults();
  } catch(e) {
    console.warn('[PE-8] learning step failed:', e);
  }

  // PF-3: backfill は 60 秒後（または成績タブ open 時）に lazy 実行
  //   _backfillTodayPredictions は predictRace × 全レース で重い (~1.5s TBT)
  //   起動 critical path から外し、ユーザーが成績タブを開く / 60秒経過まで待つ
  _scheduleLazyBackfill();

  // バックグラウンド DB 構築（公式 DB が薄い場合）
  if(Object.keys(racerDB).length < 50){
    setTimeout(function(){ if(typeof buildInitialDB === 'function') buildInitialDB(); }, 5000);
  }

  console.log('[PE-8] deferred all done (backfill scheduled for lazy run)');
}

// PF-3: backfill を lazy 起動（成績タブ open or 60 秒 idle）
var _backfillDone = false;
var _backfillTimer = null;
async function _runLazyBackfillOnce(reason){
  if(_backfillDone) return;
  _backfillDone = true;
  if(_backfillTimer){ clearTimeout(_backfillTimer); _backfillTimer = null; }
  console.log('[PF-3] lazy backfill triggered:', reason);
  try {
    await _backfillTodayPredictions();
    updateHistoryWithResults();
  } catch(e) {
    console.warn('[PF-3] lazy backfill failed:', e);
    _backfillDone = false;   // 失敗時はリトライ可能化
  }
}
function _scheduleLazyBackfill(){
  if(_backfillDone || _backfillTimer) return;
  // 60 秒後に自動実行（ユーザーがその間に成績タブを開けば早期実行）
  _backfillTimer = setTimeout(function(){
    _runLazyBackfillOnce('60s timeout');
  }, 60000);
}

// ===============================================
// ODDS HELPERS (PRESERVED)
// ===============================================
function getOddsForRace(sid,rn){
  if(!oddsData||!oddsData.odds) return null;
  return oddsData.odds.find(function(o){return o.stadium===parseInt(sid)&&o.race===parseInt(rn)})||null;
}

function calcPopularity(raceOdds){
  if(!raceOdds) return null;
  if(raceOdds.win){
    var entries=[];
    for(var b in raceOdds.win) entries.push({boat:parseInt(b),odds:raceOdds.win[b]});
    entries.sort(function(a,b){return a.odds-b.odds});
    return entries.map(function(e,i){e.rank=i+1;return e});
  }
  return null;
}

// P3 L-17: getOddsTrend は未使用かつ oddsHistory 未初期化のため削除

function calcEV(aiProb,odds){
  if(!odds||odds<=0) return null;
  return aiProb*odds;
}

function evBadge(ev){
  if(ev===null) return'';
  if(ev>=1.2) return'<span class="ev-badge ev-strong">EV'+ev.toFixed(1)+'</span>';
  if(ev>=1.0) return'<span class="ev-badge ev-good">EV'+ev.toFixed(1)+'</span>';
  if(ev>=0.8) return'<span class="ev-badge ev-neutral">EV'+ev.toFixed(1)+'</span>';
  return'<span class="ev-badge ev-bad">EV'+ev.toFixed(1)+'</span>';
}

// ===============================================
// RACE DATA / PARTS HELPERS (PRESERVED)
// ===============================================
function getRaceDataForRace(sid,rn){
  if(!raceData||!raceData.racedata) return null;
  return raceData.racedata.find(function(r){return r.stadium===parseInt(sid)&&r.race===parseInt(rn)})||null;
}

// F16: Macool 風セルレンダリング (背景=枠番色 / 上=着順 / 下=進入コース漢数字+ST)
function renderSeriesCell(entry){
  if(!entry) return '<td class="series-mc empty"></td>';
  var KANJI = ['','一','二','三','四','五','六'];
  var place, course, waku, st;
  if(typeof entry === 'object'){
    place = entry.place; course = entry.course; waku = entry.waku; st = entry.st || '';
  } else {
    place = entry; course = null; waku = null; st = '';
  }
  var bgWaku = waku || course;
  var courseKanji = (course && course >= 1 && course <= 6) ? KANJI[course] : '-';
  var bgCls = bgWaku ? 'wk'+bgWaku : 'wkNa';
  var placeStr = (place && place >= 1 && place <= 6) ? place : '-';
  var stHtml = st ? '<span class="series-st">'+st+'</span>' : '';
  return '<td class="series-mc '+bgCls+'">'
       + '<span class="series-top">'+placeStr+'</span>'
       + '<span class="series-bottom">'+courseKanji+stHtml+'</span>'
       + '</td>';
}

function renderSeriesNums(results){
  if(!results||!results.length) return'';
  return results.map(function(r){ return renderSeriesCell(r); }).join('');
}

// PF-6: partsHtml は未使用（旧 race detail の名残）→ 削除

// ===============================================
// HELPER: Motor evaluation A-E
// ===============================================
function motorEvalGrade(r){
  if(r>=50)return{grade:'A',label:'超抜',cls:'motor-a'};
  if(r>=43)return{grade:'B',label:'中堅上位',cls:'motor-b'};
  if(r>=36)return{grade:'B',label:'中堅上位',cls:'motor-b'};
  if(r>=28)return{grade:'C',label:'中堅',cls:'motor-c'};
  if(r>=20)return{grade:'D',label:'中堅下位',cls:'motor-d'};
  return{grade:'E',label:'ワースト',cls:'motor-e'};
}

// ===============================================
// HELPER: Get family name (max 3 chars)
// ===============================================
function familyName(n){return (n||'').split(/[\s\u3000]/)[0].slice(0,3)}

// ===============================================
// HELPER: Racer badges (form, class, F count)
// ===============================================
function racerBadges(boat,form,divergence){
  var badges=[];
  var fc=boat.racer_flying_count||0;
  // F14: A1勝負 / A2勝負 バッジは撤去（ユーザー要望: 意味が分かりにくい）
  if(form){
    if(form.label==='好調'||form.label==='絶好調') badges.push('<span class="racer-badge badge-hot">好調</span>');
    if(form.label==='不調'||form.label==='絶不調') badges.push('<span class="racer-badge badge-cold">不調</span>');
    if(form.trend>0.5) badges.push('<span class="racer-badge badge-rising">上昇</span>');
  }
  if(fc>=1) badges.push('<span class="racer-badge badge-f1">F'+fc+'</span>');
  // X1: 妙味 / 危険バッジ（AI vs 市場確率の乖離）
  if(divergence){
    if(divergence.delta >= 0.08) badges.push('<span class="racer-badge" style="background:#E8F5E9;color:#2E7D32;border:1px solid #2E7D32">🎯妙味+'+(divergence.delta*100).toFixed(0)+'pt</span>');
    else if(divergence.delta >= 0.04) badges.push('<span class="racer-badge" style="background:#E8F5E9;color:#2E7D32">🎯妙味</span>');
    else if(divergence.delta <= -0.08) badges.push('<span class="racer-badge" style="background:#FFEBEE;color:#C62828;border:1px solid #C62828">⚠過大評価</span>');
    if(divergence.ev != null && divergence.ev >= 1.20) badges.push('<span class="racer-badge" style="background:#FFF3E0;color:#E65100">EV'+divergence.ev.toFixed(2)+'</span>');
  }
  return badges.join('');
}

// ===============================================
// PAGE CONTROL (REWRITTEN)
// ===============================================
function showPage(page){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  // PD-7: aria-current は nav の active 状態と同期
  document.querySelectorAll('.nav-btn').forEach(function(b){
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  if(page!=='detail') stopOddsAutoRefresh();

  function _setActive(navId){
    var el = document.getElementById(navId);
    if(el){ el.classList.add('active'); el.setAttribute('aria-current','page'); }
  }

  if(page==='top'){document.getElementById('pageTop').classList.add('active');_setActive('navTop')}
  else if(page==='races'){document.getElementById('pageRaces').classList.add('active');_setActive('navTop')}
  else if(page==='detail'){document.getElementById('pageDetail').classList.add('active');_setActive('navTop');startOddsAutoRefresh()}
  else if(page==='stats'){document.getElementById('pageStats').classList.add('active');_setActive('navStats');renderStats()}
  else if(page==='backtest'){document.getElementById('pageBacktest').classList.add('active');_setActive('navBacktest')}
  else if(page==='settings'){document.getElementById('pageSettings').classList.add('active');_setActive('navSettings');loadSettings()}
  window.scrollTo(0,0);
}

// ===============================================
// SCREEN 1: TOP - 4 column stadium grid (REWRITTEN)
// ===============================================
function renderStadiums(){
  document.getElementById('topLoading').style.display='none';
  var sumDiv=document.getElementById('topSummary');
  var list=document.getElementById('stadiumList');
  // PH-5d: sumDiv は HTML で min-height で初期スペース確保済 → display 設定不要
  //   旧: sumDiv.style.display='block' は CLS の主要因 (60px 押下げ)
  list.style.display='grid';
  // PH-5c: list.innerHTML='' を撤去 (CLS 抑制)
  //   下記 list.innerHTML = html で atomic に置換、中間 empty 状態を作らない

  var acc=getAccuracy();
  sumDiv.innerHTML='<div class="summary-bar">'
    +'<div class="summary-item"><div class="s-num" style="color:var(--accent)">'+acc.total+'</div><div class="s-label">判定済</div></div>'
    +'<div class="summary-item"><div class="s-num" style="color:var(--gold)">'+acc.trifectaHit+'</div><div class="s-label">3連単的中</div></div>'
    +'<div class="summary-item"><div class="s-num" style="color:var(--success)">'+acc.trifectaRate+'%</div><div class="s-label">的中率</div></div>'
    +'<div class="summary-item"><div class="s-num" style="color:var(--text)">'+Object.keys(racerDB).length+'</div><div class="s-label">選手DB</div></div>'
    +'</div>';

  var activeIds={};
  if(programData){
    for(var sid in programData) activeIds[sid]=true;
  }

  // PH-2: DocumentFragment + 単一 innerHTML join で reflow 1 回に削減
  //   従来: 24 createElement + 24 appendChild = 24 reflow
  //   新版: HTML 文字列 join + 1 回 innerHTML = 1 reflow
  //   PG-6 の event delegation が data-sid を受けるため onclick 不要
  var html = '';
  for(var id=1;id<=24;id++){
    var sid=String(id);
    var name=STADIUMS[id];
    if(activeIds[sid]&&programData[sid]){
      var stadium=programData[sid];
      var raceNums=Object.keys(stadium).sort(function(a,b){return parseInt(a)-parseInt(b)});
      var totalRaces=raceNums.length;
      var doneCount=0;
      if(resultData&&resultData[sid]){
        raceNums.forEach(function(rn){if(resultData[sid][rn]&&resultData[sid][rn].isFinished) doneCount++});
      }
      var firstRace=stadium[raceNums[0]];
      var gradeNum=firstRace?firstRace.race_grade_number||5:5;
      var grade=GRADE_CLASS[gradeNum]||GRADE_CLASS[5];

      var dayInfo='';
      if(raceData&&raceData.racedata){
        var rd=raceData.racedata.find(function(r){return r.stadium===parseInt(sid)});
        if(rd&&rd.day) dayInfo=rd.day+'日目';
      }

      var nextRaceInfo='';
      var nextRn=null;
      for(var ri=0;ri<raceNums.length;ri++){
        var rnCheck=raceNums[ri];
        var isDone=resultData&&resultData[sid]&&resultData[sid][rnCheck]&&resultData[sid][rnCheck].isFinished;
        if(!isDone){nextRn=rnCheck;break}
      }
      if(nextRn) nextRaceInfo=nextRn+'R';
      else nextRaceInfo='終了';

      // PH-2 + CLS 対策: stadium-day を常に 2 つレンダー（dayInfo 無くても &nbsp; placeholder）
      // PI-fix: iOS standalone PWA で event delegation が click 発火しないため
      //   inline onclick + role="button" + tabindex="0" を必ず付ける（既存の
      //   `<button onclick="showPage(...)">` 動作と同じパスを使う）
      html += '<div class="stadium-card active-stadium" data-sid="'+sid+'" '
        +'role="button" tabindex="0" onclick="openStadium(\''+sid+'\')">'
        +'<span class="stadium-grade '+grade.cls+'">'+grade.name+'</span>'
        +'<span class="stadium-name">'+name+'</span>'
        +'<span class="stadium-status">'+doneCount+'/'+totalRaces+'R</span>'
        +'<span class="stadium-day">'+(dayInfo||'&nbsp;')+'</span>'
        +'<span class="stadium-day">'+nextRaceInfo+'</span>'
        +'</div>';
    } else {
      html += '<div class="stadium-card inactive-stadium">'
        +'<span class="stadium-name">'+name+'</span>'
        +'<span class="stadium-status">次節</span>'
        +'</div>';
    }
  }
  list.innerHTML = html;   // PH-2: 単一 reflow
}

// ===============================================
// SCREEN 2: RACE LIST TABLE (REWRITTEN)
// ===============================================
function openStadium(sid){
  // PI-fix: predictRace 等は app-rest.js (lazy load) にあるため、rest 未 load
  //   で呼ばれた場合は ReferenceError で silently fail する。これを防ぐため
  //   guard + retry を入れる。
  if(typeof predictRace !== 'function' || typeof savePrediction !== 'function'){
    try { reportError({type:'info', msg:'openStadium deferred: rest not ready', sid:sid}); }catch(_){}
    currentStadium = sid;
    var name0 = (typeof STADIUMS!=='undefined' && STADIUMS[parseInt(sid)]) || ('場'+sid);
    var t = document.getElementById('racesTitle');
    if(t) t.textContent = name0;
    var l = document.getElementById('racesList');
    if(l) l.innerHTML = '<div class="card">読込中... (予測モジュール待機)</div>';
    showPage('races');
    var _retry = 0;
    var _iv = setInterval(function(){
      _retry++;
      if(typeof predictRace === 'function' && typeof savePrediction === 'function'){
        clearInterval(_iv);
        try { openStadium(sid); }catch(e){ try{ reportError({type:'error', msg:'openStadium retry threw: '+e.message}); }catch(_){} }
      } else if(_retry > 30){
        clearInterval(_iv);
        if(l) l.innerHTML = '<div class="card">予測モジュールの読込に失敗しました。「更新」ボタンを押してください。</div>';
      }
    }, 200);
    return;
  }
  currentStadium=sid;
  var name=STADIUMS[parseInt(sid)]||('場'+sid);
  var stadium=programData[sid];
  if(!stadium){
    document.getElementById('racesTitle').textContent=name;
    document.getElementById('racesList').innerHTML='<div class="card">データがありません</div>';
    showPage('races');
    return;
  }

  var firstRace=stadium[Object.keys(stadium)[0]];
  var gradeNum=firstRace?firstRace.race_grade_number||5:5;
  var grade=GRADE_CLASS[gradeNum]||GRADE_CLASS[5];
  document.getElementById('racesTitle').innerHTML=name+' <span class="stadium-grade '+grade.cls+'" style="vertical-align:middle">'+grade.name+'</span>';

  var raceNums=Object.keys(stadium).sort(function(a,b){return parseInt(a)-parseInt(b)});

  var html='<table class="race-table">';
  html+='<thead><tr>';
  html+='<th class="race-col">R</th>';
  for(var b=1;b<=6;b++){
    html+='<th class="boat-col boat-header-'+b+'">'+b+'</th>';
  }
  html+='</tr></thead><tbody>';

  raceNums.forEach(function(rn){
    var race=stadium[rn];
    var pred=predictRace(sid,parseInt(rn));
    var progPred=predictRaceProgram(sid,parseInt(rn));
    var hasResult=resultData&&resultData[sid]&&resultData[sid][rn]&&resultData[sid][rn].isFinished;

    if(pred) savePrediction(todayStr(),sid,rn,pred,hasResult?resultData[sid][rn]:null);

    // 直前予想があるか判定
    var pvData=previewData&&previewData[sid]&&previewData[sid][rn]?previewData[sid][rn]:null;
    var hasRealPv=false;
    if(pvData&&pvData.boats){for(var pk in pvData.boats){if(pvData.boats[pk]&&pvData.boats[pk].racer_exhibition_time!=null){hasRealPv=true;break}}}

    // 表示用の予想（直前あれば直前、なければ番組）
    var dispPred=(hasRealPv&&pred)?pred:null;
    var typeSource=dispPred||progPred;
    var typeIcon=typeSource?(typeSource.raceType==='honmei'?'⚡':typeSource.raceType==='ana'?'🔥':'📊'):'';
    var typeCls=dispPred?dispPred.typeCls:(progPred?('type-'+(progPred.raceType||'middle')):'');

    // 番組→直前で最も上昇した艇の番号
    var riserStr='';
    if(dispPred&&progPred){
      var diff=comparePredictions(progPred,dispPred);
      if(diff&&diff.biggestRiser) riserStr=' <span style="color:#43A047;font-size:9px">↑'+diff.biggestRiser.boat+'</span>';
    }

    html+='<tr onclick="openRace(\''+sid+'\',\''+rn+'\')">';
    var closedAt=race.race_closed_at||'';
    var closedTime=closedAt?closedAt.split(' ')[1]||'':'';
    if(closedTime) closedTime=closedTime.slice(0,5);
    var stageLabel=hasRealPv?'<span style="font-size:8px;color:#E65100">直前</span>':'<span style="font-size:8px;color:#1A237E">番組</span>';
    html+='<td class="race-num-cell">'+rn+'<br><span style="font-size:9px;color:var(--text-dim);font-weight:400">'+closedTime+'</span><span class="race-type-icon"><span class="type-badge '+typeCls+'">'+typeIcon+'</span></span><br>'+stageLabel+riserStr+'</td>';

    if(race.boats&&Array.isArray(race.boats)){
      var boatMap={};
      race.boats.forEach(function(bt){boatMap[bt.racer_boat_number]=bt});
      var activePredMarks=dispPred?dispPred.marks:(progPred?progPred.marks:null);
      for(var bn=1;bn<=6;bn++){
        var bt=boatMap[bn];
        if(!bt){html+='<td>-</td>';continue}
        var racerName=escText(bt.racer_name||'');
        var isTop=activePredMarks&&activePredMarks[0]&&activePredMarks[0].boat===bn;
        var nameClass=isTop?'name-bold':'';
        var markStr=isTop?'◎ ':'';
        html+='<td class="racer-cell"><span class="'+nameClass+'">'+markStr+escText(racerName)+'</span></td>';
      }
    } else {
      for(var x=0;x<6;x++) html+='<td>-</td>';
    }

    html+='</tr>';

    if(hasResult&&pred){
      var res=resultData[sid][rn];
      var places=res.results.slice().sort(function(a,b){return a.place-b.place}).slice(0,3);
      var actualCombo=places[0].racer_boat_number+'-'+places[1].racer_boat_number+'-'+places[2].racer_boat_number;
      var hit=pred.trifecta.some(function(t){return t.combo===actualCombo});
      html+='<tr onclick="openRace(\''+sid+'\',\''+rn+'\')" style="background:'+(hit?'#E8F5E9':'#FFEBEE')+'">';
      html+='<td class="race-result-cell '+(hit?'hit':'miss')+'">'+(hit?'的中':'×')+'</td>';
      for(var bn2=1;bn2<=6;bn2++){
        var placeNum=null;
        places.forEach(function(p,pi){if(p.racer_boat_number===bn2) placeNum=pi+1});
        html+='<td class="race-result-cell">'+(placeNum?placeNum+'着':'')+'</td>';
      }
      html+='</tr>';
    }
  });

  html+='</tbody></table>';
  document.getElementById('racesList').innerHTML=html;
  document.getElementById('raceSummary').innerHTML='';

  showPage('races');
}

// ===============================================
// SCREEN 3: RACE DETAIL - Macour style (REWRITTEN)
// ===============================================
function openRace(sid,rn){
  currentStadium=sid;
  currentRace=rn;
  var name=STADIUMS[parseInt(sid)]||('場'+sid);
  var race=programData[sid][rn];
  var closedAt=race?race.race_closed_at||'':'';
  var closedTime=closedAt?closedAt.split(' ')[1]||'':'';
  if(closedTime) closedTime=closedTime.slice(0,5);
  document.getElementById('detailTitle').innerHTML=name+' '+rn+'R'+(closedTime?' <span style="font-size:12px;color:var(--text-dim);font-weight:400">締切 '+closedTime+'</span>':'');
  document.getElementById('detailBack').onclick=function(){openStadium(sid)};

  var preview=previewData&&previewData[sid]&&previewData[sid][rn]?previewData[sid][rn]:null;
  var result=resultData&&resultData[sid]&&resultData[sid][rn]?resultData[sid][rn]:null;
  var pred=predictRace(sid,parseInt(rn));
  var raceOdds=getOddsForRace(sid,rn);
  var popularity=calcPopularity(raceOdds);
  var rdForRace=getRaceDataForRace(sid,rn);

  document.getElementById('oddsRefreshBtn').style.display='inline-block';
  updateOddsUI();

  // Weather
  var weatherHtml='';
  if(preview){
    var w=preview.weather||preview;
    var windDir=WIND_DIR[w.wind_direction||w.race_wind_direction_number]||'---';
    var ws=w.wind_speed||w.race_wind||0;
    var wh=w.wave_height||w.race_wave||0;
    var temp=w.temperature||w.race_temperature||'--';
    var wtemp=w.water_temperature||w.race_water_temperature||'--';
    weatherHtml='<div class="weather-bar">'
      +'<span class="weather-item">風: '+windDir+' '+ws+'m</span>'
      +'<span class="weather-item">波: '+wh+'cm</span>'
      +'<span class="weather-item">気温: '+temp+'℃</span>'
      +'<span class="weather-item">水温: '+wtemp+'℃</span>'
      +'</div>';
  }
  document.getElementById('detailWeather').innerHTML=weatherHtml;

  // Result
  var resHtml='';
  if(result&&result.isFinished&&result.results&&result.results.length>0){
    var places=result.results.slice().sort(function(a,b){return a.place-b.place});
    resHtml='<div class="result-box"><div class="result-title">レース結果</div>';
    resHtml+='<div class="result-places">';
    places.slice(0,3).forEach(function(p){resHtml+=p.place+'着'+boatBadge(p.racer_boat_number)+' '});
    resHtml+='</div>';
    if(result.technique_number) resHtml+='<div style="font-size:11px;margin-bottom:6px">決まり手: <b>'+(TECHNIQUE[result.technique_number]||'---')+'</b></div>';
    if(result.refund){
      ['trifecta','trio','exacta'].forEach(function(type){
        var label=type==='trifecta'?'3連単':type==='trio'?'3連複':'2連単';
        if(result.refund[type]){
          result.refund[type].forEach(function(r){
            resHtml+='<div class="refund-row"><span class="refund-label">'+label+' '+r.combination+'</span><span class="refund-val">\\'+((r.amount||r.payout||0).toLocaleString())+'</span></div>';
          });
        }
      });
    }
    if(pred){
      var actualCombo=places[0].racer_boat_number+'-'+places[1].racer_boat_number+'-'+places[2].racer_boat_number;
      var hit=pred.trifecta.some(function(t){return t.combo===actualCombo});
      resHtml+='<div style="margin-top:8px;font-size:14px;font-weight:700;text-align:center" class="'+(hit?'hit':'miss')+'">'+(hit?'3連単 的中!':'不的中')+'</div>';
    }
    resHtml+='</div>';
  }
  document.getElementById('detailResult').innerHTML=resHtml;

  // ==========================================
  // 3a. Macour-style 出走表テーブル (horizontal, label column on right, sticky)
  // ==========================================
  var boatsHtml='';
  if(race&&race.boats&&Array.isArray(race.boats)){
    var boatMap={};
    race.boats.forEach(function(bt){boatMap[bt.racer_boat_number]=bt});
    var pvMap={};
    if(preview&&preview.boats){
      for(var pi=1;pi<=6;pi++){if(preview.boats[String(pi)]) pvMap[pi]=preview.boats[String(pi)]}
    }

    // Compute ET/ST ranks for highlighting
    var etTimes=[],stTimes=[];
    for(var ri=1;ri<=6;ri++){
      var pvi=pvMap[ri];
      etTimes.push({boat:ri,val:(pvi&&pvi.racer_exhibition_time!=null&&pvi.racer_exhibition_time>0)?pf(pvi.racer_exhibition_time):999});
      stTimes.push({boat:ri,val:(pvi&&pvi.racer_start_timing!=null)?pf(pvi.racer_start_timing):999});
    }
    etTimes.sort(function(a,b){return a.val-b.val});
    stTimes.sort(function(a,b){return a.val-b.val});
    var etRankMap={},stRankMap={};
    etTimes.forEach(function(e,i){etRankMap[e.boat]=i});
    stTimes.forEach(function(e,i){stRankMap[e.boat]=i});

    boatsHtml='<div class="section-title">出走表</div>';
    boatsHtml+='<div class="detail-table-wrap"><table class="detail-table">';

    // Row 0: 枠番ヘッダー (boat colors)
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      boatsHtml+='<td class="boat-col-header" style="background:'+BOAT_COLORS[bn]+';color:'+BOAT_TEXT[bn]+';border:1px solid '+(bn===1?'#ccc':'transparent')+'">'+bn+'号艇</td>';
    }
    boatsHtml+='<th>枠</th></tr>';

    // Row 1: 級別
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var cn=bt.racer_class_number||4;
      boatsHtml+='<td><span style="background:'+CLASS_COLOR[cn]+';color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700">'+CLASS_NAME[cn]+'</span></td>';
    }
    boatsHtml+='<th>級</th></tr>';

    // Row 2: 登番 + 期(unavailable, show "-")
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var rid=bt.racer_number||0;
      boatsHtml+='<td><b>'+rid+'</b> <span style="font-size:9px;color:var(--text-dim)">-期</span></td>';
    }
    boatsHtml+='<th>登番</th></tr>';

    // Row 3: 選手名 (bold, colored by boat number, 16px)
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var nameColor=bn===1?'var(--text)':BOAT_COLORS[bn];
      if(bn===5) nameColor='#B8860B';
      var m=pred?pred.marks.find(function(x){return x.boat===bn}):null;
      var markStr=m?' <span style="font-size:10px;color:var(--accent)">'+m.mark+'</span>':'';
      var rid=bt.racer_number||0;
      var photoHtml=rid?'<img class="racer-photo" src="data/photos/'+rid+'.jpg" loading="lazy" alt="" onerror="this.dataset.broken=\'1\'">':'';
      boatsHtml+='<td>'+photoHtml+'<span style="font-weight:700;font-size:13px;color:'+nameColor+'">'+escText(bt.racer_name||'')+'</span>'+markStr+'</td>';
    }
    boatsHtml+='<th>選手</th></tr>';

    // Row 4: 年齢 + 支部 + 体重
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var age=bt.racer_age||'-';
      var branch=bt.racer_branch_name||'-';
      var weight=bt.racer_weight||'-';
      boatsHtml+='<td style="font-size:10px">'+age+'歳/'+escText(branch)+'<br>'+weight+'kg</td>';
    }
    boatsHtml+='<th>年齢等</th></tr>';

    // Row 5: バッジ
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var form=getRacerForm(bt.racer_number||0);
      // X1: 妙味バッジ用に divergence を渡す
      var div = (pred && pred.divergence) ? pred.divergence[bn] : null;
      var badges=racerBadges(bt,form,div);
      boatsHtml+='<td>'+(badges||'-')+'</td>';
    }
    boatsHtml+='<th>特徴</th></tr>';

    // Row 6: モーター評価 A-E
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var mr=pf(bt.racer_assigned_motor_top_2_percent);
      var me=motorEvalGrade(mr);
      boatsHtml+='<td><span class="'+me.cls+'">'+me.grade+'</span> <span style="font-size:9px;color:var(--text-sub)">'+me.label+'</span></td>';
    }
    boatsHtml+='<th>モーター</th></tr>';

    // Row 7: 全国勝率 + 2連率 (highlight pink if >=6.0)
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var wr=pf(bt.racer_national_top_1_percent);
      var t2=pf(bt.racer_national_top_2_percent);
      var hlCls=(wr>=6.0)?'hl-pink':'';
      boatsHtml+='<td class="'+hlCls+'"><b>'+wr.toFixed(2)+'</b><br><span style="font-size:9px">2連:'+t2.toFixed(1)+'%</span></td>';
    }
    boatsHtml+='<th>全国勝率</th></tr>';

    // Row 8: 当地勝率 + 2連率
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var lwr=pf(bt.racer_local_top_1_percent);
      var lt2=pf(bt.racer_local_top_2_percent);
      var hlCls=(lwr>=6.0)?'hl-pink':'';
      boatsHtml+='<td class="'+hlCls+'"><b>'+lwr.toFixed(2)+'</b><br><span style="font-size:9px">2連:'+lt2.toFixed(1)+'%</span></td>';
    }
    boatsHtml+='<th>当地勝率</th></tr>';

    // Row 9: 平均ST
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var avgSt=pf(bt.racer_average_start_timing);
      boatsHtml+='<td>'+(bt.racer_average_start_timing!=null?avgSt.toFixed(2):'---')+'</td>';
    }
    boatsHtml+='<th>平均ST</th></tr>';

    // Row 10: モーター番号 + 2連率 (highlight pink if >=40%)
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var mNum=bt.racer_assigned_motor_number||'-';
      var mr2=pf(bt.racer_assigned_motor_top_2_percent);
      var hlCls=(mr2>=40)?'hl-pink':'';
      boatsHtml+='<td class="'+hlCls+'"><b>'+mNum+'</b><br><span style="font-size:9px">'+mr2.toFixed(1)+'%</span></td>';
    }
    boatsHtml+='<th>モーター</th></tr>';

    // Row 11: ボート番号 + 2連率 (highlight pink if >=40%)
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var bNum=bt.racer_assigned_boat_number||'-';
      var br2=pf(bt.racer_assigned_boat_top_2_percent);
      var hlCls=(br2>=40)?'hl-pink':'';
      boatsHtml+='<td class="'+hlCls+'"><b>'+bNum+'</b><br><span style="font-size:9px">'+br2.toFixed(1)+'%</span></td>';
    }
    boatsHtml+='<th>ボート</th></tr>';

    // Row 12: F/L count
    boatsHtml+='<tr>';
    for(var bn=1;bn<=6;bn++){
      var bt=boatMap[bn];
      if(!bt){boatsHtml+='<td>-</td>';continue}
      var fc=bt.racer_flying_count||0;
      var lc=bt.racer_late_start_count_in_current_term||0;
      var flStr='F'+fc+'/L'+lc;
      if(fc>0) flStr='<span style="color:var(--danger);font-weight:700">F'+fc+'</span>/L'+lc;
      boatsHtml+='<td>'+flStr+'</td>';
    }
    boatsHtml+='<th>F/L</th></tr>';

    // F16: 今節成績 (Macool 風) — 14 cells (= 7 days × 2 slots) を縦並べ
    if(rdForRace&&rdForRace.boats){
      var boatsSeries = [];
      var maxNonNull = 0;
      for(var bn=1;bn<=6;bn++){
        var bt=boatMap[bn];
        var rid=bt?bt.racer_number||0:0;
        var rdBoat=rdForRace.boats?rdForRace.boats.find(function(rb){return rb.boat_number===bn||rb.racer_number===rid}):null;
        var arr = rdBoat ? (rdBoat.current_series_results || []) : [];
        boatsSeries.push(arr);
        for(var i=0;i<arr.length;i++){
          if(arr[i] != null && i+1 > maxNonNull) maxNonNull = i+1;
        }
      }
      if(maxNonNull > 0){
        var pairs = Math.ceil(maxNonNull / 2);
        var DAY_LABELS = ['初日','2日目','3日目','4日目','5日目','準優','最終'];
        for(var p=0; p<pairs; p++){
          for(var slot=0; slot<2; slot++){
            var idx = p*2 + slot;
            if(idx >= maxNonNull) break;
            boatsHtml+='<tr>';
            for(var bi=0; bi<6; bi++){
              boatsHtml += renderSeriesCell(boatsSeries[bi][idx]);
            }
            if(slot === 0){
              var rs = (idx+1 < maxNonNull) ? 2 : 1;
              boatsHtml += '<th rowspan="'+rs+'" class="series-day-th">'+(DAY_LABELS[p]||(p+1)+'日目')+'</th>';
            }
            boatsHtml += '</tr>';
          }
        }
      }
    }

    boatsHtml+='</table></div>';
  }
  document.getElementById('detailBoats').innerHTML=boatsHtml;

  // ==========================================
  // 3b. 展示情報テーブル
  // ==========================================
  var exhHtml='';
  if(preview&&preview.boats){
    exhHtml='<div class="section-title">展示情報</div>';
    exhHtml+='<div class="detail-table-wrap"><table class="exhibition-table">';
    // F12: 展示テーブルに「持ペラ / 部品交換 / 調整重量」を追加
    exhHtml+='<thead><tr><th>枠</th><th>ST</th><th>展示</th><th>チルト</th><th>整備</th><th>調整</th></tr></thead><tbody>';

    for(var bn=1;bn<=6;bn++){
      var pv=pvMap[bn];
      var stVal=(pv&&pv.racer_start_timing!=null)?pv.racer_start_timing:null;
      var etVal=(pv&&pv.racer_exhibition_time!=null&&pv.racer_exhibition_time>0)?pv.racer_exhibition_time:null;
      var tiltVal=(pv&&pv.racer_tilt_adjustment!=null)?pv.racer_tilt_adjustment:null;
      var propVal=(pv&&pv.racer_propeller)?pv.racer_propeller:'';
      var partsVal=(pv&&pv.racer_parts_replaced)?pv.racer_parts_replaced:'';
      var adjVal=(pv&&pv.racer_adjust_weight!=null)?pv.racer_adjust_weight:0;

      // Rank coloring for ET
      var etRk=etRankMap[bn];
      var etCls=etRk===0?'hl-rank1':etRk===1?'hl-rank2':etRk===2?'hl-rank3':'';
      // Rank coloring for ST
      var stRk=stRankMap[bn];
      var stCls=stRk===0?'hl-rank1':stRk===1?'hl-rank2':stRk===2?'hl-rank3':'';

      var stDisp=stVal!==null?('.'+String(Math.abs(pf(stVal)*100).toFixed(0)).padStart(2,'0')):'---';
      if(stVal!==null&&pf(stVal)<0) stDisp='F'+stDisp;

      // 整備表示: プロペラと部品交換の合成
      var maintDisp = '';
      if(propVal) maintDisp += '<span style="background:#FFF3E0;color:#E65100;padding:1px 4px;border-radius:2px;font-size:9px">P'+escText(propVal)+'</span> ';
      if(partsVal) maintDisp += '<span style="background:#E3F2FD;color:#1565C0;padding:1px 4px;border-radius:2px;font-size:9px;font-weight:700">⚙'+escText(partsVal)+'</span>';
      if(!maintDisp) maintDisp = '<span style="color:#CCC">-</span>';

      // 調整重量: > 0 なら警告色
      var adjDisp = adjVal > 0
        ? '<span style="color:var(--warn);font-weight:700">+'+adjVal.toFixed(1)+'</span>'
        : '<span style="color:#CCC">-</span>';

      exhHtml+='<tr>';
      exhHtml+='<td style="background:'+BOAT_COLORS[bn]+';color:'+BOAT_TEXT[bn]+';font-weight:700;border:1px solid '+(bn===1?'#ccc':'transparent')+'">'+bn+'</td>';
      exhHtml+='<td class="'+stCls+'">'+stDisp+'</td>';
      exhHtml+='<td class="'+etCls+'">'+(etVal!==null?etVal:'---')+'</td>';
      exhHtml+='<td>'+(tiltVal!==null?tiltVal:'---')+'</td>';
      exhHtml+='<td style="font-size:9px">'+maintDisp+'</td>';
      exhHtml+='<td>'+adjDisp+'</td>';
      exhHtml+='</tr>';
    }
    exhHtml+='</tbody></table></div>';
    // 注記: 公式に存在しない情報（まわり足/直線/1周/ピット）は専門紙でのみ取得可能
    exhHtml+='<div style="font-size:9px;color:var(--text-dim);margin-top:4px">※ まわり足・1周・直線・ピット離れは boatrace.jp 公式に非公開（マクール等専門紙のみ）</div>';

    // Course entry grid
    if(preview.boats){
      var courseEntries=[];
      var hasCourse=false;
      for(var ci=1;ci<=6;ci++){
        var cpv=preview.boats[String(ci)];
        var cn=(cpv&&cpv.racer_course_number!=null)?cpv.racer_course_number:ci;
        if(cpv&&cpv.racer_course_number!=null) hasCourse=true;
        courseEntries.push({boat:ci,course:cn});
      }
      if(hasCourse){
        courseEntries.sort(function(a,b){return a.course-b.course});
        exhHtml+='<div style="margin:8px 0;text-align:center;font-size:11px;font-weight:700;color:var(--text-sub)">進入コース</div>';
        exhHtml+='<div class="course-grid">';
        courseEntries.forEach(function(e){
          exhHtml+='<div class="course-entry" style="background:'+BOAT_COLORS[e.boat]+';color:'+BOAT_TEXT[e.boat]+';border:1px solid '+(e.boat===1?'#ccc':'transparent')+'">'+e.boat+'</div>';
        });
        exhHtml+='</div>';
      }
    }
  }
  document.getElementById('detailExhibition').innerHTML=exhHtml;

  // ==========================================
  // 3c. 2段階AI予想セクション（番組予想 + 直前予想）
  // ==========================================
  var predHtml='';
  var progPred=predictRaceProgram(sid,parseInt(rn));
  var boats=race&&race.boats?race.boats:[];

  // ========= 番組予想 =========
  if(progPred){
    predHtml+='<div style="background:#F0F4FF;border:1px solid #C5CAE9;border-radius:10px;padding:12px;margin:8px 0">';
    predHtml+='<div style="font-weight:700;font-size:14px;color:#1A237E;margin-bottom:8px">番組予想 <span style="font-size:11px;color:#666;font-weight:400">出走表データのみ</span></div>';
    progPred.marks.forEach(function(m,i){
      if(i>=4) return;
      var boatInfo=boats.find(function(b){return b.racer_boat_number===m.boat});
      var nm=boatInfo?(boatInfo.racer_name||'').split(/\s|\u3000/)[0]:'';
      var probPct=Math.round(m.prob*100);
      predHtml+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px">';
      predHtml+='<span style="font-weight:700;width:20px">'+m.mark+'</span>';
      predHtml+=boatBadge(m.boat);
      predHtml+='<span>'+escText(nm)+'</span>';
      predHtml+='<span style="font-family:monospace;color:#1A237E;font-weight:700;margin-left:auto">'+probPct+'%</span>';
      predHtml+='</div>';
    });
    var progTypeIcon=progPred.raceType==='honmei'?'⚡':progPred.raceType==='ana'?'🔥':'📊';
    predHtml+='<div style="font-size:11px;color:#666;margin-top:6px">'+progTypeIcon+progPred.typeLabel+'  信頼度: '+progPred.confidence+'%</div>';
    if(progPred.marks[0].reasons&&progPred.marks[0].reasons.length>0){
      predHtml+='<div style="font-size:11px;color:#555;margin-top:6px;padding:6px;background:#E8EAF6;border-radius:6px">';
      progPred.marks[0].reasons.slice(0,3).forEach(function(r){predHtml+='<div>・'+escText(r)+'</div>'});
      predHtml+='</div>';
    }
    predHtml+='</div>';
  }

  // ========= 直前予想 =========
  var hasRealPreview=false;
  if(preview&&preview.boats){
    for(var pk in preview.boats){if(preview.boats[pk]&&preview.boats[pk].racer_exhibition_time!=null){hasRealPreview=true;break}}
  }

  predHtml+='<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:12px;margin:8px 0">';
  predHtml+='<div style="font-weight:700;font-size:14px;color:#E65100;margin-bottom:8px">直前予想 <span style="font-size:11px;color:#666;font-weight:400">展示航走反映</span></div>';

  if(hasRealPreview&&pred){
    var diff=comparePredictions(progPred,pred);
    pred.marks.forEach(function(m,i){
      if(i>=4) return;
      var boatInfo=boats.find(function(b){return b.racer_boat_number===m.boat});
      var nm=boatInfo?(boatInfo.racer_name||'').split(/\s|\u3000/)[0]:'';
      var probPct=Math.round(m.prob*100);
      var change=diff?diff.changes.find(function(c){return c.boat===m.boat}):null;
      var diffStr='';
      if(change&&change.rankDiff>0){
        diffStr=' <span style="color:#43A047;font-size:11px;font-weight:700">↑+'+Math.round(change.probDiff*100)+'%</span>';
      } else if(change&&change.rankDiff<0){
        diffStr=' <span style="color:#E53935;font-size:11px;font-weight:700">↓'+Math.round(change.probDiff*100)+'%</span>';
      }
      predHtml+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px">';
      predHtml+='<span style="font-weight:700;width:20px">'+m.mark+'</span>';
      predHtml+=boatBadge(m.boat);
      predHtml+='<span>'+escText(nm)+'</span>';
      predHtml+='<span style="font-family:monospace;color:#E65100;font-weight:700;margin-left:auto">'+probPct+'%</span>';
      predHtml+=diffStr;
      predHtml+='</div>';
    });
    var liveTypeIcon=pred.raceType==='honmei'?'⚡':pred.raceType==='ana'?'🔥':'📊';
    predHtml+='<div style="font-size:11px;color:#666;margin-top:6px">'+liveTypeIcon+pred.typeLabel+'  信頼度: '+starsHtml(pred.confStars)+' '+pred.confidence+'%</div>';
    // X5: シナリオ確率表示
    if(pred.scenarios){
      var scen = pred.scenarios;
      var scenLabels = {nige:'逃げ', sashi:'差し', makuri:'まくり', makuriSashi:'まくり差し', other:'穴'};
      var scenStr = '';
      Object.keys(scen).forEach(function(k){
        if(scen[k] >= 0.05){
          var pct = (scen[k] * 100).toFixed(0);
          scenStr += '<span style="margin-right:8px"><b>'+scenLabels[k]+'</b> '+pct+'%</span>';
        }
      });
      predHtml+='<div style="font-size:10px;color:#666;margin-top:4px;padding:4px 6px;background:#F5F5F5;border-radius:4px">想定展開: '+scenStr+'</div>';
    }

    // 展示による変動サマリー
    if(diff){
      var hasChange=diff.changes.some(function(c){return c.rankDiff!==0});
      if(hasChange){
        predHtml+='<div style="font-size:11px;margin-top:8px;padding:6px;background:#FFF3E0;border-radius:6px">';
        predHtml+='<div style="font-weight:700;color:#E65100;margin-bottom:4px">展示による変動</div>';
        diff.changes.forEach(function(c){
          if(c.rankDiff>0){
            var reasons=c.addedReasons.length>0?c.addedReasons.slice(0,2).join(', '):'展示好調';
            predHtml+='<div style="color:#2E7D32">↑ '+c.boat+'号艇: '+escText(reasons)+'</div>';
          } else if(c.rankDiff<0){
            var risks=c.addedRisks.length>0?c.addedRisks.slice(0,2).join(', '):'展示不調';
            predHtml+='<div style="color:#C62828">↓ '+c.boat+'号艇: '+escText(risks)+'</div>';
          }
        });
        if(diff.typeChanged){
          predHtml+='<div style="color:#D84315;font-weight:700;margin-top:4px">⚠ '+diff.progType+' → '+diff.liveType+' に変化</div>';
        }
        predHtml+='</div>';
      }
    }

    // AI vs popularity divergence
    if(popularity&&pred.marks.length>0){
      var aiTop=pred.marks[0].boat;
      var popTop=popularity[0]?popularity[0].boat:0;
      if(aiTop!==popTop&&popTop>0){
        predHtml+='<div style="font-size:11px;color:var(--warn);margin:6px 0;padding:6px;background:#FFF8E1;border:1px solid #FFE0B2;border-radius:6px">AI予想◎'+aiTop+'号艇 vs 1番人気'+popTop+'号艇 -- 逆張り注目</div>';
      }
    }
  } else {
    // 直前情報なし
    predHtml+='<div style="text-align:center;padding:16px;color:#999">';
    predHtml+='<div style="font-size:24px;margin-bottom:8px">⏳</div>';
    predHtml+='<div style="font-size:12px">展示航走後に更新されます</div>';
    predHtml+='<div style="font-size:10px;color:#BBB;margin-top:4px">レース開始約30分前に直前情報が配信されます</div>';
    predHtml+='</div>';
  }
  predHtml+='</div>';

  // ========= 買い目（直前予想ベースを優先） =========
  var activePred=(hasRealPreview&&pred)?pred:null;
  var activePredLabel=hasRealPreview?'直前予想':'番組予想';
  if(activePred||progPred){
    predHtml+='<div style="background:var(--card-bg);border:2px solid var(--accent);border-radius:10px;padding:12px;margin:8px 0">';
    predHtml+='<div style="font-weight:700;font-size:14px;color:var(--accent);margin-bottom:8px">推奨買い目 <span style="font-size:10px;color:var(--text-dim);font-weight:400">★'+activePredLabel+'ベース</span></div>';

    if(activePred&&activePred.trifecta){
      // 直前予想の買い目
      predHtml+='<div class="bet-label">3連単推奨 <span class="bet-method">['+escText(activePred.methodLabel||'')+']</span></div><div class="bet-combos">';
      activePred.trifecta.forEach(function(t){
        var odds3=t.odds || (raceOdds&&raceOdds.trifecta?raceOdds.trifecta[t.combo]:null);
        var ev3 = t.ev != null ? t.ev : (odds3?calcEV(t.prob,odds3):null);
        var evHtml=evBadge(ev3);
        var oddsStr=odds3?'<span class="odds-val"> '+odds3+'倍</span>':'';
        // X1: EV モードの場合、Kelly 配分（円）を表示
        var stakeStr = t.stakeYen ? '<span style="font-size:9px;color:var(--accent);font-weight:700;margin-left:4px">¥'+t.stakeYen.toLocaleString()+'</span>' : '';
        predHtml+='<span class="bet-chip">'+t.combo+' <span style="font-size:9px;color:var(--text-dim)">'+(t.prob*100).toFixed(1)+'%</span>'+oddsStr+evHtml+stakeStr+'</span>';
      });
      predHtml+='</div>';
      // X1: EV モード時の合計投資額表示
      if(activePred.evApplied){
        var totalStake = activePred.trifecta.reduce(function(a,t){return a+(t.stakeYen||0)},0);
        predHtml+='<div style="font-size:10px;color:var(--accent);margin-top:4px">EV ベース投資合計: ¥'+totalStake.toLocaleString()+'</div>';
      }
      if(!raceOdds) predHtml+='<div style="font-size:9px;color:var(--text-dim);margin-bottom:6px">オッズ未取得 -- 確率ベースの推定値</div>';
      predHtml+='<div class="bet-label">2連単推奨</div><div class="bet-combos">';
      activePred.exacta.forEach(function(t){predHtml+='<span class="bet-chip">'+t.combo+'</span>'});
      predHtml+='</div>';
    } else if(progPred){
      // 番組予想ベースの買い目
      var betCount3=parseInt(settings.betCount3)||10;
      var betCount2=parseInt(settings.betCount2)||5;
      var method=settings.betMethod||'auto';
      if(method==='auto'){
        if(progPred.raceType==='honmei') method='prob';
        else if(progPred.raceType==='ana') method='box';
        else method='formation';
      }
      var progBets=generateBetsV2(progPred.marks,method,betCount3,betCount2);
      predHtml+='<div class="bet-label">3連単推奨</div><div class="bet-combos">';
      progBets.trifecta.forEach(function(t){
        predHtml+='<span class="bet-chip">'+t.combo+' <span style="font-size:9px;color:var(--text-dim)">'+(t.prob*100).toFixed(1)+'%</span></span>';
      });
      predHtml+='</div>';
      predHtml+='<div class="bet-label">2連単推奨</div><div class="bet-combos">';
      progBets.exacta.forEach(function(t){predHtml+='<span class="bet-chip">'+t.combo+'</span>'});
      predHtml+='</div>';
      predHtml+='<div style="font-size:10px;color:#FF9800;margin-top:6px">※展示航走後に最終版の買い目に更新されます</div>';
    }
    predHtml+='</div>';
  }
  document.getElementById('detailPrediction').innerHTML=predHtml;

  // ==========================================
  // 3d + 3e + 3f. Odds sections
  // ==========================================
  document.getElementById('detailOdds').innerHTML=renderOddsSection(sid,rn,raceOdds,pred,race);

  showPage('detail');
}

// ===============================================
// Macour-style Odds Section (3d trifecta + 3e exacta + 3f controls)
// ===============================================
function renderOddsSection(sid,rn,raceOdds,pred,race){
  if(!raceOdds) return'';
  var html='';

  // Build boat name map
  var boatNames={};
  if(race&&race.boats){
    race.boats.forEach(function(bt){
      boatNames[bt.racer_boat_number]=familyName(bt.racer_name);
    });
  }

  // 3d. 3連単オッズテーブル (Macour-exact)
  if(raceOdds.trifecta){
    html+='<div class="odds-section">';
    html+='<div class="odds-section-header"><span class="odds-section-title">3連単オッズ</span></div>';
    html+='<div class="detail-table-wrap"><table class="trifecta-macour">';

    // Header: 左端「2着」ラベル + 6 columns(1着)（右端の冗長ラベル列は撤去）
    html+='<thead><tr>';
    html+='<th class="left-col" style="font-size:10px;color:#999">2着</th>';
    for(var first=1;first<=6;first++){
      var hName=boatNames[first]||first;
      html+='<th style="background:'+BOAT_COLORS[first]+';color:'+BOAT_TEXT[first]+';border:1px solid '+(first===1?'#ccc':'transparent')+'">'+first+'.'+escText(hName)+'</th>';
    }
    html+='</tr></thead><tbody>';

    // 2着は固定順(1,2,3,4,5,6)で回す。1着と同じ番号はスキップ。
    // 全列で同じ2着・3着の並びにする（右端列で明示）
    // 2着の候補: 1-6の固定順
    var allBoatNums=[1,2,3,4,5,6];

    for(var second=1;second<=6;second++){
      // 3着の候補: 1-6から1着(列ごとに異なる)と2着を除いた残り → 固定順で並べる
      var thirdsForLabel=allBoatNums.filter(function(b){return b!==second});
      // ただし各列の1着も除くので3着は列ごとに異なる → 右端ラベルは2着番号のみ表示
      for(var ti=0;ti<4;ti++){
        // この行で表示する3着候補（固定順のti番目、ただし1着と2着を除く）
        var isGroupStart=(ti===0);
        var isAlt=(second%2===0);

        html+='<tr'+(isAlt?' class="alt-bg"':'')+'>';

        // 左端「2着」号艇列（グループ先頭のみバッジ、罫線なし）
        var leftLabel='';
        if(isGroupStart){
          leftLabel='<span style="display:inline-block;width:18px;height:18px;line-height:18px;background:'+BOAT_COLORS[second]+';color:'+BOAT_TEXT[second]+';text-align:center;border-radius:3px;font-size:11px;font-weight:700;border:1px solid '+(second===1?'#ccc':'transparent')+'">'+second+'</span>';
        }
        html+='<td class="left-col">'+leftLabel+'</td>';

        for(var first=1;first<=6;first++){
          if(first===second){
            html+='<td class="'+(isGroupStart?'group-sep':'')+'" style="background:#E8E8E8"></td>';
            continue;
          }
          var thirds=allBoatNums.filter(function(b){return b!==first&&b!==second});
          if(ti>=thirds.length){
            html+='<td class="'+(isGroupStart?'group-sep':'')+'" style="text-align:center;color:#CCC">-</td>';
            continue;
          }
          var thirdBoat=thirds[ti];
          var combo=first+'-'+second+'-'+thirdBoat;
          var oddsVal=raceOdds.trifecta[combo];

          var cellClass=isGroupStart?'group-sep':'';
          var oddsClass='';
          if(oddsVal){
            if(oddsVal<=10) oddsClass='odds-low';
            else if(oddsVal>=100) oddsClass='odds-high';
          }

          var badge='<span class="badge" style="display:inline-block;width:12px;height:12px;line-height:12px;background:'+BOAT_COLORS[thirdBoat]+';color:'+BOAT_TEXT[thirdBoat]+';text-align:center;border-radius:2px;font-size:9px;font-weight:700;border:1px solid '+(thirdBoat===1?'#ccc':'transparent')+'">'+thirdBoat+'</span>';

          var oddsStr=oddsVal?oddsVal.toFixed(1):'-';
          html+='<td class="'+cellClass+'"><div class="cell-flex">'+badge+'<span class="odds '+oddsClass+'">'+oddsStr+'</span></div></td>';
        }

        html+='</tr>';
      }
    }

    html+='</tbody></table></div></div>';
  }

  // 3e. 2連単オッズ 6x6 matrix
  if(raceOdds.exacta){
    html+='<div class="odds-section">';
    html+='<div class="odds-section-header"><span class="odds-section-title">2連単オッズ</span></div>';
    html+='<div class="detail-table-wrap"><table class="exacta-matrix">';
    html+='<thead><tr><th style="background:#F8F8F8">1着＼2着</th>';
    for(var c=1;c<=6;c++){
      html+='<th style="background:'+BOAT_COLORS[c]+';color:'+BOAT_TEXT[c]+';border:1px solid '+(c===1?'#ccc':'transparent')+'">'+c+'</th>';
    }
    html+='</tr></thead><tbody>';

    for(var row=1;row<=6;row++){
      html+='<tr>';
      html+='<td style="background:'+BOAT_COLORS[row]+';color:'+BOAT_TEXT[row]+';font-weight:700;border:1px solid '+(row===1?'#ccc':'transparent')+'">'+row+'</td>';
      for(var col=1;col<=6;col++){
        if(row===col){
          html+='<td class="diag">-</td>';
        } else {
          var eCombo=row+'-'+col;
          var eOdds=raceOdds.exacta[eCombo];
          var eCls='';
          if(eOdds){
            if(eOdds<=10) eCls='odds-low';
            else if(eOdds>=100) eCls='odds-high';
          }
          html+='<td><span class="'+eCls+'">'+(eOdds||'-')+'</span></td>';
        }
      }
      html+='</tr>';
    }
    html+='</tbody></table></div></div>';
  }

  // 3f. Odds refresh + auto-refresh timer + PAT settings link
  html+='<div class="odds-section" style="text-align:center">';
  html+='<button class="odds-refresh-btn" onclick="refreshOdds()">オッズ更新</button>';
  html+=' <span class="odds-stale" id="oddsStaleMsg2"></span>';
  if(oddsLastFetched){
    var elapsed=Math.round((Date.now()-oddsLastFetched)/60000);
    html+=' <span style="font-size:9px;color:var(--text-dim)">'+elapsed+'分前更新</span>';
  }
  html+='<div style="font-size:9px;color:var(--text-dim);margin-top:4px">自動更新: 5分間隔</div>';
  html+='</div>';

  return html;
}

// ===============================================
// SCREEN 4: STATS - 本日詳細 + 場別全表示 (F16 全面書き直し)
// ===============================================
// 過去全期間の累計表示は削除し、本日のみの詳細に統一
//   ・サマリ: 本日のレース数 / 3連単的中 / 3連単率
//   ・券種別: 3連単 / 2連単 の的中数 / 投資 / 払戻 / 回収率
//   ・レースタイプ別: 本命 / 混戦 / 穴 ごとの的中率 / 回収率
//   ・場別 (全場): 場ごとに R数 / 3連単的中 / 投資 / 払戻 / 回収率
function calcTodayStats(){
  if(typeof _migrateDropStaleTodayHistory==='function') _migrateDropStaleTodayHistory();
  if(typeof _cleanStaleHistoryToday==='function') _cleanStaleHistoryToday();
  var today=todayStr();
  var history=safeParse('boatrace_history', []);   // PA-5
  var verified=history.filter(function(h){return h.date===today && h.actual && h.actual.length>0});

  var betCount3=parseInt(settings.betCount3)||10;
  var betCount2=parseInt(settings.betCount2)||5;
  var unitBet=100;

  var tri={hits:0, invest:0, payout:0};
  var exa={hits:0, invest:0, payout:0};
  var typeStats={honmei:{total:0,hit3:0,payout3:0,invest:0}, middle:{total:0,hit3:0,payout3:0,invest:0}, ana:{total:0,hit3:0,payout3:0,invest:0}};
  var stadiumStats={};
  // F18: 的中フラグはあるが payout が 0 / 未取得のレースを検出
  var warnings = { tri_zero: [], exa_zero: [] };

  verified.forEach(function(h){
    var triInvest=betCount3*unitBet;
    var exaInvest=betCount2*unitBet;
    tri.invest+=triInvest;
    exa.invest+=exaInvest;
    if(h.trifecta_hit){
      tri.hits++;
      tri.payout+=(h.payout3||0);
      if(!h.payout3 || h.payout3 === 0){
        warnings.tri_zero.push((STADIUMS[parseInt(h.stadium)]||('場'+h.stadium))+' '+h.race+'R');
      }
    }
    if(h.exacta_hit){
      exa.hits++;
      exa.payout+=(h.payout2||0);
      if(!h.payout2 || h.payout2 === 0){
        warnings.exa_zero.push((STADIUMS[parseInt(h.stadium)]||('場'+h.stadium))+' '+h.race+'R');
      }
    }

    var t=h.raceType||'middle';
    if(!typeStats[t]) typeStats[t]={total:0,hit3:0,payout3:0,invest:0};
    typeStats[t].total++;
    typeStats[t].invest+=triInvest;
    if(h.trifecta_hit){ typeStats[t].hit3++; typeStats[t].payout3+=(h.payout3||0); }

    var sid=parseInt(h.stadium);
    var sName=STADIUMS[sid]||('場'+sid);
    if(!stadiumStats[sid]) stadiumStats[sid]={sid:sid, name:sName, total:0, hit3:0, hit2:0, invest3:0, invest2:0, payout3:0, payout2:0};
    var ss=stadiumStats[sid];
    ss.total++;
    ss.invest3+=triInvest;
    ss.invest2+=exaInvest;
    if(h.trifecta_hit){ ss.hit3++; ss.payout3+=(h.payout3||0); }
    if(h.exacta_hit){  ss.hit2++; ss.payout2+=(h.payout2||0); }
  });

  return {
    today:today, total:verified.length, tri:tri, exa:exa,
    typeStats:typeStats, stadiumStats:stadiumStats,
    warnings:warnings,
    unitBet:unitBet, betCount3:betCount3, betCount2:betCount2,
  };
}

function _rateColor(rate){
  if(rate>=100) return 'recovery-positive';
  if(rate>=80)  return '';
  return 'recovery-negative';
}

function renderStats(){
  // PF-3: 成績タブ open 時に backfill を即時実行（lazy 起動）
  if(typeof _runLazyBackfillOnce === 'function') _runLazyBackfillOnce('stats tab opened');
  var s=calcTodayStats();

  // ヘッダ: 本日サマリ
  var triRate3=s.tri.invest>0?Math.round(s.tri.payout/s.tri.invest*100):0;
  var trifectaRate=s.total>0?(s.tri.hits/s.total*100).toFixed(1):'0.0';
  document.getElementById('statSummary').innerHTML=
    '<div class="stat-card"><div class="stat-num" style="color:var(--accent)">'+s.total+'</div><div class="stat-label">本日 判定済</div></div>'
    +'<div class="stat-card"><div class="stat-num" style="color:var(--gold)">'+s.tri.hits+'</div><div class="stat-label">3連単的中</div></div>'
    +'<div class="stat-card"><div class="stat-num" style="color:'+(triRate3>=100?'var(--success)':'var(--danger)')+'">'+triRate3+'%</div><div class="stat-label">3連単回収率</div></div>';

  var recHtml='';

  // 券種別 (本日)
  recHtml+='<div class="card" style="padding:0;overflow:hidden">';
  recHtml+='<div style="padding:10px 12px;font-weight:700;font-size:13px;border-bottom:1px solid var(--border)">本日 券種別</div>';
  recHtml+='<table class="recovery-table">';
  recHtml+='<thead><tr><th>券種</th><th>的中</th><th>投資</th><th>回収</th><th>回収率</th></tr></thead><tbody>';
  var triR=s.tri.invest>0?Math.round(s.tri.payout/s.tri.invest*100):0;
  var exaR=s.exa.invest>0?Math.round(s.exa.payout/s.exa.invest*100):0;
  var triHitRate=s.total>0?(s.tri.hits/s.total*100).toFixed(0):'-';
  var exaHitRate=s.total>0?(s.exa.hits/s.total*100).toFixed(0):'-';
  recHtml+='<tr><td><b>3連単</b></td><td>'+s.tri.hits+' ('+triHitRate+'%)</td><td>¥'+s.tri.invest.toLocaleString()+'</td><td>¥'+s.tri.payout.toLocaleString()+'</td><td class="'+_rateColor(triR)+'">'+triR+'%</td></tr>';
  recHtml+='<tr><td><b>2連単</b></td><td>'+s.exa.hits+' ('+exaHitRate+'%)</td><td>¥'+s.exa.invest.toLocaleString()+'</td><td>¥'+s.exa.payout.toLocaleString()+'</td><td class="'+_rateColor(exaR)+'">'+exaR+'%</td></tr>';
  // 合計行
  var totInv=s.tri.invest+s.exa.invest;
  var totPay=s.tri.payout+s.exa.payout;
  var totRate=totInv>0?Math.round(totPay/totInv*100):0;
  var net=totPay-totInv;
  recHtml+='<tr style="background:#F8F8F8;font-weight:700"><td>合計</td><td>'+(s.tri.hits+s.exa.hits)+'</td><td>¥'+totInv.toLocaleString()+'</td><td>¥'+totPay.toLocaleString()+'<br><span style="font-size:9px;color:'+(net>=0?'var(--success)':'var(--danger)')+'">('+(net>=0?'+':'')+'¥'+net.toLocaleString()+')</span></td><td class="'+_rateColor(totRate)+'">'+totRate+'%</td></tr>';
  recHtml+='</tbody></table></div>';

  // レースタイプ別 (本日)
  recHtml+='<div class="card" style="padding:0;overflow:hidden">';
  recHtml+='<div style="padding:10px 12px;font-weight:700;font-size:13px;border-bottom:1px solid var(--border)">本日 レースタイプ別 (3連単)</div>';
  recHtml+='<table class="recovery-table">';
  recHtml+='<thead><tr><th>タイプ</th><th>R数</th><th>的中</th><th>的中率</th><th>回収率</th></tr></thead><tbody>';
  var typeLabels={honmei:'⚡本命',middle:'📊混戦',ana:'🔥穴'};
  ['honmei','middle','ana'].forEach(function(t){
    var ts=s.typeStats[t];
    var hr=ts.total>0?(ts.hit3/ts.total*100).toFixed(0):'-';
    var rr=ts.invest>0?Math.round(ts.payout3/ts.invest*100):0;
    recHtml+='<tr><td>'+typeLabels[t]+'</td><td>'+ts.total+'</td><td>'+ts.hit3+'</td><td>'+hr+'%</td><td class="'+_rateColor(rr)+'">'+rr+'%</td></tr>';
  });
  recHtml+='</tbody></table></div>';

  // 場別 全場 (本日)
  var stadArr=[];
  for(var sid in s.stadiumStats) stadArr.push(s.stadiumStats[sid]);
  // 回収率の高い順
  stadArr.forEach(function(ss){
    ss.rate3=ss.invest3>0?Math.round(ss.payout3/ss.invest3*100):0;
    ss.rate2=ss.invest2>0?Math.round(ss.payout2/ss.invest2*100):0;
  });
  stadArr.sort(function(a,b){return b.rate3-a.rate3});

  if(stadArr.length>0){
    recHtml+='<div class="card" style="padding:0;overflow:hidden">';
    recHtml+='<div style="padding:10px 12px;font-weight:700;font-size:13px;border-bottom:1px solid var(--border)">本日 場別 (回収率順)</div>';
    recHtml+='<table class="recovery-table">';
    recHtml+='<thead><tr><th>場</th><th>R数</th><th>3連的中</th><th>3連投資</th><th>3連回収</th><th>3連率</th></tr></thead><tbody>';
    stadArr.forEach(function(ss){
      var hr=ss.total>0?(ss.hit3/ss.total*100).toFixed(0):'-';
      recHtml+='<tr><td><b>'+escText(ss.name)+'</b></td><td>'+ss.total+'</td><td>'+ss.hit3+' ('+hr+'%)</td><td>¥'+ss.invest3.toLocaleString()+'</td><td>¥'+ss.payout3.toLocaleString()+'</td><td class="'+_rateColor(ss.rate3)+'">'+ss.rate3+'%</td></tr>';
    });
    recHtml+='</tbody></table></div>';
  }

  // F18: データ整合性 警告（的中だが payout 未取得の件）
  var w = s.warnings;
  if(w.tri_zero.length > 0 || w.exa_zero.length > 0){
    recHtml+='<div class="card" style="padding:12px;background:#FFF3E0;border-left:4px solid var(--warn)">';
    recHtml+='<div style="font-weight:700;color:#E65100;margin-bottom:6px">⚠ データ整合性の警告</div>';
    if(w.tri_zero.length > 0){
      recHtml+='<div style="font-size:11px;margin-bottom:4px">3連単的中だが払戻未取得: <b>'+w.tri_zero.length+'件</b></div>';
      recHtml+='<div style="font-size:10px;color:var(--text-sub)">'+escText(w.tri_zero.join(', '))+'</div>';
    }
    if(w.exa_zero.length > 0){
      recHtml+='<div style="font-size:11px;margin-top:6px;margin-bottom:4px">2連単的中だが払戻未取得: <b>'+w.exa_zero.length+'件</b></div>';
      recHtml+='<div style="font-size:10px;color:var(--text-sub)">'+escText(w.exa_zero.join(', '))+'</div>';
    }
    recHtml+='<div style="font-size:9px;color:var(--text-dim);margin-top:6px">※ 該当レースの結果データが Open API / 自前スクレイパーにまだ反映されていない可能性。「更新」を押すと再取得・再補完されます。</div>';
    recHtml+='</div>';
  }

  document.getElementById('statRecovery').innerHTML=recHtml;
  // 旧 statDetail（重複情報）と statChart は空に
  var sd=document.getElementById('statDetail'); if(sd) sd.innerHTML='';
  var sc=document.getElementById('statsChart'); if(sc && sc.parentNode){ sc.parentNode.style.display='none'; }
}

// PD-13b: Chart.js 動的 import（成績タブ初表示時のみロード）
//   インターネット切断時はキャッシュ（PD-2 SW cdn-v1）から提供
//   SRI ハッシュは _validateLS の値と同じく PA-3 で計算済の SHA-384
var _chartLoadingPromise = null;
function _loadChartLib(){
  if(typeof Chart !== 'undefined') return Promise.resolve();
  if(_chartLoadingPromise) return _chartLoadingPromise;
  _chartLoadingPromise = new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.integrity = 'sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD';
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.async = true;
    s.onload = function(){ console.log('[Chart] loaded'); resolve(); };
    s.onerror = function(e){
      console.warn('[Chart] load failed', e);
      _chartLoadingPromise = null;   // リトライ可能化
      reject(new Error('Chart.js load failed'));
    };
    document.head.appendChild(s);
  });
  return _chartLoadingPromise;
}

function renderStatsChart(){
  var ctx=document.getElementById('chartAccuracy');
  if(!ctx) return;
  // PD-13b: Chart.js が未ロードならまず読み込んで再帰呼出
  if(typeof Chart === 'undefined'){
    _loadChartLib().then(renderStatsChart, function(err){
      var parent = ctx.parentNode;
      if(parent) parent.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:11px">グラフ描画ライブラリの読込に失敗しました</div>';
    });
    return;
  }
  if(statsChart) statsChart.destroy();
  var history=safeParse('boatrace_history', []);   // PA-5
  var byDate={};
  history.forEach(function(h){
    if(!h.actual) return;
    if(!byDate[h.date]) byDate[h.date]={total:0,hit:0};
    byDate[h.date].total++;
    if(h.trifecta_hit) byDate[h.date].hit++;
  });
  var dates=Object.keys(byDate).sort().slice(-14);
  var rates=dates.map(function(d){return byDate[d].total>0?(byDate[d].hit/byDate[d].total*100):0});

  statsChart=new Chart(ctx,{
    type:'bar',
    data:{
      labels:dates.map(function(d){return d.slice(4,6)+'/'+d.slice(6)}),
      datasets:[{data:rates,backgroundColor:'rgba(33,150,243,0.5)',borderColor:'#2196F3',borderWidth:1,borderRadius:4}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,animation:{duration:0},
      plugins:{legend:{display:false},title:{display:true,text:'日別3連単的中率(%)',color:'#666',font:{size:11}}},
      scales:{
        x:{ticks:{font:{size:9},color:'#999'},grid:{display:false}},
        y:{beginAtZero:true,max:100,ticks:{font:{size:9},color:'#999',callback:function(v){return v+'%'}},grid:{color:'rgba(0,0,0,0.06)'}}
      }
    }
  });
}

// ===============================================
// SCREEN 5: SETTINGS (REWRITTEN)
// ===============================================
function loadSettings(){
  document.getElementById('setBetCount3').value=settings.betCount3||10;
  document.getElementById('setBetCount2').value=settings.betCount2||5;
  document.getElementById('setBetMethod').value=settings.betMethod||'auto';
  // X1: EV モード関連の初期化
  var ev = document.getElementById('setEvMode');
  if(ev) ev.value = (settings.evMode===true || settings.evMode==='true') ? 'true' : 'false';
  var em = document.getElementById('setEvMin');
  if(em) em.value = String(settings.evMin || 1.15);
  var kf = document.getElementById('setKellyFrac');
  if(kf) kf.value = String(settings.kellyFrac != null ? settings.kellyFrac : 0.5);
  var br = document.getElementById('setBankroll');
  if(br) br.value = settings.bankroll || 10000;

  // F19: RPi URL 設定 UI を撤去（古い localStorage キーがあれば clean up）
  try{ localStorage.removeItem('boatrace_rpi_url'); }catch(_){}

  var dbInfo=document.getElementById('dbInfo');
  var racerCount=Object.keys(racerDB).length;
  var stadiumCount=Object.keys(stadiumDB).length;
  var history = safeParse('boatrace_history', []);
  var historyCount=history.length;
  var withProbs = history.filter(function(h){ return h.actual && h.actual.length>0 && Array.isArray(h.mark_probs); });
  var lsUsed=0;
  try{for(var k in localStorage) lsUsed+=((localStorage.getItem(k)||'').length*2)}catch(e){}

  // PE-3: データ収集サマリ + 予測モデル学習状況
  var dates = {}; history.forEach(function(h){ if(h.date) dates[h.date]=1; });
  var dayCount = Object.keys(dates).length;
  var plattAge = _plattCoeffs.fittedAt ? Math.floor((Date.now()-_plattCoeffs.fittedAt)/86400000)+'日前' : '未校正';
  var plattStatus = (_plattCoeffs.a===1 && _plattCoeffs.b===0) ? 'identity (校正前)' : 'a='+_plattCoeffs.a.toFixed(2)+' b='+_plattCoeffs.b.toFixed(2);
  var fStatsN = _featureStats.n;
  var l2Step = l2trainStep;
  var learnedN = Object.keys(l2learnedKeys).length;

  dbInfo.innerHTML =
      '<b>📊 ストレージ</b><br>'
    + '選手DB: '+racerCount+'人 / 場DB: '+stadiumCount+'場<br>'
    + '予想履歴: '+historyCount+'件 ('+dayCount+'日分、確率付 '+withProbs.length+'件)<br>'
    + 'localStorage: '+(lsUsed/1024/1024).toFixed(2)+' / 5 MB<br><br>'
    + '<b>🧠 予測モデル状態</b><br>'
    + 'L2 学習ステップ: '+l2Step+' (済レース '+learnedN+')<br>'
    + 'rolling stats N: '+fStatsN+' / warmup '+TUNING.PREDICTION.ZSCORE_WARMUP_N+'<br>'
    + 'Platt 校正: '+plattStatus+' ('+plattAge+', n='+(_plattCoeffs.n||0)+')<br>'
    + (withProbs.length >= TUNING.PREDICTION.PLATT_MIN_SAMPLES
        ? '<span style="color:var(--success)">✓ 自動再校正条件を満たしています</span>'
        : '<span style="color:var(--text-dim)">再校正まで残り '+(TUNING.PREDICTION.PLATT_MIN_SAMPLES - withProbs.length)+' 件</span>');

  // PE-3 + PF-9: 自動再校正 — サンプル充足 & 7 日以上経過なら静かに Worker で再校正
  var ageMs = Date.now() - (_plattCoeffs.fittedAt || 0);
  if(withProbs.length >= TUNING.PREDICTION.PLATT_MIN_SAMPLES && ageMs > 7*86400000){
    _refitPlattCoeffs(history).then(function(fitted){
      if(fitted){
        console.log('[Platt] auto-refit a='+fitted.a.toFixed(3)+' b='+fitted.b.toFixed(3)+' n='+fitted.n);
      }
    });
  }
}

// PE-3: 履歴を CSV エクスポート（バックテスト解析用）
function exportHistoryCSV(){
  var history = safeParse('boatrace_history', []);
  if(!history.length){ alert('履歴がありません'); return; }
  var rows = ['date,stadium,race,raceType,winner_actual,p1,p2,p3,p4,p5,p6,trifecta_hit,exacta_hit,payout3,payout2'];
  history.forEach(function(h){
    if(!Array.isArray(h.mark_probs)) return;
    var probs = {};
    h.mark_probs.forEach(function(mp){ probs[mp.boat] = mp.prob; });
    var winner = (h.actual && h.actual[0]) || '';
    rows.push([
      h.date||'', h.stadium||'', h.race||'', h.raceType||'', winner,
      (probs[1]||0).toFixed(4), (probs[2]||0).toFixed(4), (probs[3]||0).toFixed(4),
      (probs[4]||0).toFixed(4), (probs[5]||0).toFixed(4), (probs[6]||0).toFixed(4),
      h.trifecta_hit?1:0, h.exacta_hit?1:0, h.payout3||0, h.payout2||0
    ].join(','));
  });
  var blob = new Blob([rows.join('\n')], {type:'text/csv;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'boatrace_history_'+jstYmd(0)+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  alert('CSV をダウンロードしました ('+(rows.length-1)+'件)');
}

// PE-3: forward-chain backtest を即時実行して結果表示
function runForwardChainNow(){
  var history = safeParse('boatrace_history', []);
  var result = runForwardChainBacktest(history, {warmupRaces: 30});
  if(result.evaluatedSamples === 0){
    alert('評価可能なサンプルがありません\n('+result.totalSamples+'件中、warmup '+result.warmupSkipped+'件スキップ後 0)');
    return;
  }
  alert('Forward-Chain Backtest:\n'
    + '評価サンプル: '+result.evaluatedSamples+' / 総 '+result.totalSamples+'\n'
    + '  warmup スキップ: '+result.warmupSkipped+'\n'
    + 'Log Loss: '+result.logLoss.toFixed(4)+'\n'
    + 'Brier:    '+result.brier.toFixed(4)+'\n'
    + 'ECE:      '+(result.ece*100).toFixed(2)+'%\n\n'
    + result.note);
}

function saveSetting(key,val){settings[key]=val; safeSet('boatrace_settings', settings)}   // P3 L-05
function clearCache(){var keys=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.startsWith('bc_'))keys.push(k)}keys.forEach(function(k){localStorage.removeItem(k)});alert('キャッシュをクリアしました ('+keys.length+'件)')}
// PD-10: 破壊操作は二段確認（confirm + DELETE 入力）でフールプルーフ
function _confirmDestructive(actionLabel){
  if(!confirm(actionLabel+'\n\nこの操作は取り消せません。本当に実行しますか?')) return false;
  var ans = prompt('確認のため "DELETE" と入力してください\n（キャンセルすると中止）', '');
  if(ans !== 'DELETE'){
    alert('入力が一致しないため中止しました');
    return false;
  }
  return true;
}
function clearHistory(){
  if(_confirmDestructive('成績履歴を全て削除しますか?')){
    localStorage.removeItem('boatrace_history');
    alert('履歴を削除しました');
  }
}
function rebuildDB(){
  if(_confirmDestructive('選手/場DBを再構築しますか?')){
    localStorage.removeItem('boatrace_racerDB');
    localStorage.removeItem('boatrace_stadiumDB');
    location.reload();
  }
}
function resetWeights(){
  // PD-10: 二段確認（学習データ消失は致命的のため）
  if(_confirmDestructive('学習重みをリセットしますか?\n（学習済キャッシュとカウンタも一緒にリセット）')){
    try{
      localStorage.removeItem('boatrace_weights');
      localStorage.removeItem('boatrace_learned');   // PB-1
      localStorage.removeItem('boatrace_trainstep'); // PB-2
    }catch(_){}
    l2weights = L2_INIT_WEIGHTS.slice();
    l2learnedKeys = {};
    l2trainStep = 0;
    alert('重みをリセットしました');
  }
}
// PC-6: エラーログ表示・コピー・削除
function _loadErrorLog(){
  try{ var raw=localStorage.getItem('boatrace_errors'); if(!raw) return [];
       var v=JSON.parse(raw); return Array.isArray(v)?v:[]; }
  catch(_){ return []; }
}
function showErrorLog(){
  var buf=_loadErrorLog();
  if(!buf.length){ alert('エラーログは空です'); return; }
  var lines=buf.slice(-20).map(function(e){
    return '['+(e.iso||new Date(e.ts).toISOString())+'] '+(e.type||'?')+': '+(e.msg||'')+(e.src?(' @ '+e.src+':'+(e.line||0)):'');
  });
  alert('直近 '+lines.length+' 件 / 全 '+buf.length+' 件:\n\n'+lines.join('\n'));
}
function copyErrorLog(){
  var buf=_loadErrorLog();
  var text=JSON.stringify(buf, null, 2);
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ alert('クリップボードにコピーしました ('+buf.length+'件)'); },
      function(e){ alert('コピー失敗: '+e); });
  } else {
    // フォールバック: textarea を介した execCommand
    var ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); alert('コピーしました ('+buf.length+'件)'); }
    catch(e){ alert('コピー失敗: '+e); }
    finally{ document.body.removeChild(ta); }
  }
}
function clearErrorLog(){
  if(confirm('エラーログを削除しますか?')){
    try{ localStorage.removeItem('boatrace_errors'); alert('削除しました'); }
    catch(e){ alert('削除失敗: '+e); }
  }
}

// PB-6 + PF-9: Platt scaling 再校正を user 操作から呼び出し（Worker 経由）
async function refitPlattCoefficients(){
  var history = safeParse('boatrace_history', []);
  var withProbs = history.filter(function(h){
    return h.actual && h.actual.length>0 && Array.isArray(h.mark_probs);
  });
  if(withProbs.length < TUNING.PREDICTION.PLATT_MIN_SAMPLES){
    alert('履歴サンプルが不足しています ('+withProbs.length+' / 必要 '+TUNING.PREDICTION.PLATT_MIN_SAMPLES+' 件)\n'
        + 'もう少しレース履歴が貯まってから再校正してください');
    return;
  }
  var result = await _refitPlattCoeffs(history);
  if(!result){
    alert('校正に失敗しました（適格サンプル不足）');
    return;
  }
  alert('校正完了:\n  a = '+result.a.toFixed(3)+'\n  b = '+result.b.toFixed(3)+'\n  サンプル: '+result.n+'\n\n'
      + '次回予想から calibrated 確率が反映されます');
}

// ===============================================
// F19: RPi URL Management 撤去（GitHub Pages のみで運用）
// ===============================================
// (PAT機能撤去 P0-S02: localStorage平文保存はXSSで漏洩可能)
// オッズ更新は cron 側で自動実行されるため PAT 経由 dispatch は不要
// ===============================================

// ===============================================
// レース単位の即時更新（Open API再取得+公式データマージ）
// ===============================================
async function refreshThisRace(){
  if(!currentStadium||!currentRace) return;
  var btn=document.getElementById('oddsRefreshBtn');
  if(btn){btn.disabled=true;btn.textContent='⏳ 更新中...';}

  try{
    // Open APIから3つとも最新取得
    var ts='?t='+Date.now();
    var rawPg=await fetchWithFallback(API_BASE+'/programs/v2/today.json'+ts);
    var rawPv=_filterStalePreviews(await fetchWithFallback(API_BASE+'/previews/v2/today.json'+ts));
    var rawRs=await fetchWithFallback(API_BASE+'/results/v2/today.json'+ts);
    if(rawPg) programData=indexByStadiumRace(rawPg,'programs');
    if(rawPv) previewData=indexPreviews(rawPv);
    if(rawRs) resultData=indexResults(rawRs);

    // F19: 自前データを GitHub Pages 経由で取得してマージ
    try{
      var liveResp=await fetch('data/previews/today.json?t='+Date.now());
      if(liveResp.ok){var liveData=await liveResp.json();_applyLiveDataMerge(liveData);}
    }catch(e){}
    try{
      var oddsResp=await fetch('data/odds/today.json?t='+Date.now());
      if(oddsResp.ok){
        var od=await oddsResp.json();
        if(od.updated_at){
          var oddsDate=new Date(new Date(od.updated_at).getTime()+9*3600000).toISOString().slice(0,10);
          var todayDate2=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
          if(oddsDate===todayDate2){oddsData=od;oddsLastFetched=Date.now();}
        }
      }
    }catch(e){}

    if(resultData) updateDBFromResults(resultData,programData);
    updateHistoryWithResults();

    // 現在のレース詳細を再描画
    openRace(currentStadium,currentRace);
    if(btn){btn.textContent='✅ 更新完了';btn.disabled=false;}
    setTimeout(function(){if(btn) btn.textContent='🔄 このレースを更新'},2000);
  }catch(e){
    console.warn('refreshThisRace error:',e);
    if(btn){btn.textContent='🔄 このレースを更新';btn.disabled=false;}
  }
}

// ===============================================
// Odds Refresh (P0-S02: PAT撤去 — クライアントから dispatch しない)
// オッズは Raspberry Pi 上の cron が約3分間隔で自動更新する
// ===============================================
function refreshOdds(){
  var btn=document.getElementById('oddsRefreshBtn');
  if(btn){btn.disabled=true;btn.textContent='取得中...';}

  fetch('data/odds/today.json?t='+Date.now())
    .then(function(r){if(r.ok) return r.json();throw new Error('fetch error')})
    .then(function(d){
      oddsData=d;
      oddsLastFetched=Date.now();
      if(btn){btn.textContent='✅ 更新完了';btn.disabled=false;}
      updateOddsUI();
      if(currentStadium&&currentRace) openRace(currentStadium,currentRace);
      setTimeout(function(){if(btn) btn.textContent='🔄 オッズ更新'},2000);
    }).catch(function(){
      if(btn){btn.textContent='🔄 オッズ更新';btn.disabled=false;}
    });
}

function startOddsAutoRefresh(){
  stopOddsAutoRefresh();
  oddsAutoRefreshTimer=setInterval(function(){
    fetch('data/odds/today.json?t='+Date.now())
      .then(function(r){if(r.ok) return r.json();throw new Error('fail')})
      .then(function(d){
        oddsData=d;
        oddsLastFetched=Date.now();
        updateOddsUI();
      }).catch(function(){});
  },300000);
}

function stopOddsAutoRefresh(){
  if(oddsAutoRefreshTimer){
    clearInterval(oddsAutoRefreshTimer);
    oddsAutoRefreshTimer=null;
  }
}

function updateOddsUI(){
  var msg=document.getElementById('oddsStaleMsg');
  if(!msg) return;
  if(!oddsLastFetched){
    msg.textContent='';
    return;
  }
  var elapsed=Math.round((Date.now()-oddsLastFetched)/60000);
  if(elapsed>15){
    msg.textContent='('+elapsed+'分前 - 古い可能性あり)';
  } else if(elapsed>0){
    msg.textContent='('+elapsed+'分前)';
  } else {
    msg.textContent='(最新)';
  }
}

// ===============================================
// INITIALIZATION
// ===============================================
// P0-S02: 旧バージョンで保存された PAT を強制削除（XSS対策）
try{ localStorage.removeItem('boatrace_github_pat'); }catch(_){}

// P0-S03: Service Worker 登録（PWAキャッシュ戦略を有効化）
// PD-3: 新版検出時のトースト + 即時更新フロー
function showUpdateToast(onUpdate){
  // 既存トーストがあれば削除
  var old = document.getElementById('br-update-toast');
  if(old) old.remove();
  var toast = document.createElement('div');
  toast.id = 'br-update-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');
  toast.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);'+
    'background:#1A3A5C;color:#fff;padding:12px 16px;border-radius:8px;'+
    'box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:9999;font-size:13px;'+
    'display:flex;align-items:center;gap:12px;max-width:90%';
  toast.innerHTML = '<span>新しいバージョンがあります</span>'+
    '<button id="br-update-btn" style="background:#00B4D8;color:#fff;border:none;'+
    'border-radius:4px;padding:6px 12px;font-size:12px;min-height:40px;cursor:pointer">更新</button>'+
    '<button id="br-update-dismiss" aria-label="閉じる" style="background:transparent;'+
    'color:#fff;border:none;font-size:18px;cursor:pointer;padding:0 4px;min-height:40px">×</button>';
  document.body.appendChild(toast);
  document.getElementById('br-update-btn').addEventListener('click', function(){
    toast.remove();
    if(typeof onUpdate === 'function') onUpdate();
  });
  document.getElementById('br-update-dismiss').addEventListener('click', function(){ toast.remove(); });
}

// PH-3 + PH-4: SW 登録 / 一部 setup を first paint 後に遅延 (TBT 削減)
//   scheduler.postTask があれば 'background' priority で投入
//   フォールバックは setTimeout
function _runIdleTask(fn, delay){
  if(typeof scheduler !== 'undefined' && scheduler.postTask){
    return scheduler.postTask(fn, {priority:'background'});
  }
  return setTimeout(fn, delay || 0);
}

// PH-3: SW 登録は load 後 + 余裕をもった setTimeout でさらに遅延
//   これにより HTML parse + first paint 期に SW 登録が混入しない
function _setupServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  // updateViaCache:'none' で sw.js 自体を HTTP cache から外し、
  //   iOS が古い VERSION を見続ける事故を防ぐ
  navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'})
    .then(function(reg){
      console.log('[SW] registered scope=', reg.scope);
      _runIdleTask(function(){ reg.update(); }, 100);
      setInterval(function(){ reg.update(); }, 1800000);
      reg.addEventListener('updatefound', function(){
        var nw = reg.installing;
        if(!nw) return;
        nw.addEventListener('statechange', function(){
          if(nw.state === 'installed' && navigator.serviceWorker.controller){
            console.log('[SW] new version available');
            showUpdateToast(function(){
              if(typeof window._markSwUpdateRequested === 'function') window._markSwUpdateRequested();
              nw.postMessage({type:'SKIP_WAITING'});
            });
          }
        });
      });
    })
    .catch(function(err){ console.warn('[SW] register failed', err); });

  var _userTriggeredSwUpdate = false;
  var _swReloadDone = false;
  window._markSwUpdateRequested = function(){ _userTriggeredSwUpdate = true; };
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    // PI-fix: iOS standalone で SW skipWaiting した場合も自動 reload して
    //   新 JS に切替（古い JS を引きずるのを防ぐ）。1 セッション 1 回だけ。
    if(_swReloadDone) return;
    _swReloadDone = true;
    console.log('[SW] new controller, reloading');
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', function(e){
    if(e.data && e.data.type === 'NEW_VERSION'){
      console.log('[SW] activated new version:', e.data.version);
    }
  });
}

// PG-6: stadium-card event delegation
// PI-fix: prerendered card は inline onclick も持つ（iOS standalone 防御）。
//   その場合 onclick が先に発火しているので、ここは無視（card.dataset._fired guard）。
function _setupStadiumDelegation(){
  var list = document.getElementById('stadiumList');
  if(!list) return;
  // PI-fix: hasAttribute('onclick') スキップを撤廃 + capture/bubble 両方で
  //   フォールバック。iOS standalone PWA で innerHTML 経由 div の
  //   inline onclick が動かない事象への防御。openStadium は idempotent。
  list.addEventListener('click', function(e){
    var card = e.target.closest('.stadium-card[data-sid]');
    if(!card) return;
    if(e._delegationHandled) return;
    e._delegationHandled = true;
    var sid = card.getAttribute('data-sid');
    if(sid && typeof openStadium === 'function') openStadium(sid);
  });
  document.addEventListener('click', function(e){
    var card = e.target.closest && e.target.closest('.stadium-card[data-sid]');
    if(!card) return;
    if(e._delegationHandled) return;
    e._delegationHandled = true;
    var sid = card.getAttribute('data-sid');
    if(sid && typeof openStadium === 'function') openStadium(sid);
  }, true);
}

// PH-1 + PH-4: 起動 setup を分散
//   1) HTML 解析直後に必須描画のみ (headerDate)
//   2) loadAllData は即時 kickoff (network が CPU 並列なので OK)
//   3) cleanOldData / event delegation / SW 登録 は idle で実行
document.getElementById('headerDate').innerHTML=formatDate();

// PH-5e: LCP/FCP を確実に Good (<2.5s) に固定するため loadAllData を
//   First Contentful Paint より十分後に kickoff
//   (prerender HTML が既に LCP 要素として測定される)
//   100ms 遅延 → defer 直後の同期処理 burst を完全に分離
setTimeout(function(){
  loadAllData().then(function(){ if(typeof _renderFreshness==='function') _renderFreshness(); });
}, 100);

// PH-1: 非クリティカル setup は first paint 後の idle に分散
_runIdleTask(function(){
  cleanOldData();
}, 100);
// PI-fix: iOS standalone PWA で scheduler.postTask({priority:'background'}) が
//   loadAllData の重いタスクに starve され、stadium-card のタップが効かなくなる
//   問題を修正。リスナ追加は ~0ms なので同期実行で LCP/FCP に影響しない。
_setupStadiumDelegation();
_runIdleTask(function(){
  // SW 登録は更に load イベント後で遅延
  if(document.readyState === 'complete') _setupServiceWorker();
  else window.addEventListener('load', function(){
    _runIdleTask(_setupServiceWorker, 200);
  }, {once:true});
}, 1500);   // first paint + LCP の後（~1500ms）に SW 登録

// P3 L-18: 全 setInterval を一元管理し、unload 時にクリア
// PD-12: visibilitychange で隠れたタブの polling を停止（バッテリー / ネットワーク節約）
var _managedTimers=[];
var _managedDefs=[];   // {fn, ms, id}
function setManagedInterval(fn, ms){
  var id=setInterval(fn, ms);
  _managedTimers.push(id);
  _managedDefs.push({fn:fn, ms:ms, id:id});
  return id;
}
window.addEventListener('beforeunload', function(){ _managedTimers.forEach(clearInterval); });
// PD-12: 非表示時はタイマーを停止、復帰時に再開
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'hidden'){
    _managedDefs.forEach(function(d){ if(d.id != null){ clearInterval(d.id); d.id = null; } });
  } else {
    _managedDefs.forEach(function(d){
      if(d.id == null){ d.id = setInterval(d.fn, d.ms); _managedTimers.push(d.id); }
    });
    // 復帰時に即時 1 回実行（古い表示を即時更新）
    _managedDefs.forEach(function(d){ try{ d.fn(); }catch(_){ } });
  }
});

// F2: 90秒間隔（旧 300秒）。data/* は CDN キャッシュ + cron 3 分更新なので軽量
// F3: 取得した updated_at から最終更新時刻を追跡し、ヘッダーに「📡 X分前」を表示
var _dataLatestUpdatedAt = 0;   // epoch ms
function _noteUpdatedAt(iso){
  if(!iso) return;
  var t = Date.parse(iso);
  if(Number.isFinite(t) && t > _dataLatestUpdatedAt) _dataLatestUpdatedAt = t;
}
function _renderFreshness(){
  var el = document.getElementById('dataFreshness');
  if(!el) return;
  if(!_dataLatestUpdatedAt){ el.textContent=''; return; }
  // データが今日 (JST) のものでなければ「待機中」表示（cron が本日まだ走っていない等）
  var todayJst = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  var dataDate = new Date(_dataLatestUpdatedAt+9*3600000).toISOString().slice(0,10);
  if(dataDate !== todayJst){
    el.innerHTML = '<span style="color:#BDBDBD">💤 本日データ取得待ち</span>';
    return;
  }
  var sec = Math.max(0, Math.floor((Date.now() - _dataLatestUpdatedAt)/1000));
  var label;
  if(sec < 60) label = sec + '秒前';
  else if(sec < 3600) label = Math.floor(sec/60) + '分前';
  else label = Math.floor(sec/3600) + '時間前';
  // PE-2: header 背景 (#1A3A5C) で AA 適合な明色で表示
  var color = sec < 180 ? '#A5D6A7' : sec < 600 ? '#FFCC80' : '#FF8A80';
  el.innerHTML = '<span style="color:'+color+'">📡 '+label+'</span>';
}
setManagedInterval(_renderFreshness, 10000);   // 10秒ごとに表示更新

setManagedInterval(async function(){
  try{
    var t=Date.now();
    var rawP=await fetchWithFallback(API_BASE+'/programs/v2/today.json?_='+t);
    if(rawP){ programData=indexByStadiumRace(rawP,'programs'); _noteUpdatedAt(rawP.updated_at); }
    var rawPv=_filterStalePreviews(await fetchWithFallback(API_BASE+'/previews/v2/today.json?_='+t));
    if(rawPv){ previewData=indexPreviews(rawPv); _noteUpdatedAt(rawPv.updated_at); }
    var rawR=await fetchWithFallback(API_BASE+'/results/v2/today.json?_='+t);
    if(rawR){
      resultData=indexResults(rawR);
      _noteUpdatedAt(rawR.updated_at);
      if(programData)updateDBFromResults(resultData,programData);
      await learnFromResults();   // PE-9: async
      updateHistoryWithResults();
    }
    try{
      var o=await fetch('data/odds/today.json?t='+t);
      if(o.ok){ var od=await o.json(); oddsData=od; _noteUpdatedAt(od.updated_at); }
    }catch(e){}
    // F5: 自前 previews（cron 3分更新）を merge して finished/result を反映
    try{
      var p=await fetch('data/previews/today.json?t='+t);
      if(p.ok){
        var pd=await p.json();
        if(pd&&Array.isArray(pd.races)) _applyLiveDataMerge(pd);
        _noteUpdatedAt(pd.updated_at);
      }
    }catch(e){}
    _renderFreshness();
  }catch(e){console.warn('Auto refresh error:',e)}
}, 90000);   // F2: 90 秒

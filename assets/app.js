'use strict';   // PC-5: strict モードで暗黙のグローバル代入 / 8進リテラル / with 等を禁止

// Path B Kill Switch (2026-05-16): URL に ?reset=1 が付いていたら
//   SW unregister + caches.delete + localStorage clear (?reset=full) を実行し
//   クエリ無し URL に redirect する。これによりユーザが「アプリをリセット」
//   リンクを踏むだけで JS halt 状態からも自己復旧できる。
(function killSwitchBoot(){
  try {
    var p = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : null;
    if (!p || !p.has('reset')) return;
    var fullReset = (p.get('reset') === 'full');
    var jobs = [];
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function(regs){
        return Promise.all(regs.map(function(r){ try { return r.unregister(); } catch(_){ return null; } }));
      }).catch(function(){}));
    }
    if (typeof caches !== 'undefined' && caches.keys) {
      jobs.push(caches.keys().then(function(keys){
        return Promise.all(keys.map(function(k){ try { return caches.delete(k); } catch(_){ return null; } }));
      }).catch(function(){}));
    }
    if (fullReset) {
      try { localStorage.clear(); } catch(_){}
      try { sessionStorage.clear(); } catch(_){}
    }
    Promise.all(jobs).finally(function(){
      // クエリ除去して再読込
      var clean = location.pathname + location.hash;
      location.replace(clean);
    });
  } catch(_){}
})();

/* BUILD:CAPABILITIES:START */
"use strict";
(() => {
  // ../src/capabilities.js
  var Capabilities = class {
    constructor() {
      this._sync = /* @__PURE__ */ new Map();
      this._async = /* @__PURE__ */ new Map();
    }
    // ─────────────────────────────────────────────
    // 同期検出（起動時 1 回）
    // ─────────────────────────────────────────────
    detectSync() {
      this._set("abort_timeout", typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function");
      this._set("service_worker", typeof navigator !== "undefined" && "serviceWorker" in navigator);
      this._set("indexed_db", typeof indexedDB !== "undefined");
      this._set("cache_api", typeof caches !== "undefined");
      this._set(
        "local_storage",
        (() => {
          try {
            if (typeof localStorage === "undefined") return false;
            const k = "__br_cap_probe__";
            localStorage.setItem(k, "1");
            localStorage.removeItem(k);
            return true;
          } catch (_) {
            return false;
          }
        })()
      );
      this._set("scheduler_post_task", typeof scheduler !== "undefined" && typeof scheduler.postTask === "function");
      this._set("scheduler_yield", typeof scheduler !== "undefined" && typeof scheduler.yield === "function");
      this._set("request_idle_callback", typeof requestIdleCallback === "function");
      this._set("document", typeof document !== "undefined" && typeof document.querySelectorAll === "function");
      this._set("notification", typeof Notification !== "undefined");
      this._set("chart", typeof Chart !== "undefined");
      this._set("worker", typeof Worker !== "undefined");
      this._set(
        "shared_array_buffer",
        typeof window !== "undefined" && window.crossOriginIsolated === true && typeof SharedArrayBuffer !== "undefined"
      );
      this._set("cross_origin_isolated", typeof window !== "undefined" && window.crossOriginIsolated === true);
      this._set("online", this._detectOnline());
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        try {
          window.addEventListener("online", () => this._set("online", true));
          window.addEventListener("offline", () => this._set("online", false));
        } catch (_) {
        }
      }
    }
    /**
     * @param {string} name
     * @param {boolean} value
     */
    _set(name, value) {
      this._sync.set(name, value === true);
    }
    /** @returns {boolean} */
    _detectOnline() {
      if (typeof navigator === "undefined") return true;
      if (typeof navigator.onLine !== "boolean") return true;
      return navigator.onLine;
    }
    // ─────────────────────────────────────────────
    // 公開 API
    // ─────────────────────────────────────────────
    /**
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
      if (this._sync.has(name)) return this._sync.get(name) === true;
      if (this._async.has(name)) return this._async.get(name) === true;
      return false;
    }
    /**
     * 動的に状態が変わる capability の再検出（chart 動的 import 後 等）
     * @param {string} [name]
     */
    refresh(name) {
      if (name === "chart") this._set("chart", typeof Chart !== "undefined");
      else if (name === "online") this._set("online", this._detectOnline());
      else this.detectSync();
    }
    /** @returns {string[]} */
    list() {
      return Array.from(this._sync.keys()).concat(Array.from(this._async.keys()));
    }
    // ─────────────────────────────────────────────
    // Async probes（on-demand、結果キャッシュ）
    // ─────────────────────────────────────────────
    //   - 'openapi_fresh': boatraceopenapi の HEAD レスポンスから更新時刻判定
    //   - 'exhibition_data': 個別レースの preview 取得試行（呼出側で sid/rno を渡す形に拡張可能）
    //
    // Phase 1 では openapi_fresh のみ実装、他は API としてのみ用意。
    /**
     * @param {string} name
     * @param {{ url?: string; ttlMs?: number }} [opts]
     * @returns {Promise<boolean>}
     */
    async probe(name, opts) {
      if (this._async.has(name)) return this._async.get(name) === true;
      let result = false;
      try {
        if (name === "openapi_fresh") result = await this._probeOpenapiFresh(opts);
      } catch (_) {
        result = false;
      }
      this._async.set(name, result === true);
      return this._async.get(name) === true;
    }
    /**
     * @param {{ url?: string; ttlMs?: number }} [opts]
     * @returns {Promise<boolean>}
     */
    async _probeOpenapiFresh(opts) {
      if (typeof fetch !== "function") return false;
      const url = opts && opts.url || "https://boatraceopenapi.github.io/programs/v2/today.json";
      const ttlMs = opts && opts.ttlMs || 30 * 60 * 1e3;
      const r = await fetch(url, {
        method: "HEAD",
        signal: this.makeTimeoutSignal(3e3),
        cache: "no-store"
      });
      if (!r.ok) return false;
      const lm = r.headers.get("last-modified");
      if (!lm) return false;
      const age = Date.now() - new Date(lm).getTime();
      return Number.isFinite(age) && age >= 0 && age < ttlMs;
    }
    // ─────────────────────────────────────────────
    // ヘルパ: 互換性のあるタイムアウト signal を返す
    //   has('abort_timeout') が true なら AbortSignal.timeout(ms)
    //   false なら AbortController + setTimeout の polyfill
    // 主に iOS Safari 旧版での fetch timeout 互換を確保するため。
    // ─────────────────────────────────────────────
    /**
     * @param {number} ms
     * @returns {AbortSignal}
     */
    makeTimeoutSignal(ms) {
      if (this.has("abort_timeout")) {
        return AbortSignal.timeout(ms);
      }
      const c = new AbortController();
      const ctxScheduler = typeof setTimeout === "function" ? setTimeout : null;
      if (ctxScheduler)
        ctxScheduler(() => {
          try {
            c.abort();
          } catch (_) {
          }
        }, ms);
      return c.signal;
    }
    // ─────────────────────────────────────────────
    // ヘルパ: 利用可能な「アイドル時実行」関数を返す
    //   scheduler.postTask({priority:'background'}) > requestIdleCallback > setTimeout
    // ─────────────────────────────────────────────
    /**
     * @param {() => void} fn
     * @param {{ delay?: number; timeout?: number; priority?: string }} [opts]
     * @returns {unknown}
     */
    runIdle(fn, opts) {
      const _gAny = (
        /** @type {any} */
        globalThis
      );
      if (this.has("scheduler_post_task")) {
        return _gAny.scheduler.postTask(fn, { priority: "background", ...opts || {} });
      }
      if (this.has("request_idle_callback")) {
        return _gAny.requestIdleCallback(fn, { timeout: opts && opts.timeout || 3e3 });
      }
      return setTimeout(fn, opts && opts.delay || 0);
    }
  };
  var capabilities = new Capabilities();
  capabilities.detectSync();
  var _g = (
    /** @type {any} */
    globalThis
  );
  _g.capabilities = capabilities;
  _g.Capabilities = Capabilities;
})();

/* BUILD:CAPABILITIES:END */

// ===============================================
// CONSTANTS (PRESERVED)
// ===============================================
// 競艇ドメインの静的データテーブル (STADIUMS / CLASS_NAME / BOAT_COLORS / BOAT_TEXT /
//   TECHNIQUE / WIND_DIR / GRADE_CLASS / CLASS_COLOR) は src/context/domain_constants.js
//   に移動 (Clearwing Phase 2e)。BUILD:CONTEXT_DOMAIN bundle 経由で globalThis に公開。
/* BUILD:CONTEXT_DOMAIN:START */
"use strict";
(() => {
  // ../src/context/domain_constants.js
  var STADIUMS = Object.freeze({
    1: "\u6850\u751F",
    2: "\u6238\u7530",
    3: "\u6C5F\u6238\u5DDD",
    4: "\u5E73\u548C\u5CF6",
    5: "\u591A\u6469\u5DDD",
    6: "\u6D5C\u540D\u6E56",
    7: "\u84B2\u90E1",
    8: "\u5E38\u6ED1",
    9: "\u6D25",
    10: "\u4E09\u56FD",
    11: "\u3073\u308F\u3053",
    12: "\u4F4F\u4E4B\u6C5F",
    13: "\u5C3C\u5D0E",
    14: "\u9CF4\u9580",
    15: "\u4E38\u4E80",
    16: "\u5150\u5CF6",
    17: "\u5BAE\u5CF6",
    18: "\u5FB3\u5C71",
    19: "\u4E0B\u95A2",
    20: "\u82E5\u677E",
    21: "\u82A6\u5C4B",
    22: "\u798F\u5CA1",
    23: "\u5510\u6D25",
    24: "\u5927\u6751"
  });
  var CLASS_NAME = Object.freeze({ 1: "A1", 2: "A2", 3: "B1", 4: "B2" });
  var CLASS_COLOR = Object.freeze({ 1: "#FF2244", 2: "#FF6644", 3: "#2288FF", 4: "#888888" });
  var BOAT_COLORS = Object.freeze({
    1: "#FFFFFF",
    2: "#000000",
    3: "#FF1122",
    4: "#2255FF",
    5: "#FFD700",
    6: "#22CC44"
  });
  var BOAT_TEXT = Object.freeze({
    1: "#000000",
    2: "#FFFFFF",
    3: "#FFFFFF",
    4: "#FFFFFF",
    5: "#000000",
    6: "#FFFFFF"
  });
  var TECHNIQUE = Object.freeze({
    1: "\u9003\u3052",
    2: "\u5DEE\u3057",
    3: "\u307E\u304F\u308A",
    4: "\u307E\u304F\u308A\u5DEE\u3057",
    5: "\u629C\u304D",
    6: "\u6075\u307E\u308C"
  });
  var WIND_DIR = Object.freeze({
    1: "N",
    2: "NNE",
    3: "NE",
    4: "ENE",
    5: "E",
    6: "ESE",
    7: "SE",
    8: "SSE",
    9: "S",
    10: "SSW",
    11: "SW",
    12: "WSW",
    13: "W",
    14: "WNW",
    15: "NW",
    16: "NNW",
    17: "\u7121\u98A8"
  });
  var GRADE_CLASS = Object.freeze({
    1: Object.freeze({ name: "SG", cls: "grade-sg" }),
    2: Object.freeze({ name: "G1", cls: "grade-g1" }),
    3: Object.freeze({ name: "G2", cls: "grade-g2" }),
    4: Object.freeze({ name: "G3", cls: "grade-g3" }),
    5: Object.freeze({ name: "\u4E00\u822C", cls: "grade-general" })
  });
  globalThis.STADIUMS = STADIUMS;
  globalThis.CLASS_NAME = CLASS_NAME;
  globalThis.CLASS_COLOR = CLASS_COLOR;
  globalThis.BOAT_COLORS = BOAT_COLORS;
  globalThis.BOAT_TEXT = BOAT_TEXT;
  globalThis.TECHNIQUE = TECHNIQUE;
  globalThis.WIND_DIR = WIND_DIR;
  globalThis.GRADE_CLASS = GRADE_CLASS;
})();

/* BUILD:CONTEXT_DOMAIN:END */
var COURSE_WIN_RATE={1:0.55,2:0.14,3:0.12,4:0.11,5:0.06,6:0.02};
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

// v2 (2026-05-24): FEATURE_DIM 12 → 24 拡張。既存 12 (index 0..11) は値維持で完全後方互換。
// v2 追加 (index 12..23) は 0 init → warmup 中は影響ゼロ、学習で発見させる。
// 旧 12 要素 weights を持つ既存ユーザは MIGRATIONS[3] で自動 padding (safe_storage.js)。
var L2_INIT_WEIGHTS=[3.0,1.5,-1.0,-4.0,-1.5,0.5,4.0,-0.8,1.0,1.5,0.3,3.5,0,0,0,0,0,0,0,0,0,0,0,0];
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
  var FEATURE_DIM = 24;
  var ERROR_BUF_MAX = 100;
  var STORAGE_KEYS = Object.freeze({
    SCHEMA_VERSION: "boatrace_schema_version",
    // P0-6: 互換性管理
    SETTINGS: "boatrace_settings",
    RACER_DB: "boatrace_racerDB",
    STADIUM_DB: "boatrace_stadiumDB",
    MOTOR_STATS: "boatrace_motorStats",
    EXHIBITION_STATS: "boatrace_exhibitionStats",
    PAIRWISE_DB: "boatrace_pairwiseDB",
    WEIGHTS: "boatrace_weights",
    // PB-1: L2 学習重み
    LEARNED: "boatrace_learned",
    // PB-1: 学習ガード
    TRAINSTEP: "boatrace_trainstep",
    // PB-2: LR decay 用
    FEATURE_STATS: "boatrace_featurestats",
    // PB-7: rolling stats
    PLATT: "boatrace_platt",
    // PB-6: Platt 校正
    HISTORY: "boatrace_history",
    ERRORS: "boatrace_errors",
    // PC-6: エラーログ
    DIAG: "boatrace_diag",
    // PI 診断オーバーレイ
    NAV: "boatrace_nav"
    // P0-5: PWA 状態復元（sessionStorage 側）
  });
  function _isFiniteNum(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function _validateRacerDBSample(value) {
    var ids = Object.keys(value);
    var sample = ids.slice(0, 50);
    for (var i = 0; i < sample.length; i++) {
      var r = value[sample[i]];
      if (!r || typeof r !== "object" || Array.isArray(r)) return false;
      if (r.courseStats && typeof r.courseStats === "object") {
        for (var c in r.courseStats) {
          var cs = r.courseStats[c];
          if (!cs || typeof cs !== "object") return false;
          if (cs.races != null && !_isFiniteNum(cs.races)) return false;
          if (cs.win != null && !_isFiniteNum(cs.win)) return false;
        }
      }
      if (r.classNum != null && !_isFiniteNum(r.classNum)) return false;
    }
    return true;
  }
  function _validateStadiumDBSample(value) {
    var sids = Object.keys(value).slice(0, 30);
    for (var i = 0; i < sids.length; i++) {
      var s = value[sids[i]];
      if (!s || typeof s !== "object") return false;
      if (s.courseWinRate && typeof s.courseWinRate === "object") {
        for (var c in s.courseWinRate) {
          var cw = s.courseWinRate[c];
          if (cw && typeof cw === "object") {
            if (cw.races != null && !_isFiniteNum(cw.races)) return false;
            if (cw.win != null && !_isFiniteNum(cw.win)) return false;
          }
        }
      }
    }
    return true;
  }
  function _validateLS(key, value) {
    if (value === null || value === void 0) return null;
    switch (key) {
      case "boatrace_settings":
        return typeof value === "object" && !Array.isArray(value) ? value : null;
      case "boatrace_racerDB":
        if (typeof value !== "object" || Array.isArray(value)) return null;
        if (Object.keys(value).length > 1e4) return null;
        if (!_validateRacerDBSample(value)) return null;
        return value;
      case "boatrace_stadiumDB":
        if (typeof value !== "object" || Array.isArray(value)) return null;
        if (Object.keys(value).length > 1e4) return null;
        if (!_validateStadiumDBSample(value)) return null;
        return value;
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
        for (let i2 = 0; i2 < value.length; i2++) {
          if (!Number.isFinite(value[i2]) || Math.abs(value[i2]) > 1e3) return null;
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
        for (let i2 = 0; i2 < FEATURE_DIM; i2++) {
          if (!Number.isFinite(value.mean[i2]) || !Number.isFinite(value.m2[i2])) return null;
        }
        return value;
      case "boatrace_platt":
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        if (!Number.isFinite(value.a) || !Number.isFinite(value.b)) return null;
        if (Math.abs(value.a) > 10 || Math.abs(value.b) > 10) return null;
        return value;
      case "boatrace_platt_perstadium":
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        if (Object.keys(value).length > 30) return null;
        for (var sid in value) {
          var ps = value[sid];
          if (!ps || typeof ps !== "object") return null;
          if (!Number.isFinite(ps.a) || !Number.isFinite(ps.b)) return null;
          if (Math.abs(ps.a) > 10 || Math.abs(ps.b) > 10) return null;
        }
        return value;
      case "boatrace_isotonic":
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        if (!Array.isArray(value.points)) return null;
        if (value.points.length > 100) return null;
        for (var i = 0; i < value.points.length; i++) {
          var pt = value.points[i];
          if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
          if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) return null;
        }
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
  var _IDB_KEYS_LARGE_SET = {
    boatrace_racerDB: 1,
    boatrace_stadiumDB: 1,
    boatrace_pairwiseDB: 1,
    boatrace_motorStats: 1,
    boatrace_exhibitionStats: 1
  };
  function safeSet(key, value) {
    if (_IDB_KEYS_LARGE_SET[key] && typeof globalThis.idbPut === "function") {
      try {
        globalThis.idbPut(key, value);
      } catch (_) {
      }
      try {
        localStorage.removeItem(key);
      } catch (_) {
      }
      return true;
    }
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
          try {
            reportError({ type: "warn", msg: "storage quota recovered by history trim", key });
          } catch (_) {
          }
          return true;
        } catch (_) {
        }
      }
      console.warn("[storage] set failed", key, e);
      try {
        reportError({ type: "error", msg: "storage set failed: " + (e && e.message || "unknown"), key });
      } catch (_) {
      }
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
  var SCHEMA_KEY = "boatrace_schema_version";
  var CURRENT_SCHEMA = 3;
  var MIGRATIONS = {
    // v1→v2: P0-3 で追加した kpiMode のデフォルト値を settings に流し込む
    2: function() {
      try {
        const raw = localStorage.getItem("boatrace_settings");
        const s = raw ? JSON.parse(raw) : {};
        if (s && typeof s === "object" && s.kpiMode == null) {
          s.kpiMode = "balanced";
          localStorage.setItem("boatrace_settings", JSON.stringify(s));
        }
      } catch (_) {
      }
    },
    // v2→v3 (2026-05-24): FEATURE_DIM 12 → 24 拡張に伴う localStorage 移行
    //   - boatrace_weights: 12 要素 → 24 要素 (新 12 weights = 0 init)
    //   - boatrace_featurestats: mean[12] / m2[12] → mean[24] / m2[24]
    //     mean は 0 padding、m2 は **1.0 padding** (z-score の divide by zero 防止 —
    //     学習が進むまで identity transform 同等に動作)
    //   既存 weights/stats が壊れない後方互換が最重要 (致命: R1/R2 リスク回避)
    3: function() {
      try {
        const wRaw = localStorage.getItem("boatrace_weights");
        if (wRaw) {
          const w = JSON.parse(wRaw);
          if (Array.isArray(w) && w.length === 12) {
            const newW = w.slice();
            for (let i = 0; i < 12; i++) newW.push(0);
            localStorage.setItem("boatrace_weights", JSON.stringify(newW));
          }
        }
      } catch (_) {
      }
      try {
        const fRaw = localStorage.getItem("boatrace_featurestats");
        if (fRaw) {
          const f = JSON.parse(fRaw);
          if (f && Array.isArray(f.mean) && f.mean.length === 12 && Array.isArray(f.m2) && f.m2.length === 12) {
            const newMean = f.mean.slice();
            const newM2 = f.m2.slice();
            for (let i = 0; i < 12; i++) {
              newMean.push(0);
              newM2.push(1);
            }
            localStorage.setItem("boatrace_featurestats", JSON.stringify({
              mean: newMean,
              m2: newM2,
              n: f.n
            }));
          }
        }
      } catch (_) {
      }
    }
  };
  function _runMigrations() {
    let cur = 1;
    try {
      const raw = localStorage.getItem(SCHEMA_KEY);
      const v = raw ? parseInt(raw, 10) : 1;
      if (Number.isFinite(v) && v >= 1 && v <= 1e3) cur = v;
    } catch (_) {
    }
    if (cur >= CURRENT_SCHEMA) return;
    for (let v = cur + 1; v <= CURRENT_SCHEMA; v++) {
      const fn = MIGRATIONS[v];
      if (typeof fn === "function") {
        try {
          fn();
        } catch (e) {
          console.warn("[migrate] v" + v + " failed", e);
        }
      }
      try {
        localStorage.setItem(SCHEMA_KEY, String(v));
      } catch (_) {
      }
    }
  }
  globalThis._validateLS = _validateLS;
  globalThis._bootParseLS = _bootParseLS;
  globalThis.safeParse = safeParse;
  globalThis.safeSet = safeSet;
  globalThis.reportError = reportError;
  globalThis.ERROR_BUF_MAX = ERROR_BUF_MAX;
  globalThis._runMigrations = _runMigrations;
  globalThis.SCHEMA_KEY = SCHEMA_KEY;
  globalThis.CURRENT_SCHEMA = CURRENT_SCHEMA;
  globalThis.STORAGE_KEYS = STORAGE_KEYS;
})();

/* BUILD:SAFE_STORAGE:END */

// P0-6: スキーマバージョン migration を最優先で実行（safeParse 利用前）
try { if(typeof _runMigrations === 'function') _runMigrations(); } catch(_){}

// Path B B11 (2026-05-16): ストレージ自動クリーンアップ強化。
//   旧 Epic 28 は bc_* / cache_* のみ削除し、boatrace_history や racerDB の
//   肥大は手動 (緊急クリーンアップボタン) でしか解消できず、ユーザが「いっぱい」
//   状態で放置するケースが多発。本ブロックでは:
//     1. >3MB で bc_* / cache_* / corrupt / diag 削除 (旧 Epic 28 範囲)
//     2. >3.5MB で history を直近 500 件に自動 trim (旧仕様 1000 から削減)
//     3. >4MB で racerDB を直近 30 日アクティブ選手のみに圧縮
//     4. >4.5MB で stadiumDB も同様
//   いずれも保持優先順位: 設定 > 学習重み > 履歴 > DB > キャッシュ
//   完了後 boatrace_errors に diag_storage_autoclean を残す。
// Epic 28: localStorage 緊急クリーンアップ — 起動時に容量超過チェック
//   2MB 超で全 bc_* を強制削除（時間 cutoff 無関係）
//   旧仕様 (Epic 28a 4MB + 10分 expire) は programs (~1MB) が新規 fetch 直後でも
//   削除対象になり結局効果薄。Epic 28b で BC_MAX_BYTES=100KB を導入したため、
//   今後は小さい cache のみが保存される。既存の巨大 bc_* は強制削除で一掃。
try {
  var _lsBytes = 0;
  for(var _k in localStorage) _lsBytes += ((localStorage.getItem(_k)||'').length * 2);
  if(_lsBytes > 2 * 1024 * 1024){   // 2MB 超 (Epic 28b: 閾値を下げ早期介入)
    // Epic 28f: 容量超過時にキー別バイト数 TOP10 を console + reportError 両方に出力
    //   (スマホで DevTools が見えないユーザでも、設定画面のエラーログから確認可能)
    var _topKeys = [];
    for(var _kx=0;_kx<localStorage.length;_kx++){
      var _kn = localStorage.key(_kx);
      if(!_kn) continue;
      _topKeys.push({ k:_kn, b:(localStorage.getItem(_kn)||'').length*2 });
    }
    var _top10 = _topKeys.sort(function(a,b){return b.b-a.b}).slice(0,10);
    _top10.forEach(function(it){
      console.warn('[storage]   ' + (it.b/1024).toFixed(0) + ' KB - ' + it.k);
    });
    // boatrace_errors にも保存して設定画面 → エラーログから確認可能に
    try {
      if(typeof reportError === 'function') reportError({
        type: 'diag_storage_top10',
        msg: 'localStorage usage ' + (_lsBytes/1024/1024).toFixed(2) + 'MB top10',
        usage_mb: parseFloat((_lsBytes/1024/1024).toFixed(2)),
        top10: _top10.map(function(it){ return { key: it.k, kb: parseFloat((it.b/1024).toFixed(1)) }; }),
      });
    } catch(_){}
    console.warn('[storage] usage='+(_lsBytes/1024/1024).toFixed(2)+'MB — force-clearing bc_* / cache_* / br_* / corrupt');
    // Epic 28g: bc_* に加え cache_* (boatrace 以外のアプリが書いた汎用 cache キー) も削除
    //   ユーザログで cache_915902876 (439KB) cache_593280445 (436KB) 等が判明
    // Epic 28i (PR #41 統合): br_prog/br_res/br_prev (~2.1MB 観測) も削除対象に追加。
    //   現コードベースには存在しないキー (git 全履歴 0 ヒット)、同一 origin 上の
    //   別プロジェクト由来の孤児データと推定。boatrace_* は保護。
    var _bcRm = 0, _cacheRm = 0, _brRm = 0;
    var _bcK = [], _cacheK = [], _brK = [];
    for(var _i=0;_i<localStorage.length;_i++){
      var _kk = localStorage.key(_i);
      if(!_kk) continue;
      if(_kk.indexOf('bc_')===0) _bcK.push(_kk);
      else if(_kk.indexOf('cache_')===0) _cacheK.push(_kk);
      // br_ で始まり boatrace_ ではないキー (= 旧版 / 別アプリ由来の孤児)
      else if(_kk.indexOf('br_')===0 && _kk.indexOf('boatrace_')!==0) _brK.push(_kk);
    }
    _bcK.forEach(function(_kk){ try { localStorage.removeItem(_kk); _bcRm++; } catch(_){} });
    _cacheK.forEach(function(_kk){ try { localStorage.removeItem(_kk); _cacheRm++; } catch(_){} });
    _brK.forEach(function(_kk){ try { localStorage.removeItem(_kk); _brRm++; } catch(_){} });
    // diag / 破損キー も一掃
    try { localStorage.removeItem('boatrace_diag'); }catch(_){}
    var _corrK = [];
    for(var _j=0;_j<localStorage.length;_j++){
      var _ck = localStorage.key(_j);
      if(_ck && _ck.indexOf('__corrupt_') > 0) _corrK.push(_ck);
    }
    _corrK.forEach(function(_kk){ try{ localStorage.removeItem(_kk); }catch(__){} });
    console.warn('[storage] force-clear done: bc_*='+_bcRm+' cache_*='+_cacheRm+' br_*='+_brRm+' corrupt='+_corrK.length);
    try { if(typeof reportError === 'function') reportError({
      type: 'diag_storage_cleanup',
      msg: 'cleanup: bc_*='+_bcRm+' cache_*='+_cacheRm+' br_*='+_brRm+' corrupt='+_corrK.length,
      bc: _bcRm, cache_: _cacheRm, br_: _brRm, corrupt: _corrK.length,
    }); } catch(_){}
  }

  // Path B B11: 階層的自動クリーンアップ (bc_*/cache_* 削除後にまだ大きい場合)
  // localStorage 再計測
  var _lsAfter = 0;
  for(var _k2 in localStorage) _lsAfter += ((localStorage.getItem(_k2)||'').length * 2);
  var _trimmed = { history: 0, racer: 0, stadium: 0 };

  // Tier 2: >2.5MB なら history を 500 件に trim (Epic 28i: 3.5MB → 2.5MB に閾値引下げ)
  //   旧 3.5MB だと br_* 等の外部キーが居れば history が 1.7MB に達しても発動しなかった。
  //   2.5MB に下げて history 単体で trigger できるように。
  //   PR #41 統合: trim skip 理由の可視化 (diag_trim_skipped)
  if(_lsAfter > 2.5 * 1024 * 1024){
    var _trimReason = 'unknown';
    var _histLen = -1;
    try {
      var _hraw = localStorage.getItem('boatrace_history');
      if(!_hraw){
        _trimReason = 'no_history_key';
      } else {
        var _h = JSON.parse(_hraw);
        if(!Array.isArray(_h)){
          _trimReason = 'not_array';
        } else {
          _histLen = _h.length;
          if(_h.length > 500){
            _trimmed.history = _h.length - 500;
            localStorage.setItem('boatrace_history', JSON.stringify(_h.slice(-500)));
            _trimReason = 'trimmed';
          } else {
            _trimReason = 'len_under_500';
          }
        }
      }
    } catch(e){
      _trimReason = 'parse_error: ' + ((e&&e.message)||'unknown');
    }
    // 閾値に達したのに trim されなかったケースを可視化
    if(_trimmed.history === 0){
      try { if(typeof reportError === 'function') reportError({
        type: 'diag_trim_skipped',
        msg: 'history trim skipped at '+(_lsAfter/1024/1024).toFixed(2)+'MB: '+_trimReason,
        ls_mb: parseFloat((_lsAfter/1024/1024).toFixed(2)),
        history_len: _histLen,
        reason: _trimReason,
      }); } catch(_){}
    }
    _lsAfter = 0;
    for(var _k3 in localStorage) _lsAfter += ((localStorage.getItem(_k3)||'').length * 2);
  }

  // Tier 3: >4MB なら racerDB を 30 日以内にアクティブな選手のみに圧縮
  if(_lsAfter > 4 * 1024 * 1024){
    try {
      var _rraw = localStorage.getItem('boatrace_racerDB');
      if(_rraw){
        var _rdb = JSON.parse(_rraw);
        var _cutoff = new Date(Date.now()-30*86400000);
        var _cutoffStr = _cutoff.getFullYear()+('0'+(_cutoff.getMonth()+1)).slice(-2)+('0'+_cutoff.getDate()).slice(-2);
        var _kept = {};
        for(var _rid in _rdb){
          if((_rdb[_rid].lastUpdated||'') >= _cutoffStr){ _kept[_rid] = _rdb[_rid]; }
          else { _trimmed.racer++; }
        }
        localStorage.setItem('boatrace_racerDB', JSON.stringify(_kept));
      }
    } catch(_){}
    _lsAfter = 0;
    for(var _k4 in localStorage) _lsAfter += ((localStorage.getItem(_k4)||'').length * 2);
  }

  // Tier 4: >4.5MB なら stadiumDB も同様に
  if(_lsAfter > 4.5 * 1024 * 1024){
    try {
      var _sraw = localStorage.getItem('boatrace_stadiumDB');
      if(_sraw){
        var _sdb = JSON.parse(_sraw);
        var _scutoff = new Date(Date.now()-30*86400000);
        var _scutoffStr = _scutoff.getFullYear()+('0'+(_scutoff.getMonth()+1)).slice(-2)+('0'+_scutoff.getDate()).slice(-2);
        var _skept = {};
        for(var _sid2 in _sdb){
          if((_sdb[_sid2].lastUpdated||'') >= _scutoffStr){ _skept[_sid2] = _sdb[_sid2]; }
          else { _trimmed.stadium++; }
        }
        localStorage.setItem('boatrace_stadiumDB', JSON.stringify(_skept));
      }
    } catch(_){}
  }

  if(_trimmed.history > 0 || _trimmed.racer > 0 || _trimmed.stadium > 0){
    console.warn('[storage] auto-trim done: history='+_trimmed.history+' racer='+_trimmed.racer+' stadium='+_trimmed.stadium);
    try { if(typeof reportError === 'function') reportError({
      type: 'diag_storage_autoclean',
      msg: 'auto-trim: history='+_trimmed.history+' racer='+_trimmed.racer+' stadium='+_trimmed.stadium,
      trimmed: _trimmed,
    }); } catch(_){}
    // ユーザに toast (loadSettings が後で実行されるので、保存時点で済)
    try {
      var _ts = document.createElement('div');
      _ts.id = 'storage_autoclean_toast';
      _ts.setAttribute('role', 'status');
      _ts.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1976D2;color:#fff;padding:10px 16px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.3);z-index:9999;font-size:12px;max-width:90%;text-align:center';
      var _msg = 'ストレージ自動クリーンアップ:';
      if(_trimmed.history > 0) _msg += ' 古い履歴 '+_trimmed.history+' 件';
      if(_trimmed.racer > 0) _msg += ' / 選手 '+_trimmed.racer+' 件';
      if(_trimmed.stadium > 0) _msg += ' / 場 '+_trimmed.stadium+' 件';
      _msg += ' を削除しました';
      _ts.textContent = _msg;
      // DOM 構築前に呼ばれるので、DOMContentLoaded を待ってから挿入
      var _show = function(){
        if(!document.body) return setTimeout(_show, 100);
        document.body.appendChild(_ts);
        setTimeout(function(){ try { _ts.remove(); } catch(_){} }, 6000);
      };
      if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _show, {once:true});
      else _show();
    } catch(_){}
  }
} catch(_){ /* localStorage 全体不可なら諦め */ }

// Epic 13 (P1-B2): IndexedDB migration — LS の大型キーを IDB に移し、
//   in-memory racerDB / stadiumDB を IDB から読み直す（async、fire-and-forget）
//   起動時の同期 _bootParseLS は LS から読むため、IDB に既に移ってる場合は
//   再代入が必要。完了後にイベント発火。
(function _bootIdbMigrate(){
  // Epic 28e: rest 側関数のため typeof guard 必須 + polling で必ず実行
  function tryRun(retry){
    if(typeof idbMigrateFromLS !== 'function'){
      if(retry > 50){ console.warn('[idb] idbMigrateFromLS not loaded after 5s — IDB unavailable'); return; }
      setTimeout(function(){ tryRun(retry+1); }, 100);
      return;
    }
    var _idbAvail = capabilities.has('indexed_db');
    console.log('[idb] migrate start (IDB available='+_idbAvail+')');
    idbMigrateFromLS().then(function(res){
      var migN = ((res && res.migrated)||[]).length;
      var errN = ((res && res.errors)||[]).length;
      var dedN = ((res && res.deduped)||[]).length;   // Epic 28g: LS 重複削除数
      console.log('[idb] migrate done: migrated=' + migN + ' errors=' + errN + ' deduped=' + dedN);
      if(res && res.migrated && res.migrated.length){
        console.log('[idb]   migrated keys:', res.migrated.join(', '));
      }
      if(res && res.deduped && res.deduped.length){
        console.log('[idb]   deduped (LS 重複削除):', res.deduped.join(', '));
      }
      // Epic 28f: 結果を reportError に保存 (スマホで DevTools 不可なユーザ向け)
      // FIX (2026-05-22): 全 0 件 (avail=true, migrated=0, errors=0, deduped=0) は
      //   「やることなし」の正常状態であり報告不要。errN/migN/dedN のいずれかが >0、
      //   または IDB 不可の時のみ reportError する (boatrace_errors のノイズ削減)。
      try {
        var _shouldReport = errN > 0 || migN > 0 || dedN > 0 || !_idbAvail;
        if(_shouldReport && typeof reportError === 'function') reportError({
          type: 'diag_idb_migrate',
          msg: 'idb migrate: migrated=' + migN + ' errors=' + errN + ' deduped=' + dedN + ' (avail=' + _idbAvail + ')',
          idb_available: _idbAvail,
          migrated: (res && res.migrated) || [],
          deduped: (res && res.deduped) || [],
          errors: (res && res.errors) || [],
        });
      } catch(_){}
      return Promise.all([
        idbGet('boatrace_racerDB'),
        idbGet('boatrace_stadiumDB'),
        idbGet('boatrace_pairwiseDB'),
        idbGet('boatrace_motorStats'),
        idbGet('boatrace_exhibitionStats'),
      ]);
    }).then(function(arr){
      if(arr[0] && typeof arr[0] === 'object' && Object.keys(arr[0]).length > 0){
        try { racerDB = arr[0]; console.log('[idb] reloaded racerDB ('+Object.keys(arr[0]).length+' racers)'); } catch(_){}
      }
      if(arr[1] && typeof arr[1] === 'object' && Object.keys(arr[1]).length > 0){
        try { stadiumDB = arr[1]; console.log('[idb] reloaded stadiumDB ('+Object.keys(arr[1]).length+' stadiums)'); } catch(_){}
      }
      // Epic 28h: 残り 3 キーも IDB からメモリへ再ロード。
      //   safeSet が IDB ルーティングに変わったため、_bootParseLS は空 {} を返し
      //   in-memory に蓄積データが反映されない (= 学習リセット) のを防ぐ。
      if(arr[2] && typeof arr[2] === 'object' && Object.keys(arr[2]).length > 0){
        try { pairwiseDB = arr[2]; console.log('[idb] reloaded pairwiseDB ('+Object.keys(arr[2]).length+' pairs)'); } catch(_){}
      }
      if(arr[3] && typeof arr[3] === 'object' && Object.keys(arr[3]).length > 0){
        try { stadiumMotorStats = arr[3]; console.log('[idb] reloaded motorStats ('+Object.keys(arr[3]).length+' stadiums)'); } catch(_){}
      }
      if(arr[4] && typeof arr[4] === 'object' && Object.keys(arr[4]).length > 0){
        try { stadiumExhibitionStats = arr[4]; console.log('[idb] reloaded exhibitionStats ('+Object.keys(arr[4]).length+' stadiums)'); } catch(_){}
      }
    }).catch(function(e){
      var msg = (e && e.message) || 'unknown';
      console.warn('[idb] boot migrate/load failed:', msg);
      try { if(typeof reportError === 'function') reportError({ type:'diag_idb_failed', msg: msg }); } catch(_){}
    });
  }
  tryRun(0);
})();

// =====================================================================
// PI-fix: 診断オーバーレイ（iOS standalone PWA タップ不能問題の調査用）
//   - capture-phase で touchstart/touchend/click/pointerdown を全て記録
//   - タイトル「BOATRACE AI」(.logo) を 5 連打で debug overlay 表示
//   - リング 100 件、stadium-card 関連は別セクションで強調表示
//   - 「クリア」ボタンでバッファ初期化 → ノイズ無しの再採取が可能
// =====================================================================
(function(){
  var DIAG_MAX = 100;
  // Epic 28h: byte cap — 旧仕様は entry 数 100 のみで bounded、touchstart 等の
  //   ペイロードが大きいイベントが連発すると 27KB まで膨張していた
  //   (boatrace_diag が LS 全体の 1% を浪費)。古い entry から捨てて 10KB 以下に保つ。
  var DIAG_BYTES_MAX = 10 * 1024;
  var ring = [];
  function pushDiag(o){
    o.t = Date.now();
    ring.push(o);
    if(ring.length > DIAG_MAX) ring.shift();
    try {
      var s = JSON.stringify(ring);
      while(ring.length > 1 && s.length > DIAG_BYTES_MAX){
        ring.shift();
        s = JSON.stringify(ring);
      }
      localStorage.setItem('boatrace_diag', s);
    } catch(_){}
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
      shareBtn.remove();
    };
    // L3 (Epic 8): 診断テキストを共有可能な形式で書出。
    //   iOS standalone PWA は DevTools 不可かつ AirDrop / メール送信に頼ることが多い。
    //   1) clipboard 書込 (失敗時は textarea で選択状態にして手動コピー可能に)
    //   2) data URL を新規 window で開いて長押し→「リンクをコピー」「メールで送信」を可能に
    var shareBtn = document.createElement('button');
    shareBtn.textContent = '📤 共有';
    shareBtn.style.cssText = 'position:fixed;top:10px;right:200px;background:#28a;color:#fff;border:0;padding:8px 14px;font:14px sans-serif;border-radius:6px;z-index:2147483648';
    shareBtn.onclick = function(){
      var diagText = ov.textContent || '';
      // 1) Web Share API（iOS PWA でも対応）
      if(navigator.share){
        navigator.share({
          title: 'BoatRace Oracle 診断',
          text: diagText.length > 8000 ? diagText.slice(0, 8000) + '\n... (truncated)' : diagText
        }).catch(function(){
          // user キャンセル等は無視
        });
        return;
      }
      // 2) clipboard fallback
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(diagText).then(function(){
          shareBtn.textContent = '✓ コピー済';
          setTimeout(function(){ shareBtn.textContent = '📤 共有'; }, 2000);
        }).catch(function(){
          showShareFallback();
        });
        return;
      }
      showShareFallback();
      function showShareFallback(){
        // 3) textarea で選択状態にして手動コピーを促す（iOS 古バージョン向け）
        var ta = document.createElement('textarea');
        ta.value = diagText;
        ta.style.cssText = 'position:fixed;top:60px;left:10px;right:10px;height:200px;z-index:2147483647;font:11px monospace';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        setTimeout(function(){ ta.remove(); }, 30000);
      }
    };
    document.body.appendChild(ov);
    document.body.appendChild(close);
    document.body.appendChild(clearBtn);
    document.body.appendChild(shareBtn);
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
var FEATURE_DIM = 24;
// PJ Phase 致命バグ修正 (commit 55a3046) と同等の対処を再適用 (Epic 12 で再発したため)。
//   _initFeatureStats() は split_app.py により rest bundle 側へ MOVE されるため、
//   critical bundle の boot 時点 (rest 未 load) では ReferenceError → silent halt する。
//   よって critical の IIFE 内ではインラインリテラルで初期化する。
var _featureStats = (function(){
  var raw = _bootParseLS('boatrace_featurestats', null);
  if(raw && Array.isArray(raw.mean) && raw.mean.length===FEATURE_DIM
        && Array.isArray(raw.m2) && typeof raw.n==='number'){ return raw; }
  return { mean: new Array(FEATURE_DIM).fill(0), m2: new Array(FEATURE_DIM).fill(0), n: 0 };
})();
// _initFeatureStats は rest 側 utility として後方互換のため残置（呼出元 0 件、安全）

// PB-6: Platt scaling 係数 — 既定は a=1, b=0（identity = no calibration）
//   将来 _refitPlattCoeffs(history) で auto-tune
var _plattCoeffs = (function(){
  var raw = _bootParseLS('boatrace_platt', null);
  if(raw && Number.isFinite(raw.a) && Number.isFinite(raw.b)
        && Number.isFinite(raw.fittedAt)){ return raw; }
  return { a: 1.0, b: 0.0, fittedAt: 0, n: 0 };
})();

// 2026-05-24 (Tier 2): 場別 Platt 係数 — 各場 100 サンプル以上で個別校正
//   構造: { sid: { a, b, n, fittedAt }, ... }
//   _applyPlattCalibration(p, sid) が場別 → global の順で参照
var _plattCoeffsByStadium = (function(){
  var raw = _bootParseLS('boatrace_platt_perstadium', null);
  if(raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
})();

// 2026-05-24 (Tier 2): Isotonic 校正 breakpoints
//   構造: { points: [{x, y}, ...], fittedAt, n } | null
//   PAV (pool adjacent violators) で fit、apply 時は線形補間
var _isotonicCoeffs = (function(){
  var raw = _bootParseLS('boatrace_isotonic', null);
  if(raw && Array.isArray(raw.points) && raw.points.length >= 2) return raw;
  return null;
})();

// 2026-05-24 (Tier 2): 採用する校正手法 — 'platt' | 'isotonic' | 'none'
//   _chooseCalibrationMethod が held-out log loss で auto-select
//   既定 'platt' (従来挙動を維持)
var _calibrationMethod = (function(){
  try {
    var raw = localStorage.getItem('boatrace_calib_method');
    if(raw === 'platt' || raw === 'isotonic' || raw === 'none') return raw;
  } catch(_){}
  return 'platt';
})();

// PB-5: Stacking 重み — L2 が L1 logit を補正する係数
//   既定 γ=0 で stacking 無効（線形融合のみ）
//   STACKING_MODE='residual' のとき active
var _stackingGamma = 0.0;

// PC-3: 主要しきい値の集約（マジックナンバー撲滅、変更履歴の追跡性向上）
//       根拠: CLAUDE.md 修正履歴の Review 系 / X1 EV/Kelly 改善設計を参照
var TUNING = Object.freeze({
  // レースタイプ判定（top1 確率 / top2 累積 / 環境ペナルティ）
  // FIX: 旧しきい値 (top1>0.40, top2>0.55, top1<0.25) ではボートレース 1コース
  //   優位性により大半が本命判定 → 穴/混戦が極端に少なくユーザに偏り。
  //   30/49/21 程度の分布になるように再調整。
  RACE_TYPE: Object.freeze({
    HONMEI_TOP1_MIN: 0.50,        // top1 これ以上で本命候補（旧 0.40）
    HONMEI_TOP2_MIN: 0.65,        // 本命は top1+top2 ≥ 0.65 を満たす必要（旧 0.55）
    ANA_TOP1_MAX: 0.32,           // top1 これ未満は穴候補（旧 0.25）
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
    // Tier 3 (2026-05-24): GBDT 第 3 層
    //   gbdt_model.json (n_train >= GBDT_MIN_TRAIN) があれば _blendGBDTPrediction
    //   が L1+L2 logit に blend する。placeholder 中は何もしない (safety)。
    ENABLE_GBDT: true,           // 既定 ON: model 側 n_train で gating されるため安全
    GBDT_BLEND_WEIGHT: 0.3,      // GBDT 寄与の割合 (1-w)*L1L2 + w*GBDT
    GBDT_MIN_TRAIN: 5000,        // model.n_train がこの未満なら blend を見送り
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
var settings=_bootParseLS('boatrace_settings', {betCount3:10, betCount2:5, betCountAna:3, betMethod:'auto'});
var racerDB=_bootParseLS('boatrace_racerDB', {});
var stadiumDB=_bootParseLS('boatrace_stadiumDB', {});
// X2: 場別正規化用統計（モーター / 展示タイム）
var stadiumMotorStats=_bootParseLS('boatrace_motorStats', {});
var stadiumExhibitionStats=_bootParseLS('boatrace_exhibitionStats', {});
// X4: 潮汐データ（cron で 1日1回更新）
var tideData=null;
// オリジナル展示(各場サイトの一周/まわり足/直線、対応場のみ)。sid -> rno -> {waku -> {lap,turn,straight,ex}}
var _origExhibIndex={};
// オンデマンド対応場(ヘッダ駆動の col クラス表で _parseOrigExhibitionHtml が解析可能な場)。
//   ajax_yosou 系 11 場 + びわこ(11: 独自CMS modules/yosou/cyokuzen.php?kind=2 だが
//   表構造は col5-8=展示/一周/まわり足/直線 で同形式)。URL差は Worker 側で吸収。
var _OE_VENUES={5:1,6:1,8:1,9:1,10:1,13:1,14:1,18:1,19:1,20:1,21:1,11:1};
// 静的形式(別パーサ)でオンデマンド対応する場: 戸田(XML)/蒲郡(recomend htm)。
//   GHA 定時スクレイプの遅延を埋めるため、閲覧時に Worker 経由で最新を取得する。
var _OE_FMT={2:'toda',7:'gama',12:'suminoe',17:'miyajima',24:'omura'};
var _oeLiveTried={};

// Worker プロキシ応答(各場 cyokuzen HTML)を DOMParser で解析 → {waku -> {ex/lap/turn/straight}}。
//   ヘッダ駆動(展示/一周/まわり足/直線 のラベルから列特定)で場ごとの列構成差を吸収。
function _parseOrigExhibitionHtml(html){
  try{
    var doc=new DOMParser().parseFromString(html,'text/html');
    var tables=doc.querySelectorAll('table'), target=null;
    for(var i=0;i<tables.length;i++){
      var tx=tables[i].textContent||'';
      // 直線は任意(徳山は 展示/一周/まわり足 のみ)。一周&まわり足 で表を特定。
      if(tx.indexOf('一周')>=0&&tx.indexOf('まわり足')>=0){target=tables[i];break;}
    }
    if(!target) return null;
    var LABELS={'展示':'ex_time','展示タイム':'ex_time','一周':'lap_time','まわり足':'turn_time','直線':'straight_time'};
    var colmap={}, trs=target.querySelectorAll('tr');
    for(var r=0;r<trs.length;r++){
      var ths=trs[r].querySelectorAll('th');
      for(var t=0;t<ths.length;t++){
        var lab=(ths[t].textContent||'').replace(/\s+/g,''), f=LABELS[lab];
        if(!f||colmap[f]) continue;
        var cls=(ths[t].className||'').split(/\s+/).filter(function(c){return /^col\d+$/.test(c);});
        if(cls.length) colmap[f]=cls[0];
      }
    }
    if(!(colmap.lap_time&&colmap.turn_time)) return null;  // 直線は任意
    var bymap={};
    for(var r2=0;r2<trs.length;r2++){
      var wtd=trs[r2].querySelector('td.waku'); if(!wtd) continue;
      var waku=parseInt((wtd.textContent||'').trim(),10);
      if(!(waku>=1&&waku<=6)) continue;
      var rec={racer_boat_number:waku};
      for(var f2 in colmap){
        var td=trs[r2].querySelector('td.'+colmap[f2]);
        var v=td?parseFloat((td.textContent||'').trim()):0;
        rec[f2]=(v>0)?v:0;
      }
      bymap[waku]=rec;
    }
    return Object.keys(bymap).length?bymap:null;
  }catch(e){ return null; }
}

// 戸田XML(record: teiban/ttime/rnd/cnr/str) → {waku -> {ex/lap/turn/straight}}。
function _parseTodaXml(xml){
  try{
    var doc=new DOMParser().parseFromString(xml,'application/xml');
    var recs=doc.querySelectorAll('record'); if(!recs.length) return null;
    var bymap={};
    for(var i=0;i<recs.length;i++){
      var g=function(t){var e=recs[i].querySelector(t);var v=e?parseFloat((e.textContent||'').trim()):0;return (v>0)?v:0;};
      var tb=recs[i].querySelector('teiban');
      var waku=tb?parseInt((tb.textContent||'').trim(),10):0;
      if(!(waku>=1&&waku<=6)) continue;
      bymap[waku]={racer_boat_number:waku,ex_time:g('ttime'),lap_time:g('rnd'),turn_time:g('cnr'),straight_time:g('str')};
    }
    return Object.keys(bymap).length?bymap:null;
  }catch(e){ return null; }
}
// 蒲郡 recomend(table.ta_recomend: cho_waku + ori_time×4[展示/一周/まわり足/直線]) → bymap。
function _parseGamagoriRecomendHtml(html){
  try{
    var doc=new DOMParser().parseFromString(html,'text/html');
    var tables=doc.querySelectorAll('table'), target=null;
    for(var i=0;i<tables.length;i++){
      var tx=tables[i].textContent||'';
      if(tx.indexOf('一周')>=0&&tx.indexOf('まわり足')>=0&&tx.indexOf('直線')>=0){target=tables[i];break;}
    }
    if(!target) return null;
    var bymap={}, trs=target.querySelectorAll('tr');
    for(var r=0;r<trs.length;r++){
      var wtd=trs[r].querySelector('td.cho_waku'); if(!wtd) continue;
      var waku=parseInt((wtd.textContent||'').trim(),10);
      if(!(waku>=1&&waku<=6)) continue;
      var ots=trs[r].querySelectorAll('td.ori_time');
      var val=function(n){var t=ots[n]?parseFloat((ots[n].textContent||'').trim()):0; return (t>0)?t:0;};
      bymap[waku]={racer_boat_number:waku,ex_time:val(0),lap_time:val(1),turn_time:val(2),straight_time:val(3)};
    }
    return Object.keys(bymap).length?bymap:null;
  }catch(e){ return null; }
}
// 住之江 yoso05RR(直前情報予想)→ bymap。時刻列 th が全て col10・枠セルが waku01.. の
//   ため col 駆動が効かない。ヘッダ th の並び(枠/選手名/体重/チルト/展示/一周/まわり足)から
//   位置を取り td を位置で読む(直線列なし)。
function _parseSuminoeYoso(html){
  try{
    var doc=new DOMParser().parseFromString(html,'text/html');
    var tables=doc.querySelectorAll('table'), target=null;
    for(var i=0;i<tables.length;i++){
      var tx=tables[i].textContent||'';
      if(tx.indexOf('一周')>=0&&tx.indexOf('まわり')>=0){target=tables[i];break;}
    }
    if(!target) return null;
    var trs=target.querySelectorAll('tr'), head=null;
    for(var r=0;r<trs.length;r++){
      var ths=trs[r].querySelectorAll('th');
      if(!ths.length) continue;
      var labels=[]; for(var t=0;t<ths.length;t++) labels.push((ths[t].textContent||'').replace(/\s+/g,''));
      if(labels.indexOf('枠')>=0){ head=labels; break; }
    }
    if(!head) return null;
    var iEx=head.indexOf('展示'), iLap=head.indexOf('一周'), iTurn=head.indexOf('まわり足'), iStr=head.indexOf('直線');
    if(iLap<0||iTurn<0) return null;
    var bymap={};
    for(var r2=0;r2<trs.length;r2++){
      var first=trs[r2].querySelector('td'); if(!first) continue;
      var m=/waku0*(\d+)/.exec(first.className||'');
      if(!m) continue;
      var waku=parseInt(m[1],10); if(!(waku>=1&&waku<=6)) continue;
      var tds=trs[r2].querySelectorAll('td');
      var v=function(n){var x=(n>=0&&n<tds.length)?parseFloat((tds[n].textContent||'').trim()):0; return (x>0)?x:0;};
      bymap[waku]={racer_boat_number:waku,ex_time:v(iEx),lap_time:v(iLap),turn_time:v(iTurn),straight_time:v(iStr)};
    }
    // スタート展示 ST も抽出(dl: dt=ST文字列, dd.boatN=艇番)。".10"→0.10/"F.03"→負(フライング)。
    //   boatrace.jp 直前情報が未取得でも ST/展示タイムを補完できる。
    var dls=doc.querySelectorAll('dl');
    for(var d=0;d<dls.length;d++){
      var dt=dls[d].querySelector('dt'), dd=dls[d].querySelector('dd');
      if(!dt||!dd) continue;
      var mb=/boat([1-6])/.exec(dd.className||''); if(!mb) continue;
      var bn=parseInt(mb[1],10); if(!bymap[bn]) continue;
      var st=(dt.textContent||'').trim();
      var sv=parseFloat(st.replace(/[^0-9.]/g,''));
      if(!isNaN(sv)) bymap[bn].st_time=(/f/i.test(st)?-sv:sv);
    }
    return Object.keys(bymap).length?bymap:null;
  }catch(e){ return null; }
}
// 大村(omurakyotei.jp /yosou/sp/syussou) → bymap。位置ベース: 枠/ST/展示タイム/一周/
//   まわり足/直線/チルト、枠セル waku{N}。ST も同表にあるため st_time も取得。
function _parseOmura(html){
  try{
    var doc=new DOMParser().parseFromString(html,'text/html');
    var tables=doc.querySelectorAll('table'), target=null;
    for(var i=0;i<tables.length;i++){
      var tx=tables[i].textContent||'';
      if(tx.indexOf('一周')>=0&&tx.indexOf('まわり')>=0&&tx.indexOf('ST')>=0){target=tables[i];break;}
    }
    if(!target) return null;
    var trs=target.querySelectorAll('tr'), head=null;
    for(var r=0;r<trs.length;r++){
      var ths=trs[r].querySelectorAll('th');
      if(!ths.length) continue;
      head=[]; for(var t=0;t<ths.length;t++) head.push((ths[t].textContent||'').replace(/\s+/g,''));
      break;
    }
    if(!head) return null;
    var find=function(lab){for(var i2=0;i2<head.length;i2++){if(head[i2].indexOf(lab)>=0) return i2;} return -1;};
    var iSt=find('ST'), iEx=find('展示'), iLap=find('一周'), iTurn=find('まわり足'), iStr=find('直線');
    if(iLap<0||iTurn<0) return null;
    var bymap={};
    for(var r2=0;r2<trs.length;r2++){
      var first=trs[r2].querySelector('td'); if(!first) continue;
      var m=/waku(\d+)/.exec(first.className||''); if(!m) continue;
      var waku=parseInt(m[1],10); if(!(waku>=1&&waku<=6)) continue;
      var tds=trs[r2].querySelectorAll('td');
      var v=function(n){var x=(n>=0&&n<tds.length)?parseFloat((tds[n].textContent||'').trim()):0; return (x>0)?x:0;};
      var rec={racer_boat_number:waku,ex_time:v(iEx),lap_time:v(iLap),turn_time:v(iTurn),straight_time:v(iStr)};
      if(iSt>=0&&iSt<tds.length){
        var stx=(tds[iSt].textContent||'').trim(), sv=parseFloat(stx.replace(/[^0-9.]/g,''));
        if(!isNaN(sv)) rec.st_time=(/f/i.test(stx)?-sv:sv);
      }
      bymap[waku]=rec;
    }
    return Object.keys(bymap).length?bymap:null;
  }catch(e){ return null; }
}
// 宮島 kaisai_reload.php 応答全文(####区切り)→ bymap。位置ベース: 一周/まわり足/直線 を
//   含む表を探し、ヘッダのラベル位置で列特定、各行の先頭付近 1-6 を枠として読む。
function _parseMiyajimaReload(html){
  try{
    var doc=new DOMParser().parseFromString(html,'text/html');
    var tables=doc.querySelectorAll('table'), target=null;
    for(var i=0;i<tables.length;i++){
      var tx=tables[i].textContent||'';
      if(tx.indexOf('一周')>=0&&(tx.indexOf('まわり足')>=0||tx.indexOf('回り足')>=0)&&tx.indexOf('直線')>=0){target=tables[i];break;}
    }
    if(!target) return null;
    var LAB={'展示':'ex_time','展示タイム':'ex_time','一周':'lap_time','まわり足':'turn_time','回り足':'turn_time','直線':'straight_time'};
    var trs=target.querySelectorAll('tr'), colidx=null;
    for(var r=0;r<trs.length;r++){
      var cs=trs[r].querySelectorAll('th,td'), found={};
      for(var c=0;c<cs.length;c++){
        var f=LAB[(cs[c].textContent||'').replace(/\s+/g,'')];
        if(f&&!(f in found)) found[f]=c;
      }
      if(('lap_time' in found)&&('turn_time' in found)&&('straight_time' in found)){ colidx=found; break; }
    }
    if(!colidx) return null;
    var bymap={}, seen={};
    for(var r2=0;r2<trs.length;r2++){
      var cells=trs[r2].querySelectorAll('td');
      if(cells.length<=colidx.straight_time) continue;
      var waku=null;
      for(var k=0;k<3&&k<cells.length;k++){
        var t2=(cells[k].textContent||'').trim();
        if(/^[1-6]$/.test(t2)){ waku=parseInt(t2,10); break; }
      }
      if(waku===null||seen[waku]) continue; seen[waku]=1;
      var v=function(f){var ix=colidx[f]; if(ix==null||ix<0||ix>=cells.length) return 0; var x=parseFloat((cells[ix].textContent||'').trim()); return (x>0)?x:0;};
      bymap[waku]={racer_boat_number:waku,ex_time:v('ex_time'),lap_time:v('lap_time'),turn_time:v('turn_time'),straight_time:v('straight_time')};
    }
    return Object.keys(bymap).length?bymap:null;
  }catch(e){ return null; }
}
// 閲覧中レースのオリジナル展示を Worker 経由でオンデマンド取得 → index 更新 → 同レース閲覧中なら再描画。
function _loadOrigExhibitionLive(sid,rno){
  try{
    sid=parseInt(sid); rno=parseInt(rno);
    var fmt=_OE_VENUES[sid]?'ajax':(_OE_FMT[sid]||null);
    if(!fmt) return;
    var key=sid+'-'+rno;
    if(_oeLiveTried[key]) return; _oeLiveTried[key]=true;
    var hd=(typeof todayStr==='function')?todayStr():'';
    if(!/^\d{8}$/.test(hd)) return;
    var base=(typeof WORKER_BASE!=='undefined'&&WORKER_BASE)?WORKER_BASE:'';
    if(!base) return;
    // 空振り(展示前/失敗)はガードを解除し、後で再オープン時に再取得できるようにする。
    //   展示は締切30-40分前に出るため、展示前に開いた後でも取りに行ける必要がある。
    var _retry=function(){ _oeLiveTried[key]=false; };
    fetch(base+'/orig-exhibition-proxy?jcd='+sid+'&race='+rno+'&hd='+hd,{cache:'no-store'})
      .then(function(r){return r.ok?r.text():null;})
      .then(function(html){
        if(!html){ _retry(); return; }
        var bymap=(fmt==='toda')?_parseTodaXml(html):(fmt==='gama')?_parseGamagoriRecomendHtml(html):(fmt==='suminoe')?_parseSuminoeYoso(html):(fmt==='miyajima')?_parseMiyajimaReload(html):(fmt==='omura')?_parseOmura(html):_parseOrigExhibitionHtml(html);
        if(!bymap){ _retry(); return; }
        if(!_origExhibIndex[sid]) _origExhibIndex[sid]={};
        _origExhibIndex[sid][rno]=bymap;
        if(String(currentStadium)===String(sid)&&String(currentRace)===String(rno)&&typeof openRace==='function'){
          openRace(sid,rno);  // 再描画(predictRace も最新展示で再計算)。
        }
      }).catch(function(){ _retry(); });
  }catch(e){}
}
// X6: 対戦相性 DB
var pairwiseDB=_bootParseLS('boatrace_pairwiseDB', {});
var l2weights=_bootParseLS('boatrace_weights', null) || L2_INIT_WEIGHTS.slice();
// PB-1: 学習済レースキーセット（同レース二重学習を防ぐ）。Set ではなく
//       JSON 互換の object 形式 { "20260504_22_1": 1, ... } で永続化
var l2learnedKeys=_bootParseLS('boatrace_learned', {});
// PB-2: 学習更新カウンタ（LR decay 用）
var l2trainStep=(function(){ var v=_bootParseLS('boatrace_trainstep', 0); return (typeof v==='number'&&Number.isFinite(v))?v:0; })();

// Epic 19: data-action delegation — CSP 'unsafe-inline' 撤去のための inline onclick 代替
//   各 button/element に data-action="xxx" を付与。capture phase で document が
//   ハンドリングし、ACTION_HANDLERS テーブルから関数を引いて呼び出す。
//   引数は data-arg-* （camelCase 化された dataset.argXxx）から取得する。
//   既存 inline onclick と並存可能（先に inline が動けば preventDefault されない）。
var ACTION_HANDLERS = {
  hardReload:              function(){ if(typeof hardReload==='function') hardReload(); },
  forceRefresh:            function(){ if(typeof forceRefresh==='function') forceRefresh(); },
  refreshOdds:             function(){ if(typeof refreshOdds==='function') refreshOdds(); },
  refreshThisRace:         function(){ if(typeof refreshThisRace==='function') refreshThisRace(); },
  openStadium:             function(el){ if(typeof openStadium==='function') openStadium(el.dataset.argSid); },
  openRace:                function(el){
    var sid = el.dataset.argSid, rn = el.dataset.argRn;
    // Phase 2 完遂続編: openRace は app-rest-detail.min.js (lazy chunk) にあるため、
    //   未 load なら _ensureRaceDetailChunk で動的 load してから呼出
    if (typeof openRace === 'function') return openRace(sid, rn);
    if (typeof _ensureRaceDetailChunk === 'function') {
      _ensureRaceDetailChunk().then(function(){
        if (typeof openRace === 'function') openRace(sid, rn);
      }).catch(function(){ /* silent: 次の click で再試行 */ });
    }
  },
  showPage:                function(el){ if(typeof showPage==='function') showPage(el.dataset.argPage); },
  showDetailTab:           function(el){ if(typeof _showDetailTab==='function') _showDetailTab(el.dataset.argTab); },
  toggleRaceWatched:       function(el){ if(typeof _toggleRaceWatched==='function') _toggleRaceWatched(el.dataset.argSid, el.dataset.argRn); },
  enableNotifyPermission:  function(){ if(typeof _enableNotifyPermission==='function') _enableNotifyPermission(); },
  toggleCOI:               function(){ if(typeof _toggleCOI==='function') _toggleCOI(); },
  closeApiHealthBanner:    function(){ var b=document.getElementById('apiHealthBanner'); if(b) b.style.display='none'; },
  runBacktest:             function(){ if(typeof runBacktest==='function') runBacktest(); },
  clearCache:              function(){ if(typeof clearCache==='function') clearCache(); },
  clearHistory:            function(){ if(typeof clearHistory==='function') clearHistory(); },
  rebuildDB:               function(){ if(typeof rebuildDB==='function') rebuildDB(); },
  resetWeights:            function(){ if(typeof resetWeights==='function') resetWeights(); },
  showErrorLog:            function(){ if(typeof showErrorLog==='function') showErrorLog(); },
  copyErrorLog:            function(){ if(typeof copyErrorLog==='function') copyErrorLog(); },
  clearErrorLog:           function(){ if(typeof clearErrorLog==='function') clearErrorLog(); },
  refitPlattCoefficients:  function(){ if(typeof refitPlattCoefficients==='function') refitPlattCoefficients(); },
  exportHistoryCSV:        function(){ if(typeof exportHistoryCSV==='function') exportHistoryCSV(); },
  runForwardChainNow:      function(){ if(typeof runForwardChainNow==='function') runForwardChainNow(); },
  saveSetting:             function(el){
    if(typeof saveSetting !== 'function') return;
    var key = el.dataset.argKey;
    var v = el.value;
    if(key === 'evMode') v = (v === 'true');
    else if(key === 'bankroll') v = parseInt(v, 10) || 10000;
    saveSetting(key, v);
  },
  changeLocale:            function(el){
    // Epic 22: 言語切替 — applyLocale で再翻訳、setLocale fallback で reload
    if(typeof applyLocale === 'function'){ applyLocale(el.value); }
    else if(typeof setLocale === 'function'){ setLocale(el.value); try { location.reload(); }catch(_){} }
  },
  shareLearnedWeights:     function(){ if(typeof _shareLearnedWeights==='function') _shareLearnedWeights(); },
  emergencyStorageCleanup: function(){
    // Epic 28: 容量緊急解放 — bc_* / __corrupt_* / diag を全削除し、history も上限超なら trim
    if(!confirm('localStorage の bc_* (API キャッシュ) / 破損キー / 診断ログを全て削除します。\n履歴 / 学習データ / 設定は保持されます。よろしいですか？')) return;
    var bcN=0, coN=0;
    var ks=[];
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(k && (k.indexOf('bc_')===0 || k.indexOf('__corrupt_')>0)) ks.push(k);
    }
    ks.forEach(function(k){
      try{
        if(k.indexOf('bc_')===0) bcN++; else coN++;
        localStorage.removeItem(k);
      }catch(_){}
    });
    try { localStorage.removeItem('boatrace_diag'); }catch(_){}
    // history を 1000 件に強制 trim
    var hN=0;
    try {
      var raw = localStorage.getItem('boatrace_history');
      if(raw){
        var hist = JSON.parse(raw);
        if(Array.isArray(hist) && hist.length > 1000){
          var newHist = hist.slice(-1000);
          localStorage.setItem('boatrace_history', JSON.stringify(newHist));
          hN = hist.length - 1000;
        }
      }
    } catch(_){}
    var lsBytes=0; for(var kk in localStorage) lsBytes += ((localStorage.getItem(kk)||'').length*2);
    alert('解放完了: bc_*=' + bcN + ' / 破損=' + coN + ' / history trim=' + hN
          + '\n現在使用率: ' + (lsBytes/1024/1024).toFixed(2) + ' / 5 MB');
    if(typeof loadSettings==='function') loadSettings();
  },
};

// Epic 24: 真の FL endpoint via GitHub Issues opt-in upload
//   1. クライアント自身の L2 重みに DP noise を加算
//   2. payload を encode して新規 Issue 作成 URL を生成
//   3. ユーザが github.com で内容確認 → submit (opt-in)
//   4. .github/workflows/aggregate-fl-uploads.yml が parse → data/db/fl_uploads/ に保存
//   5. 週次 compute_community_weights.py が aggregate に取り込む
function _shareLearnedWeights(){
  if(!Array.isArray(l2weights) || l2weights.length === 0){
    alert('学習データが不足しています（まず予想を続けて学習を蓄積してください）');
    return;
  }
  if(typeof buildDPGradient !== 'function'){
    alert('DP gradient ヘルパが未ロードです（rest bundle 待ち）');
    return;
  }
  var T = Math.max(1, l2trainStep || 100);
  var dp = (typeof estimateDPParams === 'function') ? estimateDPParams(1.0, 1e-5, T) : { sigma: 0.1 };
  var dpWeights = buildDPGradient(l2weights, { maxNorm: 5.0, sigma: dp.sigma });
  var payload = {
    schema: 'br_fl_upload_v1',
    feature_dim: 12,
    feature_version: 1,
    weights: dpWeights.map(function(w){ return Math.round(w * 1000) / 1000; }),
    n_steps: T,
    dp: { epsilon: 1.0, delta: 1e-5, sigma: Math.round(dp.sigma * 1000) / 1000 },
    submitted_at: new Date().toISOString()
  };
  var body = '## FL Gradient Upload (DP-noised)\n\n'
    + '<!-- Do not edit. This issue is auto-parsed by .github/workflows/aggregate-fl-uploads.yml -->\n\n'
    + '```json\n' + JSON.stringify(payload, null, 2) + '\n```\n\n'
    + '_Submitted from BoatRace Oracle PWA. DP epsilon=' + payload.dp.epsilon + '._';
  var title = 'fl-gradient-upload: ' + payload.submitted_at.slice(0, 10);
  var url = 'https://github.com/inotaka1979/boatrace-ai/issues/new'
    + '?title=' + encodeURIComponent(title)
    + '&body=' + encodeURIComponent(body)
    + '&labels=' + encodeURIComponent('fl-gradient-upload');
  var preview = JSON.stringify(payload.weights.slice(0, 3)) + '... (12次元)';
  if(confirm('学習結果を匿名で共有しますか？\n\nDP noise 適用済 (sigma=' + payload.dp.sigma + ')、'
           + '個人特定不可な集約用途のみ使用されます。\n\n重み prefix: ' + preview)){
    try { window.open(url, '_blank'); }
    catch(e){ alert('Issue 作成 URL を開けませんでした: ' + e.message); }
  }
}

function _setupActionDelegation(){
  if(window._actionDelegationInstalled) return;
  window._actionDelegationInstalled = true;
  document.addEventListener('click', function(e){
    var el = e.target;
    var depth = 0;
    while(el && el !== document.documentElement && depth < 8){
      var act = el.dataset && el.dataset.action;
      if(act && ACTION_HANDLERS[act]){
        try { ACTION_HANDLERS[act](el, e); }
        catch(err){ console.error('[action]', act, err); }
        return;
      }
      el = el.parentElement;
      depth++;
    }
  }, true); // capture phase で確実に拾う（iOS standalone PWA で bubble が止まる事例対策）
  // change イベントも処理（select/input の data-action 用）
  document.addEventListener('change', function(e){
    var el = e.target;
    if(!el || !el.dataset) return;
    var act = el.dataset.action;
    if(act && ACTION_HANDLERS[act]){
      try { ACTION_HANDLERS[act](el, e); }
      catch(err){ console.error('[action change]', act, err); }
    }
  }, true);
}
// PJ Phase 致命バグ再発防止: split_app.py により _setupActionDelegation 等は rest bundle
//   側に MOVE される → critical の boot 時点では未定義 → ReferenceError → silent halt。
//   よって polling で typeof チェックしながら確実に rest load 完了後に呼ぶ。
(function _bootRetry(){
  var n = 0;
  function tick(){
    n++;
    var ok = (typeof _setupActionDelegation === 'function');
    if(ok){
      try { _setupActionDelegation(); } catch(_){}
      return;
    }
    if(n < 50) setTimeout(tick, 100); // 5 秒上限
  }
  tick();
})();

// Epic 19: font 等の async stylesheet の onload="this.media='all'" は CSP unsafe-inline
//   依存。代替として data-csp-onload-media を見て JS で listener を attach する。
//   既に load 済（link.sheet が truthy）なら即時適用 → race condition 回避。
//   try/catch で test VM 等の document.querySelectorAll 不在環境でも安全。
try {
  (function _setupCSPOnloadShim(){
    function applyAll(){
      if(typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
      var links = document.querySelectorAll('link[data-csp-onload-media]');
      for(var i=0;i<links.length;i++){
        (function(l){
          var target = l.getAttribute('data-csp-onload-media') || 'all';
          function flip(){ try { l.media = target; } catch(_){} }
          if(l.sheet){ flip(); return; }
          l.addEventListener('load', flip, { once: true });
          l.addEventListener('error', function(){ /* 失敗は無視、システムフォントが使われる */ }, { once: true });
        })(links[i]);
      }
    }
    if(typeof document !== 'undefined' && document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', applyAll, { once: true });
    } else {
      applyAll();
    }
  })();
} catch(_){ /* test 環境等で document が不完全な場合は no-op */ }

// Epic 18 (P2-7): SharedArrayBuffer ヘルパ — crossOriginIsolated 環境でのみ動作
//   Worker への state 転送を構造化複製（〜50ms）から SAB（〜0ms）に置換するための土台。
//   COI は opt-in（URL ?coi=1 が付いた navigation のみ SW が COOP/COEP を inject）。
//   外部リソース (font/CDN) の CORP 対応を確認するため段階展開。
function _isSABAvailable(){
  return capabilities.has('shared_array_buffer');
}
function _toggleCOI(){
  // 現在 ?coi=1 が付いていなければ付けて reload、付いていれば削除して reload
  try {
    var u = new URL(location.href);
    if(u.searchParams.get('coi') === '1'){
      u.searchParams.delete('coi');
      sessionStorage.removeItem('_coi_reloaded');
      alert('SAB 実験モードを OFF にして再読込します');
    } else {
      u.searchParams.set('coi', '1');
      alert('SAB 実験モードを ON にして再読込します。フォントやアイコンが崩れる場合は OFF に戻してください。');
    }
    location.href = u.toString();
  } catch(e){
    alert('再読込に失敗: ' + e.message);
  }
}
function _refreshCOIStatus(){
  var el = document.getElementById('coiStatus');
  if(!el) return;
  var coi = capabilities.has('cross_origin_isolated');
  var sab = _isSABAvailable();
  var qsCoi = false;
  try { qsCoi = (new URLSearchParams(location.search)).get('coi') === '1'; } catch(_){}
  el.textContent = coi ? ('✓ 有効 (SAB ' + (sab ? '可' : '不可') + ')')
                   : qsCoi ? '読込中...'
                   : 'OFF';
  el.style.color = coi ? 'var(--success)' : 'var(--text-sub)';
}
function _packStringToSAB(str){
  if(!_isSABAvailable() || typeof str !== 'string') return null;
  try {
    var enc = new TextEncoder().encode(str);
    var sab = new SharedArrayBuffer(enc.byteLength);
    new Uint8Array(sab).set(enc);
    return { sab: sab, length: enc.byteLength };
  } catch(e){
    console.warn('[SAB] pack failed:', e);
    return null;
  }
}
// 起動ログで COI 状態を可視化
try {
  console.log('[Epic18] crossOriginIsolated=' + capabilities.has('cross_origin_isolated')
    + ' SABAvailable=' + capabilities.has('shared_array_buffer'));
} catch(_){}

// Tier 3 (2026-05-24): GBDT model loader — data/db/gbdt_model.json を取得
//   src/analysis/gbdt_runtime.js (analysis 層) は no-fetch-in-analysis 規約のため、
//   IO は app.js 側に置く (community_weights と同じパターン)。
//   結果は globalThis._gbdtModel に格納 → _blendGBDTPrediction が参照。
var _gbdtModel = null;
async function loadGBDTModel(){
  try {
    var resp = await fetch('data/db/gbdt_model.json?t=' + Date.now(), { cache: 'no-store' });
    if(!resp.ok) return null;
    var json = await resp.json();
    if(!json || json.schema !== 'br_gbdt_v1') return null;
    if(json.feature_dim !== FEATURE_DIM){
      console.warn('[gbdt] feature_dim mismatch — ignoring model', json.feature_dim, '!=', FEATURE_DIM);
      return null;
    }
    _gbdtModel = json;
    return json;
  } catch(e) {
    console.warn('[gbdt] load failed:', e);
    return null;
  }
}

// Epic 17 (P2-6) + Epic 21: 階層的 federated learning — global + per-stadium 重みを blend
//   起動時に data/db/community_weights.json を取得し、in-memory に保持
//   predictRace 時に sid を見て stadium_weights が利用可能なら 3 段 blend（self/stadium/global）
var _communityWeightsCache = null;
function _blendCommunityWeights(){
  fetch('data/db/community_weights.json?_=' + Date.now(), { cache: 'no-store' })
    .then(function(r){ if(!r.ok) throw new Error('no community'); return r.json(); })
    .then(function(cw){
      if(!cw || !Array.isArray(cw.weights) || cw.weights.length !== L2_INIT_WEIGHTS.length) return;
      _communityWeightsCache = cw;
      // Epic 28d: placeholder (cw.n === 0 または _meta.placeholder=true) は blend skip。
      //   ユーザの local 学習結果 (n=390 等) を INIT_WEIGHTS と混ぜると劣化するため。
      //   compute_community_weights.py が cron で実重みを生成したら blend 開始。
      if((cw._meta && cw._meta.placeholder === true) || !cw.n || cw.n === 0){
        console.log('[community] placeholder detected (n='+cw.n+'), skip blend (cache only)');
        return;
      }
      var n = l2trainStep || 0;
      var alpha = (n < 100) ? 0.7 : 0.3;
      var blended = new Array(L2_INIT_WEIGHTS.length);
      for(var i = 0; i < blended.length; i++){
        var c = Number.isFinite(cw.weights[i]) ? cw.weights[i] : L2_INIT_WEIGHTS[i];
        var l = Number.isFinite(l2weights[i]) ? l2weights[i] : L2_INIT_WEIGHTS[i];
        blended[i] = alpha * c + (1 - alpha) * l;
      }
      l2weights = blended;
      var nStad = (cw.stadium_weights && typeof cw.stadium_weights === 'object')
        ? Object.keys(cw.stadium_weights).length : 0;
      console.log('[community] blended (alpha='+alpha+', n='+n+', cw.n='+cw.n+', stadiums='+nStad+')');
    })
    .catch(function(_){ /* community_weights 未配信は通常の状態 */ });
}
// Epic 21: predictRace 時に sid に応じた階層 blend 重みを返す
//   優先順: self (local) -> per-stadium -> global
//   weight 比率: stadium がある & local n>=100 なら (self 0.5, stadium 0.3, global 0.2)
//                stadium ある & local n<100 なら (stadium 0.5, global 0.3, self 0.2)
//                stadium 無し → 既存挙動（self / global blend）
function _hierarchicalWeights(sid){
  var cw = _communityWeightsCache;
  if(!cw || !Array.isArray(cw.weights)) return l2weights;
  // Epic 28d: placeholder は階層 blend からも除外
  if((cw._meta && cw._meta.placeholder === true) || !cw.n || cw.n === 0) return l2weights;
  var stad = (cw.stadium_weights || {})[String(sid)];
  if(!Array.isArray(stad) || stad.length !== L2_INIT_WEIGHTS.length){
    return l2weights;  // stadium 未学習 → 既存 blend を維持
  }
  var n = l2trainStep || 0;
  var ws, wt, wg;  // self / stadium / global の比率
  if(n >= 100){ ws = 0.5; wt = 0.3; wg = 0.2; }
  else        { ws = 0.2; wt = 0.5; wg = 0.3; }
  var out = new Array(L2_INIT_WEIGHTS.length);
  for(var i = 0; i < out.length; i++){
    var s = Number.isFinite(l2weights[i]) ? l2weights[i] : L2_INIT_WEIGHTS[i];
    var t = Number.isFinite(stad[i])      ? stad[i]      : L2_INIT_WEIGHTS[i];
    var g = Number.isFinite(cw.weights[i])? cw.weights[i]: L2_INIT_WEIGHTS[i];
    out[i] = ws * s + wt * t + wg * g;
  }
  return out;
}
// _blendCommunityWeights は rest bundle 側のため typeof guard 必須（さもなくば setTimeout(undefined) で silent fail）
setTimeout(function(){
  if(typeof _blendCommunityWeights === 'function'){ try { _blendCommunityWeights(); } catch(_){} }
}, 5000);
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
  // D6 (2026-05-17): SW update の transient エラーは無害なので filter。
  //   GitHub Pages のネットワーク blip / deploy 中の 5xx で発生し、次の自動 update
  //   で必ず回復する。エラーログを汚すだけなので報告しない。
  if(/ServiceWorker.*fetching the script|unknown error/i.test(msg)) {
    try { console.warn('[SW] transient update error filtered:', msg); } catch(_){}
    return;
  }
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
    if(capabilities.has('service_worker') && navigator.serviceWorker.controller){
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
    if(capabilities.has('cache_api')){
      var keys = await caches.keys();
      await Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }
    // 3) 全 SW を unregister
    if(capabilities.has('service_worker')){
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
    if(capabilities.has('cache_api')){
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
    if(rawP){ programData=indexByStadiumRace(rawP,'programs'); _noteUpdatedAt(rawP.updated_at); _noteTodayDataFromRaw(rawP,'programs'); }
    var rawPv = _filterStalePreviews(await fetchWithFallback(API_BASE+'/previews/v2/today.json?_='+t));
    if(rawPv){ previewData=indexPreviews(rawPv); _noteUpdatedAt(rawPv.updated_at); _noteTodayDataFromRaw(rawPv,'previews'); }
    // results: 自前 data/results/today.json を優先、fallback で Open API
    var rawR = null;
    try{
      var rR = await fetch('data/results/today.json?t='+t, {cache:'no-store'});
      if(rR.ok){
        var rd = await rR.json();
        var todayJst = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        // FIX: race_date は "YYYYMMDD" or "YYYY-MM-DD" の両形式があるため正規化して比較
        var todayJstNoDash = todayJst.replace(/-/g,'');
        // F4.1: スタブ (race_technique_number 全 null) の場合は OpenAPI にフォールバック
        if(rd && Array.isArray(rd.results) && rd.results.length > 0
           && rd.results.some(function(r){return String(r.race_date||'').replace(/-/g,'')===todayJstNoDash})
           && rd.results.some(function(r){return r.race_technique_number!=null})){
          rawR = rd;
        }
      }
    }catch(_){}
    if(!rawR) rawR = await fetchWithFallback(API_BASE+'/results/v2/today.json?_='+t);
    if(rawR){
      resultData=indexResults(rawR);
      _noteUpdatedAt(rawR.updated_at);
      _noteTodayDataFromRaw(rawR,'results');
      if(programData) updateDBFromResults(resultData, programData);
      await learnFromResults();
      updateHistoryWithResults();
    }
    try{
      var o = await fetch('data/odds/today.json?t='+t, {cache:'no-store'});
      // rt-fix2 P0-A: 単調性ガード付きマージ (live 取得分の巻き戻り防止)
      if(o.ok){ var od=await o.json(); _mergeOddsSnapshot(od); _noteUpdatedAt(od.updated_at); }
    }catch(e){}
    // 自前 previews を merge（finished/result の最新化）
    // D4a: local が 20 分以上古い場合は skip (Worker の方が新しい)
    try{
      var p = await fetch('data/previews/today.json?t='+t, {cache:'no-store'});
      if(p.ok){
        var pd = await p.json();
        if(_shouldApplyLocalMerge(pd)) _applyLiveDataMerge(pd);
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

/* BUILD:FEATURES:START */
"use strict";
(() => {
  // ../src/utils/features.js
  var FEATURE_VERSION = 2;
  var FEATURE_DIM_FEATURES = 24;
  function _windCourse(ctx) {
    if (!ctx.weather) return 0;
    const ws = ctx.weather.wind_speed || ctx.weather.race_wind || 0;
    const wd = ctx.weather.wind_direction || ctx.weather.race_wind_direction_number || 0;
    const isHead = wd >= 7 && wd <= 11;
    if (isHead && ctx.course === 1) return -ws / 10;
    if (isHead && ctx.course >= 4) return ws / 20;
    return 0;
  }
  function _etComp(ctx) {
    if (ctx.etRank <= 1 && ctx.st > 0 && ctx.st <= 0.1) return 1;
    if (ctx.etRank >= 4 && ctx.st >= 0.15) return -1;
    return 0;
  }
  function _formScore(ctx) {
    return ctx.form ? ctx.form.score / 10 : 0;
  }
  function _tiltAlign(ctx) {
    const c = ctx.course, t = ctx.tilt;
    if (c <= 2 && t <= -0.5) return 1;
    if (c >= 4 && t >= 0.5) return 1;
    if (c <= 2 && t >= 0.5 || c >= 4 && t <= -0.5) return -1;
    return 0;
  }
  function _waveCourse(ctx) {
    if (!ctx.weather) return 0;
    const wh = ctx.weather.wave_height || ctx.weather.race_wave || 0;
    if (ctx.course === 1) return -wh / 10;
    if (ctx.course >= 4) return wh / 20;
    return 0;
  }
  var TIDE_PHASE_COURSE_BIAS = Object.freeze({
    high: [0, 0.1, 0.05, 0, -0.05, -0.1, -0.1],
    low: [0, -0.1, -0.05, 0, 0.05, 0.1, 0.1],
    rising: [0, 0.05, 0, 0, 0, -0.05, -0.05],
    falling: [0, -0.05, 0, 0, 0, 0.05, 0.05]
  });
  function _tidePhaseCourse(ctx) {
    const extras = ctx.extras;
    if (!extras) return 0;
    const helpers = ctx.helpers || {};
    const classify = helpers.classifyTidePhase || globalThis.classifyTidePhase;
    const tideData = helpers.tideData || globalThis.tideData;
    if (typeof classify !== "function" || !tideData || !tideData.stadiums) return 0;
    const entry = tideData.stadiums[String(ctx.sid)];
    if (!entry || entry.type !== "saltwater") return 0;
    const hour = extras.raceHour;
    if (hour == null) return 0;
    const phase = classify(entry, hour);
    if (!phase) return 0;
    const row = TIDE_PHASE_COURSE_BIAS[phase];
    return row && row[ctx.course] || 0;
  }
  function _pairwiseH2H(ctx) {
    const extras = ctx.extras;
    if (!extras || !Array.isArray(extras.allBoats)) return 0;
    const helpers = ctx.helpers || {};
    const pwScore = helpers.pairwiseScore || globalThis.pairwiseScore;
    if (typeof pwScore !== "function") return 0;
    const oppRids = [];
    for (let i = 0; i < extras.allBoats.length; i++) {
      const ob = extras.allBoats[i];
      const orid = ob && ob.racer_number;
      if (orid && orid !== ctx.rid) oppRids.push(orid);
    }
    if (oppRids.length === 0) return 0;
    const r = pwScore(ctx.rid, ctx.sid, oppRids);
    return r && Number.isFinite(r.score) ? r.score / 2 : 0;
  }
  function _classFieldSpread(ctx) {
    const extras = ctx.extras;
    if (!extras || !Array.isArray(extras.allBoats) || extras.allBoats.length < 2) return 0;
    const classes = [];
    for (let i = 0; i < extras.allBoats.length; i++) {
      const cn = extras.allBoats[i] && extras.allBoats[i].racer_class_number;
      if (cn != null) classes.push(cn);
    }
    if (classes.length < 2) return 0;
    let sum = 0;
    for (let i = 0; i < classes.length; i++) sum += classes[i];
    const mean = sum / classes.length;
    let varSum = 0;
    for (let i = 0; i < classes.length; i++) varSum += (classes[i] - mean) ** 2;
    return Math.sqrt(varSum / classes.length) / 2;
  }
  function _motorFieldRank(ctx) {
    const extras = ctx.extras;
    if (!extras || !Array.isArray(extras.allBoats) || extras.allBoats.length < 2) return 0.5;
    const myMotor = ctx.pf(ctx.boat.racer_assigned_motor_top_2_percent);
    if (!Number.isFinite(myMotor) || myMotor === 0) return 0.5;
    let rank = 1;
    for (let i = 0; i < extras.allBoats.length; i++) {
      const om = ctx.pf(extras.allBoats[i].racer_assigned_motor_top_2_percent);
      if (Number.isFinite(om) && om > myMotor) rank++;
    }
    return rank / 6;
  }
  function _recentWinRate(ctx) {
    const helpers = ctx.helpers || {};
    const racerDB = helpers.racerDB || globalThis.racerDB;
    if (!racerDB || !racerDB[ctx.rid]) return 0;
    const recent = racerDB[ctx.rid].recentResults;
    if (!Array.isArray(recent) || recent.length < 5) return 0;
    const slice = recent.slice(-10);
    let wins = 0;
    for (let i = 0; i < slice.length; i++) {
      if (slice[i] === 1) wins++;
    }
    return wins / slice.length;
  }
  var FEATURE_PIPELINE = Object.freeze([
    // v1 (index 0..11) — 既存重み互換のため順序維持
    { name: "natWinPct", fn: (ctx) => ctx.pf(ctx.boat.racer_national_top_1_percent) / 10 },
    { name: "motorRate", fn: (ctx) => ctx.pf(ctx.boat.racer_assigned_motor_top_2_percent) / 100 },
    { name: "etRankNorm", fn: (ctx) => (ctx.etRank + 1) / 6 },
    { name: "courseNorm", fn: (ctx) => ctx.course / 6 },
    { name: "classNorm", fn: (ctx) => (ctx.boat.racer_class_number || 3) / 4 },
    { name: "windCourse", fn: _windCourse },
    { name: "racerCWR", fn: (ctx) => ctx.racerCWR || ctx.pf(ctx.boat.racer_national_top_1_percent) / 100 },
    { name: "stRankNorm", fn: (ctx) => (ctx.stRank + 1) / 6 },
    { name: "etComp", fn: _etComp },
    { name: "formScore", fn: _formScore },
    { name: "tiltAlign", fn: _tiltAlign },
    { name: "stadCWR", fn: (ctx) => ctx.stadCWR },
    // v2 (index 12..23) — 当初 weights=0 から学習開始
    { name: "localWinPct", fn: (ctx) => ctx.pf(ctx.boat.racer_local_top_1_percent) / 10 },
    { name: "localTop2Pct", fn: (ctx) => ctx.pf(ctx.boat.racer_local_top_2_percent) / 100 },
    { name: "weightZ", fn: (ctx) => {
      const w = ctx.pf(ctx.boat.racer_weight);
      if (!w) return 0;
      return Math.max(-3, Math.min(3, (w - 52) / 2));
    } },
    { name: "ageNorm", fn: (ctx) => {
      const a = ctx.pf(ctx.boat.racer_age);
      if (!a) return 0.5;
      return Math.max(0, Math.min(1, a / 60));
    } },
    { name: "weightAdjust", fn: (ctx) => {
      const myPv = ctx.myPv || {};
      return ctx.pf(myPv.racer_weight_adjustment) / 5;
    } },
    { name: "tiltRaw", fn: (ctx) => ctx.tilt },
    // ctx.tilt は既に pf 済
    { name: "waveCourse", fn: _waveCourse },
    { name: "tidePhaseCourse", fn: _tidePhaseCourse },
    { name: "pairwiseH2H", fn: _pairwiseH2H },
    { name: "classFieldSpread", fn: _classFieldSpread },
    { name: "motorFieldRank", fn: _motorFieldRank },
    { name: "recentWinRate", fn: _recentWinRate }
  ]);
  function buildL2Features(boat, preview, weather, etRank, stRank, sid, helpers, extras) {
    const h = helpers || {};
    const pf = h.pf || ((v) => parseFloat(v) || 0);
    const course = preview && preview.racer_course_number != null ? preview.racer_course_number : preview ? preview.racer_boat_number : boat.racer_boat_number;
    const rid = boat.racer_number || 0;
    const racerCWR = h.getRacerCourseWinRate ? h.getRacerCourseWinRate(rid, course) : null;
    const stadCWR = h.getStadiumCourseWinRate ? h.getStadiumCourseWinRate(String(sid), course) : 0;
    const myPv = preview || {};
    const st = myPv.racer_start_timing != null ? pf(myPv.racer_start_timing) : 99;
    const tilt = myPv.racer_tilt_adjustment != null ? pf(myPv.racer_tilt_adjustment) : pf(myPv.racer_tilt);
    const form = h.getRacerForm ? h.getRacerForm(rid) : null;
    const ctx = {
      boat,
      preview,
      weather,
      etRank,
      stRank,
      sid,
      course,
      rid,
      racerCWR,
      stadCWR,
      myPv,
      st,
      tilt,
      form,
      pf,
      helpers: h,
      extras: extras || null
    };
    const out = new Array(FEATURE_PIPELINE.length);
    for (let i = 0; i < FEATURE_PIPELINE.length; i++) {
      const v = FEATURE_PIPELINE[i].fn(ctx);
      out[i] = Number.isFinite(v) ? v : 0;
    }
    return out;
  }
  globalThis.FEATURE_VERSION = FEATURE_VERSION;
  globalThis.FEATURE_DIM_FEATURES = FEATURE_DIM_FEATURES;
  globalThis.FEATURE_PIPELINE = FEATURE_PIPELINE;
  globalThis.buildL2Features = buildL2Features;
  globalThis.getL2Features = function(boat, preview, weather, etRank, stRank, sid, extras) {
    return buildL2Features(boat, preview, weather, etRank, stRank, sid, {
      pf: typeof globalThis.pf === "function" ? globalThis.pf : null,
      getRacerCourseWinRate: globalThis.getRacerCourseWinRate,
      getStadiumCourseWinRate: globalThis.getStadiumCourseWinRate,
      getRacerForm: globalThis.getRacerForm,
      pairwiseScore: globalThis.pairwiseScore,
      classifyTidePhase: globalThis.classifyTidePhase,
      tideData: globalThis.tideData,
      racerDB: globalThis.racerDB
    }, extras);
  };
})();

/* BUILD:FEATURES:END */

/* BUILD:IDB:START */
"use strict";
(() => {
  // ../src/utils/idb_store.js
  var IDB_NAME = "boatrace_idb";
  var IDB_STORE = "kv";
  var IDB_VERSION = 1;
  var IDB_KEYS_LARGE = [
    "boatrace_racerDB",
    "boatrace_stadiumDB",
    "boatrace_pairwiseDB",
    "boatrace_motorStats",
    "boatrace_exhibitionStats"
  ];
  var _idbInstance = null;
  var _idbAvailable = globalThis.capabilities && typeof globalThis.capabilities.has === "function" ? globalThis.capabilities.has("indexed_db") : typeof indexedDB !== "undefined";
  function _openIDB() {
    if (_idbInstance) return Promise.resolve(_idbInstance);
    if (!_idbAvailable) return Promise.reject(new Error("IDB unavailable"));
    return new Promise(function(resolve, reject) {
      let req;
      try {
        req = indexedDB.open(IDB_NAME, IDB_VERSION);
      } catch (e) {
        _idbAvailable = false;
        reject(e);
        return;
      }
      req.onupgradeneeded = function() {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function() {
        _idbInstance = req.result;
        _idbInstance.onversionchange = function() {
          try {
            _idbInstance.close();
          } catch (_) {
          }
          _idbInstance = null;
        };
        resolve(_idbInstance);
      };
      req.onerror = function() {
        reject(req.error);
      };
      req.onblocked = function() {
        reject(new Error("IDB blocked"));
      };
    });
  }
  function idbGet(key) {
    return _openIDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function() {
          resolve(req.result === void 0 ? null : req.result);
        };
        req.onerror = function() {
          reject(req.error);
        };
      });
    }).catch(function() {
      return null;
    });
  }
  function idbPut(key, value) {
    return _openIDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        const tx = db.transaction(IDB_STORE, "readwrite");
        const req = tx.objectStore(IDB_STORE).put(value, key);
        req.onsuccess = function() {
          resolve(true);
        };
        req.onerror = function() {
          reject(req.error);
        };
      });
    }).catch(function(e) {
      try {
        if (typeof reportError === "function")
          reportError({ type: "warn", msg: "idbPut failed: " + (e && e.message || "unknown"), key });
      } catch (_) {
      }
      return false;
    });
  }
  function idbDelete(key) {
    return _openIDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(IDB_STORE, "readwrite");
        const req = tx.objectStore(IDB_STORE).delete(key);
        req.onsuccess = function() {
          resolve(true);
        };
        req.onerror = function() {
          resolve(false);
        };
      });
    }).catch(function() {
      return false;
    });
  }
  function idbKeys() {
    return _openIDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = function() {
          resolve(req.result || []);
        };
        req.onerror = function() {
          resolve([]);
        };
      });
    }).catch(function() {
      return [];
    });
  }
  function idbBytes() {
    if (navigator && navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function(e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }).catch(function() {
        return { usage: 0, quota: 0 };
      });
    }
    return Promise.resolve({ usage: 0, quota: 0 });
  }
  function idbMigrateFromLS() {
    if (!_idbAvailable) return Promise.resolve({ migrated: [], skipped: ["idb_unavailable"], deduped: [] });
    const migrated = [];
    const errors = [];
    const deduped = [];
    const tasks = IDB_KEYS_LARGE.map(function(key) {
      return idbGet(key).then(function(existing) {
        if (existing != null) {
          let lsHas = false;
          try {
            lsHas = localStorage.getItem(key) != null;
          } catch (_) {
          }
          if (lsHas) {
            try {
              localStorage.removeItem(key);
              deduped.push(key);
            } catch (_) {
            }
          }
          return;
        }
        let lsRaw = null;
        try {
          lsRaw = localStorage.getItem(key);
        } catch (_) {
        }
        if (lsRaw == null) return;
        let parsed;
        try {
          parsed = JSON.parse(lsRaw);
        } catch (_) {
          return;
        }
        if (parsed == null) return;
        return idbPut(key, parsed).then(function(ok) {
          if (ok) {
            try {
              localStorage.removeItem(key);
            } catch (_) {
            }
            migrated.push(key);
          } else {
            errors.push(key);
          }
        });
      });
    });
    return Promise.all(tasks).then(function() {
      return { migrated, errors, deduped };
    });
  }
  globalThis.idbGet = idbGet;
  globalThis.idbPut = idbPut;
  globalThis.idbDelete = idbDelete;
  globalThis.idbKeys = idbKeys;
  globalThis.idbBytes = idbBytes;
  globalThis.idbMigrateFromLS = idbMigrateFromLS;
  globalThis.IDB_KEYS_LARGE = IDB_KEYS_LARGE;
  globalThis._idbAvailable = _idbAvailable;
})();

/* BUILD:IDB:END */

/* BUILD:BANDIT:START */
"use strict";
(() => {
  // ../src/utils/bandit.js
  var BANDIT_KEY = "boatrace_bandit";
  function _sampleGamma(shape) {
    if (shape < 1) {
      return _sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, v;
      do {
        x = _sampleNormal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function _sampleNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function _sampleBeta(alpha, beta) {
    const x = _sampleGamma(alpha);
    const y = _sampleGamma(beta);
    return x / (x + y);
  }
  function banditSelect(variants) {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    let best = variants[0];
    let bestSample = -Infinity;
    for (const v of variants) {
      const a = Math.max(1e-3, v.alpha || 1);
      const b = Math.max(1e-3, v.beta || 1);
      const s = _sampleBeta(a, b);
      if (s > bestSample) {
        bestSample = s;
        best = v;
      }
    }
    return best;
  }
  function banditUpdate(variants, variantId, reward) {
    const v = variants.find((x) => x.id === variantId);
    if (!v) return false;
    const r = Math.max(0, Math.min(1, +reward || 0));
    v.alpha = (v.alpha || 1) + r;
    v.beta = (v.beta || 1) + (1 - r);
    v.n = (v.n || 0) + 1;
    v.lastReward = r;
    v.lastUpdated = Date.now();
    return true;
  }
  function banditMeans(variants) {
    return variants.map((v) => ({
      id: v.id,
      mean: (v.alpha || 1) / ((v.alpha || 1) + (v.beta || 1)),
      n: v.n || 0
    })).sort((a, b) => b.mean - a.mean);
  }
  function banditLoad(defaults) {
    let parsed = null;
    try {
      const raw = localStorage.getItem(BANDIT_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (_) {
    }
    if (!parsed || !Array.isArray(parsed.variants) || parsed.variants.length === 0) {
      return Array.isArray(defaults) ? defaults.slice() : [];
    }
    return parsed.variants;
  }
  function banditSave(variants) {
    try {
      localStorage.setItem(BANDIT_KEY, JSON.stringify({ variants, updated_at: Date.now() }));
      return true;
    } catch (_) {
      return false;
    }
  }
  globalThis.banditSelect = banditSelect;
  globalThis.banditUpdate = banditUpdate;
  globalThis.banditMeans = banditMeans;
  globalThis.banditLoad = banditLoad;
  globalThis.banditSave = banditSave;
  globalThis.BANDIT_KEY = BANDIT_KEY;
})();

/* BUILD:BANDIT:END */

/* BUILD:I18N:START */
"use strict";
(() => {
  // ../src/utils/i18n.js
  var I18N_KEY = "boatrace_locale";
  var DEFAULT_LOCALE = "ja";
  var I18N_TABLES = {
    ja: {
      // common
      "common.loading": "\u30C7\u30FC\u30BF\u53D6\u5F97\u4E2D...",
      "common.refresh": "\u66F4\u65B0",
      "common.close": "\u9589\u3058\u308B",
      "common.copy": "\u30B3\u30D4\u30FC",
      "common.share": "\u5171\u6709",
      "common.delete": "\u524A\u9664",
      "common.cancel": "\u30AD\u30E3\u30F3\u30BB\u30EB",
      "common.ok": "OK",
      "common.yes": "\u306F\u3044",
      "common.no": "\u3044\u3044\u3048",
      "common.reset": "\u30EA\u30BB\u30C3\u30C8",
      "common.show": "\u8868\u793A",
      "common.execute": "\u5B9F\u884C",
      // race
      "race.honmei": "\u672C\u547D",
      "race.middle": "\u6DF7\u6226",
      "race.ana": "\u7A74",
      "race.confidence": "\u4FE1\u983C\u5EA6",
      "race.lineup": "\u51FA\u8D70\u8868",
      "race.ai_reasoning": "AI\u4E88\u60F3\u30FB\u8CB7\u3044\u76EE",
      "race.odds_picks": "\u30AA\u30C3\u30BA",
      "race.back_to_list": "\u2190 \u30EC\u30FC\u30B9\u4E00\u89A7\u306B\u623B\u308B",
      "race.back_to_top": "\u2190 \u5834\u9078\u629E\u306B\u623B\u308B",
      "race.refresh_this": "\u{1F504} \u3053\u306E\u30EC\u30FC\u30B9\u3092\u66F4\u65B0",
      // page
      "page.top": "\u30C8\u30C3\u30D7",
      "page.stats": "\u6210\u7E3E",
      "page.backtest": "\u691C\u8A3C",
      "page.settings": "\u8A2D\u5B9A",
      // settings
      "settings.bet_count_3": "3\u9023\u5358 \u8CB7\u3044\u76EE\u70B9\u6570",
      "settings.bet_count_2": "2\u9023\u5358 \u8CB7\u3044\u76EE\u70B9\u6570",
      "settings.bet_method": "\u8CB7\u3044\u76EE\u65B9\u5F0F",
      "settings.kpi_mode": "KPI \u30E2\u30FC\u30C9",
      "settings.ev_mode": "EV \u30E2\u30FC\u30C9",
      "settings.ev_min": "EV \u6700\u4F4E\u95BE\u5024",
      "settings.kelly_frac": "Kelly \u6BD4\u7387",
      "settings.bankroll": "\u8CC7\u91D1 (\u5186)",
      "settings.notify": "\u7684\u4E2D\u901A\u77E5",
      "settings.coi": "SAB\u9AD8\u901F\u5316(\u5B9F\u9A13)",
      "settings.cache": "\u30C7\u30FC\u30BF\u30AD\u30E3\u30C3\u30B7\u30E5",
      "settings.history": "\u6210\u7E3E\u5C65\u6B74",
      "settings.racer_db": "\u9078\u624B/\u5834DB",
      "settings.weights": "\u5B66\u7FD2\u91CD\u307F",
      "settings.errors": "\u30A8\u30E9\u30FC\u30ED\u30B0",
      "settings.platt": "\u78BA\u7387\u6821\u6B63 (Platt)",
      "settings.csv_export": "\u5C65\u6B74 CSV \u30A8\u30AF\u30B9\u30DD\u30FC\u30C8",
      "settings.forward_chain": "Forward-chain \u8A55\u4FA1",
      "settings.language": "\u8868\u793A\u8A00\u8A9E",
      // notify
      "notify.permission_request": "\u8A31\u53EF\u30EA\u30AF\u30A8\u30B9\u30C8",
      "notify.permission_granted": "\u2713 \u8A31\u53EF\u6E08",
      "notify.permission_denied": "\xD7 \u62D2\u5426\uFF08\u30D6\u30E9\u30A6\u30B6\u8A2D\u5B9A\u3067\u5909\u66F4\u53EF\uFF09",
      "notify.permission_default": "\u672A\u8A2D\u5B9A",
      "notify.title": "\u304A\u6C17\u306B\u5165\u308A\u30EC\u30FC\u30B9\u306E\u7D50\u679C\u304C\u78BA\u5B9A",
      // api
      "api.health.fail": "API \u53D6\u5F97\u5931\u6557",
      "api.health.cached": "\u30AD\u30E3\u30C3\u30B7\u30E5\u4F7F\u7528\u4E2D",
      "api.health.warning": "\u8868\u793A\u304C\u53E4\u3044\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059",
      "api.health.retry": "\u518D\u8A66\u884C",
      // backtest
      "backtest.run": "\u25B6 \u30D0\u30C3\u30AF\u30C6\u30B9\u30C8\u5B9F\u884C",
      "backtest.period": "\u671F\u9593",
      "backtest.title": "\u30D0\u30C3\u30AF\u30C6\u30B9\u30C8",
      // stats
      "stats.today_total": "\u672C\u65E5 \u5224\u5B9A\u6E08",
      "stats.tri_hits": "3\u9023\u5358\u7684\u4E2D",
      "stats.tri_recovery": "3\u9023\u5358\u56DE\u53CE\u7387",
      "stats.loading": "\u8AAD\u8FBC\u4E2D...",
      // confidence stars
      "confidence.label": "\u4FE1\u983C\u5EA6",
      // motor evaluation labels
      "motor.\u8D85\u629C": "\u8D85\u629C",
      "motor.\u597D\u6A5F": "\u597D\u6A5F",
      "motor.\u4E26\u6A5F": "\u4E26\u6A5F",
      "motor.\u4F4E\u8ABF": "\u4F4E\u8ABF",
      "motor.\u6574\u5099\u8981": "\u6574\u5099\u8981",
      // form labels
      "form.\u7D76\u597D\u8ABF": "\u7D76\u597D\u8ABF",
      "form.\u597D\u8ABF": "\u597D\u8ABF",
      "form.\u666E\u901A": "\u666E\u901A",
      "form.\u4E0D\u8ABF": "\u4E0D\u8ABF",
      "form.\u7D76\u4E0D\u8ABF": "\u7D76\u4E0D\u8ABF",
      // misc
      "misc.no_data": "\u30C7\u30FC\u30BF\u306A\u3057"
    },
    en: {
      // common
      "common.loading": "Loading...",
      "common.refresh": "Refresh",
      "common.close": "Close",
      "common.copy": "Copy",
      "common.share": "Share",
      "common.delete": "Delete",
      "common.cancel": "Cancel",
      "common.ok": "OK",
      "common.yes": "Yes",
      "common.no": "No",
      "common.reset": "Reset",
      "common.show": "Show",
      "common.execute": "Run",
      // race
      "race.honmei": "Favorite",
      "race.middle": "Mixed",
      "race.ana": "Long shot",
      "race.confidence": "Confidence",
      "race.lineup": "Lineup",
      "race.ai_reasoning": "AI prediction & picks",
      "race.odds_picks": "Odds",
      "race.back_to_list": "\u2190 Back to race list",
      "race.back_to_top": "\u2190 Back to stadiums",
      "race.refresh_this": "\u{1F504} Refresh this race",
      // page
      "page.top": "Top",
      "page.stats": "Stats",
      "page.backtest": "Backtest",
      "page.settings": "Settings",
      // settings
      "settings.bet_count_3": "Trifecta # of bets",
      "settings.bet_count_2": "Exacta # of bets",
      "settings.bet_method": "Betting method",
      "settings.kpi_mode": "KPI mode",
      "settings.ev_mode": "EV mode",
      "settings.ev_min": "Min EV threshold",
      "settings.kelly_frac": "Kelly fraction",
      "settings.bankroll": "Bankroll (JPY)",
      "settings.notify": "Win notification",
      "settings.coi": "SAB acceleration (exp.)",
      "settings.cache": "Data cache",
      "settings.history": "Bet history",
      "settings.racer_db": "Racer / stadium DB",
      "settings.weights": "Learned weights",
      "settings.errors": "Error log",
      "settings.platt": "Probability calibration (Platt)",
      "settings.csv_export": "CSV export",
      "settings.forward_chain": "Forward-chain eval",
      "settings.language": "Display language",
      // notify
      "notify.permission_request": "Request permission",
      "notify.permission_granted": "\u2713 Granted",
      "notify.permission_denied": "\xD7 Denied (change in browser settings)",
      "notify.permission_default": "Not set",
      "notify.title": "Watched race result confirmed",
      // api
      "api.health.fail": "API fetch failed",
      "api.health.cached": "Using cached data",
      "api.health.warning": "Displayed data may be stale",
      "api.health.retry": "Retry",
      // backtest
      "backtest.run": "\u25B6 Run backtest",
      "backtest.period": "Period",
      "backtest.title": "Backtest",
      // stats
      "stats.today_total": "Today judged",
      "stats.tri_hits": "Trifecta hits",
      "stats.tri_recovery": "Trifecta ROI",
      "stats.loading": "Loading...",
      // confidence
      "confidence.label": "Confidence",
      // motor evaluation labels
      "motor.\u8D85\u629C": "Top-tier",
      "motor.\u597D\u6A5F": "Good",
      "motor.\u4E26\u6A5F": "Average",
      "motor.\u4F4E\u8ABF": "Poor",
      "motor.\u6574\u5099\u8981": "Maintenance",
      // form labels
      "form.\u7D76\u597D\u8ABF": "Excellent",
      "form.\u597D\u8ABF": "Good",
      "form.\u666E\u901A": "Average",
      "form.\u4E0D\u8ABF": "Poor",
      "form.\u7D76\u4E0D\u8ABF": "Terrible",
      // misc
      "misc.no_data": "No data"
    },
    // Epic 25: zh-CN (簡体中文) — UI 60キー完全翻訳
    "zh-CN": {
      // common
      "common.loading": "\u52A0\u8F7D\u4E2D...",
      "common.refresh": "\u5237\u65B0",
      "common.close": "\u5173\u95ED",
      "common.copy": "\u590D\u5236",
      "common.share": "\u5206\u4EAB",
      "common.delete": "\u5220\u9664",
      "common.cancel": "\u53D6\u6D88",
      "common.ok": "\u786E\u5B9A",
      "common.yes": "\u662F",
      "common.no": "\u5426",
      "common.reset": "\u91CD\u7F6E",
      "common.show": "\u663E\u793A",
      "common.execute": "\u6267\u884C",
      // race
      "race.honmei": "\u672C\u547D",
      "race.middle": "\u6DF7\u6218",
      "race.ana": "\u51B7\u95E8",
      "race.confidence": "\u53EF\u4FE1\u5EA6",
      "race.lineup": "\u51FA\u573A\u8868",
      "race.ai_reasoning": "AI \u63A8\u7406\u4E0E\u4E70\u70B9",
      "race.odds_picks": "\u8D54\u7387",
      "race.back_to_list": "\u2190 \u8FD4\u56DE\u6BD4\u8D5B\u5217\u8868",
      "race.back_to_top": "\u2190 \u8FD4\u56DE\u8D5B\u573A\u9009\u62E9",
      "race.refresh_this": "\u{1F504} \u5237\u65B0\u6B64\u573A\u6BD4\u8D5B",
      // page
      "page.top": "\u9996\u9875",
      "page.stats": "\u4E1A\u7EE9",
      "page.backtest": "\u56DE\u6D4B",
      "page.settings": "\u8BBE\u7F6E",
      // settings
      "settings.bet_count_3": "\u4E09\u8FDE\u5355\u6CE8\u6570",
      "settings.bet_count_2": "\u4E8C\u8FDE\u5355\u6CE8\u6570",
      "settings.bet_method": "\u6295\u6CE8\u65B9\u5F0F",
      "settings.kpi_mode": "KPI \u6A21\u5F0F",
      "settings.ev_mode": "EV \u6A21\u5F0F",
      "settings.ev_min": "EV \u6700\u4F4E\u9608\u503C",
      "settings.kelly_frac": "Kelly \u6BD4\u7387",
      "settings.bankroll": "\u8D44\u91D1 (\u65E5\u5143)",
      "settings.notify": "\u4E2D\u5956\u901A\u77E5",
      "settings.coi": "SAB \u52A0\u901F (\u5B9E\u9A8C)",
      "settings.cache": "\u6570\u636E\u7F13\u5B58",
      "settings.history": "\u6295\u6CE8\u5386\u53F2",
      "settings.racer_db": "\u9009\u624B / \u8D5B\u573A DB",
      "settings.weights": "\u5B66\u4E60\u6743\u91CD",
      "settings.errors": "\u9519\u8BEF\u65E5\u5FD7",
      "settings.platt": "\u6982\u7387\u6821\u51C6 (Platt)",
      "settings.csv_export": "CSV \u5BFC\u51FA",
      "settings.forward_chain": "Forward-chain \u8BC4\u4F30",
      "settings.language": "\u663E\u793A\u8BED\u8A00",
      // notify
      "notify.permission_request": "\u8BF7\u6C42\u6743\u9650",
      "notify.permission_granted": "\u2713 \u5DF2\u6388\u6743",
      "notify.permission_denied": "\xD7 \u5DF2\u62D2\u7EDD\uFF08\u5728\u6D4F\u89C8\u5668\u8BBE\u7F6E\u4E2D\u66F4\u6539\uFF09",
      "notify.permission_default": "\u672A\u8BBE\u7F6E",
      "notify.title": "\u5173\u6CE8\u6BD4\u8D5B\u7ED3\u679C\u5DF2\u786E\u8BA4",
      // api
      "api.health.fail": "API \u83B7\u53D6\u5931\u8D25",
      "api.health.cached": "\u4F7F\u7528\u7F13\u5B58\u6570\u636E",
      "api.health.warning": "\u663E\u793A\u6570\u636E\u53EF\u80FD\u8FC7\u65F6",
      "api.health.retry": "\u91CD\u8BD5",
      // backtest
      "backtest.run": "\u25B6 \u8FD0\u884C\u56DE\u6D4B",
      "backtest.period": "\u671F\u95F4",
      "backtest.title": "\u56DE\u6D4B",
      // stats
      "stats.today_total": "\u4ECA\u65E5\u5DF2\u5224\u5B9A",
      "stats.tri_hits": "\u4E09\u8FDE\u5355\u4E2D\u5956",
      "stats.tri_recovery": "\u4E09\u8FDE\u5355\u56DE\u6536\u7387",
      "stats.loading": "\u52A0\u8F7D\u4E2D...",
      // confidence
      "confidence.label": "\u53EF\u4FE1\u5EA6",
      // motor evaluation labels
      "motor.\u8D85\u629C": "\u6781\u4F73",
      "motor.\u597D\u6A5F": "\u826F\u597D",
      "motor.\u4E26\u6A5F": "\u4E00\u822C",
      "motor.\u4F4E\u8ABF": "\u8F83\u5DEE",
      "motor.\u6574\u5099\u8981": "\u9700\u68C0\u4FEE",
      // form labels
      "form.\u7D76\u597D\u8ABF": "\u6781\u4F73",
      "form.\u597D\u8ABF": "\u826F\u597D",
      "form.\u666E\u901A": "\u4E00\u822C",
      "form.\u4E0D\u8ABF": "\u8F83\u5DEE",
      "form.\u7D76\u4E0D\u8ABF": "\u6781\u5DEE",
      // misc
      "misc.no_data": "\u65E0\u6570\u636E"
    }
  };
  var _currentLocale = DEFAULT_LOCALE;
  function _detectLocale() {
    try {
      const qs = new URLSearchParams(location.search || "");
      const q = qs.get("lang");
      if (q && I18N_TABLES[q]) return q;
    } catch (_) {
    }
    try {
      const stored = localStorage.getItem(I18N_KEY);
      if (stored && I18N_TABLES[stored]) return stored;
    } catch (_) {
    }
    try {
      const nav = (navigator.language || "").slice(0, 2);
      if (nav && I18N_TABLES[nav]) return nav;
    } catch (_) {
    }
    return DEFAULT_LOCALE;
  }
  function setLocale(locale) {
    if (!I18N_TABLES[locale]) return false;
    _currentLocale = locale;
    try {
      localStorage.setItem(I18N_KEY, locale);
    } catch (_) {
    }
    return true;
  }
  function getLocale() {
    return _currentLocale;
  }
  function t(key, params) {
    const table = I18N_TABLES[_currentLocale] || I18N_TABLES[DEFAULT_LOCALE];
    let text = table[key];
    if (text == null) {
      text = I18N_TABLES[DEFAULT_LOCALE] && I18N_TABLES[DEFAULT_LOCALE][key] || key;
    }
    if (params && typeof params === "object") {
      text = text.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] != null ? String(params[k]) : "{{" + k + "}}");
    }
    return text;
  }
  function availableLocales() {
    return Object.keys(I18N_TABLES);
  }
  function translatePage(root) {
    const r = root || (typeof document !== "undefined" ? document : null);
    if (!r || typeof r.querySelectorAll !== "function") return 0;
    let n = 0;
    r.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const text = t(key);
      if (text !== key) {
        el.textContent = text;
        n++;
      }
    });
    r.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      const spec = el.getAttribute("data-i18n-attr") || "";
      spec.split(",").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (!attr || !key) return;
        const text = t(key);
        if (text !== key) {
          el.setAttribute(attr, text);
          n++;
        }
      });
    });
    return n;
  }
  function applyLocale(locale) {
    if (!setLocale(locale)) return false;
    translatePage();
    return true;
  }
  _currentLocale = _detectLocale();
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => translatePage(), { once: true });
    } else {
      setTimeout(() => translatePage(), 0);
    }
  }
  globalThis.t = t;
  globalThis.setLocale = setLocale;
  globalThis.getLocale = getLocale;
  globalThis.availableLocales = availableLocales;
  globalThis.I18N_TABLES = I18N_TABLES;
  globalThis.translatePage = translatePage;
  globalThis.applyLocale = applyLocale;
})();

/* BUILD:I18N:END */

/* BUILD:DP_GRADIENT:START */
"use strict";
(() => {
  // ../src/utils/dp_gradient.js
  function _sampleStdNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function _l2Norm(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) {
      if (Number.isFinite(arr[i])) s += arr[i] * arr[i];
    }
    return Math.sqrt(s);
  }
  function clipGradient(grad, maxNorm) {
    if (!Array.isArray(grad)) return grad;
    const m = Math.max(1e-3, maxNorm || 1);
    const n = _l2Norm(grad);
    if (n <= m || n === 0) return grad.map((g) => Number.isFinite(g) ? g : 0);
    const scale = m / n;
    return grad.map((g) => Number.isFinite(g) ? g * scale : 0);
  }
  function addGaussianNoise(grad, sigma) {
    if (!Array.isArray(grad)) return grad;
    const s = Math.max(0, sigma || 0);
    if (s === 0) return grad.slice();
    return grad.map((g) => Number.isFinite(g) ? g + _sampleStdNormal() * s : 0);
  }
  function buildDPGradient(grad, opts) {
    const o = opts || {};
    const clipped = clipGradient(grad, o.maxNorm != null ? o.maxNorm : 1);
    return addGaussianNoise(clipped, o.sigma != null ? o.sigma : 0.1);
  }
  function estimateDPParams(epsilon, delta, T) {
    const eps = Math.max(0.01, epsilon || 1);
    const dlt = Math.max(1e-9, delta || 1e-5);
    const t = Math.max(1, T || 100);
    const sensitivity = 1;
    const epsPerStep = eps / Math.sqrt(t);
    const sigma = Math.sqrt(2 * Math.log(1.25 / dlt)) * sensitivity / epsPerStep;
    return { sigma, epsPerStep, T: t, epsilon: eps, delta: dlt };
  }
  globalThis.clipGradient = clipGradient;
  globalThis.addGaussianNoise = addGaussianNoise;
  globalThis.buildDPGradient = buildDPGradient;
  globalThis.estimateDPParams = estimateDPParams;
})();

/* BUILD:DP_GRADIENT:END */

// PF-2: softmax は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）

// PF-2: safeDiv は BUILD:SAFE_STORAGE / MATH bundle で提供（旧 inline 削除）

function boatBadge(num){return'<span class="boat-badge" style="background:'+BOAT_COLORS[num]+';color:'+BOAT_TEXT[num]+';border:1px solid '+(num===1?'#ccc':'transparent')+'">'+num+'</span>'}
// PF-6: boatBadgeLg は未使用（grep で 0 callsite）→ 削除
function starsHtml(n){var s='';for(var i=0;i<5;i++)s+=i<n?'★':'☆';return s}
function pf(v){return parseFloat(v)||0}

// P0-7: API health 状態 — 'ok' | 'cached' | 'fail'
/* BUILD:DISCOVERY_OPENAPI:START */
"use strict";
(() => {
  // ../src/discovery/openapi_client.js
  var _g = (
    /** @type {any} */
    globalThis
  );
  var BC_MAX_BYTES = 100 * 1024;
  var WORKER_BASE = "https://boatrace-scrape-trigger.inotaka1979.workers.dev";
  var _apiHealth = { programs: "ok", previews: "ok", results: "ok", odds: "ok" };
  function _setApiHealth(url, state) {
    const key = url.indexOf("/programs/") >= 0 ? "programs" : url.indexOf("/previews/") >= 0 ? "previews" : url.indexOf("/results/") >= 0 ? "results" : url.indexOf("/odds/") >= 0 ? "odds" : null;
    if (!key) return;
    _apiHealth[key] = state;
    if (typeof _g._renderApiHealthBanner === "function") {
      try {
        _g._renderApiHealthBanner();
      } catch (_) {
      }
    }
  }
  function _mapToWorkerUrl(openapiUrl) {
    if (openapiUrl.indexOf("/programs/v2/today.json") >= 0) return WORKER_BASE + "/api/programs";
    if (openapiUrl.indexOf("/previews/v2/today.json") >= 0) return WORKER_BASE + "/api/previews";
    if (openapiUrl.indexOf("/results/v2/today.json") >= 0) return WORKER_BASE + "/api/results";
    return null;
  }
  function _mapToOfficialUrl(openapiUrl) {
    if (openapiUrl.indexOf("/programs/v2/today.json") >= 0) return "data/programs/today.json";
    return null;
  }
  function _markFetchOk() {
    try {
      _g._lastFetchOkAt = Date.now();
    } catch (_) {
    }
  }
  function _fetchOne(url, timeoutMs) {
    const signal = _g.capabilities.makeTimeoutSignal(timeoutMs || 1e4);
    return fetch(url, { signal, cache: "no-store" }).then(function(r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }
  function fetchWithFallback(url) {
    const baseUrl = url.split("?")[0];
    const workerUrl = _mapToWorkerUrl(baseUrl);
    function _onOk(d) {
      _setApiHealth(baseUrl, "ok");
      _markFetchOk();
      try {
        const serialized = JSON.stringify({ data: d, time: Date.now() });
        if (serialized.length <= BC_MAX_BYTES) {
          localStorage.setItem(_g.cacheKey(baseUrl), serialized);
        }
      } catch (_) {
      }
      return d;
    }
    const primary = workerUrl ? _fetchOne(workerUrl + "?_=" + Date.now(), 4e3) : Promise.reject(new Error("no-worker-mapping"));
    function _openapiThenCache() {
      return _fetchOne(url, 8e3).then(_onOk).catch(function(e) {
        console.warn("API error:", baseUrl, e.message);
        try {
          const c = localStorage.getItem(_g.cacheKey(baseUrl));
          if (c) {
            const o = JSON.parse(c);
            if (Date.now() - o.time < 6e5) {
              _setApiHealth(baseUrl, "cached");
              return o.data;
            }
          }
        } catch (_) {
        }
        _setApiHealth(baseUrl, "fail");
        return null;
      });
    }
    return primary.then(_onOk).catch(function(workerErr) {
      if (workerErr && workerErr.message !== "no-worker-mapping") {
        console.warn("[fetch] worker miss:", workerErr.message);
      }
      const officialUrl = _mapToOfficialUrl(baseUrl);
      if (!officialUrl) return _openapiThenCache();
      return _fetchOne(officialUrl + "?_=" + Date.now(), 5e3).then(function(d) {
        if (!d || !Array.isArray(d.programs) || d.programs.length === 0) {
          throw new Error("official-empty");
        }
        return _onOk(d);
      }).catch(function(offErr) {
        if (offErr && offErr.message !== "official-empty") {
          console.warn("[fetch] official miss, falling back to openapi:", offErr.message);
        }
        return _openapiThenCache();
      });
    });
  }
  function validateApiPayload(apiJson, key) {
    if (!apiJson || typeof apiJson !== "object") return false;
    if (!Array.isArray(apiJson[key])) return false;
    return true;
  }
  function indexByStadiumRace(apiJson, key) {
    if (!validateApiPayload(apiJson, key)) {
      if (apiJson) {
        console.warn("[schema] invalid payload for", key);
        try {
          _setApiHealth("/" + key + "/", "fail");
        } catch (_) {
        }
      }
      return null;
    }
    const arr = apiJson[key];
    const result = {};
    let todayIso = null;
    try {
      if (typeof _g.todayStr === "function") {
        const t = _g.todayStr();
        if (t && t.length === 8) {
          todayIso = t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8);
        }
      }
    } catch (_) {
    }
    arr.forEach(function(item) {
      if (todayIso && item.race_date && item.race_date !== todayIso) return;
      const sid = String(item.race_stadium_number);
      const rn = String(item.race_number);
      if (!result[sid]) result[sid] = {};
      result[sid][rn] = item;
    });
    return result;
  }
  function indexPreviews(apiJson) {
    const indexed = indexByStadiumRace(apiJson, "previews");
    if (!indexed) return null;
    for (const sid in indexed) {
      for (const rn in indexed[sid]) {
        const p = (
          /** @type {any} */
          indexed[sid][rn]
        );
        p.weather = {
          wind_speed: p.race_wind || 0,
          wind_direction: p.race_wind_direction_number || 0,
          wave_height: p.race_wave || 0,
          temperature: p.race_temperature || 0,
          water_temperature: p.race_water_temperature || 0,
          weather_number: p.race_weather_number || 0
        };
      }
    }
    return indexed;
  }
  function indexResults(apiJson) {
    const indexed = indexByStadiumRace(apiJson, "results");
    if (!indexed) return null;
    for (const sid in indexed) {
      for (const rn in indexed[sid]) {
        const r = (
          /** @type {any} */
          indexed[sid][rn]
        );
        const isFinished = r.race_technique_number != null;
        if (isFinished && r.boats && Array.isArray(r.boats)) {
          r.results = r.boats.filter(function(b) {
            return b.racer_place_number != null;
          }).map(function(b) {
            return {
              place: b.racer_place_number,
              racer_boat_number: b.racer_boat_number,
              racer_course_number: b.racer_course_number,
              racer_number: b.racer_number,
              racer_name: b.racer_name,
              racer_start_timing: b.racer_start_timing
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
  function _filterStalePreviews(raw) {
    if (!raw || !Array.isArray(raw.previews) || !raw.previews.length) return raw;
    const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
    const firstDate = raw.previews[0].race_date || "";
    if (firstDate && firstDate !== today) {
      console.warn("\u516C\u5F0F API previews \u306F\u53E4\u3044(" + firstDate + " JST), \u5168\u4EF6 skip");
      return { previews: [], updated_at: raw.updated_at };
    }
    const filtered = raw.previews.filter(function(p) {
      const hasWeather = (p.race_wind || 0) > 0 || (p.race_water_temperature || 0) > 0 || (p.race_temperature || 0) > 0 || (p.race_wave || 0) > 0 || p.race_wind_direction_number != null;
      let bs = p.boats || [];
      if (!Array.isArray(bs))
        bs = Object.keys(bs).map(function(k) {
          return bs[k];
        });
      const hasExh = bs.some(function(b) {
        return b && (b.racer_exhibition_time || 0) > 0;
      });
      return hasWeather || hasExh;
    });
    if (filtered.length !== raw.previews.length) {
      console.info("previews: " + raw.previews.length + " \u2192 " + filtered.length + " (\u30C7\u30FC\u30BF\u672A\u53D6\u5F97\u306E\u30EC\u30FC\u30B9\u3092\u9664\u5916)");
    }
    return { previews: filtered, updated_at: raw.updated_at };
  }
  function _probeWorkerHealth() {
    try {
      if (typeof fetch !== "function") return;
      fetch(WORKER_BASE + "/health", { cache: "no-store" }).then(function(r) {
        return r.ok ? r.json() : null;
      }).then(function(j) {
        _g._workerHealthy = !!(j && j.ok);
      }).catch(function() {
        _g._workerHealthy = false;
      }).then(function() {
        if (typeof _g._renderApiHealthBanner === "function") _g._renderApiHealthBanner();
      });
    } catch (_) {
    }
  }
  _g.BC_MAX_BYTES = BC_MAX_BYTES;
  _g.WORKER_BASE = WORKER_BASE;
  _g._probeWorkerHealth = _probeWorkerHealth;
  _g._apiHealth = _apiHealth;
  if (typeof _g._lastFetchOkAt !== "number") _g._lastFetchOkAt = 0;
  _g._setApiHealth = _setApiHealth;
  _g._mapToWorkerUrl = _mapToWorkerUrl;
  _g._fetchOne = _fetchOne;
  _g.fetchWithFallback = fetchWithFallback;
  _g.validateApiPayload = validateApiPayload;
  _g.indexByStadiumRace = indexByStadiumRace;
  _g.indexPreviews = indexPreviews;
  _g.indexResults = indexResults;
  _g._filterStalePreviews = _filterStalePreviews;
})();

/* BUILD:DISCOVERY_OPENAPI:END */

/* BUILD:REPORTING_STATUS_BANNER:START */
"use strict";
(() => {
  // ../src/reporting/status_banner.js
  var _g = (
    /** @type {any} */
    globalThis
  );
  function _renderApiHealthBanner() {
    const banner = document.getElementById("apiHealthBanner");
    const msg = document.getElementById("apiHealthMsg");
    if (!banner || !msg) return;
    const health = _g._apiHealth || {};
    const fails = [];
    const cached = [];
    for (const k in health) {
      if (health[k] === "fail") fails.push(k);
      else if (health[k] === "cached") cached.push(k);
    }
    const workerDown = _g._workerHealthy === false;
    if (fails.length === 0 && cached.length === 0 && !workerDown) {
      banner.style.display = "none";
      return;
    }
    const parts = [];
    if (workerDown) parts.push("\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u914D\u4FE1\u304C\u505C\u6B62\u4E2D \u2014 \u76F4\u63A5\u53D6\u5F97\u306B\u5207\u66FF\u6E08\u307F");
    if (fails.length) parts.push("API\u53D6\u5F97\u5931\u6557: " + fails.join("/"));
    if (cached.length) parts.push("\u30AD\u30E3\u30C3\u30B7\u30E5\u4F7F\u7528\u4E2D: " + cached.join("/"));
    msg.textContent = parts.join(" / ") + " \u2014 \u8868\u793A\u304C\u53E4\u3044\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059";
    banner.style.display = "block";
  }
  function _renderFreshness() {
    const el = document.getElementById("dataFreshness");
    if (!el) return;
    const now = Date.now();
    const fetchAt = _g._lastFetchOkAt || 0;
    const dataGen = _g._dataLatestUpdatedAt || 0;
    if (!fetchAt && !dataGen) {
      el.textContent = "";
      return;
    }
    function _ago(ms) {
      const sec = Math.max(0, Math.floor(ms / 1e3));
      if (sec < 60) return sec + "\u79D2\u524D";
      if (sec < 3600) return Math.floor(sec / 60) + "\u5206\u524D";
      return Math.floor(sec / 3600) + "\u6642\u9593\u524D";
    }
    const todayJst = new Date(now + 9 * 36e5).toISOString().slice(0, 10);
    if (dataGen) {
      const dataDate = new Date(dataGen + 9 * 36e5).toISOString().slice(0, 10);
      if (dataDate !== todayJst) {
        el.innerHTML = '<span style="color:#BDBDBD">\u{1F4A4} \u672C\u65E5\u30C7\u30FC\u30BF\u53D6\u5F97\u5F85\u3061</span>';
        return;
      }
    }
    let label;
    let color;
    if (dataGen) {
      const genMin = Math.floor((now - dataGen) / 6e4);
      label = "\u{1F552} " + _ago(now - dataGen);
      color = genMin < 15 ? "#A5D6A7" : genMin < 40 ? "#FFCC80" : "#FF8A80";
    } else {
      label = "\u{1F552} \u53D6\u5F97\u4E2D";
      color = "#BDBDBD";
    }
    let conn = "";
    if (fetchAt) {
      const fsec = Math.floor((now - fetchAt) / 1e3);
      const fetchAgo = fsec < 5 ? "\u305F\u3063\u305F\u4ECA" : _ago(now - fetchAt);
      conn = fsec < 300 ? '<span style="color:#81C784;font-size:0.85em"> \u30FB\u{1F4E1}\u63A5\u7D9AOK(\u53D6\u5F97 ' + fetchAgo + ")</span>" : '<span style="color:#FF8A80;font-size:0.85em"> \u30FB\u{1F4E1}\u63A5\u7D9A\u4E0D\u8ABF(' + _ago(now - fetchAt) + ")</span>";
    } else {
      conn = '<span style="color:#FFCC80;font-size:0.85em"> \u30FB\u{1F4E1}\u672A\u63A5\u7D9A</span>';
    }
    el.innerHTML = '<span style="color:' + color + '">' + label + "</span>" + conn;
  }
  _g._renderApiHealthBanner = _renderApiHealthBanner;
  _g._renderFreshness = _renderFreshness;
})();

/* BUILD:REPORTING_STATUS_BANNER:END */

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

/* BUILD:ANALYSIS_BACKTEST:START */
"use strict";
(() => {
  // ../src/analysis/backtest.js
  var _g = (
    /** @type {any} */
    globalThis
  );
  function _btParseDate(yyyymmdd) {
    if (!yyyymmdd || typeof yyyymmdd !== "string" || yyyymmdd.length !== 8) return null;
    return new Date(
      parseInt(yyyymmdd.slice(0, 4), 10),
      parseInt(yyyymmdd.slice(4, 6), 10) - 1,
      parseInt(yyyymmdd.slice(6, 8), 10)
    );
  }
  function runBacktestEngine(history, opt) {
    opt = opt || {};
    const periodDays = opt.periodDays != null ? opt.periodDays : 14;
    const stakePerBet = opt.stakePerBet || 100;
    const ledger = [];
    let cutoff = null;
    if (periodDays > 0) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - periodDays);
      cutoff = d;
    }
    history.forEach(function(h) {
      if (!h.actual) return;
      if (cutoff) {
        const hd = _btParseDate(h.date);
        if (!hd || hd < cutoff) return;
      }
      ledger.push(h);
    });
    let totalBets = 0, totalStake = 0, totalPayout = 0;
    let hits3 = 0, hits2 = 0;
    const dailyROI = {};
    let maxDD = 0, currentLoss = 0;
    const byType = {
      honmei: { n: 0, hits: 0, payout: 0 },
      middle: { n: 0, hits: 0, payout: 0 },
      ana: { n: 0, hits: 0, payout: 0 }
    };
    const byStadium = {};
    ledger.sort(function(a, b) {
      return (a.date || "").localeCompare(b.date || "");
    });
    ledger.forEach(function(h) {
      const bets3n = (h.trifecta_bets || []).length;
      const bets2n = (h.exacta_bets || []).length;
      const stake = (bets3n + bets2n) * stakePerBet;
      const payout = (h.payout3 || 0) + (h.payout2 || 0);
      totalBets += bets3n + bets2n;
      totalStake += stake;
      totalPayout += payout;
      if (h.trifecta_hit) hits3++;
      if (h.exacta_hit) hits2++;
      const rt = h.raceType || "middle";
      if (byType[rt]) {
        byType[rt].n++;
        if (h.trifecta_hit) byType[rt].hits++;
        byType[rt].payout += h.payout3 || 0;
      }
      const sid = parseInt(h.stadium);
      if (sid && sid >= 1 && sid <= 24) {
        if (!byStadium[sid])
          byStadium[sid] = {
            sid,
            name: typeof _g.STADIUMS === "object" && _g.STADIUMS[sid] || "\u5834" + sid,
            n: 0,
            hits3: 0,
            hits2: 0,
            stake: 0,
            payout: 0,
            payout3: 0,
            // Tier 2 (2026-05-24): Bootstrap CI 用に per-race (stake, payout) を保持
            races: []
          };
        const ss = byStadium[sid];
        ss.n++;
        ss.stake += stake;
        ss.payout += payout;
        ss.payout3 += h.payout3 || 0;
        if (ss.races) ss.races.push({ stake, payout });
        if (h.trifecta_hit) ss.hits3++;
        if (h.exacta_hit) ss.hits2++;
      }
      const net = payout - stake;
      if (net < 0) {
        currentLoss += -net;
        maxDD = Math.max(maxDD, currentLoss);
      } else {
        currentLoss = 0;
      }
      const d = h.date || "unknown";
      if (!dailyROI[d]) dailyROI[d] = { stake: 0, payout: 0, n: 0 };
      dailyROI[d].stake += stake;
      dailyROI[d].payout += payout;
      dailyROI[d].n++;
    });
    const roi = totalStake > 0 ? totalPayout / totalStake : 0;
    const hitRate3 = ledger.length > 0 ? hits3 / ledger.length : 0;
    const hitRate2 = ledger.length > 0 ? hits2 / ledger.length : 0;
    const dailyReturns = Object.keys(dailyROI).map(function(d) {
      const s = dailyROI[d].stake;
      return s > 0 ? (dailyROI[d].payout - s) / s : 0;
    });
    const meanR = dailyReturns.length > 0 ? dailyReturns.reduce(function(a, b) {
      return a + b;
    }, 0) / dailyReturns.length : 0;
    const varR = dailyReturns.length > 1 ? dailyReturns.reduce(function(a, r) {
      return a + (r - meanR) * (r - meanR);
    }, 0) / (dailyReturns.length - 1) : 0;
    const stdR = Math.sqrt(varR);
    const sharpe = stdR > 0 ? meanR / stdR : 0;
    const calibration = _computeCalibrationMetrics(ledger);
    for (const sid in byStadium) {
      const ss = byStadium[sid];
      ss.roi = ss.stake > 0 ? ss.payout / ss.stake : 0;
      ss.roiCI = _bootstrapROICI(ss.races || [], 1e3);
      delete ss.races;
    }
    return {
      samples: ledger.length,
      totalBets,
      totalStake,
      totalPayout,
      netProfit: totalPayout - totalStake,
      roi,
      hitRate3,
      hitRate2,
      maxDrawdown: maxDD,
      sharpe,
      byType,
      byStadium,
      dailyROI,
      period: periodDays,
      logLoss: calibration.logLoss,
      brier: calibration.brier,
      ece: calibration.ece,
      calibratedSamples: calibration.n,
      leakageNote: "NOTE: \u65E2\u5B58\u5C65\u6B74\u306F\u4E88\u60F3\u6642\u70B9\u3067\u65E2\u306B L2 \u5B66\u7FD2\u304C\u53CD\u6620\u6E08\u307F\u306E\u305F\u3081 look-ahead leakage \u306E\u53EF\u80FD\u6027\u3042\u308A\u3002\u5B8C\u5168\u306A forward-chain \u8A55\u4FA1\u306B\u306F runForwardChainBacktest() \u3092\u4F7F\u7528"
    };
  }
  function runForwardChainBacktest(history, opt) {
    opt = opt || {};
    const warmup = opt.warmupRaces != null ? opt.warmupRaces : 30;
    const sorted = (history || []).slice().filter(function(h) {
      return h.actual && h.actual.length > 0 && Array.isArray(h.mark_probs);
    });
    sorted.sort(function(a, b) {
      const d = (a.date || "").localeCompare(b.date || "");
      if (d !== 0) return d;
      return (a.stadium || 0) - (b.stadium || 0) || (a.race || 0) - (b.race || 0);
    });
    const evalSet = sorted.slice(warmup);
    const cal = _computeCalibrationMetrics(evalSet);
    return {
      totalSamples: sorted.length,
      warmupSkipped: Math.min(warmup, sorted.length),
      evaluatedSamples: evalSet.length,
      logLoss: cal.logLoss,
      brier: cal.brier,
      ece: cal.ece,
      note: "\u6642\u7CFB\u5217\u9806\u3067 warmup \u5F8C\u306E\u30EC\u30FC\u30B9\u306E\u307F\u8A55\u4FA1\u3002\u5B8C\u5168\u306A forward-chain \u518D\u5B66\u7FD2\u306B\u306F\u30EC\u30FC\u30B9\u6642\u70B9\u306E features \u4FDD\u5B58\u304C\u5FC5\u8981"
    };
  }
  function _bootstrapROICI(races, nResamples) {
    nResamples = nResamples || 1e3;
    if (!Array.isArray(races) || races.length < 10) return null;
    const n = races.length;
    const rois = new Array(nResamples);
    let seed = Date.now() >>> 0 | 1;
    const _rand = function() {
      seed = seed * 1664525 + 1013904223 >>> 0;
      return seed / 4294967295;
    };
    for (let r = 0; r < nResamples; r++) {
      let sumStake = 0;
      let sumPayout = 0;
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(_rand() * n);
        sumStake += races[idx].stake;
        sumPayout += races[idx].payout;
      }
      rois[r] = sumStake > 0 ? sumPayout / sumStake : 0;
    }
    rois.sort(function(a, b) {
      return a - b;
    });
    const loIdx = Math.floor(nResamples * 0.025);
    const hiIdx = Math.ceil(nResamples * 0.975) - 1;
    return { lo: rois[loIdx], hi: rois[hiIdx], n };
  }
  function _computeReliabilityBins(entries) {
    const bins = [];
    for (let i = 0; i < 10; i++) bins.push({ sum: 0, hit: 0, n: 0 });
    entries.forEach(function(h) {
      if (!h.actual || !h.actual.length || !Array.isArray(h.mark_probs)) return;
      const winner = h.actual[0];
      const probs = {};
      h.mark_probs.forEach(function(mp) {
        probs[mp.boat] = mp.prob;
      });
      for (let b = 1; b <= 6; b++) {
        const p = probs[b];
        if (!Number.isFinite(p) || p <= 0 || p >= 1) continue;
        const binIdx = Math.min(9, Math.floor(p * 10));
        bins[binIdx].sum += p;
        bins[binIdx].n += 1;
        if (b === winner) bins[binIdx].hit += 1;
      }
    });
    return bins.map(function(b, i) {
      return {
        binStart: i / 10,
        binEnd: (i + 1) / 10,
        avgP: b.n > 0 ? b.sum / b.n : 0,
        actRate: b.n > 0 ? b.hit / b.n : 0,
        n: b.n
      };
    });
  }
  function _computeCalibrationMetrics(entries) {
    let logLossSum = 0, brierSum = 0, n = 0;
    const bins = [];
    for (let i = 0; i < 10; i++) bins.push({ sum: 0, hit: 0, n: 0 });
    entries.forEach(function(h) {
      if (!h.actual || !h.actual.length || !Array.isArray(h.mark_probs)) return;
      const winner = h.actual[0];
      const probs = {};
      h.mark_probs.forEach(function(mp) {
        probs[mp.boat] = mp.prob;
      });
      const pWin = probs[winner];
      if (!Number.isFinite(pWin) || pWin <= 0 || pWin >= 1) return;
      logLossSum += -Math.log(pWin);
      for (let b = 1; b <= 6; b++) {
        const p = probs[b] || 0;
        const y = b === winner ? 1 : 0;
        brierSum += (p - y) * (p - y);
      }
      const binIdx = Math.min(9, Math.floor(pWin * 10));
      bins[binIdx].sum += pWin;
      bins[binIdx].hit += 1;
      bins[binIdx].n += 1;
      n++;
    });
    const logLoss = n > 0 ? logLossSum / n : 0;
    const brier = n > 0 ? brierSum / n : 0;
    let ece = 0;
    bins.forEach(function(b) {
      if (b.n === 0) return;
      const avgP = b.sum / b.n;
      const actRate = b.hit / b.n;
      ece += b.n / Math.max(1, n) * Math.abs(avgP - actRate);
    });
    return { logLoss, brier, ece, n };
  }
  _g._btParseDate = _btParseDate;
  _g.runBacktestEngine = runBacktestEngine;
  _g.runForwardChainBacktest = runForwardChainBacktest;
  _g._computeCalibrationMetrics = _computeCalibrationMetrics;
  _g._bootstrapROICI = _bootstrapROICI;
  _g._computeReliabilityBins = _computeReliabilityBins;
})();

/* BUILD:ANALYSIS_BACKTEST:END */

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
    var html = '<div class="card"><div class="p-12">';
    html += '<div class="card-title">📈 バックテスト結果</div>';
    html += '<table class="text-w-full-12"><tbody>';
    html += '<tr><td>対象レース</td><td class="ta-r">'+r.samples+' R</td></tr>';
    html += '<tr><td>投資総額</td><td class="ta-r">¥'+r.totalStake.toLocaleString()+'</td></tr>';
    html += '<tr><td>払戻総額</td><td class="ta-r">¥'+r.totalPayout.toLocaleString()+'</td></tr>';
    html += '<tr><td>純損益</td><td style="text-align:right;color:'+(r.netProfit>=0?'var(--success)':'var(--danger)')+';font-weight:700">'
            +(r.netProfit>=0?'+':'')+'¥'+r.netProfit.toLocaleString()+'</td></tr>';
    html += '<tr><td><b>回収率</b></td><td style="text-align:right;color:'+roiColor+';font-weight:700;font-size:14px">'+roiPct+'%</td></tr>';
    html += '<tr><td>3連単的中率</td><td class="ta-r">'+(r.hitRate3*100).toFixed(1)+'%</td></tr>';
    html += '<tr><td>2連単的中率</td><td class="ta-r">'+(r.hitRate2*100).toFixed(1)+'%</td></tr>';
    html += '<tr><td>最大ドローダウン</td><td class="ta-r">¥'+r.maxDrawdown.toLocaleString()+'</td></tr>';
    html += '<tr><td>シャープレシオ</td><td class="ta-r">'+r.sharpe.toFixed(2)+'</td></tr>';
    html += '</tbody></table>';
    html += '</div></div>';
    resultDiv.innerHTML = html;

    // タイプ別内訳
    var dh = '<div class="card"><div class="p-12">';
    dh += '<div class="card-title">レースタイプ別</div>';
    dh += '<table class="text-w-full-12"><thead><tr><th>タイプ</th><th>R数</th><th>3連単的中</th><th>払戻合計</th></tr></thead><tbody>';
    ['honmei','middle','ana'].forEach(function(t){
      var tt = r.byType[t];
      var lbl = t==='honmei'?'⚡本命':t==='middle'?'📊混戦':'🔥穴';
      dh += '<tr><td>'+lbl+'</td><td class="ta-r">'+tt.n+'</td>'
         +'<td class="ta-r">'+tt.hits+' ('+(tt.n>0?(tt.hits/tt.n*100).toFixed(1):0)+'%)</td>'
         +'<td class="ta-r">¥'+tt.payout.toLocaleString()+'</td></tr>';
    });
    dh += '</tbody></table>';
    dh += '<div style="font-size:9px;color:var(--text-dim);margin-top:8px">'
       + '※ 簡易バックテスト: 各推奨買い目を ¥'+opt.stakePerBet+' ずつ均等購入したと仮定。'
       + '<br>※ EV/Kelly モードの精密再現には当時オッズの履歴アーカイブが必要（X7+α で実装予定）。'
       + '</div>';
    dh += '</div></div>';

    // B17 (2026-05-17): 場別集計テーブル
    // Tier 2 (2026-05-24): Bootstrap 95% CI を併記して「systematically losing 場」を判別可能に
    var stadArr = [];
    for(var ssid in r.byStadium) stadArr.push(r.byStadium[ssid]);
    if(stadArr.length > 0){
      stadArr.forEach(function(ss){
        ss.roi = ss.stake > 0 ? ss.payout / ss.stake : 0;
        ss.hitRate3 = ss.n > 0 ? ss.hits3 / ss.n : 0;
      });
      stadArr.sort(function(a,b){ return b.roi - a.roi; });
      dh += '<div class="card"><div class="p-12">';
      dh += '<div class="card-title">場別 (回収率順 + 95% CI)</div>';
      dh += '<table class="text-w-full-12"><thead><tr><th>場</th><th>R数</th><th>的中</th><th>回収率</th><th>95% CI</th><th>判定</th></tr></thead><tbody>';
      stadArr.forEach(function(ss){
        var roiPct = (ss.roi * 100).toFixed(0);
        var roiClass = ss.roi >= 1.0 ? 'recovery-positive' : (ss.roi >= 0.8 ? '' : 'recovery-negative');
        var ciStr = '—', verdict = '<span style="color:var(--text-dim)">N 不足</span>';
        if(ss.roiCI){
          var lo = (ss.roiCI.lo * 100).toFixed(0);
          var hi = (ss.roiCI.hi * 100).toFixed(0);
          ciStr = '['+lo+'%, '+hi+'%]';
          // CI が完全に 1.0 (100%) 未満なら統計的に「負け確実」 → avoid
          // CI が完全に 1.0 (100%) 超なら統計的に「勝ち確実」 → favor (現実的にはほぼ起きない)
          if(ss.roiCI.hi < 1.0)
            verdict = '<span style="color:var(--danger);font-weight:700">🚫 avoid</span>';
          else if(ss.roiCI.lo > 1.0)
            verdict = '<span style="color:var(--success);font-weight:700">⭐ favor</span>';
          else
            verdict = '<span style="color:var(--text-dim)">未確定</span>';
        }
        dh += '<tr><td><b>'+escText(ss.name)+'</b></td>'
            + '<td class="ta-r">'+ss.n+'</td>'
            + '<td class="ta-r">'+ss.hits3+' ('+(ss.hitRate3*100).toFixed(0)+'%)</td>'
            + '<td class="ta-r '+roiClass+'">'+roiPct+'%</td>'
            + '<td class="ta-r" style="font-size:10px">'+ciStr+'</td>'
            + '<td class="ta-r">'+verdict+'</td></tr>';
      });
      dh += '</tbody></table>';
      dh += '<div style="font-size:9px;color:var(--text-dim);margin-top:6px">'
         + '※ 95% CI は Bootstrap (1000 リサンプリング) で算出。<b>🚫 avoid</b>= CI 全域が 100% 未満 (統計的に負け)。<b>⭐ favor</b>= CI 全域が 100% 超 (公営競技の控除率 25% を超える勝ち、ほぼ起きない)。N&lt;10 件は CI 算出不能。</div>';
      dh += '</div></div>';
    }

    // Tier 2 (2026-05-24): Reliability diagram (calibration plot)
    // 予測確率 (X) vs 実際の的中率 (Y) を 10 bin で表示。対角線が完全校正。
    // 「70% 当たると言ったレースは本当に 70% 当たっているか」を可視化。
    try {
      var binsArr = _computeReliabilityBins(history);
      var binCount = 0;
      binsArr.forEach(function(b){ if(b.n > 0) binCount++; });
      if(binCount >= 3){
        dh += '<div class="card"><div class="p-12">';
        dh += '<div class="card-title">📊 Reliability Diagram (確率校正検証)</div>';
        dh += '<div style="font-size:11px;color:var(--text-sub);margin-bottom:8px">予測確率 (X) vs 実際の 1 着率 (Y)。対角線 (= 完全校正) に近いほど予測精度が高い。bars 上の点を結ぶ線が対角を <b>下回る</b>=過信 (overconfident)、<b>上回る</b>=過小評価。</div>';
        // 簡易 ASCII chart (Chart.js 動的 import より軽量)
        dh += '<table class="text-w-full-12" style="font-size:11px"><thead><tr><th>予測 bin</th><th>件数</th><th>平均予測%</th><th>実 1 着率%</th><th>差分</th><th>視覚</th></tr></thead><tbody>';
        binsArr.forEach(function(b){
          if(b.n === 0) return;
          var label = (b.binStart*100).toFixed(0)+'-'+(b.binEnd*100).toFixed(0)+'%';
          var predPct = (b.avgP*100).toFixed(1);
          var actPct = (b.actRate*100).toFixed(1);
          var diff = (b.actRate - b.avgP) * 100;
          var diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
          var diffColor = Math.abs(diff) < 5 ? 'var(--success)' : Math.abs(diff) < 15 ? 'var(--warn)' : 'var(--danger)';
          // 視覚: bar 風 (実 1 着率を bin の左端から伸ばす)
          var barWidth = Math.min(100, b.actRate * 100);
          var diagonal = (b.binStart + b.binEnd) * 50; // bin の中央が完全校正なら何 % か
          var bar = '<div style="position:relative;height:14px;background:#f5f5f5;border-radius:2px;overflow:hidden">'
            + '<div style="position:absolute;left:0;top:0;height:100%;width:'+barWidth+'%;background:linear-gradient(90deg,#2196F3,#4CAF50);opacity:.7"></div>'
            + '<div style="position:absolute;left:'+diagonal+'%;top:0;width:2px;height:100%;background:#000"></div>'
            + '</div>';
          dh += '<tr><td><b>'+label+'</b></td>'
              + '<td class="ta-r">'+b.n+'</td>'
              + '<td class="ta-r">'+predPct+'%</td>'
              + '<td class="ta-r">'+actPct+'%</td>'
              + '<td class="ta-r" style="color:'+diffColor+';font-weight:700">'+diffStr+'</td>'
              + '<td style="min-width:120px">'+bar+'</td></tr>';
        });
        dh += '</tbody></table>';
        dh += '<div style="font-size:9px;color:var(--text-dim);margin-top:6px">'
           + '※ 黒い縦線=完全校正点、青緑バー=実 1 着率。差分が ±5% 以内なら校正良好、±15% 超は要再校正。<br>'
           + '※ 「設定→確率校正 (Platt) 再校正」で改善可能。'
           + '</div>';
        dh += '</div></div>';
      }
    } catch(e){}

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

// P2-3: pairwise matchup の人間可読サマリ（race detail で TOP3 表示）
//   既存 pairwiseDB を活用。サンプル 5件以上、勝率差 20%以上の対戦のみ抽出。
function _renderPairwiseSummary(boats){
  if(!Array.isArray(boats) || boats.length < 2) return '';
  if(typeof pairwiseDB === 'undefined' || !pairwiseDB) return '';
  var insights = [];
  for(var i=0;i<boats.length;i++){
    for(var j=i+1;j<boats.length;j++){
      var a = boats[i], b = boats[j];
      var ridA = a.racer_number||0, ridB = b.racer_number||0;
      if(!ridA || !ridB) continue;
      var key = (ridA < ridB) ? ridA+'-'+ridB : ridB+'-'+ridA;
      var rec = pairwiseDB[key];
      if(!rec || rec.races < 5) continue;
      var aWins = rec.head2head[String(ridA)] || 0;
      var bWins = rec.head2head[String(ridB)] || 0;
      var diff = (aWins - bWins) / rec.races;
      if(Math.abs(diff) >= 0.20){
        insights.push({
          aBoat: a.racer_boat_number, bBoat: b.racer_boat_number,
          aWins: aWins, bWins: bWins, races: rec.races,
          advantage: diff > 0 ? a.racer_boat_number : b.racer_boat_number,
          absDiff: Math.abs(diff)
        });
      }
    }
  }
  if(insights.length === 0) return '';
  insights.sort(function(x,y){ return y.absDiff - x.absDiff; });
  var top = insights.slice(0, 3);
  var html = '<div style="margin-top:10px;padding:8px;background:#F3F8FF;border-left:3px solid var(--accent);border-radius:4px;font-size:11px">'
    + '<div style="font-weight:700;margin-bottom:4px">🤝 過去対戦データ (TOP'+top.length+')</div>';
  top.forEach(function(it){
    html += '<div>'+it.aBoat+'号艇 vs '+it.bBoat+'号艇: '
      + it.aWins+'勝'+it.bWins+'敗 ('+it.races+'戦) '
      + '<span style="color:var(--success);font-weight:700">→ '+it.advantage+'号艇有利</span></div>';
  });
  html += '</div>';
  return html;
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

      // 節間追跡（個人別 — racerDB 在籍者のみ）
      sortedRes.forEach(function(r){
        var rid = r.racer_number || 0;
        if(!rid || !racerDB[rid]) return;
        var rdb = racerDB[rid];
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
      });

      // 対戦相性（pairwise: 場の同レース内、j>i ループで 1 ペア 1 回）
      // 旧版は外/内の両方向で同ペアを 2 回カウントしていた（races/head2head 共に倍化）。
      // 失格艇 (place が 1〜6 の整数でない) は除外して誤クレジット防止。
      for(var ii=0; ii<sortedRes.length; ii++){
        var rA = sortedRes[ii];
        var ridA = rA && rA.racer_number || 0;
        var pA = rA && rA.place;
        if(!ridA || !(pA >= 1 && pA <= 6)) continue;
        for(var jj=ii+1; jj<sortedRes.length; jj++){
          var rB = sortedRes[jj];
          var ridB = rB && rB.racer_number || 0;
          var pB = rB && rB.place;
          if(!ridB || ridB === ridA || !(pB >= 1 && pB <= 6)) continue;
          var key = (ridA < ridB) ? (ridA+'-'+ridB) : (ridB+'-'+ridA);
          if(!pairwiseDB[key]) pairwiseDB[key] = { races: 0, head2head: {} };
          var pr = pairwiseDB[key];
          pr.races++;
          if(pA !== pB){
            var winner = (pA < pB) ? ridA : ridB;
            pr.head2head[String(winner)] = (pr.head2head[String(winner)] || 0) + 1;
          }
        }
      }
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

/* BUILD:ANALYSIS_PREDICT_SCENARIOS:START */
"use strict";
(() => {
  // ../src/analysis/predict_scenarios.js
  function predictScenarios(boats, preview, weather, sid, grade) {
    var prior = SCENARIO_PRIORS_BY_GRADE[grade || 0] || SCENARIO_PRIORS_BY_GRADE[0];
    var scen = Object.assign({}, prior);
    var sdb = stadiumDB[String(sid)];
    if (sdb && sdb.courseWinRate && sdb.courseWinRate[1]) {
      var cwr = sdb.courseWinRate[1];
      if (cwr.races >= 30) {
        var rate = cwr.win / cwr.races;
        var delta = (rate - 0.55) * 0.5;
        scen.nige = Math.max(0.2, Math.min(0.8, scen.nige + delta));
      }
    }
    if (weather) {
      var ws = weather.wind_speed || weather.race_wind || 0;
      var wh = weather.wave_height || weather.race_wave || 0;
      if (ws >= 5 || wh >= 7) {
        scen.nige *= 0.7;
        scen.makuri *= 1.3;
        scen.other *= 1.5;
      }
    }
    var sum = 0;
    for (var k in scen) sum += scen[k];
    if (sum > 0) {
      for (var k2 in scen) scen[k2] = scen[k2] / sum;
    }
    return scen;
  }
  function predictWithScenarios(boats, preview, weather, sid, grade) {
    var sc = predictScenarios(boats, preview, weather, sid, grade);
    var dist = {};
    Object.keys(SCENARIO_DIST).forEach(function(scKey) {
      var w = sc[scKey] || 0;
      var template = SCENARIO_DIST[scKey];
      Object.keys(template).forEach(function(combo) {
        dist[combo] = (dist[combo] || 0) + w * template[combo];
      });
    });
    var allCombos = [];
    for (var i = 1; i <= 6; i++)
      for (var j = 1; j <= 6; j++)
        for (var k = 1; k <= 6; k++) {
          if (i !== j && j !== k && i !== k) allCombos.push(i + "-" + j + "-" + k);
        }
    var residual = 0.05 / allCombos.length;
    allCombos.forEach(function(c3) {
      if (dist[c3] == null) dist[c3] = residual;
    });
    var s = 0;
    for (var c in dist) s += dist[c];
    if (s > 0) for (var c2 in dist) dist[c2] = dist[c2] / s;
    return { dist, scenarios: sc };
  }
  function predictEntryCourses(boats, sid) {
    var dists = boats.map(function(b) {
      return {
        boat: b.racer_boat_number,
        rid: b.racer_number,
        dist: getEntryDist(b.racer_number, b.racer_boat_number, sid)
      };
    });
    var permutations = [];
    function perm(arr, current) {
      if (arr.length === 0) {
        permutations.push(current);
        return;
      }
      for (var i2 = 0; i2 < arr.length; i2++) {
        var rest = arr.slice(0, i2).concat(arr.slice(i2 + 1));
        perm(rest, current.concat([arr[i2]]));
      }
    }
    perm([1, 2, 3, 4, 5, 6], []);
    var best = null, bestScore = -Infinity;
    permutations.forEach(function(p) {
      var s = 0;
      var valid = true;
      for (var i2 = 0; i2 < dists.length; i2++) {
        var pr = dists[i2].dist[String(p[i2])] || 0;
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
      var by = {};
      var c = {};
      boats.forEach(function(b) {
        by[b.racer_boat_number] = b.racer_boat_number;
        c[b.racer_boat_number] = 0.5;
      });
      return { byBoat: by, conf: c };
    }
    var byBoat = {}, conf = {};
    for (var i = 0; i < dists.length; i++) {
      byBoat[dists[i].boat] = best[i];
      conf[dists[i].boat] = dists[i].dist[String(best[i])] || 0;
    }
    return { byBoat, conf };
  }
  globalThis.predictScenarios = predictScenarios;
  globalThis.predictWithScenarios = predictWithScenarios;
  globalThis.predictEntryCourses = predictEntryCourses;
})();

/* BUILD:ANALYSIS_PREDICT_SCENARIOS:END */

// ===============================================
// X4: 環境データ（潮汐 R-02 / 場別風向 R-10 / 風×波交差項 R-14）
// ===============================================

// 場別風向プロファイル（イン不利になる風向の角度番号）
// JMA / 公式の風向番号は 1=北 → 16=北北西 と仮定
var STADIUM_WIND_PROFILE = {
  '02': { headWindDirs:[3,4,5],  tailWindDirs:[11,12,13], note:'北東風がイン不利（戸田）' },
  '03': { headWindDirs:[5,6,7],  tailWindDirs:[13,14,15], note:'東風がイン不利（江戸川）' },
  '04': { headWindDirs:[3,4,5],  tailWindDirs:[11,12,13], note:'運河地形・北東〜東で1コース不利（平和島）' }, // P1-A1
  '12': { headWindDirs:[7,8,9],  tailWindDirs:[15,16,1], note:'南東風で展開難（蒲郡）' },
  '14': { headWindDirs:[9,10,11],tailWindDirs:[1,2,3],   note:'南西風で荒れる（唐津）' },
  '19': { headWindDirs:[5,6,7],  tailWindDirs:[13,14,15], note:'関門海峡・南東で外有利（下関）' }, // P1-A1
  '20': { headWindDirs:[3,4,5],  tailWindDirs:[11,12,13], note:'玄界灘・北東で1コース不利（若松）' }, // P1-A1
  // 残り18場は将来 GitHub Actions nightly で「場×風向×1コース勝率」を集計し
  // 自動更新する `config/wind_profile.json` で補完予定（P2）。
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
// P1-A3: 級別×コースの ST 標本平均（プロ定石ベースの経験値）
//   新人/転勤直後で stStats 5件未満でも、級別での想定 ST に対する乖離で評価可能に
//   キー: classNum (1=A1, 2=A2, 3=B1=base, 4=B2)
var ST_CLASS_BASELINE = { 1: 0.13, 2: 0.15, 3: 0.16, 4: 0.17 };
function stDivergenceScore(thisSt, rid, course){
  if(thisSt < 0) return -6;   // フライング
  var rdb = racerDB[rid];
  var key = String(course);
  if(rdb && rdb.stStats && rdb.stStats[key] && rdb.stStats[key].count >= 5){
    var personalAvg = rdb.stStats[key].mean;
    var z = (thisSt - personalAvg) / 0.04;
    if(z <= -1.0) return +5;   // 自己平均より +1σ 以上鋭い → 神スタ
    if(z <= -0.5) return +3;
    if(z <= +0.5) return 0;
    if(z <= +1.0) return -2;
    return -4;
  }
  // P1-A3: サンプル不足時は級別 baseline で z 評価（旧: 絶対値判定だけでは新人で常に同じ）
  var classNum = (rdb && rdb.classNum) || 3;
  var classAvg = ST_CLASS_BASELINE[classNum] || 0.16;
  var zc = (thisSt - classAvg) / 0.03;  // class baseline は分散小さめなので std=0.03
  if(zc <= -1.0) return +4;
  if(zc <= -0.5) return +2;
  if(zc <= +0.5) return 0;
  if(zc <= +1.0) return -2;
  return -3;
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
  // Epic 28: bc_* (fetch cache) の自動 expire — 10分以上経過したものを起動時に削除
  //   localStorage 5MB 超過 (ユーザ報告 5.34MB / 107%) の主因が bc_* 累積だったため
  //   既存の clearCache() は手動全削除のみ、自動 expire が無く累積していた
  var bcExpired = 0;
  var bcKept = 0;
  var bcCutoffMs = Date.now() - 10*60*1000; // 10 分
  var bcKeys = [];
  for(var i=0;i<localStorage.length;i++){
    var k = localStorage.key(i);
    if(k && k.indexOf('bc_')===0) bcKeys.push(k);
  }
  bcKeys.forEach(function(k){
    try {
      var raw = localStorage.getItem(k);
      if(!raw){ localStorage.removeItem(k); bcExpired++; return; }
      var obj = JSON.parse(raw);
      if(!obj || typeof obj.time !== 'number' || obj.time < bcCutoffMs){
        localStorage.removeItem(k);
        bcExpired++;
      } else {
        bcKept++;
      }
    } catch(_){
      // 破損 cache は削除
      try { localStorage.removeItem(k); bcExpired++; } catch(__){}
    }
  });
  if(bcExpired > 0) console.log('bc_* cache expire 削除: '+bcExpired+'件 (有効残'+bcKept+'件)');
}

// Epic 13: saveDB は IDB 優先、fallback で LS（既存呼出は同期 API のまま fire-and-forget）
function saveDB(){
  if(typeof idbPut === 'function'){
    // IDB 書込（失敗時は idbPut 内で reportError）
    idbPut('boatrace_racerDB', racerDB);
    idbPut('boatrace_stadiumDB', stadiumDB);
    return;
  }
  // IDB 不可環境（古い iOS Safari 等）は LS fallback
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
// PC-2b: scoreBoatV2 から抽出した純粋計算ヘルパ + L2 features
//   Clearwing Phase 2 完遂続きで src/analysis/l2_features.js に移管。
//   note: worker_predictor.js にも twin が存在する (Web Worker 用)。

/* BUILD:ANALYSIS_L2_FEATURES:START */
"use strict";
(() => {
  // ../src/analysis/l2_features.js
  function _computeClassAttenuation(allBoats) {
    if (!Array.isArray(allBoats) || !allBoats.length) return 1;
    var avgClass = 0;
    allBoats.forEach(function(b) {
      avgClass += b && b.racer_class_number || 3;
    });
    avgClass /= allBoats.length;
    if (avgClass >= 3.5) return 0.55;
    if (avgClass >= 3) return 0.7;
    if (avgClass >= 2.5) return 0.85;
    return 1;
  }
  function _classCourseMult(classNum, course) {
    var c = classNum || 3, k = course || 3;
    if (c < 1) c = 1;
    if (c > 4) c = 4;
    if (k < 1) k = 1;
    if (k > 6) k = 6;
    return CLASS_COURSE_MULT[k - 1][c - 1];
  }
  function _computeRaceScenario(allBoats, allPreviews, sid, raceHour) {
    if (!Array.isArray(allBoats)) return null;
    var attackProbs = [0, 0, 0, 0, 0, 0, 0];
    for (var c = 2; c <= 6; c++) {
      var bt = allBoats.find(function(b) {
        return b.racer_boat_number === c;
      });
      if (!bt) {
        attackProbs[c] = 0.1;
        continue;
      }
      var rid = bt.racer_number || 0;
      var style = getRacerCourseStyle(rid, c) || DEFAULT_COURSE_TECHNIQUE[c];
      if (!style) {
        attackProbs[c] = 0.08;
        continue;
      }
      var total = (style.nige || 0) + (style.sashi || 0) + (style.makuri || 0) + (style.makuriSashi || 0) + (style.nuki || 0) + (style.megumare || 0);
      if (total < 3) {
        attackProbs[c] = 0.08;
        continue;
      }
      var sashiRate = (style.sashi || 0) / total;
      var makuriComboRate = ((style.makuri || 0) + (style.makuriSashi || 0)) / total;
      var threat = c === 2 ? sashiRate * 0.7 + makuriComboRate * 0.4 : c === 3 ? makuriComboRate * 0.6 + sashiRate * 0.3 : makuriComboRate * 0.5;
      if (threat < 0.02) threat = 0.02;
      if (threat > 0.55) threat = 0.55;
      attackProbs[c] = threat;
    }
    if (sid != null && raceHour != null && typeof tideData !== "undefined" && tideData && tideData.stadiums) {
      var tideEntry = tideData.stadiums[String(sid)];
      if (tideEntry && typeof classifyTidePhase === "function") {
        var phase = classifyTidePhase(tideEntry, raceHour);
        var outsideMakuriFactor = phase === "high" ? 0.85 : phase === "low" ? 1.15 : 1;
        if (outsideMakuriFactor !== 1) {
          for (var k = 4; k <= 6; k++) {
            attackProbs[k] *= outsideMakuriFactor;
            if (attackProbs[k] < 0.02) attackProbs[k] = 0.02;
            if (attackProbs[k] > 0.55) attackProbs[k] = 0.55;
          }
        }
      }
    }
    var nigeSuccess = 1;
    for (var i = 2; i <= 6; i++) nigeSuccess *= 1 - attackProbs[i];
    if (nigeSuccess < 0.02) nigeSuccess = 0.02;
    if (nigeSuccess > 0.95) nigeSuccess = 0.95;
    return { nigeSuccess, attackProbs };
  }
  function _resolveCourse(boat, preview, predictedEntries) {
    var bn = boat.racer_boat_number;
    if (preview && preview.racer_course_number != null) {
      return { course: preview.racer_course_number, entryConf: 1, source: "preview" };
    }
    if (predictedEntries && predictedEntries.byBoat && predictedEntries.byBoat[bn]) {
      return {
        course: predictedEntries.byBoat[bn],
        entryConf: predictedEntries.conf[bn] || 0.5,
        source: "predicted"
      };
    }
    return { course: preview ? preview.racer_boat_number : bn, entryConf: 1, source: "frame" };
  }
  function getL2Features(boat, preview, weather, etRank, stRank, sid) {
    var course = preview && preview.racer_course_number != null ? preview.racer_course_number : preview ? preview.racer_boat_number : boat.racer_boat_number;
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
    else if (course <= 2 && tilt >= 0.5 || course >= 4 && tilt <= -0.5) tiltAlign = -1;
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
      stadCWR
    ];
  }
  function l2Predict(features6) {
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
        if (fi) z += fi * (w[i] || 0);
      }
      logits[b] = z;
    }
    return softmax(logits);
  }
  function l2Update(features6, winnerIdx) {
    var probs = l2Predict(features6);
    var lr = L2_LR0 / (1 + l2trainStep / L2_LR_TAU);
    for (var b = 0; b < 6; b++) {
      var target = b === winnerIdx ? 1 : 0;
      var err = probs[b] - target;
      for (var i = 0; i < l2weights.length; i++) {
        var grad = err * (features6[b][i] || 0) + L2_LAMBDA * l2weights[i];
        l2weights[i] -= lr * grad;
      }
      _updateFeatureStats(features6[b]);
    }
    l2trainStep += 1;
    safeSet("boatrace_weights", l2weights);
    safeSet("boatrace_trainstep", l2trainStep);
    if (l2trainStep % 50 === 0) safeSet("boatrace_featurestats", _featureStats);
  }
  globalThis._computeClassAttenuation = _computeClassAttenuation;
  globalThis._classCourseMult = _classCourseMult;
  globalThis._computeRaceScenario = _computeRaceScenario;
  globalThis._resolveCourse = _resolveCourse;
  globalThis.getL2Features = getL2Features;
  globalThis.l2Predict = l2Predict;
  globalThis.l2Update = l2Update;
})();

/* BUILD:ANALYSIS_L2_FEATURES:END */

// P0-1: 場別×級別×コースの相互作用係数。
//   常識: 「A1の1コース」と「B2の1コース」では同じ scwr でも実勝率は大きく違う。
//   1コースほど級の影響大、6コースほど小（外側はそもそも不利が支配的）。
//   row index = course-1, col index = classNum-1 (1=A1,2=A2,3=B1=base,4=B2)
var CLASS_COURSE_MULT = [
  [1.10, 1.02, 1.00, 0.85],
  [1.08, 1.02, 1.00, 0.88],
  [1.06, 1.02, 1.00, 0.92],
  [1.05, 1.02, 1.00, 0.94],
  [1.03, 1.01, 1.00, 0.97],
  [1.02, 1.01, 1.00, 0.98]
];

// P0-2: レース毎に1度だけ算出するシナリオ確率。
//   nige_success_prob(1コース) = ∏(1 - attack_prob_c) for c=2..6
//   attack_prob は隣接艇の決まり手主体率を簡略化（max(sashi, makuri+makuriSashi)）
//   1コース以外は対象外（影響度が小さく、既存 C カテゴリで十分カバー）。

// X3 進入予想 → 採用コースと信頼度を決定
//   preview.racer_course_number > predictedEntries > 枠番 の優先順

/* BUILD:ANALYSIS_SCORE_BOAT:START */
"use strict";
(() => {
  // ../src/analysis/score_boat.js
  function scoreBoatV2(boat, preview, weather, allBoats, allPreviews, sid, predictedEntries, rno) {
    var score = 0;
    var reasons = [];
    var risks = [];
    var bn = boat.racer_boat_number;
    var resolved = _resolveCourse(boat, preview, predictedEntries);
    var course = resolved.course;
    var entryConf = resolved.entryConf;
    if (resolved.source === "predicted" && course !== bn && entryConf >= 0.6) {
      reasons.push("\u9032\u5165\u4E88\u60F3: " + bn + "\u67A0\u2192" + course + "\u30B3\u30FC\u30B9(" + (entryConf * 100).toFixed(0) + "%)");
    }
    var rid = boat.racer_number || 0;
    var scwr = getStadiumCourseWinRate(String(sid), course);
    var baseCoursePt = scwr * COURSE_MULTIPLIER;
    var attn = _computeClassAttenuation(allBoats);
    var classCM = _classCourseMult(boat.racer_class_number, course);
    var coursePt;
    if (resolved.source === "predicted" && course !== bn && entryConf > 0 && entryConf < 1) {
      var scwrFrame = getStadiumCourseWinRate(String(sid), bn);
      var classCMFrame = _classCourseMult(boat.racer_class_number, bn);
      var ptPred = scwr * COURSE_MULTIPLIER * attn * classCM;
      var ptFrame = scwrFrame * COURSE_MULTIPLIER * attn * classCMFrame;
      coursePt = ptPred * entryConf + ptFrame * (1 - entryConf);
    } else {
      coursePt = baseCoursePt * attn * classCM;
    }
    score += coursePt;
    if (course === 1 && allBoats) {
      var _rh = null;
      try {
        if (typeof programData !== "undefined" && programData && programData[String(sid)]) {
          var _races = programData[String(sid)];
          var _firstKey = Object.keys(_races)[0];
          var _ca = _firstKey ? _races[_firstKey].race_closed_at || "" : "";
          if (_ca) {
            var _hh = _ca.split(" ")[1] || "";
            if (_hh) _rh = parseInt(_hh.split(":")[0], 10);
          }
        }
      } catch (_) {
      }
      var sc = _computeRaceScenario(allBoats, allPreviews, sid, _rh);
      if (sc && Number.isFinite(sc.nigeSuccess)) {
        var lodd = Math.log(sc.nigeSuccess / (1 - sc.nigeSuccess));
        score += lodd * 4;
        if (sc.nigeSuccess >= 0.65) reasons.push("\u9003\u3052\u6210\u529F\u7387\u63A8\u5B9A " + Math.round(sc.nigeSuccess * 100) + "%");
        else if (sc.nigeSuccess <= 0.35) risks.push("\u9003\u3052\u963B\u6B62\u30EA\u30B9\u30AF(" + Math.round((1 - sc.nigeSuccess) * 100) + "%)");
      }
    }
    if (preview && preview.racer_course_number != null) {
      if (bn > course) {
        score += 3;
        reasons.push("\u524D\u4ED8\u3051\u6210\u529F(" + bn + "\u2192" + course + "\u30B3\u30FC\u30B9)");
      } else if (bn < course) {
        score -= 2;
        risks.push("\u62BC\u3057\u51FA\u3055\u308C(" + bn + "\u2192" + course + "\u30B3\u30FC\u30B9)");
      }
    }
    if (course === 1) reasons.push(course + "\u30B3\u30FC\u30B9(\u5834\u52DD\u7387" + Math.round(scwr * 100) + "%)");
    var racerCWR = getRacerCourseWinRate(rid, course);
    if (racerCWR !== null) {
      score += racerCWR * 25;
      var rdb = racerDB[rid];
      if (rdb && rdb.courseStats && rdb.courseStats[course]) {
        var cs = rdb.courseStats[course];
        score += cs.top3 / cs.races * 0.08 * 100;
        if (racerCWR > 0.5 && course <= 2) reasons.push("\u30B3\u30FC\u30B9\u52251\u7740\u7387" + Math.round(racerCWR * 100) + "%");
      }
    } else {
      var wr = pf(boat.racer_national_top_1_percent);
      score += wr * 2.5;
      var lr = pf(boat.racer_local_top_2_percent);
      score += lr * 0.15;
    }
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
        var cBoat = allBoats.find(function(b) {
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
            reasons.push("2\u30B3\u30FC\u30B9\u5DEE\u3057\u4E3B\u4F53\u2192\u9003\u3052\u6B8B\u308A\u3084\u3059\u3044");
          } else if (makuriRate > 0.3) {
            score -= 5;
            risks.push("2\u30B3\u30FC\u30B9\u307E\u304F\u308A\u50BE\u5411(\u8105\u5A01)");
          }
        }
        if (cCourse === 3) {
          if (course === 1 && makuriRate > 0.3) {
            score -= 3;
            risks.push("3\u30B3\u30FC\u30B9\u307E\u304F\u308A\u50BE\u5411");
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
    var motorRate = pf(boat.racer_assigned_motor_top_2_percent);
    var motorEval = motorScoreNormalized(motorRate, sid);
    score += motorEval.score;
    var motorLabel = motorEval.label;
    var motorEmoji = motorEval.emoji;
    if (motorEval.label === "\u8D85\u629C")
      reasons.push("\u8D85\u629C\u30E2\u30FC\u30BF\u30FC(" + motorRate + "%" + (motorEval.z != null ? " z=" + motorEval.z.toFixed(1) : "") + ")");
    else if (motorEval.label === "\u6574\u5099\u8981") risks.push("\u30E2\u30FC\u30BF\u30FC\u4E0D\u8ABF(" + motorRate + "%)");
    var boatRate = pf(boat.racer_assigned_boat_top_2_percent);
    score += boatRate * 0.08;
    var etRank = 5, etTime = 99;
    if (allPreviews && allPreviews.boats) {
      var times = [];
      for (var ei = 1; ei <= 6; ei++) {
        var epv = allPreviews.boats[String(ei)];
        var etime = epv && epv.racer_exhibition_time != null && epv.racer_exhibition_time > 0 ? pf(epv.racer_exhibition_time) : 99;
        times.push({ boat: ei, time: etime });
      }
      times.sort(function(a, b) {
        return a.time - b.time;
      });
      etRank = times.findIndex(function(t) {
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
      if (etRank === 0) reasons.push("\u5C55\u793A\u30BF\u30A4\u30E0\u6700\u901F(" + etTime + "s)");
      var ezAux = exhibitionZScore(etTime, sid);
      if (ezAux !== 0) score += -ezAux * 2 * decay;
      if (ezAux <= -1) reasons.push("\u5C55\u793A\u30BF\u30A4\u30E0\u5834\u76F8\u5BFE\u7684\u306B\u8D85\u901F(z=" + ezAux.toFixed(1) + ")");
      var oeRace = ((typeof globalThis !== "undefined" && globalThis._origExhibIndex || {})[sid] || {})[rno] || null;
      if (oeRace) {
        var _oeRank = function(field) {
          var arr = [];
          for (var w in oeRace) {
            var v = oeRace[w] && oeRace[w][field];
            if (v > 0) arr.push({ w: parseInt(w, 10), v });
          }
          arr.sort(function(a, b) {
            return a.v - b.v;
          });
          var rk = -1;
          for (var i = 0; i < arr.length; i++) {
            if (arr[i].w === bn) {
              rk = i;
              break;
            }
          }
          return { rank: rk, n: arr.length };
        };
        var turnR = _oeRank("turn_time");
        var lapR = _oeRank("lap_time");
        if (turnR.n >= 4 && turnR.rank >= 0) {
          var tb = turnR.rank === 0 ? 2.5 : turnR.rank === 1 ? 1.2 : turnR.rank >= turnR.n - 1 ? -1.5 : 0;
          score += tb * decay;
          if (turnR.rank === 0) reasons.push("\u307E\u308F\u308A\u8DB3\u6700\u901F(\u30AA\u30EA\u30B8\u30CA\u30EB\u5C55\u793A)");
          else if (turnR.rank >= turnR.n - 1) risks.push("\u307E\u308F\u308A\u8DB3\u6700\u9045(\u30AA\u30EA\u30B8\u30CA\u30EB\u5C55\u793A)");
        }
        if (lapR.n >= 4 && lapR.rank >= 0) {
          var lb = lapR.rank === 0 ? 1.5 : lapR.rank === 1 ? 0.8 : 0;
          score += lb * decay;
          if (lapR.rank === 0) reasons.push("\u4E00\u5468\u6700\u901F(\u30AA\u30EA\u30B8\u30CA\u30EB\u5C55\u793A)");
        }
      }
      if (myPv && myPv.racer_start_timing != null) {
        var st = pf(myPv.racer_start_timing);
        var absScore = st < 0 ? -6 : st <= 0.05 ? 4 : st <= 0.1 ? 2 : st >= 0.2 ? -2 : 0;
        var perScore = stDivergenceScore(st, rid, course);
        var stScore = Math.max(absScore, perScore);
        score += stScore;
        if (stScore >= 4) reasons.push("ST\u92ED\u3044(" + st + "s)");
        else if (stScore <= -2 && st > 0) risks.push("ST\u51FA\u9045\u308C(" + st + "s)");
        else if (st < 0) risks.push("F\u30B9\u30BF\u30FC\u30C8\u6C17\u5473(" + st + "s)");
        if (etRank <= 1 && st > 0 && st <= 0.1) score += 3;
        else if (etRank <= 1 && st > 0.15) score += 1;
        else if (etRank >= 4 && st > 0 && st <= 0.1) score += 1;
        else if (etRank >= 4 && st >= 0.15) score -= 3;
        var tilt = pf(myPv.racer_tilt_adjustment);
        if (course <= 2 && tilt <= -0.5) score += 2;
        else if (course >= 4 && tilt >= 0.5) score += 2;
        else if (course <= 2 && tilt >= 0.5) score -= 1;
        else if (course >= 4 && tilt <= -0.5) score -= 1;
        var adjW = pf(myPv.racer_adjust_weight);
        if (adjW >= 1) {
          if (course >= 4) {
            score -= 3;
            risks.push("\u8ABF\u6574\u91CD\u91CF+" + adjW.toFixed(1) + "kg(\u30A2\u30A6\u30C8\u4E0D\u5229)");
          } else {
            score -= 1;
            risks.push("\u8ABF\u6574\u91CD\u91CF+" + adjW.toFixed(1) + "kg");
          }
        } else if (adjW >= 0.5) {
          if (course >= 4) score -= 1;
        }
        var partsTxt = String(myPv.racer_parts_replaced || "");
        if (partsTxt.indexOf("\u30DA\u30E9") >= 0) {
          score -= 1;
          risks.push("\u30EC\u30FC\u30B9\u76F4\u524D\u30DA\u30E9\u4EA4\u63DB(" + escText(partsTxt) + ")");
        } else if (partsTxt) {
          reasons.push("\u6574\u5099\u5B9F\u65BD: " + escText(partsTxt));
        }
      }
      if (boat.racer_class_number === 1 && etRank >= 4) {
        score -= 4;
        risks.push("A1\u3060\u304C\u5C55\u793A\u4E0B\u4F4D(\u30E2\u30FC\u30BF\u30FC\u4E0D\u5B89)");
      }
      if ((boat.racer_class_number === 3 || boat.racer_class_number === 4) && etRank === 0) {
        score += 3;
        reasons.push("\u597D\u30E2\u30FC\u30BF\u30FC\u767A\u898B(\u5C55\u793A1\u4F4D)");
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
      var isHead = isHeadWind(wd, sid);
      var isTail = isTailWind(wd, sid);
      if (isHead && ws >= 5) {
        if (course === 1) {
          score -= 8;
          risks.push("\u5411\u304B\u3044\u98A8" + ws + "m(\u30A4\u30F3\u4E0D\u5229)");
        } else if (course === 2) score -= 3;
        else if (course >= 4) score += 4;
      } else if (isHead && ws >= 3) {
        if (course === 1) score -= 4;
        if (course >= 4) score += 2;
      }
      if (isTail && ws >= 3) {
        if (course === 1) {
          score += 4;
          reasons.push("\u8FFD\u3044\u98A8" + ws + "m(\u30A4\u30F3\u6709\u5229)");
        }
        if (course >= 4) score -= 2;
      }
      var wh = weather.wave_height || weather.race_wave || 0;
      if (wh >= 7 && course <= 2) {
        score -= 4;
        risks.push("\u6CE2\u9AD8" + wh + "cm(\u8352\u308C\u6A21\u69D8)");
      } else if (wh >= 4 && course <= 2) score -= 2;
      var stormDelta = stormBonus(ws, wh, course);
      if (stormDelta !== 0) {
        score += stormDelta;
        if (stormDelta <= -4) risks.push("\u8352\u5929\u4EA4\u5DEE\u9805" + stormDelta);
        else if (stormDelta >= 4) reasons.push("\u8352\u308C\u5C55\u958B\u3067\u6069\u6075+" + stormDelta);
      }
    }
    if (preview && preview.race_closed_at) {
      try {
        var hour = parseInt(String(preview.race_closed_at).split(" ")[1].split(":")[0], 10);
        var tideDelta = tideScore(sid, course, hour);
        if (tideDelta !== 0) {
          score += tideDelta;
          if (tideDelta >= 4) reasons.push("\u6F6E\u4F4D\u304C\u30B3\u30FC\u30B9\u6709\u5229(+" + tideDelta + ")");
          else if (tideDelta <= -4) risks.push("\u6F6E\u4F4D\u4E0D\u5229(" + tideDelta + ")");
        }
      } catch (_) {
      }
    }
    var seriesAdj = seriesAdjustmentScore(rid, sid);
    if (seriesAdj.score !== 0) {
      score += seriesAdj.score;
      if (seriesAdj.score >= 3) reasons.push("\u7BC0\u9593\u30E2\u30FC\u30BF\u30FC\u4E0A\u6607\u4E2D(slope+" + seriesAdj.slope.toFixed(1) + ")");
      else if (seriesAdj.score <= -3) risks.push("\u7BC0\u9593\u30E2\u30FC\u30BF\u30FC\u4E0B\u964D\u4E2D(slope" + seriesAdj.slope.toFixed(1) + ")");
    }
    if (allBoats && allBoats.length > 0) {
      var oppRids = allBoats.map(function(b) {
        return b.racer_number;
      }).filter(function(o) {
        return o && o !== rid;
      });
      var pair = pairwiseScore(rid, sid, oppRids);
      if (Math.abs(pair.score) >= 0.5) {
        score += pair.score;
        if (pair.score >= 1) reasons.push("\u5BFE\u6226\u76F8\u6027\u25CE(+" + pair.score.toFixed(1) + ", " + pair.hits + "\u4EF6)");
        else if (pair.score <= -1) risks.push("\u5BFE\u6226\u76F8\u6027\xD7(" + pair.score.toFixed(1) + ", " + pair.hits + "\u4EF6)");
      }
    }
    var fc = boat.racer_flying_count || 0;
    var lc = boat.racer_late_start_count_in_current_term || boat.racer_late_count || 0;
    if (fc >= 2) {
      score -= 25;
      risks.push("F2\u6301\u3061");
    } else if (fc >= 1) {
      score -= 15;
      risks.push("F1\u6301\u3061");
    }
    if (lc >= 1) score -= 5;
    var form = getRacerForm(rid);
    if (form) {
      score += form.score;
      if (form.avg <= 2.5) reasons.push("\u597D\u8ABF(\u76F4\u8FD15R\u5E73\u5747" + form.avg.toFixed(1) + "\u7740)");
      if (form.avg >= 4) risks.push("\u4E0D\u8ABF(\u76F4\u8FD15R\u5E73\u5747" + form.avg.toFixed(1) + "\u7740)");
      if (form.trend > 0.5) reasons.push("\u4E0A\u308A\u8ABF\u5B50");
      if (form.trend < -0.5) risks.push("\u4E0B\u308A\u8ABF\u5B50");
    }
    return {
      boat: bn,
      score: Math.max(0, score),
      course,
      etRank,
      etTime,
      reasons,
      risks,
      motorLabel,
      motorEmoji,
      motorRate,
      boatRate,
      form,
      classNum: boat.racer_class_number,
      fc,
      lc
      // P1-A4: F/L 確率乗数で使用
    };
  }
  globalThis.scoreBoatV2 = scoreBoatV2;
})();

/* BUILD:ANALYSIS_SCORE_BOAT:END */


// ===============================================
// PREDICTION ENGINE V2: Layer 2 (PRESERVED)
// ===============================================
// Epic 12 (P1-B1): 旧 inline 実装は src/utils/features.js (BUILD:FEATURES bundle) に移管。
//   bundle 注入が globalThis.getL2Features を上書きするため通常はそちらが使われる。
//   bundle 失敗時の fallback として旧本体を残置（数値出力は厳密に同一）。

// P3 L-06/L-10: 旧 softmax 実装は撤去、上部の共通実装（Number.isFinite ガード付き）を利用

/* BUILD:ANALYSIS_CALIBRATION:START */
"use strict";
(() => {
  // ../src/analysis/calibration.js
  function _initFeatureStats() {
    return { mean: new Array(FEATURE_DIM).fill(0), m2: new Array(FEATURE_DIM).fill(0), n: 0 };
  }
  function _updateFeatureStats(featRow) {
    if (!Array.isArray(featRow)) return;
    _featureStats.n += 1;
    var n = _featureStats.n;
    for (var i = 0; i < FEATURE_DIM; i++) {
      var x = Number.isFinite(featRow[i]) ? featRow[i] : 0;
      var delta = x - _featureStats.mean[i];
      _featureStats.mean[i] += delta / n;
      var delta2 = x - _featureStats.mean[i];
      _featureStats.m2[i] += delta * delta2;
    }
  }
  function _normalizeFeatures(featRow) {
    if (!TUNING.PREDICTION.ENABLE_ZSCORE) return featRow;
    var n = _featureStats.n;
    if (n < TUNING.PREDICTION.ZSCORE_WARMUP_N) return featRow;
    var means = _featureStats.mean;
    var m2s = _featureStats.m2;
    var divisor = n > 1 ? n - 1 : 1;
    var out = new Array(FEATURE_DIM);
    for (var i = 0; i < FEATURE_DIM; i++) {
      var variance = m2s[i] / divisor;
      var std = Math.sqrt(variance + 1e-6);
      var x = featRow[i] || 0;
      out[i] = (x - means[i]) / std;
    }
    return out;
  }
  function _applyPlattCalibration(p, sid) {
    if (!TUNING.PREDICTION.ENABLE_PLATT) return p;
    var a = _plattCoeffs.a, b = _plattCoeffs.b;
    if (sid != null && typeof _plattCoeffsByStadium === "object" && _plattCoeffsByStadium) {
      var ps = _plattCoeffsByStadium[String(sid)];
      if (ps && Number.isFinite(ps.a) && Number.isFinite(ps.b) && ps.n >= 100) {
        a = ps.a;
        b = ps.b;
      }
    }
    if (a === 1 && b === 0) return p;
    var clipped = Math.min(0.9999, Math.max(1e-4, p));
    var logit = Math.log(clipped / (1 - clipped));
    var z = a * logit + b;
    if (z > 30) return 1;
    if (z < -30) return 0;
    return 1 / (1 + Math.exp(-z));
  }
  function _applyIsotonicCalibration(p) {
    if (!_isotonicCoeffs || !Array.isArray(_isotonicCoeffs.points)) return p;
    var pts = _isotonicCoeffs.points;
    if (pts.length < 2) return p;
    if (p <= pts[0].x) return pts[0].y;
    if (p >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    var lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      var mid = lo + hi >> 1;
      if (pts[mid].x <= p) lo = mid;
      else hi = mid;
    }
    var dx = pts[hi].x - pts[lo].x;
    if (dx <= 0) return pts[lo].y;
    var t = (p - pts[lo].x) / dx;
    return pts[lo].y + t * (pts[hi].y - pts[lo].y);
  }
  function _applyCalibration(p, sid) {
    var method = typeof _calibrationMethod === "string" ? _calibrationMethod : "platt";
    if (method === "isotonic") return _applyIsotonicCalibration(p);
    if (method === "none") return p;
    return _applyPlattCalibration(p, sid);
  }
  function _stackedPredict(features6, l1probs) {
    if (TUNING.PREDICTION.STACKING_MODE !== "residual") return l1probs;
    var feats = features6.map(_normalizeFeatures);
    var l2Logits = feats.map(function(feat, b) {
      var z = L2_BIAS + (COURSE_LOG_PRIOR[b] || 0);
      for (var i = 0; i < feat.length; i++) z += feat[i] * (l2weights[i] || 0);
      return z;
    });
    var combinedLogits = l1probs.map(function(p, b) {
      var clipped = Math.min(0.9999, Math.max(1e-4, p));
      var l1Logit = Math.log(clipped / (1 - clipped));
      return l1Logit + _stackingGamma * l2Logits[b];
    });
    return softmax(combinedLogits);
  }
  function _extractPlattPairs(history) {
    if (!Array.isArray(history)) return [];
    var samples = history.filter(function(h) {
      return h.actual && h.actual.length > 0 && Array.isArray(h.mark_probs);
    });
    if (samples.length < TUNING.PREDICTION.PLATT_MIN_SAMPLES) return [];
    var pairs = [];
    samples.forEach(function(h) {
      var winner = h.actual[0];
      var probs = {};
      h.mark_probs.forEach(function(mp) {
        probs[mp.boat] = mp.prob;
      });
      var pWin = probs[winner];
      if (!Number.isFinite(pWin) || pWin <= 0 || pWin >= 1) return;
      pairs.push({ p: pWin, y: 1 });
      for (var b = 1; b <= 6; b++) {
        if (b === winner) continue;
        var pb = probs[b];
        if (Number.isFinite(pb) && pb > 0 && pb < 1) pairs.push({ p: pb, y: 0 });
      }
    });
    return pairs;
  }
  async function _refitPlattCoeffs(history) {
    var pairs = _extractPlattPairs(history);
    if (pairs.length < 100) return null;
    var w = typeof _getPlattWorker === "function" ? _getPlattWorker() : null;
    var globalResult;
    if (w) {
      globalResult = await new Promise(function(resolve) {
        var onMsg = function(e) {
          if (!e.data || e.data.type !== "platt_refit_done") return;
          w.removeEventListener("message", onMsg);
          resolve(e.data.result);
        };
        w.addEventListener("message", onMsg);
        w.postMessage({ type: "platt_refit", samples: pairs });
      });
    }
    if (!globalResult) {
      var bestA = 1, bestB = 0, bestLoss = Infinity;
      for (var a = 0.5; a <= 2; a += 0.1) {
        for (var b = -1; b <= 1; b += 0.1) {
          var loss = 0;
          for (var i = 0; i < pairs.length; i++) {
            var pi = pairs[i];
            var clipped = Math.min(0.9999, Math.max(1e-4, pi.p));
            var logit = Math.log(clipped / (1 - clipped));
            var z = a * logit + b;
            var pp = z > 30 ? 1 : z < -30 ? 0 : 1 / (1 + Math.exp(-z));
            pp = Math.min(0.9999, Math.max(1e-4, pp));
            loss += pi.y ? -Math.log(pp) : -Math.log(1 - pp);
          }
          if (loss < bestLoss) {
            bestLoss = loss;
            bestA = a;
            bestB = b;
          }
        }
      }
      globalResult = { a: bestA, b: bestB, n: pairs.length };
    }
    _plattCoeffs = { a: globalResult.a, b: globalResult.b, fittedAt: Date.now(), n: globalResult.n };
    safeSet("boatrace_platt", _plattCoeffs);
    try {
      _plattCoeffsByStadium = _refitPerStadiumPlatt(history);
      safeSet("boatrace_platt_perstadium", _plattCoeffsByStadium);
    } catch (_) {
    }
    try {
      var iso = _refitIsotonicCalibration(history);
      if (iso) {
        _isotonicCoeffs = iso;
        safeSet("boatrace_isotonic", _isotonicCoeffs);
      }
    } catch (_) {
    }
    try {
      var chosen = _chooseCalibrationMethod(history);
      _calibrationMethod = chosen;
      try {
        localStorage.setItem("boatrace_calib_method", chosen);
      } catch (_) {
      }
    } catch (_) {
    }
    return _plattCoeffs;
  }
  function _refitIsotonicCalibration(history) {
    var pairs = _extractPlattPairs(history);
    if (pairs.length < 200) return null;
    pairs.sort(function(a, b) {
      return a.p - b.p;
    });
    var blocks = pairs.map(function(pi) {
      return { x: pi.p, sumY: pi.y, sumX: pi.p, count: 1 };
    });
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < blocks.length - 1; i++) {
        var meanI = blocks[i].sumY / blocks[i].count;
        var meanJ = blocks[i + 1].sumY / blocks[i + 1].count;
        if (meanI > meanJ) {
          blocks[i].sumY += blocks[i + 1].sumY;
          blocks[i].sumX += blocks[i + 1].sumX;
          blocks[i].count += blocks[i + 1].count;
          blocks.splice(i + 1, 1);
          changed = true;
          if (i > 0) i--;
        }
      }
    }
    var points = blocks.map(function(b) {
      return { x: b.sumX / b.count, y: b.sumY / b.count };
    });
    var compressed = [];
    for (var k = 0; k < points.length; k++) {
      if (k > 0 && k < points.length - 1 && Math.abs(points[k].y - points[k - 1].y) < 1e-9 && Math.abs(points[k].y - points[k + 1].y) < 1e-9) {
        continue;
      }
      compressed.push(points[k]);
    }
    return { points: compressed, fittedAt: Date.now(), n: pairs.length };
  }
  function _refitPerStadiumPlatt(history) {
    if (!Array.isArray(history)) return {};
    var bySid = {};
    history.forEach(function(h) {
      if (!h || !h.stadium) return;
      var sid2 = String(h.stadium);
      if (!bySid[sid2]) bySid[sid2] = [];
      bySid[sid2].push(h);
    });
    var out = {};
    for (var sid in bySid) {
      var subPairs = _extractPlattPairs(bySid[sid]);
      if (subPairs.length < 100) continue;
      var bestA = 1, bestB = 0, bestLoss = Infinity;
      for (var a = 0.5; a <= 2; a += 0.1) {
        for (var b = -1; b <= 1; b += 0.1) {
          var loss = 0;
          for (var i = 0; i < subPairs.length; i++) {
            var pi = subPairs[i];
            var clipped = Math.min(0.9999, Math.max(1e-4, pi.p));
            var logit = Math.log(clipped / (1 - clipped));
            var z = a * logit + b;
            var pp = z > 30 ? 1 : z < -30 ? 0 : 1 / (1 + Math.exp(-z));
            pp = Math.min(0.9999, Math.max(1e-4, pp));
            loss += pi.y ? -Math.log(pp) : -Math.log(1 - pp);
          }
          if (loss < bestLoss) {
            bestLoss = loss;
            bestA = a;
            bestB = b;
          }
        }
      }
      out[sid] = { a: bestA, b: bestB, n: subPairs.length, fittedAt: Date.now() };
    }
    return out;
  }
  function _chooseCalibrationMethod(history) {
    var pairs = _extractPlattPairs(history);
    if (pairs.length < 300) return "platt";
    var split = Math.floor(pairs.length * 0.8);
    var heldOut = pairs.slice(split);
    if (heldOut.length < 50) return "platt";
    var plattLoss = 0, isoLoss = 0;
    var iso = _isotonicCoeffs;
    for (var i = 0; i < heldOut.length; i++) {
      var pi = heldOut[i];
      var pPlatt = _applyPlattCalibration(pi.p);
      var pIso = iso ? _applyIsotonicCalibration(pi.p) : pi.p;
      pPlatt = Math.min(0.9999, Math.max(1e-4, pPlatt));
      pIso = Math.min(0.9999, Math.max(1e-4, pIso));
      plattLoss += pi.y ? -Math.log(pPlatt) : -Math.log(1 - pPlatt);
      isoLoss += pi.y ? -Math.log(pIso) : -Math.log(1 - pIso);
    }
    return isoLoss < plattLoss ? "isotonic" : "platt";
  }
  globalThis._initFeatureStats = _initFeatureStats;
  globalThis._updateFeatureStats = _updateFeatureStats;
  globalThis._normalizeFeatures = _normalizeFeatures;
  globalThis._applyPlattCalibration = _applyPlattCalibration;
  globalThis._applyIsotonicCalibration = _applyIsotonicCalibration;
  globalThis._applyCalibration = _applyCalibration;
  globalThis._stackedPredict = _stackedPredict;
  globalThis._extractPlattPairs = _extractPlattPairs;
  globalThis._refitPlattCoeffs = _refitPlattCoeffs;
  globalThis._refitIsotonicCalibration = _refitIsotonicCalibration;
  globalThis._refitPerStadiumPlatt = _refitPerStadiumPlatt;
  globalThis._chooseCalibrationMethod = _chooseCalibrationMethod;
})();

/* BUILD:ANALYSIS_CALIBRATION:END */


/* BUILD:ANALYSIS_GBDT_RUNTIME:START */
"use strict";
(() => {
  // ../src/analysis/gbdt_runtime.js
  var _g = (
    /** @type {any} */
    globalThis
  );
  function _traverseTree(tree, features) {
    if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) return 0;
    let idx = 0;
    for (let depth = 0; depth < 64; depth++) {
      const node = tree.nodes[idx];
      if (!node) return 0;
      if (typeof node.value === "number" && Number.isFinite(node.value)) {
        return node.value;
      }
      if (typeof node.feat !== "number" || typeof node.thr !== "number") return 0;
      const fv = features[node.feat];
      const fvNum = Number.isFinite(fv) ? fv : 0;
      idx = fvNum <= node.thr ? node.left || 0 : node.right || 0;
      if (idx <= 0 || idx >= tree.nodes.length) return 0;
    }
    return 0;
  }
  function gbdtPredictLogits(model, features) {
    if (!model || !Array.isArray(model.trees)) return [0, 0, 0, 0, 0, 0];
    const lr = Number.isFinite(model.learning_rate) ? model.learning_rate : 0.1;
    const nClasses = model.n_classes || 6;
    const logits = new Array(nClasses).fill(0);
    for (let t = 0; t < model.trees.length; t++) {
      const tree = model.trees[t];
      if (!tree || typeof tree.class !== "number") continue;
      if (tree.class < 0 || tree.class >= nClasses) continue;
      logits[tree.class] += lr * _traverseTree(tree, features);
    }
    return logits;
  }
  function _blendGBDTPrediction(currentLogits, features6, weight) {
    const enabled = _g.TUNING && _g.TUNING.PREDICTION && _g.TUNING.PREDICTION.ENABLE_GBDT;
    if (!enabled) return currentLogits;
    const model = _g._gbdtModel;
    if (!model || !Array.isArray(model.trees) || model.trees.length === 0) return currentLogits;
    if (typeof model.n_train === "number" && model.n_train < 5e3) return currentLogits;
    const w = Number.isFinite(weight) ? weight : 0.3;
    const out = currentLogits.slice();
    for (let b = 0; b < out.length && b < 6; b++) {
      const gbdtLogits = gbdtPredictLogits(model, features6[b] || []);
      const gbdtSelf = gbdtLogits[b] || 0;
      out[b] = (1 - w) * out[b] + w * gbdtSelf;
    }
    return out;
  }
  _g._traverseTree = _traverseTree;
  _g.gbdtPredictLogits = gbdtPredictLogits;
  _g._blendGBDTPrediction = _blendGBDTPrediction;
})();

/* BUILD:ANALYSIS_GBDT_RUNTIME:END */



// PB-6: Platt scaling — 確率の post-hoc 校正
//   p' = sigmoid(a * logit(p) + b)
//   既定 a=1, b=0 で identity（変化なし）。データ蓄積後 _refitPlattCoeffs で auto-tune

// PB-5: Stacking 予測 — L2 が L1 確率を補正する形式
//   p_stacked[b] = softmax( logit(L1[b]) + γ * residual_b ) where residual_b は L2 の輸出 logit
//   既定 γ=0 で stacking 無効（純粋に L1 を返す）。STACKING_MODE='residual' で active

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
  if(!capabilities.has('worker')) return null;
  try {
    _appWorker = new Worker('assets/worker.js');
    _appWorker.addEventListener('message', function(e){
      var msg = e.data || {};
      // FIX (2026-05-22): worker.js が self.onerror で詳細を post してくる場合、
      //   main の onerror では cross-origin で空になる詳細を補完して reportError する。
      if(msg.type === 'worker_self_error'){
        try { reportError({
          type: 'worker_error',
          msg: msg.msg || 'worker self-reported error',
          filename: msg.filename || '',
          line: msg.line || 0,
          col: msg.col || 0,
          stack: msg.stack || '',
          source: 'worker_self_error',
        }); } catch(_){}
        return;
      }
      if(msg.reqId != null && _appWorkerCallbacks.has(msg.reqId)){
        var cb = _appWorkerCallbacks.get(msg.reqId);
        _appWorkerCallbacks.delete(msg.reqId);
        cb(msg);
      }
    });
    // FIX (2026-05-22): worker.js が self.onerror で worker_self_error を
    //   post する仕組みを導入したため、main の Worker.onerror は重複情報のみ
    //   返してくる (cross-origin で詳細が空)。short window で self_error 到着を待ち、
    //   届かなかった場合のみ「unknown」を記録 (ノイズ削減)。
    var _lastWorkerSelfErrorAt = 0;
    var _origAddMessage = _appWorker.addEventListener.bind(_appWorker);
    _origAddMessage('message', function(ev){
      var d = ev && ev.data;
      if (d && d.type === 'worker_self_error') _lastWorkerSelfErrorAt = Date.now();
    });
    _appWorker.addEventListener('error', function(e){
      // Epic 28e + FIX: self_error が 500ms 以内に届いていれば main 側 onerror は無視
      setTimeout(function(){
        if (Date.now() - _lastWorkerSelfErrorAt < 1500) return; // self_error がカバー済
        var detail = {
          type: 'worker_error',
          msg: (e && e.message) || 'unknown (cross-origin or load fail)',
          filename: (e && e.filename) || '',
          line: (e && e.lineno) || 0,
          col: (e && e.colno) || 0,
          eventType: (e && e.type) || '',
          target: (e && e.target && (e.target.scriptURL || e.target.url)) || '',
          defaultPrevented: !!(e && e.defaultPrevented),
          timeStamp: (e && e.timeStamp) || 0,
        };
        console.warn('[PG-3] worker error', JSON.stringify(detail));
        try { reportError(detail); } catch(_){}
      }, 1000);
    });
    _appWorker.addEventListener('messageerror', function(e){
      console.warn('[PG-3] worker messageerror (structured-clone failed)', e);
      try { reportError({ type:'worker_messageerror', msg:'structured clone failed' }); } catch(_){}
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

/* BUILD:ANALYSIS_PREDICT_RACE:START */
"use strict";
(() => {
  // ../src/analysis/predict_race.js
  function predictRaceAsync(sid, raceNum) {
    var w = _getAppWorker();
    if (!w) {
      return Promise.resolve(predictRace(sid, raceNum));
    }
    var reqId = ++_appWorkerReqId;
    return new Promise(function(resolve, reject) {
      _appWorkerCallbacks.set(reqId, function(msg) {
        if (msg.type === "predict_done") resolve(msg.result);
        else if (msg.type === "error") {
          console.warn("[PG-4] worker predict error:", msg.error, msg.stack);
          try {
            resolve(predictRace(sid, raceNum));
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error("unexpected worker message: " + JSON.stringify(msg).slice(0, 200)));
        }
      });
      w.postMessage({
        type: "predict",
        reqId,
        input: {
          sid,
          raceNum
          // state を毎回送るのは重いので省略、init/sync_state で同期済み前提
        }
      });
    });
  }
  function predictRace(sid, raceNum) {
    if (!programData) return null;
    var stadiumProg = programData[String(sid)];
    if (!stadiumProg) return null;
    var race = stadiumProg[String(raceNum)];
    if (!race || !race.boats) return null;
    var preview = null, weather = null;
    if (previewData && previewData[String(sid)] && previewData[String(sid)][String(raceNum)]) {
      preview = previewData[String(sid)][String(raceNum)];
      weather = preview.weather || preview;
    }
    var boats = race.boats;
    if (!Array.isArray(boats)) return null;
    var predictedEntries = null;
    if (!preview || !preview.boats || Object.keys(preview.boats).every(function(k) {
      return preview.boats[k].racer_course_number == null;
    })) {
      predictedEntries = predictEntryCourses(boats, sid);
    }
    var l1scores = [];
    boats.forEach(function(b) {
      var pv = preview && preview.boats ? preview.boats[String(b.racer_boat_number)] : null;
      var s = scoreBoatV2(b, pv, weather, boats, preview, sid, predictedEntries, raceNum);
      l1scores.push(s);
    });
    var l1total = l1scores.reduce(function(a, s) {
      return a + Math.exp(s.score / 15);
    }, 0);
    var l1probs = l1scores.map(function(s) {
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
      sts.sort(function(a, b) {
        return a.st - b.st;
      });
      for (var sr = 0; sr < sts.length; sr++) stRanks[sts[sr].boat] = sr;
    }
    var features6 = boats.map(function(b) {
      var pv = preview && preview.boats ? preview.boats[String(b.racer_boat_number)] : null;
      var l1s = l1scores.find(function(s) {
        return s.boat === b.racer_boat_number;
      });
      return getL2Features(b, pv, weather, l1s ? l1s.etRank : 5, stRanks[b.racer_boat_number] || 5, sid);
    });
    var l2probs = l2Predict(features6);
    if (typeof _blendGBDTPrediction === "function" && typeof TUNING !== "undefined" && TUNING.PREDICTION && TUNING.PREDICTION.ENABLE_GBDT) {
      try {
        var l2logits = l2probs.map(function(p) {
          var clipped = Math.min(0.9999, Math.max(1e-4, p));
          return Math.log(clipped / (1 - clipped));
        });
        var blended = _blendGBDTPrediction(l2logits, features6, TUNING.PREDICTION.GBDT_BLEND_WEIGHT);
        if (Array.isArray(blended) && blended.length === l2probs.length) {
          var maxL = -Infinity;
          for (var bi = 0; bi < blended.length; bi++) if (blended[bi] > maxL) maxL = blended[bi];
          var sumE = 0;
          var expL = blended.map(function(l) {
            var e = Math.exp(l - maxL);
            sumE += e;
            return e;
          });
          if (sumE > 0) l2probs = expL.map(function(e) {
            return e / sumE;
          });
        }
      } catch (e) {
      }
    }
    var dbSize = Object.keys(racerDB).length;
    var alpha = 300 / (300 + dbSize);
    var beta = 1 - alpha;
    var finalProbs = boats.map(function(b, i) {
      var l1s = l1scores.find(function(s) {
        return s.boat === b.racer_boat_number;
      });
      var idx = boats.indexOf(b);
      var fp2 = alpha * l1probs[idx] + beta * l2probs[idx];
      return {
        boat: b.racer_boat_number,
        prob: fp2,
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
        classNum: l1s.classNum
      };
    });
    finalProbs.forEach(function(p) {
      p.prob = typeof _applyCalibration === "function" ? _applyCalibration(p.prob, sid) : _applyPlattCalibration(p.prob, sid);
    });
    finalProbs.forEach(function(p) {
      var l1 = l1scores.find(function(s) {
        return s.boat === p.boat;
      });
      var fc = l1 ? l1.fc || 0 : 0;
      var lc = l1 ? l1.lc || 0 : 0;
      var mult = fc >= 2 ? 0.75 : fc >= 1 ? 0.85 : lc >= 1 ? 0.95 : 1;
      p.prob *= mult;
    });
    var _sumCalib = finalProbs.reduce(function(a, p) {
      return a + p.prob;
    }, 0);
    if (_sumCalib > 0 && Math.abs(_sumCalib - 1) > 1e-6) {
      finalProbs.forEach(function(p) {
        p.prob = p.prob / _sumCalib;
      });
    }
    finalProbs.sort(function(a, b) {
      return b.prob - a.prob;
    });
    var marks = finalProbs.map(function(p, i) {
      p.mark = i === 0 ? "\u25CE" : i === 1 ? "\u25CB" : i === 2 ? "\u25B2" : i === 3 ? "\u25B3" : "\xD7";
      return p;
    });
    var topProb = marks[0].prob;
    var top2Prob = marks[0].prob + marks[1].prob;
    var raceType, typeLabel, typeCls;
    var wh = weather ? weather.wave_height || weather.race_wave || 0 : 0;
    var ws2 = weather ? weather.wind_speed || weather.race_wind || 0 : 0;
    var RT = TUNING.RACE_TYPE;
    if (topProb > RT.HONMEI_TOP1_MIN && top2Prob > RT.HONMEI_TOP2_MIN) {
      raceType = "honmei";
      typeLabel = "\u672C\u547D";
      typeCls = "type-honmei";
    } else if (topProb < RT.ANA_TOP1_MAX || wh >= RT.ANA_WAVE_HEIGHT_CM || ws2 >= RT.ANA_WIND_SPEED_MS) {
      raceType = "ana";
      typeLabel = "\u7A74";
      typeCls = "type-ana";
    } else {
      raceType = "middle";
      typeLabel = "\u6DF7\u6226";
      typeCls = "type-middle";
    }
    var betCount3 = parseInt(settings.betCount3) || 10;
    var betCount2 = parseInt(settings.betCount2) || 5;
    var method = settings.betMethod || "auto";
    var evMode = settings.evMode === true || settings.evMode === "true";
    var kpiMode = settings.kpiMode || "balanced";
    var TYPE_EVMIN = {
      roi: { honmei: 1.2, middle: 1.25, ana: 1.35 },
      balanced: { honmei: 1.1, middle: 1.15, ana: 1.25 },
      hit: { honmei: 1, middle: 1.05, ana: 1.1 }
    };
    var TYPE_MAXBETS = {
      roi: { honmei: 4, middle: 5, ana: 3 },
      balanced: { honmei: 6, middle: 8, ana: 5 },
      hit: { honmei: 10, middle: 12, ana: 8 }
    };
    var defEvMin = parseFloat(settings.evMin) || 1.15;
    var modeEvMin = kpiMode !== "off" && TYPE_EVMIN[kpiMode] ? TYPE_EVMIN[kpiMode][raceType] : null;
    var modeMaxBets = kpiMode !== "off" && TYPE_MAXBETS[kpiMode] ? TYPE_MAXBETS[kpiMode][raceType] : null;
    var evOpt = {
      evMin: modeEvMin != null ? modeEvMin : defEvMin,
      maxBets: modeMaxBets != null ? modeMaxBets : betCount3,
      kellyFrac: parseFloat(settings.kellyFrac) || 0.5,
      bankroll: parseInt(settings.bankroll) || 1e4
    };
    var raceOddsForEV = null;
    if (oddsData && oddsData.odds) {
      var found = oddsData.odds.find(function(o) {
        return o.stadium === parseInt(sid) && o.race === parseInt(raceNum);
      });
      if (found) raceOddsForEV = found;
    }
    if (method === "auto") {
      if (evMode && raceOddsForEV && raceOddsForEV.trifecta) method = "ev";
      else if (raceType === "honmei") method = "prob";
      else if (raceType === "ana") method = "box";
      else method = "formation";
    }
    var grade = race.race_grade_number || 0;
    var scenarioRes = predictWithScenarios(boats, preview, weather, sid, grade);
    var bets = generateBetsV2(marks, method, betCount3, betCount2, raceOddsForEV, evOpt);
    bets.marks = marks;
    bets.evApplied = method === "ev";
    bets.scenarios = scenarioRes.scenarios;
    bets.scenarioDist = scenarioRes.dist;
    bets.grade = grade;
    if (raceOddsForEV && raceOddsForEV.win) {
      var aiByBoat = [];
      for (var bi = 1; bi <= 6; bi++) {
        var fp = finalProbs.find(function(p) {
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
    bets.ana = function() {
      var anaTopN = parseInt(settings.betCountAna) || 3;
      if (anaTopN < 1) anaTopN = 1;
      else if (anaTopN > 6) anaTopN = 6;
      var excludeCombos = (bets.trifecta || []).map(function(t) {
        return t.combo;
      });
      if (raceOddsForEV && raceOddsForEV.trifecta && Object.keys(raceOddsForEV.trifecta).length > 0) {
        var anaRes = _pickAnaCandidates(marks, raceOddsForEV.trifecta, {
          minOdds: 30,
          minEV: 1,
          minOddsLoose: 15,
          topN: anaTopN,
          excludeCombos
        });
        var picks = anaRes.primary.length > 0 ? anaRes.primary : anaRes.fallback;
        return picks.map(function(p) {
          return p.combo;
        });
      }
      if (marks && marks.length >= 3) {
        var dist = buildTrifectaProbDist(marks);
        var top1Boat = marks[0].boat;
        var excludeSet = {};
        excludeCombos.forEach(function(c) {
          if (c) excludeSet[String(c)] = true;
        });
        var cands = [];
        for (var k in dist) {
          if (!Object.prototype.hasOwnProperty.call(dist, k)) continue;
          if (k.split("-")[0] === String(top1Boat)) continue;
          if (excludeSet[k]) continue;
          cands.push({ combo: k, prob: dist[k] });
        }
        cands.sort(function(a, b) {
          return b.prob - a.prob;
        });
        return cands.slice(0, anaTopN).map(function(c) {
          return c.combo;
        });
      }
      return [];
    }();
    return bets;
  }
  globalThis.predictRace = predictRace;
  globalThis.predictRaceAsync = predictRaceAsync;
})();

/* BUILD:ANALYSIS_PREDICT_RACE:END */

/* BUILD:ANALYSIS_PREDICT_PROGRAM:START */
"use strict";
(() => {
  // ../src/analysis/predict_program.js
  function predictRaceProgram(sid, raceNum) {
    if (!programData) return null;
    var stadiumProg = programData[String(sid)];
    if (!stadiumProg) return null;
    var race = stadiumProg[String(raceNum)];
    if (!race || !race.boats) return null;
    var boats = race.boats;
    if (!Array.isArray(boats)) return null;
    var predictedEntries = predictEntryCourses(boats, sid);
    var l1scores = [];
    boats.forEach(function(b) {
      var s = scoreBoatV2(b, null, null, boats, null, sid, predictedEntries, raceNum);
      l1scores.push(s);
    });
    var l1total = l1scores.reduce(function(a, s) {
      return a + Math.exp(s.score / 15);
    }, 0);
    var l1probs = l1scores.map(function(s) {
      return Math.exp(s.score / 15) / l1total;
    });
    var features6 = boats.map(function(b) {
      var l1s = l1scores.find(function(s) {
        return s.boat === b.racer_boat_number;
      });
      return getL2Features(b, null, null, l1s ? l1s.etRank : 5, 5, sid);
    });
    var l2probs = l2Predict(features6);
    var dbSize = Object.keys(racerDB).length;
    var alpha = 600 / (600 + dbSize);
    var beta = 1 - alpha;
    var finalProbs = boats.map(function(b, i) {
      var l1s = l1scores.find(function(s) {
        return s.boat === b.racer_boat_number;
      });
      var idx = boats.indexOf(b);
      var fp = alpha * l1probs[idx] + beta * l2probs[idx];
      return {
        boat: b.racer_boat_number,
        prob: fp,
        score: l1s.score,
        course: l1s.course,
        reasons: l1s.reasons,
        risks: l1s.risks,
        motorLabel: l1s.motorLabel,
        motorEmoji: l1s.motorEmoji,
        motorRate: l1s.motorRate,
        classNum: l1s.classNum
      };
    });
    finalProbs.forEach(function(p) {
      p.prob = typeof _applyCalibration === "function" ? _applyCalibration(p.prob, sid) : _applyPlattCalibration(p.prob, sid);
    });
    finalProbs.forEach(function(p) {
      var l1 = l1scores.find(function(s) {
        return s.boat === p.boat;
      });
      var fc = l1 ? l1.fc || 0 : 0;
      var lc = l1 ? l1.lc || 0 : 0;
      var mult = fc >= 2 ? 0.75 : fc >= 1 ? 0.85 : lc >= 1 ? 0.95 : 1;
      p.prob *= mult;
    });
    var _sum2 = finalProbs.reduce(function(a, p) {
      return a + p.prob;
    }, 0);
    if (_sum2 > 0 && Math.abs(_sum2 - 1) > 1e-6) {
      finalProbs.forEach(function(p) {
        p.prob = p.prob / _sum2;
      });
    }
    finalProbs.sort(function(a, b) {
      return b.prob - a.prob;
    });
    finalProbs.forEach(function(p, i) {
      p.mark = i === 0 ? "\u25CE" : i === 1 ? "\u25CB" : i === 2 ? "\u25B2" : i === 3 ? "\u25B3" : "\xD7";
    });
    var topProb = finalProbs[0].prob;
    var top2Prob = finalProbs[0].prob + finalProbs[1].prob;
    var raceType, typeLabel;
    var RT2 = TUNING.RACE_TYPE;
    if (topProb > RT2.HONMEI_TOP1_MIN && top2Prob > RT2.HONMEI_TOP2_MIN) {
      raceType = "honmei";
      typeLabel = "\u672C\u547D";
    } else if (topProb < RT2.ANA_TOP1_MAX) {
      raceType = "ana";
      typeLabel = "\u7A74";
    } else {
      raceType = "middle";
      typeLabel = "\u6DF7\u6226";
    }
    return { marks: finalProbs, raceType, typeLabel, confidence: Math.round(topProb * 100) };
  }
  globalThis.predictRaceProgram = predictRaceProgram;
})();

/* BUILD:ANALYSIS_PREDICT_PROGRAM:END */

// ===============================================
// PREDICTION ENGINE V2: INTEGRATION (PRESERVED)
// ===============================================

// ===============================================
// 番組予想（展示・風なし、出走表データのみ）
// ===============================================

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
  var rankedAll = Object.keys(probs)
    .filter(function(k){ return odds[k] && probs[k] > 0; })
    .map(function(k){
      return { combo: k, prob: probs[k], odds: odds[k], ev: probs[k] * odds[k] };
    })
    .filter(function(b){ return b.ev >= evMin; })
    .sort(function(a, b){ return b.ev - a.ev; });
  // P1-A6: 高EV案件は厳選するほど ROI が安定する（プロの定石）。
  //   平均 EV が高いほど maxBets を圧縮（既存 maxBets を上限としつつ更に絞る）
  var avgEv = rankedAll.length ? rankedAll.reduce(function(s,b){return s+b.ev;},0)/rankedAll.length : 0;
  var dynMaxBets = (avgEv >= 1.35) ? 3
                 : (avgEv >= 1.25) ? 5
                 : (avgEv >= 1.20) ? 7
                 : maxBets;
  var ranked = rankedAll.slice(0, Math.min(maxBets, dynMaxBets));
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
// _plackettLuceTrifectaProb / _plackettLuceExactaProb は src/analysis/backtest.js に移動 (Phase 2c)
// → BUILD:ANALYSIS_BACKTEST bundle 経由で globalThis に export 済

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

/**
 * 高 EV 穴買い目を抽出（レースタイプ非依存、全レースで詳細画面に表示）
 * 主候補: オッズ ≥ minOdds かつ EV ≥ minEV
 * フォールバック: 主候補が無いときは オッズ ≥ minOddsLoose の中から EV 降順で topN
 *                （EV<1 でも候補を出して「穴予想0件」を回避）
 * @param {Array} marks - sorted marks (each {boat, prob})
 * @param {Object} oddsMap - { "1-2-3": odds, ... }
 * @param {Object} opts - { minOdds:30, minEV:1.0, minOddsLoose:15, topN:3 }
 * @returns {{primary:Array, fallback:Array}} EV 降順
 */
function _pickAnaCandidates(marks, oddsMap, opts){
  if(!Array.isArray(marks) || marks.length<3 || !oddsMap || typeof oddsMap !== 'object') {
    return { primary: [], fallback: [] };
  }
  var o = opts || {};
  var minOdds = o.minOdds != null ? o.minOdds : 30;
  var minEV = o.minEV != null ? o.minEV : 1.0;
  var minOddsLoose = o.minOddsLoose != null ? o.minOddsLoose : 15;
  var topN = o.topN != null ? o.topN : 3;
  // B13 (2026-05-16): 推奨買い目との重複を排除するための除外 set。
  //   ユーザ報告「推奨と穴予想が同じになる」現象は、prob×odds が両方とも高い
  //   combo (例 1-2-3 odds=35) が両方のリストに出ることが原因。
  //   exclude に含まれる combo は primary/fallback どちらにも入れない。
  var excludeSet = {};
  if(Array.isArray(o.excludeCombos)){
    o.excludeCombos.forEach(function(c){ if(c) excludeSet[String(c)] = true; });
  }
  var dist = buildTrifectaProbDist(marks);
  var primary = [], loose = [];
  for(var combo in dist){
    if(!Object.prototype.hasOwnProperty.call(dist, combo)) continue;
    if(excludeSet[combo]) continue;   // B13: 推奨と重複したら穴からは除外
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
  // 2026-05-07: v20→v21 — savePrediction の race_date 検証漏れで「entry.date=今日 /
  // actual=昨日の確定結果」の汚染が再発したため再度ワンショット掃除を走らせる
  var key = 'boatrace_history_migrated_v21';
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
    console.warn('[migration v21] dropped '+(before-hist.length)+' stale today entries');
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
    // rt-fix2-hotfix (2026-06-11): 旧版は「resultData にこのレースが居ない」だけで
    //   actual あり確定済み履歴を削除していた。Worker live 縮退や上流 openapi の
    //   揺らぎで一瞬 resultData から消えた瞬間に確定履歴を破壊するため、
    //   ユーザー報告「開き直したら結果が減る」が発生していた。
    //   localStorage の actual あり履歴を真の source として保護し、削除しない。
    //   下の race_date チェックは「API が前日結果を返した時の汚染防止」として維持。
    if(!res) return true;
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
    var existIdx = -1;
    for(var i=0;i<history.length;i++){
      if(history[i].date===date && history[i].stadium===sid && history[i].race===rn){ existIdx = i; break; }
    }
    // F19b: 既存エントリ更新ポリシー (カウント安定化版)
    //   - 既存が actual あり (確定済) → ロックイン、常に skip
    //   - 既存が actual 無し + 新規 result あり → 上書き (初回確定時の予想を保存)
    //   - 既存が actual 無し + 新規 result 無し → skip (mid-day churn 回避)
    if(existIdx >= 0){
      var existing = history[existIdx];
      if(existing.actual && existing.actual.length > 0) return;
      var newHasResult = result && result.isFinished && result.results;
      if(!newHasResult) return;
      history.splice(existIdx, 1);
    }
    // F19c: レース終了時の予想を snapshot 保存 → 表示・統計を一致させる
    var snapshot = null;
    if(result && result.isFinished){
      snapshot = {
        marks: (pred.marks||[]).map(function(m){return {boat:m.boat, prob:m.prob, score:m.score, mark:m.mark}}),
        trifecta: (pred.trifecta||[]).map(function(t){return {combo:t.combo, prob:t.prob}}),
        exacta: (pred.exacta||[]).map(function(t){return {combo:t.combo, prob:t.prob}}),
        raceType: pred.raceType,
        typeCls: pred.typeCls,
        typeLabel: pred.typeLabel,
        confidence: pred.confidence,
        confStars: pred.confStars,
        scenarios: pred.scenarios
      };
    }
    var entry={
      date:date,stadium:sid,race:rn,
      predicted:pred.marks.map(function(m){return m.boat}),
      mark_probs: (function(){
        var byBoat = {};
        (pred.marks||[]).forEach(function(m){ if(m && m.boat) byBoat[m.boat] = m.prob; });
        var out = [];
        for(var b=1;b<=6;b++) out.push({boat:b, prob: Number.isFinite(byBoat[b]) ? byBoat[b] : 1/6});
        return out;
      })(),
      trifecta_bets:pred.trifecta.map(function(t){return t.combo}),
      exacta_bets:pred.exacta.map(function(t){return t.combo}),
      // B14 (2026-05-17): 🔥穴予想 (高EV chip) を履歴追跡。pred.ana が無い
      //   古い predictor 経由でも壊さないよう Array.isArray でガード。
      ana_bets: Array.isArray(pred.ana) ? pred.ana.slice() : [],
      raceType:pred.raceType,
      pred_snapshot:snapshot,
      actual:null,trifecta_hit:false,exacta_hit:false,quinella_hit:false,ana_hit:false
    };
    if(result&&result.isFinished&&result.results){
      // 2026-05-07 fix: Open API が前日の確定結果を返すケースで「entry.date=今日 /
      // actual=昨日」の汚染が発生していた。result.race_date が date 引数と一致しない
      // 場合は result を無視して予想だけ保存する（actual を null のまま残す）
      var rdate = (result.race_date||'').replace(/-/g,'');
      if(!rdate || rdate === date){
        var sorted=result.results.slice().sort(function(a,b){return a.place-b.place});
        entry.actual=sorted.map(function(r){return r.racer_boat_number});
        checkHit(entry);
        if(result.refund){
          // F6: Open API / 自前スクレイパーともに payout フィールド。旧 amount は念のため互換維持
          if(entry.trifecta_hit&&result.refund.trifecta&&result.refund.trifecta[0])
            entry.payout3 = result.refund.trifecta[0].payout || result.refund.trifecta[0].amount || 0;
          if(entry.exacta_hit&&result.refund.exacta&&result.refund.exacta[0])
            entry.payout2 = result.refund.exacta[0].payout || result.refund.exacta[0].amount || 0;
          // B14: 穴予想の的中は同じ 3連単 refund を流用 (同じ着順 → 同じ payout)
          if(entry.ana_hit&&result.refund.trifecta&&result.refund.trifecta[0])
            entry.ana_payout = result.refund.trifecta[0].payout || result.refund.trifecta[0].amount || 0;
        }
      } else {
        console.warn('[savePrediction] race_date mismatch: entry='+date+' result='+rdate+' ('+sid+'-'+rn+'R) → actual を保存しない');
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
  // B14: 穴予想の的中判定（3連単 actual と ana_bets の一致）
  entry.ana_hit = !!(entry.ana_bets && entry.ana_bets.indexOf(a3)>=0);
}

function updateHistoryWithResults(){
  try{
    var history=safeParse('boatrace_history', []);   // PA-5
    var updated=false;
    history.forEach(function(h){
      if(!resultData||!resultData[String(h.stadium)]||!resultData[String(h.stadium)][String(h.race)]) return;
      var res=resultData[String(h.stadium)][String(h.race)];
      if(!res.isFinished||!res.results||res.results.length===0) return;

      // 2026-05-07 fix: race_date 不一致なら触らない（前日結果の汚染防止）
      var rdate = (res.race_date||'').replace(/-/g,'');
      if(rdate && rdate !== h.date) return;

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
        // B14: 穴予想の payout 遡及補完
        if(h.ana_hit && (!h.ana_payout || h.ana_payout===0) &&
           res.refund.trifecta && res.refund.trifecta[0]){
          h.ana_payout = res.refund.trifecta[0].payout || res.refund.trifecta[0].amount || 0;
          if(h.ana_payout) updated=true;
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
  if(capabilities.has('scheduler_post_task')){
    return scheduler.postTask(function(){}, {priority:'user-blocking'});
  }
  if(capabilities.has('scheduler_yield')){
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

/* BUILD:ANALYSIS_LEARNING:START */
"use strict";
(() => {
  // ../src/analysis/learning.js
  async function learnFromResultsViaWorker() {
    var w = _getAppWorker();
    if (!w || !resultData || !programData || !previewData) return null;
    return new Promise(function(resolve) {
      var reqId = ++_appWorkerReqId;
      _appWorkerCallbacks.set(reqId, function(msg) {
        if (msg.type !== "batch_learn_done" || !msg.result) {
          resolve(null);
          return;
        }
        var r = msg.result;
        if (Array.isArray(r.l2weights)) l2weights = r.l2weights;
        if (r.featureStats) _featureStats = r.featureStats;
        if (typeof r.trainStep === "number") l2trainStep = r.trainStep;
        if (r.learnedKeys) l2learnedKeys = r.learnedKeys;
        try {
          safeSet("boatrace_weights", l2weights);
        } catch (_) {
        }
        try {
          safeSet("boatrace_trainstep", l2trainStep);
        } catch (_) {
        }
        try {
          safeSet("boatrace_featurestats", _featureStats);
        } catch (_) {
        }
        try {
          safeSet("boatrace_learned", l2learnedKeys);
        } catch (_) {
        }
        console.log("[PG-9] worker learned " + r.learnedThisCall + " new races");
        resolve(r);
      });
      w.postMessage({
        type: "batch_learn",
        reqId,
        input: {
          resultData,
          programData,
          previewData,
          state: {
            l2weights,
            featureStats: _featureStats,
            trainStep: l2trainStep,
            learnedKeys: l2learnedKeys
          }
        }
      });
    });
  }
  async function learnFromResults() {
    if (!resultData || !programData || !previewData) return;
    if (_getAppWorker()) {
      var workerResult = await learnFromResultsViaWorker();
      if (workerResult) return;
    }
    var dateKey = function() {
      try {
        for (var s in programData) {
          var stadiums = programData[s];
          for (var r in stadiums) {
            var pgm = stadiums[r];
            if (pgm && pgm.race_date) return String(pgm.race_date).replace(/-/g, "");
          }
        }
      } catch (_) {
      }
      return jstYmd(0);
    }();
    var learnedThisCall = 0;
    var iterCount = 0;
    for (var sid in resultData) {
      var races = resultData[sid];
      for (var rn in races) {
        var race = races[rn];
        if (!race || !race.isFinished || !race.results || !race.results.length) continue;
        var prog = programData[sid] && programData[sid][rn];
        var prev = previewData[sid] && previewData[sid][rn];
        if (!prog || !prog.boats || !Array.isArray(prog.boats)) continue;
        var key = dateKey + "_" + sid + "_" + rn;
        if (l2learnedKeys[key]) continue;
        var sorted = race.results.slice().sort(function(a, b) {
          return a.place - b.place;
        });
        var winnerBoat = sorted[0].racer_boat_number;
        var stRanks = {};
        if (prev && prev.boats) {
          var sts = [];
          for (var si = 1; si <= 6; si++) {
            var spv = prev.boats[String(si)];
            var stVal = spv && spv.racer_start_timing != null ? pf(spv.racer_start_timing) : 99;
            sts.push({ boat: si, st: stVal });
          }
          sts.sort(function(a, b) {
            return a.st - b.st;
          });
          sts.forEach(function(s, idx) {
            stRanks[s.boat] = idx;
          });
        }
        var etRanks = {};
        if (prev && prev.boats) {
          var ets = [];
          for (var ei = 1; ei <= 6; ei++) {
            var epv = prev.boats[String(ei)];
            var etVal = epv && epv.racer_exhibition_time != null ? pf(epv.racer_exhibition_time) : 99;
            ets.push({ boat: ei, et: etVal });
          }
          ets.sort(function(a, b) {
            return a.et - b.et;
          });
          ets.forEach(function(e, idx) {
            etRanks[e.boat] = idx;
          });
        }
        var weather = prev && prev.weather ? prev.weather : null;
        var features6 = prog.boats.map(function(b) {
          var pv = prev && prev.boats ? prev.boats[String(b.racer_boat_number)] : null;
          return getL2Features(
            b,
            pv,
            weather,
            etRanks[b.racer_boat_number] != null ? etRanks[b.racer_boat_number] : 5,
            stRanks[b.racer_boat_number] != null ? stRanks[b.racer_boat_number] : 5,
            sid
          );
        });
        var winnerIdx = prog.boats.findIndex(function(b) {
          return b.racer_boat_number === winnerBoat;
        });
        if (winnerIdx >= 0) {
          l2Update(features6, winnerIdx);
          l2learnedKeys[key] = 1;
          learnedThisCall++;
        }
        iterCount++;
        if (iterCount % 6 === 0) await _yieldToMain();
      }
    }
    if (learnedThisCall > 0) {
      var keys = Object.keys(l2learnedKeys);
      if (keys.length > L2_KEY_LIMIT) {
        var keep = keys.slice(-L2_KEY_LIMIT);
        var trimmed = {};
        for (var i = 0; i < keep.length; i++) trimmed[keep[i]] = 1;
        l2learnedKeys = trimmed;
      }
      safeSet("boatrace_learned", l2learnedKeys);
      console.log(
        "[L2] learned " + learnedThisCall + " new races (total t=" + l2trainStep + ", tracked keys=" + Object.keys(l2learnedKeys).length + ")"
      );
    }
  }
  globalThis.learnFromResults = learnFromResults;
  globalThis.learnFromResultsViaWorker = learnFromResultsViaWorker;
})();

/* BUILD:ANALYSIS_LEARNING:END */

// ===============================================
// LIVE DATA MERGE HELPER
// ===============================================

// _filterStalePreviews は src/discovery/openapi_client.js に移動 (Clearwing Phase 2b)
// → BUILD:DISCOVERY_OPENAPI bundle 経由で globalThis._filterStalePreviews を提供

// D4a (2026-05-17): local data/previews/today.json の merge を条件付きに。
//   Path C で Worker /api/previews が 5 分鮮度になり、scrape_all は 30 分間隔
//   archive 役に格下げ (D3a)。local が 20 分以上古い場合 Worker の方が新しいので
//   merge を skip し、データ精度を保つ。merge 自体は非破壊だが余計な書込を回避。
function _shouldApplyLocalMerge(localData){
  if(!localData || !Array.isArray(localData.races)) return false;
  // rt-fix3 (2026-06-11): 旧 20 分しきい値を撤廃。
  //   旧版は「Worker が常に新しい」前提で 20 分超の local data を skip していたが、
  //   GHA cron 間引き (実測 4-6 回/日) で data/previews/today.json が日常的に
  //   30-60 分超 stale になる。一方で確定結果 (finished+result.places) は
  //   Worker /api/previews には乗らないため、skip した瞬間「全レース終了したのに
  //   画面が更新されない」体感が発生していた (ユーザー報告 2026-06-11)。
  //   _applyLiveDataMerge 内に十分な保護がある:
  //     (1) liveDate===todayDate の日付ガード (前日データは弾く)
  //     (2) 展示タイム / ST / チルトは「>0 / 非 null の時だけ上書き」
  //         → Worker の richer data を local stale で退行させない (more-info-wins)
  //     (3) 既存 finished+today の result は _shouldOverwrite=false で上書きしない
  //         → 確定済み結果の巻き戻りも起きない
  //   よって age での skip は不要。Worker 主系が新しい時間帯は merge が no-op に
  //   近くなるだけで実害なし。
  return true;
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
      // 2026-05-16: 既存 resultData に「前日 race_date 付き finished entry」が
      //   居る場合 (Open API fallback が前日結果を返したケース) でも、本日の
      //   live previews 結果で **上書きする**。既存 race_date が今日でなければ
      //   stale と判定し overwrite。これが無いと _backfillTodayPredictions が
      //   `rdate !== today` で全 skip し、本日 history が 0 件のままになる。
      var _existing = resultData[sid][rn];
      var _existingDate = (_existing && _existing.race_date || '').replace(/-/g,'');
      var _todayNoDash = todayDate.replace(/-/g,'');
      var _shouldOverwrite = !_existing
        || !_existing.isFinished
        || (_existingDate && _existingDate !== _todayNoDash);
      if(_shouldOverwrite){
        resultData[sid][rn]={race_stadium_number:lr.stadium,race_number:lr.race,
          race_date:todayDate,  // ← backfill が rdate===today を確認できるよう明示
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
  // Epic 28c: 初回 loadAllData では timestamp 不要 (fetchWithFallback が cache:no-store 指定済)。
  //   ?t= を付けると <link rel="preload"> の URL と乖離して preload が無駄になり警告発生。
  //   refresh 系 (hardReload / forceRefresh) では timestamp を付ける (CDN bust 確実化)。
  var ts='';
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
  if(rawPrograms && typeof _noteTodayDataFromRaw==='function') _noteTodayDataFromRaw(rawPrograms,'programs');
  if(rawPreviews && typeof _noteUpdatedAt==='function') _noteUpdatedAt(rawPreviews.updated_at);
  if(rawPreviews && typeof _noteTodayDataFromRaw==='function') _noteTodayDataFromRaw(rawPreviews,'previews');
  if(prog) prog.style.width='70%';

  // PE-8: 結果 — 自前 → Open API fallback（Critical: ヘッダーバー的中表示用）
  // F4.1 で data/results/today.json はスタブ運用となり、確定結果は OpenAPI と
  // data/previews/today.json の merge から得る。ローカルが今日の日付でも
  // race_technique_number が全て null（スタブ）なら OpenAPI にフォールバックする。
  if(msg) msg.textContent='結果を取得中...';
  var rawResults=null;
  try{
    var resResp=await fetch('data/results/today.json?t='+Date.now());
    if(resResp.ok){
      var resData=await resResp.json();
      if(resData.results&&resData.results.length>0){
        var resDate=resData.results[0].race_date;
        var todayRes=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        // FIX: race_date は "YYYYMMDD" or "YYYY-MM-DD" の両形式があるため正規化して比較
        var resDateNoDash=String(resDate||'').replace(/-/g,'');
        var todayResNoDash=todayRes.replace(/-/g,'');
        var hasRealFinish=resData.results.some(function(r){return r.race_technique_number!=null});
        if(resDateNoDash===todayResNoDash && hasRealFinish){rawResults=resData;}
      }
    }
  }catch(e){}
  if(!rawResults){rawResults=await fetchWithFallback(API_BASE+'/results/v2/today.json'+ts)}
  await _yieldToMain();   // PH-5
  resultData=indexResults(rawResults);
  await _yieldToMain();   // PH-5
  if(rawResults&&typeof _noteUpdatedAt==='function') _noteUpdatedAt(rawResults.updated_at);
  if(rawResults&&typeof _noteTodayDataFromRaw==='function') _noteTodayDataFromRaw(rawResults,'results');

  // F5: 自前スマートスケジューラ出力 (races 配列形式) を merge
  // D4a: local が 20 分以上古い場合は skip (Worker の方が新しい)
  try{
    var localPv=await fetch('data/previews/today.json?t='+Date.now());
    if(localPv.ok){
      var localData=await localPv.json();
      if(_shouldApplyLocalMerge(localData)){
        await _yieldToMain();   // PH-5
        _applyLiveDataMerge(localData);
        if(typeof _noteUpdatedAt==='function') _noteUpdatedAt(localData.updated_at);
      } else if(localData && localData.updated_at){
        if(typeof _noteUpdatedAt==='function') _noteUpdatedAt(localData.updated_at);
      }
    }
  }catch(e){console.warn('local previews merge failed:', e)}

  if(prog) prog.style.width='100%';
  if(msg) msg.textContent='完了';

  // PE-8: Phase 2 — 非クリティカル DB / 学習を idle time に deferred
  //   capabilities.runIdle = scheduler.postTask 'background' > requestIdleCallback > setTimeout
  var schedule = function(fn){ capabilities.runIdle(fn, {timeout: 3000, delay: 100}); };
  schedule(function(){ loadDeferredData(rawPrograms, rawPreviews).catch(function(e){
    console.warn('[PE-8] deferred load failed:', e);
  }); });
  // 次節カードに「次回開催日」を後付け表示（軽量 fetch、失敗無視）
  schedule(function(){ _loadNextOpen(); });

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

  // Tier 3 (2026-05-24): GBDT model 読込 (n_trees=0 placeholder の間は no-op)
  //   _gbdtModel global を初期化。失敗しても予測は L1+L2 で続行 (safety)。
  tasks.push((async function(){
    try{
      if(typeof loadGBDTModel === 'function') await loadGBDTModel();
    } catch(e){ /* gbdt 失敗は致命にしない */ }
  })());

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
      // Epic 28h: 直接 localStorage.setItem は IDB 移行を bypass し racerDB の LS 重複が
      //   膨張し続ける真因 (ユーザログで 2281→2406KB に 10 分で +125KB 確認)。
      //   saveDB() 経由に統一 → IDB 優先 / IDB 不可なら safeSet で LS fallback。
      try { saveDB(); } catch(e){ console.warn('[PE-8] saveDB failed:', e.message); }
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
      // Epic 28h: 直接 setItem を saveDB() 経由に統一 (IDB 優先で LS 重複を防止)
      try { saveDB(); } catch(e){ console.warn('[PE-8] stadiumDB saveDB failed:', e.message); }
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
        // rt-fix2 P0-A: openStadium の先回り live 取得が先に走るケースがあるためガード付きマージ
        if(oddsDate===todayDate){_mergeOddsSnapshot(od);}
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

  // オリジナル展示（各場サイトの一周/まわり足/直線、対応場のみ）→ sid->rno->{waku->boat} に index
  tasks.push((async function(){
    try{
      var oeResp=await fetch('data/orig_exhibition/today.json?t='+Date.now());
      if(oeResp.ok){
        var oe=await oeResp.json();
        var idx={};
        (oe&&oe.exhibition||[]).forEach(function(r){
          var sid=r.race_stadium_number, rno=r.race_number;
          if(sid==null||rno==null) return;
          if(!idx[sid]) idx[sid]={};
          var bymap={};
          (r.boats||[]).forEach(function(b){ if(b&&b.racer_boat_number) bymap[b.racer_boat_number]=b; });
          idx[sid][rno]=bymap;
        });
        _origExhibIndex=idx;
      }
    }catch(e){}
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

/* BUILD:REPORTING_PAGE_ROUTER:START */
"use strict";
(() => {
  // ../src/reporting/page_router.js
  var _chunkStates = {
    stats: { loaded: false, promise: null },
    detail: { loaded: false, promise: null }
  };
  function _loadChunk(stateKey, filename) {
    var st = _chunkStates[stateKey];
    if (!st) {
      return Promise.reject(new Error("unknown chunk: " + stateKey));
    }
    if (st.loaded) return Promise.resolve();
    if (st.promise) return st.promise;
    st.promise = new Promise(function(resolve, reject) {
      var ver = "";
      try {
        var existing = document.querySelector('script[src*="app-rest.min.js"]');
        if (existing && existing.src) {
          var m = existing.src.match(/\?v=([\w]+)/);
          if (m) ver = "?v=" + m[1];
        }
      } catch (_) {
      }
      var s = document.createElement("script");
      s.src = "assets/" + filename + ver;
      s.defer = true;
      s.onload = function() {
        st.loaded = true;
        resolve();
      };
      s.onerror = function(e) {
        st.promise = null;
        reject(new Error("Failed to load " + filename + ": " + (e && e.message ? e.message : "unknown")));
      };
      document.head.appendChild(s);
    });
    return st.promise;
  }
  function _ensureStatsChunk() {
    return _loadChunk("stats", "app-rest-stats.min.js");
  }
  function _ensureRaceDetailChunk() {
    return _loadChunk("detail", "app-rest-detail.min.js");
  }
  function showPage(page) {
    document.querySelectorAll(".page").forEach(function(p) {
      p.classList.remove("active");
    });
    document.querySelectorAll(".nav-btn").forEach(function(b) {
      b.classList.remove("active");
      b.removeAttribute("aria-current");
    });
    if (page !== "detail") stopOddsAutoRefresh();
    function _setActive(navId) {
      var el = document.getElementById(navId);
      if (el) {
        el.classList.add("active");
        el.setAttribute("aria-current", "page");
      }
    }
    if (page === "top") {
      document.getElementById("pageTop").classList.add("active");
      _setActive("navTop");
    } else if (page === "races") {
      document.getElementById("pageRaces").classList.add("active");
      _setActive("navTop");
      _ensureRaceDetailChunk().catch(function() {
      });
    } else if (page === "detail") {
      document.getElementById("pageDetail").classList.add("active");
      _setActive("navTop");
      startOddsAutoRefresh();
    } else if (page === "stats") {
      document.getElementById("pageStats").classList.add("active");
      _setActive("navStats");
      _ensureStatsChunk().then(
        function() {
          if (typeof renderStats === "function") renderStats();
        },
        function(err) {
          try {
            if (typeof reportError === "function") reportError({ type: "chunk-load", msg: String(err) });
          } catch (_) {
          }
        }
      );
    } else if (page === "backtest") {
      document.getElementById("pageBacktest").classList.add("active");
      _setActive("navBacktest");
      _ensureStatsChunk().catch(function() {
      });
    } else if (page === "settings") {
      document.getElementById("pageSettings").classList.add("active");
      _setActive("navSettings");
      loadSettings();
    }
    window.scrollTo(0, 0);
    try {
      _persistNavState(page, currentStadium, currentRace);
    } catch (_) {
    }
  }
  globalThis.showPage = showPage;
  globalThis._ensureStatsChunk = _ensureStatsChunk;
  globalThis._ensureRaceDetailChunk = _ensureRaceDetailChunk;
})();

/* BUILD:REPORTING_PAGE_ROUTER:END */

/* BUILD:REPORTING_STADIUM_PAGES:START */
"use strict";
(() => {
  // ../src/reporting/stadium_pages.js
  function renderStadiums() {
    document.getElementById("topLoading").style.display = "none";
    var sumDiv = document.getElementById("topSummary");
    var list = document.getElementById("stadiumList");
    list.style.display = "grid";
    var acc = getAccuracy();
    sumDiv.innerHTML = '<div class="summary-bar"><div class="summary-item"><div class="s-num" style="color:var(--accent)">' + acc.total + '</div><div class="s-label">\u5224\u5B9A\u6E08</div></div><div class="summary-item"><div class="s-num" style="color:var(--gold)">' + acc.trifectaHit + '</div><div class="s-label">3\u9023\u5358\u7684\u4E2D</div></div><div class="summary-item"><div class="s-num" class="c-success">' + acc.trifectaRate + '%</div><div class="s-label">\u7684\u4E2D\u7387</div></div><div class="summary-item"><div class="s-num" style="color:var(--text)">' + Object.keys(racerDB).length + '</div><div class="s-label">\u9078\u624BDB</div></div></div>';
    var activeIds = {};
    if (programData) {
      for (var sid in programData) activeIds[sid] = true;
    }
    var html = "";
    var _nowMs = Date.now();
    function _closedMs(s) {
      var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || "");
      return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]) : null;
    }
    var _rdToday = false;
    if (raceData && raceData.race_date) {
      var _rdDate = String(raceData.race_date).replace(/-/g, "");
      var _tday = typeof todayStr === "function" ? todayStr() : "";
      _rdToday = !!(_tday && _rdDate === _tday);
    }
    for (var id = 1; id <= 24; id++) {
      var sid = String(id);
      var name = STADIUMS[id];
      if (activeIds[sid] && programData[sid]) {
        var stadium = programData[sid];
        var raceNums = Object.keys(stadium).sort(function(a, b) {
          return parseInt(a) - parseInt(b);
        });
        var totalRaces = raceNums.length;
        var doneCount = 0;
        var nextRn = null;
        for (var rj = 0; rj < raceNums.length; rj++) {
          var rnc = raceNums[rj];
          var rsc = resultData && resultData[sid] && resultData[sid][rnc];
          var finC = !!(rsc && /** @type {any} */
          rsc.isFinished);
          var clMs = _closedMs(stadium[rnc] && stadium[rnc].race_closed_at);
          var doneC = finC || clMs != null && clMs <= _nowMs;
          if (doneC) doneCount++;
          else if (nextRn === null) nextRn = rnc;
        }
        var firstRace = stadium[raceNums[0]];
        var gradeNum = firstRace ? firstRace.race_grade_number || 5 : 5;
        var grade = GRADE_CLASS[gradeNum] || GRADE_CLASS[5];
        var dayInfo = "";
        if (_rdToday && raceData && raceData.racedata) {
          var rd = raceData.racedata.find(function(r) {
            return r.stadium === parseInt(sid);
          });
          if (rd && rd.day_label) dayInfo = rd.day_label;
          else if (rd && rd.day) dayInfo = rd.day + "\u65E5\u76EE";
        }
        var nextRaceInfo;
        if (nextRn) {
          var _ncClosed = stadium[nextRn] && stadium[nextRn].race_closed_at;
          var _ncHm = _ncClosed ? (String(_ncClosed).split(" ")[1] || "").slice(0, 5) : "";
          nextRaceInfo = _ncHm ? nextRn + "R " + _ncHm : nextRn + "R";
        } else {
          nextRaceInfo = "\u767A\u58F2\u7D42\u4E86";
        }
        html += '<div class="stadium-card active-stadium" data-sid="' + sid + '" role="button" tabindex="0" data-action="openStadium" data-arg-sid="' + sid + '"><span class="stadium-grade ' + grade.cls + '">' + grade.name + '</span><span class="stadium-name">' + name + '</span><span class="stadium-status">' + doneCount + "/" + totalRaces + 'R</span><span class="stadium-day">' + (dayInfo || "&nbsp;") + '</span><span class="stadium-day">' + nextRaceInfo + "</span></div>";
      } else {
        var iso = typeof _nextOpenMap === "object" && _nextOpenMap ? _nextOpenMap[sid] || "" : "";
        var dateLabel = _formatNextOpen(iso);
        var dateHtml = dateLabel ? '<span class="stadium-next-date">' + dateLabel + "</span>" : "";
        html += '<div class="stadium-card inactive-stadium"' + (iso ? ' data-next-open="' + iso + '"' : "") + '><span class="stadium-name">' + name + '</span><span class="stadium-status">\u6B21\u7BC0</span>' + dateHtml + "</div>";
      }
    }
    list.innerHTML = html;
  }
  function openStadium(sid) {
    if (typeof predictRace !== "function" || typeof savePrediction !== "function") {
      try {
        reportError({ type: "info", msg: "openStadium deferred: rest not ready", sid });
      } catch (_) {
      }
      currentStadium = sid;
      var name0 = typeof STADIUMS !== "undefined" && STADIUMS[parseInt(sid)] || "\u5834" + sid;
      var t = document.getElementById("racesTitle");
      if (t) t.textContent = name0;
      var l = document.getElementById("racesList");
      if (l) l.innerHTML = '<div class="card">\u8AAD\u8FBC\u4E2D... (\u4E88\u6E2C\u30E2\u30B8\u30E5\u30FC\u30EB\u5F85\u6A5F)</div>';
      showPage("races");
      var _retry = 0;
      var _iv = setInterval(function() {
        _retry++;
        if (typeof predictRace === "function" && typeof savePrediction === "function") {
          clearInterval(_iv);
          try {
            openStadium(sid);
          } catch (e) {
            try {
              reportError({ type: "error", msg: "openStadium retry threw: " + e.message });
            } catch (_) {
            }
          }
        } else if (_retry > 30) {
          clearInterval(_iv);
          if (l)
            l.innerHTML = '<div class="card">\u4E88\u6E2C\u30E2\u30B8\u30E5\u30FC\u30EB\u306E\u8AAD\u8FBC\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u300C\u66F4\u65B0\u300D\u30DC\u30BF\u30F3\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002</div>';
        }
      }, 200);
      return;
    }
    currentStadium = sid;
    var name = STADIUMS[parseInt(sid)] || "\u5834" + sid;
    var stadium = programData[sid];
    if (!stadium) {
      document.getElementById("racesTitle").textContent = name;
      document.getElementById("racesList").innerHTML = '<div class="card">\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093</div>';
      showPage("races");
      return;
    }
    var firstRace = stadium[Object.keys(stadium)[0]];
    var gradeNum = firstRace ? firstRace.race_grade_number || 5 : 5;
    var grade = GRADE_CLASS[gradeNum] || GRADE_CLASS[5];
    document.getElementById("racesTitle").innerHTML = name + ' <span class="stadium-grade ' + grade.cls + '" style="vertical-align:middle">' + grade.name + "</span>";
    var raceNums = Object.keys(stadium).sort(function(a, b2) {
      return parseInt(a) - parseInt(b2);
    });
    var _historyForLoop = typeof safeParse === "function" ? safeParse("boatrace_history", []) : [];
    var _todayForLoop = typeof todayStr === "function" ? todayStr() : "";
    var html = '<table class="race-table">';
    html += "<thead><tr>";
    html += '<th class="race-col">R</th>';
    for (var b = 1; b <= 6; b++) {
      html += '<th class="boat-col boat-header-' + b + '">' + b + "</th>";
    }
    html += "</tr></thead><tbody>";
    raceNums.forEach(function(rn) {
      var race = stadium[rn];
      var pred = predictRace(sid, parseInt(rn));
      var progPred = predictRaceProgram(sid, parseInt(rn));
      var hasResult = resultData && resultData[sid] && resultData[sid][rn] && resultData[sid][rn].isFinished;
      if (pred) savePrediction(todayStr(), sid, rn, pred, hasResult ? resultData[sid][rn] : null);
      if (hasResult) {
        try {
          var _h = safeParse("boatrace_history", []);
          for (var _hi = 0; _hi < _h.length; _hi++) {
            var _e = _h[_hi];
            if (_e.date === todayStr() && _e.stadium === sid && _e.race === rn && _e.pred_snapshot) {
              var _liveMarkByBoat = {};
              (pred && pred.marks ? pred.marks : []).forEach(function(_m) {
                if (_m && _m.boat) _liveMarkByBoat[_m.boat] = _m.mark;
              });
              var _snapMarks = (_e.pred_snapshot.marks || pred.marks || []).map(function(_m) {
                return Object.assign({}, _m, { mark: _m.mark || _liveMarkByBoat[_m.boat] || "" });
              });
              pred = {
                marks: _snapMarks,
                trifecta: _e.pred_snapshot.trifecta || pred.trifecta,
                exacta: _e.pred_snapshot.exacta || pred.exacta,
                raceType: _e.pred_snapshot.raceType || pred.raceType,
                typeCls: _e.pred_snapshot.typeCls || pred.typeCls,
                typeLabel: _e.pred_snapshot.typeLabel || pred.typeLabel,
                confidence: _e.pred_snapshot.confidence != null ? _e.pred_snapshot.confidence : pred.confidence,
                confStars: _e.pred_snapshot.confStars != null ? _e.pred_snapshot.confStars : pred.confStars,
                scenarios: _e.pred_snapshot.scenarios || pred.scenarios
              };
              break;
            }
          }
        } catch (_) {
        }
      }
      var pvData = previewData && previewData[sid] && previewData[sid][rn] ? previewData[sid][rn] : null;
      var hasRealPv = false;
      if (pvData && pvData.boats) {
        for (var pk in pvData.boats) {
          if (pvData.boats[pk] && (pvData.boats[pk].racer_exhibition_time || 0) > 0) {
            hasRealPv = true;
            break;
          }
        }
      }
      var dispPred = hasRealPv && pred ? pred : null;
      var typeSource = dispPred || progPred;
      var typeIcon = typeSource ? typeSource.raceType === "honmei" ? "\u26A1" : typeSource.raceType === "ana" ? "\u{1F525}" : "\u{1F4CA}" : "";
      var typeCls = dispPred ? dispPred.typeCls : progPred ? "type-" + (progPred.raceType || "middle") : "";
      var riserStr = "";
      if (dispPred && progPred) {
        var diff = comparePredictions(progPred, dispPred);
        if (diff && diff.biggestRiser)
          riserStr = ' <span style="color:#43A047;font-size:9px">\u2191' + diff.biggestRiser.boat + "</span>";
      }
      html += '<tr data-action="openRace" data-arg-sid="' + sid + '" data-arg-rn="' + rn + '">';
      var closedAt = race.race_closed_at || "";
      var closedTime = closedAt ? closedAt.split(" ")[1] || "" : "";
      if (closedTime) closedTime = closedTime.slice(0, 5);
      var stageLabel = hasRealPv ? '<span style="font-size:8px;color:#E65100">\u76F4\u524D</span>' : '<span style="font-size:8px;color:#1A237E">\u756A\u7D44</span>';
      html += '<td class="race-num-cell">' + rn + '<br><span style="font-size:9px;color:var(--text-dim);font-weight:400">' + closedTime + '</span><span class="race-type-icon"><span class="type-badge ' + typeCls + '">' + typeIcon + "</span></span><br>" + stageLabel + riserStr + "</td>";
      if (race.boats && Array.isArray(race.boats)) {
        var boatMap = {};
        race.boats.forEach(function(bt2) {
          if (bt2 && bt2.racer_boat_number) boatMap[bt2.racer_boat_number] = bt2;
        });
        var activePredMarks = dispPred ? dispPred.marks : progPred ? progPred.marks : null;
        for (var bn = 1; bn <= 6; bn++) {
          var bt = boatMap[bn];
          if (!bt) {
            html += "<td>-</td>";
            continue;
          }
          var racerName = escText(bt.racer_name || "");
          var isTop = activePredMarks && activePredMarks[0] && activePredMarks[0].boat === bn;
          var nameClass = isTop ? "name-bold" : "";
          var markStr = isTop ? "\u25CE " : "";
          html += '<td class="racer-cell"><span class="' + nameClass + '">' + markStr + escText(racerName) + "</span></td>";
        }
      } else {
        for (var x = 0; x < 6; x++) html += "<td>-</td>";
      }
      html += "</tr>";
      if (hasResult && pred) {
        var res = resultData[sid][rn];
        var _rawResults = res && Array.isArray(res.results) ? res.results : [];
        var places = _rawResults.filter(function(x2) {
          return x2 && Number.isFinite(x2.place) && x2.racer_boat_number;
        }).sort(function(a, b2) {
          return a.place - b2.place;
        }).slice(0, 3);
        if (places.length < 3) return;
        var actualCombo = places[0].racer_boat_number + "-" + places[1].racer_boat_number + "-" + places[2].racer_boat_number;
        var hit;
        var _saved = null;
        for (var _hi = 0; _hi < _historyForLoop.length; _hi++) {
          var _e = _historyForLoop[_hi];
          if (_e.date === _todayForLoop && _e.stadium === sid && _e.race === rn) {
            _saved = _e;
            break;
          }
        }
        if (_saved && Array.isArray(_saved.trifecta_bets)) {
          hit = _saved.trifecta_bets.indexOf(actualCombo) >= 0;
        } else {
          hit = pred.trifecta.some(function(t2) {
            return t2.combo === actualCombo;
          });
        }
        html += '<tr data-action="openRace" data-arg-sid="' + sid + '" data-arg-rn="' + rn + '" style="background:' + (hit ? "#E8F5E9" : "#FFEBEE") + '">';
        html += '<td class="race-result-cell ' + (hit ? "hit" : "miss") + '">' + (hit ? "\u7684\u4E2D" : "\xD7") + "</td>";
        for (var bn2 = 1; bn2 <= 6; bn2++) {
          var placeNum = null;
          places.forEach(function(p, pi) {
            if (p && p.racer_boat_number === bn2) placeNum = pi + 1;
          });
          html += '<td class="race-result-cell">' + (placeNum ? placeNum + "\u7740" : "") + "</td>";
        }
        html += "</tr>";
      }
    });
    html += "</tbody></table>";
    document.getElementById("racesList").innerHTML = html;
    document.getElementById("raceSummary").innerHTML = "";
    _prefetchLiveOddsForUpcoming(sid);
    showPage("races");
  }
  function _prefetchLiveOddsForUpcoming(sid) {
    try {
      if (typeof _kickOffLiveOddsRefresh !== "function") return;
      var races = typeof programData !== "undefined" && programData ? programData[sid] : null;
      if (!races) return;
      var jst = new Date(Date.now() + 9 * 36e5);
      var nowMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
      var candidates = [];
      for (var rn in races) {
        var race = races[rn];
        if (!race || !race.race_closed_at) continue;
        var rs = typeof resultData !== "undefined" && resultData && resultData[sid] && resultData[sid][rn];
        if (rs && /** @type {any} */
        rs.isFinished) continue;
        var hm = String(race.race_closed_at).split(" ")[1];
        if (!hm) continue;
        var hp = hm.split(":");
        var closeMin = parseInt(hp[0], 10) * 60 + parseInt(hp[1], 10);
        if (!Number.isFinite(closeMin)) continue;
        var delta = closeMin - nowMin;
        if (delta >= -2 && delta <= 40) candidates.push({ rn, delta });
      }
      candidates.sort(function(a, b) {
        return a.delta - b.delta;
      });
      candidates.forEach(function(c, i) {
        setTimeout(function() {
          try {
            _kickOffLiveOddsRefresh(sid, c.rn);
          } catch (_) {
          }
        }, i * 400);
      });
    } catch (_) {
    }
  }
  globalThis.renderStadiums = renderStadiums;
  globalThis.openStadium = openStadium;
})();

/* BUILD:REPORTING_STADIUM_PAGES:END */

// P2-1 (Epic 14): ローカル通知 — server push 不要、起動時の差分検知で notify
//   トリガ: loadAllData 完了後、お気に入り（boatrace_watched）の確定レースを 1 通知に集約
//   許可: ユーザが明示的に「許可リクエスト」ボタンを押した時のみ requestPermission
function _enableNotifyPermission(){
  if(!capabilities.has('notification')){
    alert('このブラウザは通知に対応していません');
    return;
  }
  Notification.requestPermission().then(function(p){
    var el = document.getElementById('notifyStatus');
    if(el){
      el.textContent = (p === 'granted') ? '✓ 許可済'
                     : (p === 'denied')  ? '× 拒否（ブラウザ設定で変更可）'
                     : '保留';
      el.style.color = (p === 'granted') ? 'var(--success)' : 'var(--text-sub)';
    }
  });
}
function _refreshNotifyStatus(){
  var el = document.getElementById('notifyStatus');
  if(!el || !capabilities.has('notification')) return;
  var p = Notification.permission;
  el.textContent = (p === 'granted') ? '✓ 許可済'
                 : (p === 'denied')  ? '× 拒否'
                 : '未設定';
  el.style.color = (p === 'granted') ? 'var(--success)' : 'var(--text-sub)';
}
function _maybeNotifyNewResults(){
  if(!capabilities.has('notification') || Notification.permission !== 'granted') return;
  if(!resultData || typeof resultData !== 'object') return;
  var watched = (typeof _loadWatched === 'function') ? _loadWatched() : [];
  if(watched.length === 0) return;
  var now = Date.now();
  var newlyFinished = [];
  watched.forEach(function(w){
    var sd = resultData[w.sid];
    if(!sd) return;
    var rd = sd[w.race];
    if(rd && rd.isFinished) newlyFinished.push({sid:w.sid, race:w.race});
  });
  if(newlyFinished.length === 0) return;
  var sample = newlyFinished.slice(0, 3).map(function(it){
    var name = (typeof STADIUMS !== 'undefined' && STADIUMS[parseInt(it.sid)]) || ('場'+it.sid);
    return name + ' ' + it.race + 'R';
  }).join(' / ');
  var more = newlyFinished.length > 3 ? ' 他' + (newlyFinished.length - 3) + '件' : '';
  try {
    var notif = new Notification('お気に入りレースの結果が確定', {
      body: sample + more,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'boatrace-watched-results',
      renotify: false,
    });
    notif.onclick = function(){
      try { window.focus(); }catch(_){}
      try { showPage('stats'); }catch(_){}
      notif.close();
    };
  } catch(e){
    console.warn('[notify] failed:', e);
  }
  try { localStorage.setItem('boatrace_notify_last_seen', String(now)); } catch(_){}
}

// P2-2: お気に入りレース管理（注目したいレースを localStorage に記録）
//   key: boatrace_watched = [{sid, race, ts}]、上限 100 件のリングバッファ
var _WATCHED_KEY = 'boatrace_watched';
var _WATCHED_MAX = 100;
function _loadWatched(){
  try { return safeParse(_WATCHED_KEY, []); } catch(_) { return []; }
}
function _isRaceWatched(sid, rn){
  var arr = _loadWatched();
  return arr.some(function(w){ return String(w.sid)===String(sid) && String(w.race)===String(rn); });
}
function _toggleRaceWatched(sid, rn){
  var arr = _loadWatched();
  var idx = arr.findIndex(function(w){ return String(w.sid)===String(sid) && String(w.race)===String(rn); });
  if(idx >= 0){
    arr.splice(idx, 1);
  } else {
    arr.push({ sid: String(sid), race: String(rn), ts: Date.now() });
    if(arr.length > _WATCHED_MAX) arr = arr.slice(-_WATCHED_MAX);
  }
  try { safeSet(_WATCHED_KEY, arr); } catch(_){}
  // ボタン表示更新
  var btn = document.getElementById('raceStarBtn');
  if(btn){
    var nowOn = !( idx >= 0 );
    btn.textContent = nowOn ? '⭐' : '☆';
  }
}

// P0-4: 詳細画面のタブ切替（lineup / ai / odds）
function _showDetailTab(name){
  if(!name) name = 'lineup';
  var btns = document.querySelectorAll('.detail-tab-btn');
  for(var i=0;i<btns.length;i++){
    var on = btns[i].getAttribute('data-detail-tab') === name;
    btns[i].classList.toggle('active', on);
    btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }
  var secs = document.querySelectorAll('.detail-tab-section');
  for(var j=0;j<secs.length;j++){
    var on2 = secs[j].getAttribute('data-detail-section') === name;
    secs[j].classList.toggle('active', on2);
  }
  // タブ切替で表示位置を上に戻す（長スクロール対策）
  try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch(_) { window.scrollTo(0,0); }
}

// P0-5: ナビ状態の保存/復元（PWA 再起動時のページ位置保持）
//   sessionStorage は同一タブセッション内のみ保持されるため、
//   タブを閉じれば消える。安全 / シンプル / quota も別枠。
function _persistNavState(page, sid, rn){
  try {
    var st = { page: page||'top', sid: sid||null, rn: rn||null, ts: Date.now() };
    sessionStorage.setItem('boatrace_nav', JSON.stringify(st));
  } catch(_){}
}
function _restoreNavState(){
  var raw = null;
  try { raw = sessionStorage.getItem('boatrace_nav'); }catch(_){ return; }
  if(!raw) return;
  var st = null;
  try { st = JSON.parse(raw); }catch(_){ return; }
  if(!st || !st.page || st.page === 'top') return;
  // 1時間以上前は古いとして無視（ユーザー意図ではない可能性）
  if(!st.ts || Date.now() - st.ts > 3600000) return;
  function ready(){
    if(typeof showPage !== 'function') return false;
    if(st.page === 'races' && typeof openStadium !== 'function') return false;
    if(st.page === 'detail' && typeof openRace !== 'function') return false;
    return true;
  }
  function doRestore(){
    try {
      if(st.page === 'races' && st.sid){ openStadium(st.sid); }
      else if(st.page === 'detail' && st.sid && st.rn){ openRace(st.sid, st.rn); }
      else if(st.page === 'stats' || st.page === 'settings' || st.page === 'backtest'){ showPage(st.page); }
    } catch(e) {
      try{ reportError({type:'warn', msg:'_restoreNavState failed: '+e.message}); }catch(_){}
    }
  }
  if(ready()){ doRestore(); return; }
  // rest 関数の lazy load を最大 6 秒待つ
  var retry = 0;
  var iv = setInterval(function(){
    retry++;
    if(ready()){ clearInterval(iv); doRestore(); }
    else if(retry > 30){ clearInterval(iv); }
  }, 200);
}

// ===============================================
// SCREEN 1: TOP - 4 column stadium grid (REWRITTEN)
// ===============================================

// 次回開催日表示: ISO 'YYYY-MM-DD' → '5/13(火)' or '本日開催'
//   不正値・空値は空文字を返す（呼び出し側で表示制御）
function _formatNextOpen(iso){
  if(!iso || typeof iso !== 'string') return '';
  var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return '';
  var d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
  if(isNaN(d.getTime())) return '';
  // FIX: todayStr() は 'YYYYMMDD' 形式（dash 無し）を返すため、
  //   そのまま 'YYYY-MM-DD' な iso と lex 比較すると `-` (45) < `0` (48) で
  //   すべての iso が past 扱いになる。ここでは ISO 形式 (YYYY-MM-DD) に揃える。
  var t = (typeof todayStr === 'function') ? todayStr() : '';
  var todayIso = (t && /^\d{8}$/.test(t)) ? (t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6,8)) : '';
  // rt-fix3 (2026-06-27): _formatNextOpen は「非開催(グレー)の場」専用に呼ばれる。
  //   非開催の場は定義上「本日開催」ではありえない（開催中ならプログラムに載りアクティブ=青）。
  //   スケジュールデータ(current.json→next_open.json)が古いと、本来終了済/非開催の場の
  //   next_open に今日や過去日付が残り、「次節なのに本日開催」という矛盾表示になっていた。
  //   → 今日・過去の next_open は stale とみなし日付ラベルを出さない（カードは「次節」のみ）。
  //     未来日付のみ「M/D(曜)」を表示する。
  if(todayIso && iso <= todayIso) return '';
  var wd = '日月火水木金土'[d.getDay()];
  return d.getMonth()+1 + '/' + d.getDate() + '(' + wd + ')';
}

// 次回開催日マップ (sid → 'YYYY-MM-DD')
var _nextOpenMap = {};
async function _loadNextOpen(){
  try {
    var r = await fetch('data/schedule/next_open.json', { cache:'no-cache' });
    if(!r.ok) return;
    var j = await r.json();
    _nextOpenMap = (j && j.next_open) ? j.next_open : {};
    // 既に renderStadiums 済みならカードを再描画
    if(typeof renderStadiums === 'function' && document.getElementById('stadiumList')){
      try { renderStadiums(); } catch(_){}
    }
  } catch(_){}
}

// ===============================================
// SCREEN 2: RACE LIST TABLE (REWRITTEN)
// ===============================================

// ===============================================
// SCREEN 3: RACE DETAIL - Macour style (REWRITTEN)
// ===============================================

/* BUILD:REPORTING_RACE_DETAIL:START */
"use strict";
(() => {
  // ../src/reporting/race_detail.js
  function openRace(sid, rn) {
    currentStadium = sid;
    currentRace = rn;
    if (typeof globalThis._loadOrigExhibitionLive === "function") globalThis._loadOrigExhibitionLive(sid, rn);
    var name = STADIUMS[parseInt(sid)] || "\u5834" + sid;
    var race = programData[sid][rn];
    var closedAt = race ? race.race_closed_at || "" : "";
    var closedTime = closedAt ? closedAt.split(" ")[1] || "" : "";
    if (closedTime) closedTime = closedTime.slice(0, 5);
    var _watched = typeof _isRaceWatched === "function" ? _isRaceWatched(sid, rn) : false;
    var _starHtml = '<button id="raceStarBtn" aria-label="\u304A\u6C17\u306B\u5165\u308A\u5207\u66FF" style="margin-left:8px;background:transparent;border:0;font-size:18px;cursor:pointer;padding:0 4px" data-action="toggleRaceWatched" data-arg-sid="' + sid + '" data-arg-rn="' + rn + '">' + (_watched ? "\u2B50" : "\u2606") + "</button>";
    document.getElementById("detailTitle").innerHTML = name + " " + rn + "R" + (closedTime ? ' <span style="font-size:12px;color:var(--text-dim);font-weight:400">\u7DE0\u5207 ' + closedTime + "</span>" : "") + _starHtml;
    document.getElementById("detailBack").onclick = function() {
      openStadium(sid);
    };
    if (typeof _showDetailTab === "function") _showDetailTab("lineup");
    var preview = previewData && previewData[sid] && previewData[sid][rn] ? previewData[sid][rn] : null;
    var result = resultData && resultData[sid] && resultData[sid][rn] ? resultData[sid][rn] : null;
    var pred = predictRace(sid, parseInt(rn));
    if (result && result.isFinished) {
      try {
        var _h = safeParse("boatrace_history", []);
        for (var _hi = 0; _hi < _h.length; _hi++) {
          var _e = _h[_hi];
          if (_e.date === todayStr() && _e.stadium === sid && _e.race === rn && _e.pred_snapshot) {
            var _liveMarkByBoat = {};
            (pred && pred.marks ? pred.marks : []).forEach(function(_m) {
              if (_m && _m.boat) _liveMarkByBoat[_m.boat] = _m.mark;
            });
            var _snapMarks = (_e.pred_snapshot.marks || pred.marks || []).map(function(_m) {
              return Object.assign({}, _m, { mark: _m.mark || _liveMarkByBoat[_m.boat] || "" });
            });
            pred = {
              marks: _snapMarks,
              trifecta: _e.pred_snapshot.trifecta || pred.trifecta,
              exacta: _e.pred_snapshot.exacta || pred.exacta,
              raceType: _e.pred_snapshot.raceType || pred.raceType,
              typeCls: _e.pred_snapshot.typeCls || pred.typeCls,
              typeLabel: _e.pred_snapshot.typeLabel || pred.typeLabel,
              confidence: _e.pred_snapshot.confidence != null ? _e.pred_snapshot.confidence : pred.confidence,
              confStars: _e.pred_snapshot.confStars != null ? _e.pred_snapshot.confStars : pred.confStars,
              scenarios: _e.pred_snapshot.scenarios || pred.scenarios
            };
            break;
          }
        }
      } catch (_) {
      }
    }
    var raceOdds = getOddsForRace(sid, rn);
    var popularity = calcPopularity(raceOdds);
    var rdForRace = getRaceDataForRace(sid, rn);
    document.getElementById("oddsRefreshBtn").style.display = "inline-block";
    updateOddsUI();
    var weatherHtml = "";
    if (preview) {
      var w = preview.weather || preview;
      var windDir = WIND_DIR[w.wind_direction || w.race_wind_direction_number] || "---";
      var ws = w.wind_speed || w.race_wind || 0;
      var wh = w.wave_height || w.race_wave || 0;
      var temp = w.temperature || w.race_temperature || "--";
      var wtemp = w.water_temperature || w.race_water_temperature || "--";
      weatherHtml = '<div class="weather-bar"><span class="weather-item">\u98A8: ' + windDir + " " + ws + 'm</span><span class="weather-item">\u6CE2: ' + wh + 'cm</span><span class="weather-item">\u6C17\u6E29: ' + temp + '\u2103</span><span class="weather-item">\u6C34\u6E29: ' + wtemp + "\u2103</span></div>";
    }
    if (oddsData && oddsData.updated_at) {
      var _ot = Date.parse(oddsData.updated_at);
      if (!isNaN(_ot)) {
        var _osm = Math.round((Date.now() - _ot) / 6e4);
        if (_osm >= 30) {
          var _hh = _osm >= 60 ? Math.floor(_osm / 60) + "\u6642\u9593" + _osm % 60 + "\u5206" : _osm + "\u5206";
          weatherHtml = '<div style="background:#FFEBEE;border:2px solid #D32F2F;border-radius:8px;padding:10px;margin:8px 0;color:#D32F2F;font-weight:700;font-size:13px;text-align:center">\u26A0 \u30AA\u30C3\u30BA\u304C ' + _hh + '\u524D\u306E\u30B9\u30CA\u30C3\u30D7\u30B7\u30E7\u30C3\u30C8\u3067\u3059<br><span style="font-size:11px;font-weight:400">\u30EC\u30FC\u30B9\u76F4\u524D\u306E\u5E02\u5834\u3068\u4E56\u96E2\u3057\u3066\u3044\u308B\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059</span></div>' + weatherHtml;
        }
      }
    }
    document.getElementById("detailWeather").innerHTML = weatherHtml;
    var resHtml = "";
    if (result && result.isFinished && result.results && result.results.length > 0) {
      var _rawPlaces = Array.isArray(result.results) ? result.results : [];
      var places = _rawPlaces.filter(function(p) {
        return p && Number.isFinite(p.place) && p.racer_boat_number;
      }).sort(function(a, b) {
        return a.place - b.place;
      });
      resHtml = '<div class="result-box"><div class="result-title">\u30EC\u30FC\u30B9\u7D50\u679C</div>';
      resHtml += '<div class="result-places">';
      places.slice(0, 3).forEach(function(p) {
        resHtml += p.place + "\u7740" + boatBadge(p.racer_boat_number) + " ";
      });
      resHtml += "</div>";
      if (result.technique_number)
        resHtml += '<div style="font-size:11px;margin-bottom:6px">\u6C7A\u307E\u308A\u624B: <b>' + (TECHNIQUE[result.technique_number] || "---") + "</b></div>";
      if (result.refund) {
        ["trifecta", "trio", "exacta"].forEach(function(type) {
          var label = type === "trifecta" ? "3\u9023\u5358" : type === "trio" ? "3\u9023\u8907" : "2\u9023\u5358";
          if (result.refund[type]) {
            result.refund[type].forEach(function(r) {
              resHtml += '<div class="refund-row"><span class="refund-label">' + label + " " + r.combination + '</span><span class="refund-val">\\' + (r.amount || r.payout || 0).toLocaleString() + "</span></div>";
            });
          }
        });
      }
      if (pred && places.length >= 3) {
        var actualCombo = places[0].racer_boat_number + "-" + places[1].racer_boat_number + "-" + places[2].racer_boat_number;
        var hit = pred.trifecta.some(function(t) {
          return t.combo === actualCombo;
        });
        resHtml += '<div style="margin-top:8px;font-size:14px;font-weight:700;text-align:center" class="' + (hit ? "hit" : "miss") + '">' + (hit ? "3\u9023\u5358 \u7684\u4E2D!" : "\u4E0D\u7684\u4E2D") + "</div>";
      } else if (pred && places.length < 3) {
        resHtml += '<div style="margin-top:8px;font-size:11px;color:var(--text-dim);text-align:center">\u7D50\u679C\u30C7\u30FC\u30BF\u53D6\u5F97\u4E2D (\u7740\u9806 ' + places.length + "/3 \u4EF6)</div>";
      }
      resHtml += "</div>";
    }
    document.getElementById("detailResult").innerHTML = resHtml;
    var _ctxBoats = {
      race,
      preview,
      pred,
      rdForRace
    };
    _renderRaceDetailBoats(_ctxBoats);
    var boatMap = _ctxBoats.boatMap;
    var pvMap = _ctxBoats.pvMap;
    var etRankMap = _ctxBoats.etRankMap;
    var stRankMap = _ctxBoats.stRankMap;
    var _oeRace = ((globalThis._origExhibIndex || {})[sid] || {})[rn] || null;
    var _hasOe = false;
    if (_oeRace) {
      for (var _ob in _oeRace) {
        var _oeb = _oeRace[_ob];
        if (_oeb && ((_oeb.lap_time || 0) > 0 || (_oeb.turn_time || 0) > 0 || (_oeb.straight_time || 0) > 0)) {
          _hasOe = true;
          break;
        }
      }
    }
    function _oeRankMap(field) {
      var arr = [];
      for (var b = 1; b <= 6; b++) {
        var v = _oeRace && _oeRace[b] && _oeRace[b][field] || 0;
        if (v > 0) arr.push([b, v]);
      }
      arr.sort(function(a, c) {
        return a[1] - c[1];
      });
      var m = {};
      for (var i = 0; i < arr.length; i++) m[arr[i][0]] = i;
      return m;
    }
    var _lapRk = _hasOe ? _oeRankMap("lap_time") : {};
    var _turnRk = _hasOe ? _oeRankMap("turn_time") : {};
    var _strRk = _hasOe ? _oeRankMap("straight_time") : {};
    function _oeCls(rk) {
      return rk === 0 ? "hl-rank1" : rk === 1 ? "hl-rank2" : rk === 2 ? "hl-rank3" : "";
    }
    var exhHtml = "";
    if (preview && preview.boats) {
      exhHtml = '<div class="section-title">\u5C55\u793A\u60C5\u5831</div>';
      exhHtml += '<div class="detail-table-wrap"><table class="exhibition-table">';
      exhHtml += "<thead><tr><th>\u67A0</th><th>ST</th><th>\u5C55\u793A</th><th>\u30C1\u30EB\u30C8</th>" + (_hasOe ? "<th>\u4E00\u5468</th><th>\u307E\u308F\u308A\u8DB3</th><th>\u76F4\u7DDA</th>" : "") + "<th>\u6574\u5099</th><th>\u8ABF\u6574</th></tr></thead><tbody>";
      for (var bn = 1; bn <= 6; bn++) {
        var pv = pvMap[bn];
        var _oebST = _oeRace && _oeRace[bn] || {};
        var stVal = pv && pv.racer_start_timing != null ? pv.racer_start_timing : _oebST.st_time != null ? _oebST.st_time : null;
        var etVal = pv && pv.racer_exhibition_time != null && pv.racer_exhibition_time > 0 ? pv.racer_exhibition_time : (_oebST.ex_time || 0) > 0 ? _oebST.ex_time : null;
        var tiltVal = pv && pv.racer_tilt_adjustment != null ? pv.racer_tilt_adjustment : null;
        var propVal = pv && pv.racer_propeller ? pv.racer_propeller : "";
        var partsVal = pv && pv.racer_parts_replaced ? pv.racer_parts_replaced : "";
        var adjVal = pv && pv.racer_adjust_weight != null ? pv.racer_adjust_weight : 0;
        var etRk = etRankMap[bn];
        var etCls = etRk === 0 ? "hl-rank1" : etRk === 1 ? "hl-rank2" : etRk === 2 ? "hl-rank3" : "";
        var stRk = stRankMap[bn];
        var stCls = stRk === 0 ? "hl-rank1" : stRk === 1 ? "hl-rank2" : stRk === 2 ? "hl-rank3" : "";
        var stDisp = stVal !== null ? "." + String(Math.abs(pf(stVal) * 100).toFixed(0)).padStart(2, "0") : "---";
        if (stVal !== null && pf(stVal) < 0) stDisp = "F" + stDisp;
        var maintDisp = "";
        if (propVal)
          maintDisp += '<span style="background:#FFF3E0;color:#E65100;padding:1px 4px;border-radius:2px;font-size:9px">P' + escText(propVal) + "</span> ";
        if (partsVal)
          maintDisp += '<span style="background:#E3F2FD;color:#1565C0;padding:1px 4px;border-radius:2px;font-size:9px;font-weight:700">\u2699' + escText(partsVal) + "</span>";
        if (!maintDisp) maintDisp = '<span style="color:#CCC">-</span>';
        var adjDisp = adjVal > 0 ? '<span style="color:var(--warn);font-weight:700">+' + adjVal.toFixed(1) + "</span>" : '<span style="color:#CCC">-</span>';
        exhHtml += "<tr>";
        exhHtml += '<td style="background:' + BOAT_COLORS[bn] + ";color:" + BOAT_TEXT[bn] + ";font-weight:700;border:1px solid " + (bn === 1 ? "#ccc" : "transparent") + '">' + bn + "</td>";
        exhHtml += '<td class="' + stCls + '">' + stDisp + "</td>";
        exhHtml += '<td class="' + etCls + '">' + (etVal !== null ? etVal : "---") + "</td>";
        exhHtml += "<td>" + (tiltVal !== null ? tiltVal : "---") + "</td>";
        if (_hasOe) {
          var _oeb2 = _oeRace[bn] || {};
          var _lap = (_oeb2.lap_time || 0) > 0 ? _oeb2.lap_time.toFixed(2) : "---";
          var _turn = (_oeb2.turn_time || 0) > 0 ? _oeb2.turn_time.toFixed(2) : "---";
          var _str = (_oeb2.straight_time || 0) > 0 ? _oeb2.straight_time.toFixed(2) : "---";
          exhHtml += '<td class="' + _oeCls(_lapRk[bn]) + '">' + _lap + '</td><td class="' + _oeCls(_turnRk[bn]) + '">' + _turn + '</td><td class="' + _oeCls(_strRk[bn]) + '">' + _str + "</td>";
        }
        exhHtml += '<td class="fs-9">' + maintDisp + "</td>";
        exhHtml += "<td>" + adjDisp + "</td>";
        exhHtml += "</tr>";
      }
      exhHtml += "</tbody></table></div>";
      if (_hasOe) {
        exhHtml += '<div style="font-size:9px;color:var(--text-dim);margin-top:4px">\u4E00\u5468\u30FB\u307E\u308F\u308A\u8DB3\u30FB\u76F4\u7DDA\u306F\u5F53\u8A72\u5834\u30AA\u30D5\u30A3\u30B7\u30E3\u30EB\u30B5\u30A4\u30C8\u306E\u30AA\u30EA\u30B8\u30CA\u30EB\u5C55\u793A\uFF08\u5B9F\u6E2C\uFF09</div>';
      } else {
        exhHtml += '<div style="font-size:9px;color:var(--text-dim);margin-top:4px">\u203B \u3053\u306E\u5834\u306F\u4E00\u5468\u30FB\u307E\u308F\u308A\u8DB3\u30FB\u76F4\u7DDA\u306E\u30AA\u30EA\u30B8\u30CA\u30EB\u5C55\u793A\u306B\u672A\u5BFE\u5FDC\uFF08boatrace.jp \u516C\u5F0F\u306B\u306F\u975E\u63B2\u8F09\uFF09</div>';
      }
      if (preview.boats) {
        var courseEntries = [];
        var hasCourse = false;
        for (var ci = 1; ci <= 6; ci++) {
          var cpv = preview.boats[String(ci)];
          var cn = cpv && cpv.racer_course_number != null ? cpv.racer_course_number : ci;
          if (cpv && cpv.racer_course_number != null) hasCourse = true;
          courseEntries.push({ boat: ci, course: cn });
        }
        if (hasCourse) {
          courseEntries.sort(function(a, b) {
            return a.course - b.course;
          });
          exhHtml += '<div style="margin:8px 0;text-align:center;font-size:11px;font-weight:700;color:var(--text-sub)">\u9032\u5165\u30B3\u30FC\u30B9</div>';
          exhHtml += '<div class="course-grid">';
          courseEntries.forEach(function(e) {
            exhHtml += '<div class="course-entry" style="background:' + BOAT_COLORS[e.boat] + ";color:" + BOAT_TEXT[e.boat] + ";border:1px solid " + (e.boat === 1 ? "#ccc" : "transparent") + '">' + e.boat + "</div>";
          });
          exhHtml += "</div>";
        }
      }
    }
    document.getElementById("detailExhibition").innerHTML = exhHtml;
    _renderRaceDetailPrediction({
      sid,
      rn,
      race,
      pred,
      preview,
      result,
      popularity,
      raceOdds
    });
    document.getElementById("detailOdds").innerHTML = renderOddsSection(sid, rn, raceOdds, pred, race);
    showPage("detail");
    try {
      _kickOffLiveOddsRefresh(sid, rn);
    } catch (_) {
    }
  }
  globalThis.openRace = openRace;
})();

/* BUILD:REPORTING_RACE_DETAIL:END */

/* BUILD:REPORTING_RACE_DETAIL_BOATS:START */
"use strict";
(() => {
  // ../src/reporting/race_detail_boats.js
  function _renderRaceDetailBoats(ctx) {
    var race = ctx.race;
    var preview = ctx.preview;
    var pred = ctx.pred;
    var rdForRace = ctx.rdForRace;
    var boatsHtml = "";
    if (race && race.boats && Array.isArray(race.boats)) {
      var boatMap = {};
      race.boats.forEach(function(bt2) {
        if (bt2 && bt2.racer_boat_number) boatMap[bt2.racer_boat_number] = bt2;
      });
      var pvMap = {};
      if (preview && preview.boats) {
        for (var pi = 1; pi <= 6; pi++) {
          if (preview.boats[String(pi)]) pvMap[pi] = preview.boats[String(pi)];
        }
      }
      var etTimes = [], stTimes = [];
      for (var ri = 1; ri <= 6; ri++) {
        var pvi = pvMap[ri];
        etTimes.push({
          boat: ri,
          val: pvi && pvi.racer_exhibition_time != null && pvi.racer_exhibition_time > 0 ? pf(pvi.racer_exhibition_time) : 999
        });
        var _stv = pvi && pvi.racer_start_timing != null ? pf(pvi.racer_start_timing) : 999;
        if (_stv < 0) _stv = 999;
        stTimes.push({ boat: ri, val: _stv });
      }
      etTimes.sort(function(a, b) {
        return a.val - b.val;
      });
      stTimes.sort(function(a, b) {
        return a.val - b.val;
      });
      var etRankMap = {}, stRankMap = {};
      etTimes.forEach(function(e, i2) {
        etRankMap[e.boat] = i2;
      });
      stTimes.forEach(function(e, i2) {
        stRankMap[e.boat] = i2;
      });
      boatsHtml = '<div class="section-title">\u51FA\u8D70\u8868</div>';
      boatsHtml += '<div class="detail-table-wrap"><table class="detail-table">';
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        boatsHtml += '<td class="boat-col-header" style="background:' + BOAT_COLORS[bn] + ";color:" + BOAT_TEXT[bn] + ";border:1px solid " + (bn === 1 ? "#ccc" : "transparent") + '">' + bn + "\u53F7\u8247</td>";
      }
      boatsHtml += "<th>\u67A0</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var cn = bt.racer_class_number || 4;
        boatsHtml += '<td><span style="background:' + CLASS_COLOR[cn] + ';color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700">' + CLASS_NAME[cn] + "</span></td>";
      }
      boatsHtml += "<th>\u7D1A</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var rid = bt.racer_number || 0;
        boatsHtml += "<td><b>" + rid + '</b> <span class="fs-9 c-dim">-\u671F</span></td>';
      }
      boatsHtml += "<th>\u767B\u756A</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var nameColor = bn === 1 ? "var(--text)" : BOAT_COLORS[bn];
        if (bn === 5) nameColor = "#B8860B";
        var m = pred ? pred.marks.find(function(x) {
          return x.boat === bn;
        }) : null;
        var markStr = m ? ' <span style="font-size:10px;color:var(--accent)">' + m.mark + "</span>" : "";
        var rid = bt.racer_number || 0;
        var photoHtml = rid ? '<img class="racer-photo" src="data/photos/' + rid + `.jpg" loading="lazy" alt="" onerror="this.dataset.broken='1'">` : "";
        boatsHtml += "<td>" + photoHtml + '<span style="font-weight:700;font-size:13px;color:' + nameColor + '">' + escText(bt.racer_name || "") + "</span>" + markStr + "</td>";
      }
      boatsHtml += "<th>\u9078\u624B</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var age = bt.racer_age || "-";
        var branch = bt.racer_branch_name || "-";
        var weight = bt.racer_weight || "-";
        boatsHtml += '<td style="font-size:10px">' + age + "\u6B73/" + escText(branch) + "<br>" + weight + "kg</td>";
      }
      boatsHtml += "<th>\u5E74\u9F62\u7B49</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var form = getRacerForm(bt.racer_number || 0);
        var div = pred && pred.divergence ? pred.divergence[bn] : null;
        var badges = racerBadges(bt, form, div);
        boatsHtml += "<td>" + (badges || "-") + "</td>";
      }
      boatsHtml += "<th>\u7279\u5FB4</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var mr = pf(bt.racer_assigned_motor_top_2_percent);
        var me = motorEvalGrade(mr);
        boatsHtml += '<td><span class="' + me.cls + '">' + me.grade + '</span> <span style="font-size:9px;color:var(--text-sub)">' + me.label + "</span></td>";
      }
      boatsHtml += "<th>\u30E2\u30FC\u30BF\u30FC</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var wr = pf(bt.racer_national_top_1_percent);
        var t2 = pf(bt.racer_national_top_2_percent);
        var hlCls = wr >= 6 ? "hl-pink" : "";
        boatsHtml += '<td class="' + hlCls + '"><b>' + wr.toFixed(2) + '</b><br><span class="fs-9">2\u9023:' + t2.toFixed(1) + "%</span></td>";
      }
      boatsHtml += "<th>\u5168\u56FD\u52DD\u7387</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var lwr = pf(bt.racer_local_top_1_percent);
        var lt2 = pf(bt.racer_local_top_2_percent);
        var hlCls = lwr >= 6 ? "hl-pink" : "";
        boatsHtml += '<td class="' + hlCls + '"><b>' + lwr.toFixed(2) + '</b><br><span class="fs-9">2\u9023:' + lt2.toFixed(1) + "%</span></td>";
      }
      boatsHtml += "<th>\u5F53\u5730\u52DD\u7387</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var avgSt = pf(bt.racer_average_start_timing);
        boatsHtml += "<td>" + (bt.racer_average_start_timing != null ? avgSt.toFixed(2) : "---") + "</td>";
      }
      boatsHtml += "<th>\u5E73\u5747ST</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var mNum = bt.racer_assigned_motor_number || "-";
        var mr2 = pf(bt.racer_assigned_motor_top_2_percent);
        var hlCls = mr2 >= 40 ? "hl-pink" : "";
        boatsHtml += '<td class="' + hlCls + '"><b>' + mNum + '</b><br><span class="fs-9">' + mr2.toFixed(1) + "%</span></td>";
      }
      boatsHtml += "<th>\u30E2\u30FC\u30BF\u30FC</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var bNum = bt.racer_assigned_boat_number || "-";
        var br2 = pf(bt.racer_assigned_boat_top_2_percent);
        var hlCls = br2 >= 40 ? "hl-pink" : "";
        boatsHtml += '<td class="' + hlCls + '"><b>' + bNum + '</b><br><span class="fs-9">' + br2.toFixed(1) + "%</span></td>";
      }
      boatsHtml += "<th>\u30DC\u30FC\u30C8</th></tr>";
      boatsHtml += "<tr>";
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          boatsHtml += "<td>-</td>";
          continue;
        }
        var fc = bt.racer_flying_count || 0;
        var lc = bt.racer_late_start_count_in_current_term || 0;
        var flStr = "F" + fc + "/L" + lc;
        if (fc > 0) flStr = '<span style="color:var(--danger);font-weight:700">F' + fc + "</span>/L" + lc;
        boatsHtml += "<td>" + flStr + "</td>";
      }
      boatsHtml += "<th>F/L</th></tr>";
      if (rdForRace && rdForRace.boats) {
        var boatsSeries = [];
        var maxNonNull = 0;
        for (var bn = 1; bn <= 6; bn++) {
          var bt = boatMap[bn];
          var rid = bt ? bt.racer_number || 0 : 0;
          var rdBoat = rdForRace.boats ? rdForRace.boats.find(function(rb) {
            return rb.boat_number === bn || rb.racer_number === rid;
          }) : null;
          var arr = rdBoat ? rdBoat.current_series_results || [] : [];
          boatsSeries.push(arr);
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] != null && i + 1 > maxNonNull) maxNonNull = i + 1;
          }
        }
        if (maxNonNull > 0) {
          var pairs = Math.ceil(maxNonNull / 2);
          var DAY_LABELS = ["\u521D\u65E5", "2\u65E5\u76EE", "3\u65E5\u76EE", "4\u65E5\u76EE", "5\u65E5\u76EE", "\u6E96\u512A", "\u6700\u7D42"];
          for (var p = 0; p < pairs; p++) {
            for (var slot = 0; slot < 2; slot++) {
              var idx = p * 2 + slot;
              if (idx >= maxNonNull) break;
              boatsHtml += "<tr>";
              for (var bi = 0; bi < 6; bi++) {
                boatsHtml += renderSeriesCell(boatsSeries[bi][idx]);
              }
              if (slot === 0) {
                var rs = idx + 1 < maxNonNull ? 2 : 1;
                boatsHtml += '<th rowspan="' + rs + '" class="series-day-th">' + (DAY_LABELS[p] || p + 1 + "\u65E5\u76EE") + "</th>";
              }
              boatsHtml += "</tr>";
            }
          }
        }
      }
      boatsHtml += "</table></div>";
    }
    document.getElementById("detailBoats").innerHTML = boatsHtml;
    ctx.boatMap = boatMap;
    ctx.pvMap = pvMap;
    ctx.etRankMap = etRankMap;
    ctx.stRankMap = stRankMap;
  }
  globalThis._renderRaceDetailBoats = _renderRaceDetailBoats;
})();

/* BUILD:REPORTING_RACE_DETAIL_BOATS:END */

/* BUILD:REPORTING_RACE_DETAIL_PREDICTION:START */
"use strict";
(() => {
  // ../src/reporting/race_detail_prediction.js
  function _renderRaceDetailPrediction(ctx) {
    var sid = ctx.sid, rn = ctx.rn, race = ctx.race, pred = ctx.pred;
    var preview = ctx.preview, result = ctx.result, popularity = ctx.popularity, raceOdds = ctx.raceOdds;
    var predHtml = "";
    var progPred = predictRaceProgram(sid, parseInt(rn));
    var boats = race && race.boats ? race.boats : [];
    if (progPred) {
      predHtml += '<div style="background:#F0F4FF;border:1px solid #C5CAE9;border-radius:10px;padding:12px;margin:8px 0">';
      predHtml += '<div style="font-weight:700;font-size:14px;color:#1A237E;margin-bottom:8px">\u756A\u7D44\u4E88\u60F3 <span style="font-size:11px;color:#666;font-weight:400">\u51FA\u8D70\u8868\u30C7\u30FC\u30BF\u306E\u307F</span></div>';
      progPred.marks.forEach(function(m, i) {
        if (i >= 4) return;
        var boatInfo = boats.find(function(b) {
          return b.racer_boat_number === m.boat;
        });
        var nm = boatInfo ? (boatInfo.racer_name || "").split(/\s|\u3000/)[0] : "";
        var probPct = Math.round(m.prob * 100);
        predHtml += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px">';
        predHtml += '<span style="font-weight:700;width:20px">' + m.mark + "</span>";
        predHtml += boatBadge(m.boat);
        predHtml += "<span>" + escText(nm) + "</span>";
        predHtml += '<span style="font-family:monospace;color:#1A237E;font-weight:700;margin-left:auto">' + probPct + "%</span>";
        predHtml += "</div>";
      });
      var progTypeIcon = progPred.raceType === "honmei" ? "\u26A1" : progPred.raceType === "ana" ? "\u{1F525}" : "\u{1F4CA}";
      predHtml += '<div class="note-orange">' + progTypeIcon + progPred.typeLabel + "  \u4FE1\u983C\u5EA6: " + progPred.confidence + "%</div>";
      if (progPred.marks[0].reasons && progPred.marks[0].reasons.length > 0) {
        predHtml += '<div style="font-size:11px;color:#555;margin-top:6px;padding:6px;background:#E8EAF6;border-radius:6px">';
        progPred.marks[0].reasons.slice(0, 3).forEach(function(r) {
          predHtml += "<div>\u30FB" + escText(r) + "</div>";
        });
        predHtml += "</div>";
      }
      predHtml += "</div>";
    }
    var hasRealPreview = false;
    if (preview && preview.boats) {
      for (var pk in preview.boats) {
        if (preview.boats[pk] && (preview.boats[pk].racer_exhibition_time || 0) > 0) {
          hasRealPreview = true;
          break;
        }
      }
    }
    predHtml += '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:12px;margin:8px 0">';
    predHtml += '<div style="font-weight:700;font-size:14px;color:#E65100;margin-bottom:8px">\u76F4\u524D\u4E88\u60F3 <span style="font-size:11px;color:#666;font-weight:400">\u5C55\u793A\u822A\u8D70\u53CD\u6620</span></div>';
    if (hasRealPreview && pred) {
      var diff = comparePredictions(progPred, pred);
      pred.marks.forEach(function(m, i) {
        if (i >= 4) return;
        var boatInfo = boats.find(function(b) {
          return b.racer_boat_number === m.boat;
        });
        var nm = boatInfo ? (boatInfo.racer_name || "").split(/\s|\u3000/)[0] : "";
        var probPct = Math.round(m.prob * 100);
        var change = diff ? diff.changes.find(function(c) {
          return c.boat === m.boat;
        }) : null;
        var diffStr = "";
        if (change && change.rankDiff !== 0) {
          var p = Math.round(change.probDiff * 100);
          var pSign = p > 0 ? "+" : p < 0 ? "" : "";
          var arrow = change.rankDiff > 0 ? "\u2191" : "\u2193";
          var color = change.rankDiff > 0 ? "#43A047" : "#E53935";
          diffStr = ' <span style="color:' + color + ';font-size:11px;font-weight:700">' + arrow + pSign + p + "%</span>";
        }
        predHtml += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px">';
        predHtml += '<span style="font-weight:700;width:20px">' + m.mark + "</span>";
        predHtml += boatBadge(m.boat);
        predHtml += "<span>" + escText(nm) + "</span>";
        predHtml += '<span style="font-family:monospace;color:#E65100;font-weight:700;margin-left:auto">' + probPct + "%</span>";
        predHtml += diffStr;
        predHtml += "</div>";
      });
      var liveTypeIcon = pred.raceType === "honmei" ? "\u26A1" : pred.raceType === "ana" ? "\u{1F525}" : "\u{1F4CA}";
      predHtml += '<div class="note-orange">' + liveTypeIcon + pred.typeLabel + "  \u4FE1\u983C\u5EA6: " + starsHtml(pred.confStars) + " " + pred.confidence + "%</div>";
      if (pred.scenarios) {
        var scen = pred.scenarios;
        var scenLabels = { nige: "\u9003\u3052", sashi: "\u5DEE\u3057", makuri: "\u307E\u304F\u308A", makuriSashi: "\u307E\u304F\u308A\u5DEE\u3057", other: "\u7A74" };
        var scenStr = "";
        Object.keys(scen).forEach(function(k) {
          if (scen[k] >= 0.05) {
            var pct = (scen[k] * 100).toFixed(0);
            scenStr += '<span style="margin-right:8px"><b>' + scenLabels[k] + "</b> " + pct + "%</span>";
          }
        });
        predHtml += '<div style="font-size:10px;color:#666;margin-top:4px;padding:4px 6px;background:#F5F5F5;border-radius:4px">\u60F3\u5B9A\u5C55\u958B: ' + scenStr + "</div>";
      }
      if (diff) {
        var hasChange = diff.changes.some(function(c) {
          return c.rankDiff !== 0;
        });
        if (hasChange) {
          predHtml += '<div style="font-size:11px;margin-top:8px;padding:6px;background:#FFF3E0;border-radius:6px">';
          predHtml += '<div style="font-weight:700;color:#E65100;margin-bottom:4px">\u5C55\u793A\u306B\u3088\u308B\u5909\u52D5</div>';
          diff.changes.forEach(function(c) {
            if (c.rankDiff > 0) {
              var reasons = c.addedReasons.length > 0 ? c.addedReasons.slice(0, 2).join(", ") : "\u5C55\u793A\u597D\u8ABF";
              predHtml += '<div style="color:#2E7D32">\u2191 ' + c.boat + "\u53F7\u8247: " + escText(reasons) + "</div>";
            } else if (c.rankDiff < 0) {
              var risks = c.addedRisks.length > 0 ? c.addedRisks.slice(0, 2).join(", ") : "\u5C55\u793A\u4E0D\u8ABF";
              predHtml += '<div style="color:#C62828">\u2193 ' + c.boat + "\u53F7\u8247: " + escText(risks) + "</div>";
            }
          });
          if (diff.typeChanged) {
            predHtml += '<div style="color:#D84315;font-weight:700;margin-top:4px">\u26A0 ' + diff.progType + " \u2192 " + diff.liveType + " \u306B\u5909\u5316</div>";
          }
          predHtml += "</div>";
        }
      }
      if (popularity && pred.marks.length > 0) {
        var aiTop = pred.marks[0].boat;
        var popTop = popularity[0] ? popularity[0].boat : 0;
        if (aiTop !== popTop && popTop > 0) {
          predHtml += '<div style="font-size:11px;color:var(--warn);margin:6px 0;padding:6px;background:#FFF8E1;border:1px solid #FFE0B2;border-radius:6px">AI\u4E88\u60F3\u25CE' + aiTop + "\u53F7\u8247 vs 1\u756A\u4EBA\u6C17" + popTop + "\u53F7\u8247 -- \u9006\u5F35\u308A\u6CE8\u76EE</div>";
        }
      }
    } else {
      var _finished = !!(result && result.isFinished);
      predHtml += '<div style="text-align:center;padding:16px;color:#666;background:#FAFAFA;border:1px dashed #DDD;border-radius:8px">';
      if (_finished) {
        predHtml += '<div style="font-size:20px;margin-bottom:6px">\u{1F4CB}</div>';
        predHtml += '<div style="font-size:13px;font-weight:700;color:#C62828">\u5C55\u793A\u30C7\u30FC\u30BF\u672A\u53D6\u5F97\u306E\u30EC\u30FC\u30B9\u3067\u3059</div>';
        predHtml += '<div style="font-size:11px;color:#888;margin-top:4px">\u5C55\u793A\u7A93\u6642\u523B\u306B\u30B9\u30AF\u30EC\u30A4\u30D7\u304C\u5C4A\u304B\u305A\u3001\u76F4\u524D\u4E88\u60F3\u306F\u751F\u6210\u3055\u308C\u307E\u305B\u3093\u3067\u3057\u305F<br>\u4E0A\u306E<b>\u756A\u7D44\u4E88\u60F3</b>\u3068<b>\u30EC\u30FC\u30B9\u7D50\u679C</b>\u3092\u3054\u78BA\u8A8D\u304F\u3060\u3055\u3044</div>';
      } else {
        predHtml += '<div style="font-size:20px;margin-bottom:6px">\u23F3</div>';
        predHtml += '<div style="font-size:13px;font-weight:700">\u5C55\u793A\u822A\u8D70\u306E\u53CD\u6620\u5F85\u3061</div>';
        predHtml += '<div style="font-size:11px;color:#888;margin-top:4px">\u30EC\u30FC\u30B9\u958B\u59CB\u7D04 15 \u5206\u524D\u306E\u5C55\u793A\u3067\u66F4\u65B0\u3055\u308C\u307E\u3059<br>\u305D\u308C\u307E\u3067\u306F\u4E0A\u306E<b>\u756A\u7D44\u4E88\u60F3</b>\u3092\u3054\u53C2\u7167\u304F\u3060\u3055\u3044</div>';
      }
      predHtml += "</div>";
    }
    predHtml += "</div>";
    predHtml += _renderRaceDetailBets({
      sid,
      rn,
      race,
      pred,
      progPred,
      hasRealPreview,
      raceOdds
    });
    if (typeof _renderPairwiseSummary === "function" && race && race.boats) {
      var pwHtml = _renderPairwiseSummary(race.boats);
      if (pwHtml) predHtml += pwHtml;
    }
    document.getElementById("detailPrediction").innerHTML = predHtml;
  }
  globalThis._renderRaceDetailPrediction = _renderRaceDetailPrediction;
})();

/* BUILD:REPORTING_RACE_DETAIL_PREDICTION:END */

/* BUILD:REPORTING_RACE_DETAIL_BETS:START */
"use strict";
(() => {
  // ../src/reporting/race_detail_bets.js
  function _renderRaceDetailBets(ctx) {
    var sid = ctx.sid, rn = ctx.rn, race = ctx.race;
    var pred = ctx.pred, progPred = ctx.progPred;
    var hasRealPreview = ctx.hasRealPreview, raceOdds = ctx.raceOdds;
    var predHtml = "";
    var activePred = hasRealPreview && pred ? pred : null;
    var activePredLabel = hasRealPreview ? "\u76F4\u524D\u4E88\u60F3" : "\u756A\u7D44\u4E88\u60F3";
    if (activePred || progPred) {
      predHtml += '<div style="background:var(--card-bg);border:2px solid var(--accent);border-radius:10px;padding:12px;margin:8px 0">';
      predHtml += '<div style="font-weight:700;font-size:14px;color:var(--accent);margin-bottom:8px">\u63A8\u5968\u8CB7\u3044\u76EE <span style="font-size:10px;color:var(--text-dim);font-weight:400">\u2605' + activePredLabel + "\u30D9\u30FC\u30B9</span></div>";
      if (activePred && activePred.trifecta) {
        predHtml += '<div class="bet-label">3\u9023\u5358\u63A8\u5968 <span class="bet-method">[' + escText(activePred.methodLabel || "") + ']</span></div><div class="bet-combos">';
        activePred.trifecta.forEach(function(t) {
          var liveOdds = raceOdds && raceOdds.trifecta ? raceOdds.trifecta[t.combo] : null;
          var odds3 = liveOdds != null ? liveOdds : t.odds != null ? t.odds : null;
          var ev3 = odds3 != null ? calcEV(t.prob, odds3) : t.ev != null ? t.ev : null;
          var evHtml = evBadge(ev3);
          var oddsStr = odds3 != null ? '<span class="odds-val"> ' + Number(odds3).toFixed(1) + "\u500D</span>" : "";
          var stakeStr = t.stakeYen ? '<span style="font-size:9px;color:var(--accent);font-weight:700;margin-left:4px">\xA5' + t.stakeYen.toLocaleString() + "</span>" : "";
          predHtml += '<span class="bet-chip">' + t.combo + ' <span class="fs-9 c-dim">' + (t.prob * 100).toFixed(1) + "%</span>" + oddsStr + evHtml + stakeStr + "</span>";
        });
        predHtml += "</div>";
        if (activePred.evApplied) {
          var totalStake = activePred.trifecta.reduce(function(a, t) {
            return a + (t.stakeYen || 0);
          }, 0);
          predHtml += '<div style="font-size:10px;color:var(--accent);margin-top:4px">EV \u30D9\u30FC\u30B9\u6295\u8CC7\u5408\u8A08: \xA5' + totalStake.toLocaleString() + "</div>";
        }
        if (!raceOdds)
          predHtml += '<div style="font-size:9px;color:var(--text-dim);margin-bottom:6px">\u30AA\u30C3\u30BA\u672A\u53D6\u5F97 -- \u78BA\u7387\u30D9\u30FC\u30B9\u306E\u63A8\u5B9A\u5024</div>';
        predHtml += '<div class="bet-label">2\u9023\u5358\u63A8\u5968</div><div class="bet-combos">';
        activePred.exacta.forEach(function(t) {
          predHtml += '<span class="bet-chip">' + t.combo + "</span>";
        });
        predHtml += "</div>";
      } else if (progPred) {
        var betCount3 = parseInt(settings.betCount3) || 10;
        var betCount2 = parseInt(settings.betCount2) || 5;
        var method = settings.betMethod || "auto";
        if (method === "auto") {
          if (progPred.raceType === "honmei") method = "prob";
          else if (progPred.raceType === "ana") method = "box";
          else method = "formation";
        }
        var progBets = generateBetsV2(progPred.marks, method, betCount3, betCount2);
        predHtml += '<div class="bet-label">3\u9023\u5358\u63A8\u5968</div><div class="bet-combos">';
        progBets.trifecta.forEach(function(t) {
          predHtml += '<span class="bet-chip">' + t.combo + ' <span class="fs-9 c-dim">' + (t.prob * 100).toFixed(1) + "%</span></span>";
        });
        predHtml += "</div>";
        predHtml += '<div class="bet-label">2\u9023\u5358\u63A8\u5968</div><div class="bet-combos">';
        progBets.exacta.forEach(function(t) {
          predHtml += '<span class="bet-chip">' + t.combo + "</span>";
        });
        predHtml += "</div>";
        predHtml += '<div style="font-size:10px;color:#FF9800;margin-top:6px">\u203B\u5C55\u793A\u822A\u8D70\u5F8C\u306B\u6700\u7D42\u7248\u306E\u8CB7\u3044\u76EE\u306B\u66F4\u65B0\u3055\u308C\u307E\u3059</div>';
      }
      var anaSrc = activePred || progPred;
      if (anaSrc && anaSrc.marks) {
        var anaTopN = parseInt(settings.betCountAna) || 3;
        if (anaTopN < 1) anaTopN = 1;
        else if (anaTopN > 6) anaTopN = 6;
        var hasAnaOdds = !!(raceOdds && raceOdds.trifecta && Object.keys(raceOdds.trifecta).length > 0);
        var _recommendedCombos = [];
        if (activePred && Array.isArray(activePred.trifecta)) {
          _recommendedCombos = activePred.trifecta.map(function(t) {
            return t.combo;
          });
        } else if (progPred && progPred.marks) {
          try {
            var _pm = typeof progBets !== "undefined" && progBets && progBets.trifecta ? progBets.trifecta : [];
            _recommendedCombos = _pm.map(function(t) {
              return t.combo;
            });
          } catch (_) {
            _recommendedCombos = [];
          }
        }
        var anaHtmlBlock = "";
        if (hasAnaOdds) {
          var anaRes = _pickAnaCandidates(anaSrc.marks, raceOdds.trifecta, {
            minOdds: 30,
            minEV: 1,
            minOddsLoose: 15,
            topN: anaTopN,
            excludeCombos: _recommendedCombos
            // B13
          });
          var picks = anaRes.primary.length > 0 ? anaRes.primary : anaRes.fallback;
          var isPrimary = anaRes.primary.length > 0;
          if (picks.length > 0) {
            var subTitle = isPrimary ? "\u30AA\u30C3\u30BA30\u500D+ \u304B\u3064 EV\u22651.0" : "\u9AD8 EV \u5019\u88DC\u306A\u3057 \u2014 \u9AD8\u30AA\u30C3\u30BA TOP" + picks.length + " \u3092\u53C2\u8003\u8868\u793A";
            anaHtmlBlock = '<div style="margin-top:12px;padding:8px;background:rgba(255,87,34,0.08);border-left:3px solid #FF5722;border-radius:6px">';
            anaHtmlBlock += '<div class="bet-label" style="color:#FF5722">\u{1F525} \u7A74\u4E88\u60F3 <span style="font-size:9px;color:var(--text-dim);font-weight:400">' + subTitle + "</span></div>";
            anaHtmlBlock += '<div class="bet-combos">';
            picks.forEach(function(p) {
              var evColor = p.ev >= 1 ? "#FF5722" : "#999";
              anaHtmlBlock += '<span class="bet-chip">' + p.combo + ' <span class="fs-9 c-dim">' + (p.prob * 100).toFixed(2) + '%</span><span class="odds-val"> ' + p.odds.toFixed(1) + '\u500D</span><span style="font-size:9px;color:' + evColor + ';font-weight:700;margin-left:4px">EV ' + p.ev.toFixed(2) + "</span></span>";
            });
            anaHtmlBlock += "</div></div>";
          }
        } else if (anaSrc.marks.length >= 3) {
          var dist = buildTrifectaProbDist(anaSrc.marks);
          var top1Boat = anaSrc.marks[0].boat;
          var _recoSet = {};
          _recommendedCombos.forEach(function(c) {
            if (c) _recoSet[String(c)] = true;
          });
          var anaCands = [];
          for (var k in dist) {
            if (!Object.prototype.hasOwnProperty.call(dist, k)) continue;
            if (k.split("-")[0] === String(top1Boat)) continue;
            if (_recoSet[k]) continue;
            anaCands.push({ combo: k, prob: dist[k] });
          }
          anaCands.sort(function(a, b) {
            return b.prob - a.prob;
          });
          anaCands = anaCands.slice(0, anaTopN);
          if (anaCands.length > 0) {
            anaHtmlBlock = '<div style="margin-top:12px;padding:8px;background:rgba(255,87,34,0.08);border-left:3px solid #FF5722;border-radius:6px">';
            anaHtmlBlock += '<div class="bet-label" style="color:#FF5722">\u{1F525} \u7A74\u4E88\u60F3 <span style="font-size:9px;color:var(--text-dim);font-weight:400">\u30AA\u30C3\u30BA\u672A\u53D6\u5F97 \u2014 AI \u7A74\u30B3\u30F3\u30D3\u5019\u88DC</span></div>';
            anaHtmlBlock += '<div class="bet-combos">';
            anaCands.forEach(function(p) {
              anaHtmlBlock += '<span class="bet-chip">' + p.combo + ' <span class="fs-9 c-dim">' + (p.prob * 100).toFixed(2) + "%</span></span>";
            });
            anaHtmlBlock += "</div>";
            anaHtmlBlock += '<div style="font-size:9px;color:var(--text-dim);margin-top:4px">\u203B\u30AA\u30C3\u30BA\u53D6\u5F97\u5F8C\u306B EV \u8A55\u4FA1\u3078\u81EA\u52D5\u66F4\u65B0</div>';
            anaHtmlBlock += "</div>";
          }
        }
        predHtml += anaHtmlBlock;
      }
      predHtml += "</div>";
    }
    return predHtml;
  }
  globalThis._renderRaceDetailBets = _renderRaceDetailBets;
})();

/* BUILD:REPORTING_RACE_DETAIL_BETS:END */

// ===============================================
// Macour-style Odds Section (3d trifecta + 3e exacta + 3f controls)
// ===============================================
function renderOddsSection(sid,rn,raceOdds,pred,race){
  if(!raceOdds) return'';
  var html='';

  // Build boat name map
  var boatNames={};
  if(race&&race.boats){
    // D8 (2026-05-17): D6 と同様の null guard
    race.boats.forEach(function(bt){
      if(bt && bt.racer_boat_number) boatNames[bt.racer_boat_number]=familyName(bt.racer_name);
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
  // FIX: JSON 内 updated_at からの経過 (=実スクレイプ経過) を表示。
  //   cron が止まると fetch 自体は成功しても表示オッズが何時間も古いため必須。
  var staleStr = '';
  var staleColor = 'var(--text-dim)';
  if(oddsData && oddsData.updated_at){
    var t = Date.parse(oddsData.updated_at);
    if(!isNaN(t)){
      var sm = Math.round((Date.now()-t)/60000);
      if(sm >= 60){
        staleStr = '⚠ オッズデータ '+Math.floor(sm/60)+'時間'+(sm%60)+'分前 — 古い可能性あり';
        staleColor = '#D32F2F';
      } else if(sm >= 30){
        staleStr = '⚠ オッズデータ '+sm+'分前 — 古い可能性あり';
        staleColor = '#D32F2F';
      } else {
        staleStr = 'オッズデータ '+sm+'分前更新';
      }
    }
  }
  html+='<div class="odds-section" style="text-align:center">';
  html+='<button class="odds-refresh-btn" data-action="refreshOdds">オッズ更新</button>';
  html+=' <span class="odds-stale" id="oddsStaleMsg2"></span>';
  if(staleStr){
    html+=' <span style="font-size:11px;color:'+staleColor+';font-weight:'+(staleColor==='#D32F2F'?'700':'400')+';display:block;margin-top:4px">'+staleStr+'</span>';
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
  // B14 (2026-05-17): 🔥穴予想 を独立追跡（ana_bets.length で R 別投資額算出）
  var ana={hits:0, invest:0, payout:0, races:0};
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
    // B14: 🔥穴予想 集計 (ana_bets が登録されている race のみカウント)
    if(Array.isArray(h.ana_bets) && h.ana_bets.length > 0){
      ana.races++;
      ana.invest += h.ana_bets.length * unitBet;
      if(h.ana_hit){
        ana.hits++;
        ana.payout += (h.ana_payout||0);
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
    today:today, total:verified.length, tri:tri, exa:exa, ana:ana,
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

/* BUILD:REPORTING_STATS_PAGE:START */
"use strict";
(() => {
  // ../src/reporting/stats_page.js
  function renderStats() {
    if (typeof _runLazyBackfillOnce === "function") _runLazyBackfillOnce("stats tab opened");
    if (!resultData || Array.isArray(resultData) && resultData.length === 0 || typeof resultData === "object" && Object.keys(resultData).length === 0) {
      var sumEl = document.getElementById("statSummary");
      var recEl = document.getElementById("statRecovery");
      var skel = '<div class="stat-card" style="background:linear-gradient(90deg,#eee 25%,#f5f5f5 50%,#eee 75%);background-size:200% 100%;animation:skel 1.2s ease-in-out infinite"><div class="stat-num">\u2026</div><div class="stat-label">\u8AAD\u8FBC\u4E2D</div></div>';
      if (sumEl && !sumEl.innerHTML.trim()) sumEl.innerHTML = skel + skel + skel;
      if (recEl && !recEl.innerHTML.trim()) {
        var rows = "";
        for (var i = 0; i < 3; i++)
          rows += '<tr><td class="bg-light">&nbsp;</td><td class="bg-light">&nbsp;</td><td class="bg-light">&nbsp;</td><td class="bg-light">&nbsp;</td><td class="bg-light">&nbsp;</td></tr>';
        recEl.innerHTML = '<table style="width:100%"><tbody>' + rows + "</tbody></table>";
      }
    }
    var s = calcTodayStats();
    var triRate3 = s.tri.invest > 0 ? Math.round(s.tri.payout / s.tri.invest * 100) : 0;
    var trifectaRate = s.total > 0 ? (s.tri.hits / s.total * 100).toFixed(1) : "0.0";
    document.getElementById("statSummary").innerHTML = '<div class="stat-card"><div class="stat-num" style="color:var(--accent)">' + s.total + '</div><div class="stat-label">\u672C\u65E5 \u5224\u5B9A\u6E08</div></div><div class="stat-card"><div class="stat-num" style="color:var(--gold)">' + s.tri.hits + '</div><div class="stat-label">3\u9023\u5358\u7684\u4E2D</div></div><div class="stat-card"><div class="stat-num" style="color:' + (triRate3 >= 100 ? "var(--success)" : "var(--danger)") + '">' + triRate3 + '%</div><div class="stat-label">3\u9023\u5358\u56DE\u53CE\u7387</div></div>';
    var recHtml = "";
    recHtml += '<div class="card" class="p-overflow-hidden">';
    recHtml += '<div class="card-header-row">\u672C\u65E5 \u5238\u7A2E\u5225</div>';
    recHtml += '<table class="recovery-table">';
    recHtml += "<thead><tr><th>\u5238\u7A2E</th><th>\u7684\u4E2D</th><th>\u6295\u8CC7</th><th>\u56DE\u53CE</th><th>\u56DE\u53CE\u7387</th></tr></thead><tbody>";
    var triR = s.tri.invest > 0 ? Math.round(s.tri.payout / s.tri.invest * 100) : 0;
    var exaR = s.exa.invest > 0 ? Math.round(s.exa.payout / s.exa.invest * 100) : 0;
    var triHitRate = s.total > 0 ? (s.tri.hits / s.total * 100).toFixed(0) : "-";
    var exaHitRate = s.total > 0 ? (s.exa.hits / s.total * 100).toFixed(0) : "-";
    recHtml += "<tr><td><b>3\u9023\u5358</b></td><td>" + s.tri.hits + " (" + triHitRate + "%)</td><td>\xA5" + s.tri.invest.toLocaleString() + "</td><td>\xA5" + s.tri.payout.toLocaleString() + '</td><td class="' + _rateColor(triR) + '">' + triR + "%</td></tr>";
    recHtml += "<tr><td><b>2\u9023\u5358</b></td><td>" + s.exa.hits + " (" + exaHitRate + "%)</td><td>\xA5" + s.exa.invest.toLocaleString() + "</td><td>\xA5" + s.exa.payout.toLocaleString() + '</td><td class="' + _rateColor(exaR) + '">' + exaR + "%</td></tr>";
    if (s.ana && s.ana.races > 0) {
      var anaR = s.ana.invest > 0 ? Math.round(s.ana.payout / s.ana.invest * 100) : 0;
      var anaHitRate = s.ana.races > 0 ? (s.ana.hits / s.ana.races * 100).toFixed(0) : "-";
      recHtml += '<tr><td><b style="color:#FF5722">\u{1F525}\u7A74\u4E88\u60F3</b><br><span style="font-size:9px;color:var(--text-dim)">\u5BFE\u8C61 ' + s.ana.races + "R</span></td><td>" + s.ana.hits + " (" + anaHitRate + "%)</td><td>\xA5" + s.ana.invest.toLocaleString() + "</td><td>\xA5" + s.ana.payout.toLocaleString() + '</td><td class="' + _rateColor(anaR) + '">' + anaR + "%</td></tr>";
    }
    var totInv = s.tri.invest + s.exa.invest;
    var totPay = s.tri.payout + s.exa.payout;
    var totRate = totInv > 0 ? Math.round(totPay / totInv * 100) : 0;
    var net = totPay - totInv;
    recHtml += '<tr style="background:#F8F8F8;font-weight:700"><td>\u5408\u8A08</td><td>' + (s.tri.hits + s.exa.hits) + "</td><td>\xA5" + totInv.toLocaleString() + "</td><td>\xA5" + totPay.toLocaleString() + '<br><span style="font-size:9px;color:' + (net >= 0 ? "var(--success)" : "var(--danger)") + '">(' + (net >= 0 ? "+" : "") + "\xA5" + net.toLocaleString() + ')</span></td><td class="' + _rateColor(totRate) + '">' + totRate + "%</td></tr>";
    recHtml += "</tbody></table></div>";
    recHtml += '<div class="card" class="p-overflow-hidden">';
    recHtml += '<div class="card-header-row">\u672C\u65E5 \u30EC\u30FC\u30B9\u30BF\u30A4\u30D7\u5225 (3\u9023\u5358)</div>';
    recHtml += '<table class="recovery-table">';
    recHtml += "<thead><tr><th>\u30BF\u30A4\u30D7</th><th>R\u6570</th><th>\u7684\u4E2D</th><th>\u7684\u4E2D\u7387</th><th>\u56DE\u53CE\u7387</th></tr></thead><tbody>";
    var typeLabels = { honmei: "\u26A1\u672C\u547D", middle: "\u{1F4CA}\u6DF7\u6226", ana: "\u{1F525}\u7A74" };
    ["honmei", "middle", "ana"].forEach(function(t) {
      var ts = s.typeStats[t];
      var hr = ts.total > 0 ? (ts.hit3 / ts.total * 100).toFixed(0) : "-";
      var rr = ts.invest > 0 ? Math.round(ts.payout3 / ts.invest * 100) : 0;
      recHtml += "<tr><td>" + typeLabels[t] + "</td><td>" + ts.total + "</td><td>" + ts.hit3 + "</td><td>" + hr + '%</td><td class="' + _rateColor(rr) + '">' + rr + "%</td></tr>";
    });
    recHtml += "</tbody></table></div>";
    var stadArr = [];
    for (var sid in s.stadiumStats) stadArr.push(s.stadiumStats[sid]);
    stadArr.forEach(function(ss) {
      ss.rate3 = ss.invest3 > 0 ? Math.round(ss.payout3 / ss.invest3 * 100) : 0;
      ss.rate2 = ss.invest2 > 0 ? Math.round(ss.payout2 / ss.invest2 * 100) : 0;
    });
    stadArr.sort(function(a, b) {
      return b.rate3 - a.rate3;
    });
    if (stadArr.length > 0) {
      recHtml += '<div class="card" class="p-overflow-hidden">';
      recHtml += '<div class="card-header-row">\u672C\u65E5 \u5834\u5225 (\u56DE\u53CE\u7387\u9806)</div>';
      recHtml += '<table class="recovery-table">';
      recHtml += "<thead><tr><th>\u5834</th><th>R\u6570</th><th>3\u9023\u7684\u4E2D</th><th>3\u9023\u6295\u8CC7</th><th>3\u9023\u56DE\u53CE</th><th>3\u9023\u7387</th></tr></thead><tbody>";
      stadArr.forEach(function(ss) {
        var hr = ss.total > 0 ? (ss.hit3 / ss.total * 100).toFixed(0) : "-";
        recHtml += "<tr><td><b>" + escText(ss.name) + "</b></td><td>" + ss.total + "</td><td>" + ss.hit3 + " (" + hr + "%)</td><td>\xA5" + ss.invest3.toLocaleString() + "</td><td>\xA5" + ss.payout3.toLocaleString() + '</td><td class="' + _rateColor(ss.rate3) + '">' + ss.rate3 + "%</td></tr>";
      });
      recHtml += "</tbody></table></div>";
    }
    var w = s.warnings;
    if (w.tri_zero.length > 0 || w.exa_zero.length > 0) {
      recHtml += '<div class="card" style="padding:12px;background:#FFF3E0;border-left:4px solid var(--warn)">';
      recHtml += '<div style="font-weight:700;color:#E65100;margin-bottom:6px">\u26A0 \u30C7\u30FC\u30BF\u6574\u5408\u6027\u306E\u8B66\u544A</div>';
      if (w.tri_zero.length > 0) {
        recHtml += '<div style="font-size:11px;margin-bottom:4px">3\u9023\u5358\u7684\u4E2D\u3060\u304C\u6255\u623B\u672A\u53D6\u5F97: <b>' + w.tri_zero.length + "\u4EF6</b></div>";
        recHtml += '<div style="font-size:10px;color:var(--text-sub)">' + escText(w.tri_zero.join(", ")) + "</div>";
      }
      if (w.exa_zero.length > 0) {
        recHtml += '<div style="font-size:11px;margin-top:6px;margin-bottom:4px">2\u9023\u5358\u7684\u4E2D\u3060\u304C\u6255\u623B\u672A\u53D6\u5F97: <b>' + w.exa_zero.length + "\u4EF6</b></div>";
        recHtml += '<div style="font-size:10px;color:var(--text-sub)">' + escText(w.exa_zero.join(", ")) + "</div>";
      }
      recHtml += '<div style="font-size:9px;color:var(--text-dim);margin-top:6px">\u203B \u8A72\u5F53\u30EC\u30FC\u30B9\u306E\u7D50\u679C\u30C7\u30FC\u30BF\u304C Open API / \u81EA\u524D\u30B9\u30AF\u30EC\u30A4\u30D1\u30FC\u306B\u307E\u3060\u53CD\u6620\u3055\u308C\u3066\u3044\u306A\u3044\u53EF\u80FD\u6027\u3002\u300C\u66F4\u65B0\u300D\u3092\u62BC\u3059\u3068\u518D\u53D6\u5F97\u30FB\u518D\u88DC\u5B8C\u3055\u308C\u307E\u3059\u3002</div>';
      recHtml += "</div>";
    }
    document.getElementById("statRecovery").innerHTML = recHtml;
    var sd = document.getElementById("statDetail");
    if (sd) sd.innerHTML = "";
    var sc = document.getElementById("statsChart");
    if (sc && sc.parentNode) {
      sc.parentNode.style.display = "none";
    }
  }
  function renderStatsChart() {
    var ctx = document.getElementById("chartAccuracy");
    if (!ctx) return;
    capabilities.refresh("chart");
    if (!capabilities.has("chart")) {
      _loadChartLib().then(renderStatsChart, function(err) {
        var parent = ctx.parentNode;
        if (parent)
          parent.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:11px">\u30B0\u30E9\u30D5\u63CF\u753B\u30E9\u30A4\u30D6\u30E9\u30EA\u306E\u8AAD\u8FBC\u306B\u5931\u6557\u3057\u307E\u3057\u305F</div>';
      });
      return;
    }
    if (statsChart) statsChart.destroy();
    var history = safeParse("boatrace_history", []);
    var byDate = {};
    history.forEach(function(h) {
      if (!h.actual) return;
      if (!byDate[h.date]) byDate[h.date] = { total: 0, hit: 0 };
      byDate[h.date].total++;
      if (h.trifecta_hit) byDate[h.date].hit++;
    });
    var dates = Object.keys(byDate).sort().slice(-14);
    var rates = dates.map(function(d) {
      return byDate[d].total > 0 ? byDate[d].hit / byDate[d].total * 100 : 0;
    });
    statsChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: dates.map(function(d) {
          return d.slice(4, 6) + "/" + d.slice(6);
        }),
        datasets: [
          {
            data: rates,
            backgroundColor: "rgba(33,150,243,0.5)",
            borderColor: "#2196F3",
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        plugins: {
          legend: { display: false },
          title: { display: true, text: "\u65E5\u52253\u9023\u5358\u7684\u4E2D\u7387(%)", color: "#666", font: { size: 11 } }
        },
        scales: {
          x: { ticks: { font: { size: 9 }, color: "#999" }, grid: { display: false } },
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              font: { size: 9 },
              color: "#999",
              callback: function(v) {
                return v + "%";
              }
            },
            grid: { color: "rgba(0,0,0,0.06)" }
          }
        }
      }
    });
  }
  globalThis.renderStats = renderStats;
  globalThis.renderStatsChart = renderStatsChart;
})();

/* BUILD:REPORTING_STATS_PAGE:END */

// PD-13b: Chart.js 動的 import（成績タブ初表示時のみロード）
//   インターネット切断時はキャッシュ（PD-2 SW cdn-v1）から提供
//   SRI ハッシュは _validateLS の値と同じく PA-3 で計算済の SHA-384
var _chartLoadingPromise = null;
function _loadChartLib(){
  capabilities.refresh('chart');
  if(capabilities.has('chart')) return Promise.resolve();
  if(_chartLoadingPromise) return _chartLoadingPromise;
  _chartLoadingPromise = new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.integrity = 'sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD';
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.async = true;
    s.onload = function(){ console.log('[Chart] loaded'); capabilities.refresh('chart'); resolve(); };
    s.onerror = function(e){
      console.warn('[Chart] load failed', e);
      _chartLoadingPromise = null;   // リトライ可能化
      reject(new Error('Chart.js load failed'));
    };
    document.head.appendChild(s);
  });
  return _chartLoadingPromise;
}


// ===============================================
// SCREEN 5: SETTINGS (REWRITTEN)
// ===============================================
function loadSettings(){
  document.getElementById('setBetCount3').value=settings.betCount3||10;
  document.getElementById('setBetCount2').value=settings.betCount2||5;
  var ba = document.getElementById('setBetCountAna');
  if(ba) ba.value=settings.betCountAna||3;
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
  // P0-3: KPI モード（保存値があれば反映、なければ balanced）
  var km = document.getElementById('setKpiMode');
  if(km) km.value = settings.kpiMode || 'balanced';
  // P2-1 (Epic 14): 通知許可状態をボタン横に表示
  if(typeof _refreshNotifyStatus === 'function') _refreshNotifyStatus();
  // Epic 18 (P2-7): COI 状態をボタン横に表示
  if(typeof _refreshCOIStatus === 'function') _refreshCOIStatus();
  // Epic 22: 言語 dropdown を現 locale に同期
  var localeSel = document.getElementById('setLocale');
  if(localeSel && typeof getLocale === 'function') localeSel.value = getLocale();

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

  // P1-Q7: localStorage 容量バー — 5MB クォータに対する使用率を可視化
  //   60% で warn 色、80% で alert 色（自動 cleanup を促す）
  var lsRatio = lsUsed / (5 * 1024 * 1024);
  var lsColor = lsRatio >= 0.80 ? '#C62828' : (lsRatio >= 0.60 ? '#E65100' : '#2E7D32');
  var lsBar = '<div style="background:#eee;border-radius:3px;height:8px;overflow:hidden;margin:2px 0">'
            + '<div style="background:'+lsColor+';height:100%;width:'+Math.min(100,lsRatio*100).toFixed(1)+'%"></div></div>';
  dbInfo.innerHTML =
      '<b>📊 ストレージ</b><br>'
    + '選手DB: '+racerCount+'人 / 場DB: '+stadiumCount+'場<br>'
    + '予想履歴: '+historyCount+'件 ('+dayCount+'日分、確率付 '+withProbs.length+'件)<br>'
    + 'localStorage: '+(lsUsed/1024/1024).toFixed(2)+' / 5 MB ('+(lsRatio*100).toFixed(0)+'%)'+lsBar+'<br>'
    + '<b>🧠 予測モデル状態</b><br>'
    + 'L2 学習ステップ: '+l2Step+' (済レース '+learnedN+')<br>'
    + 'rolling stats N: '+fStatsN+' / warmup '+TUNING.PREDICTION.ZSCORE_WARMUP_N+'<br>'
    + 'Platt 校正: '+plattStatus+' ('+plattAge+', n='+(_plattCoeffs.n||0)+')<br>'
    + (withProbs.length >= TUNING.PREDICTION.PLATT_MIN_SAMPLES
        ? '<span class="c-success">✓ 自動再校正条件を満たしています</span>'
        : '<span style="color:var(--text-dim)">再校正まで残り '+(TUNING.PREDICTION.PLATT_MIN_SAMPLES - withProbs.length)+' 件</span>')
    + '<br><br><b>📡 データソース</b> <span style="font-size:10px;color:var(--text-dim)">(各経路の鮮度を診断)</span>'
    + '<div id="dataSourcesPanel" style="font-size:11px;margin-top:6px">読込中...</div>';

  // D2a (2026-05-17): 各データソースの updated_at を並列 fetch し鮮度可視化
  if(typeof _renderDataSourcesPanel === 'function'){
    _renderDataSourcesPanel();
  }

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

// D2a (2026-05-17): データソースの鮮度を並列 fetch して可視化
//   設定画面 → dataSourcesPanel に書込
function _renderDataSourcesPanel(){
  var panel = document.getElementById('dataSourcesPanel');
  if(!panel) return;
  var sources = [
    { key: 'worker_previews',   label: 'Worker /api/previews',    url: WORKER_BASE + '/api/previews?_=' + Date.now() },
    { key: 'worker_programs',   label: 'Worker /api/programs',    url: WORKER_BASE + '/api/programs?_=' + Date.now() },
    { key: 'worker_results',    label: 'Worker /api/results',     url: WORKER_BASE + '/api/results?_=' + Date.now() },
    { key: 'openapi_previews',  label: 'openapi previews',        url: 'https://boatraceopenapi.github.io/previews/v2/today.json?_=' + Date.now() },
    { key: 'local_previews',    label: 'ローカル data/previews',  url: 'data/previews/today.json?_=' + Date.now() },
  ];
  function ageStr(ts){
    if(!ts) return '取得失敗';
    var d = new Date(ts);
    if(isNaN(d.getTime())) return '時刻不正';
    var min = Math.floor((Date.now() - d.getTime()) / 60000);
    var color = min <= 10 ? '#2E7D32' : (min <= 30 ? '#E65100' : '#C62828');
    var icon  = min <= 10 ? '🟢' : (min <= 30 ? '🟠' : '🔴');
    var hh = String(d.getHours()).padStart(2,'0');
    var mm = String(d.getMinutes()).padStart(2,'0');
    return '<span style="color:'+color+'">'+icon+' '+hh+':'+mm+' ('+min+'分前)</span>';
  }
  Promise.all(sources.map(function(s){
    return fetch(s.url, { cache:'no-store' })
      .then(function(r){
        // D9 (2026-05-17): Last-Modified を fallback として保持。
        //   openapi (boatraceopenapi.github.io) は JSON に updated_at が無く、
        //   GitHub Pages の Last-Modified ヘッダが事実上の鮮度指標。
        var lm = r.headers.get('Last-Modified');
        return r.json().then(function(j){ return { j: j, lastModified: lm }; });
      })
      .then(function(o){
        var j = o.j;
        // updated_at: 1) JSON top-level, 2) Worker wrap, 3) HTTP Last-Modified
        var ua = j.updated_at || (j.data && j.data.updated_at) || o.lastModified;
        return { label: s.label, ts: ua, ok: true };
      })
      .catch(function(e){ return { label: s.label, ts: null, ok: false, err: String(e).slice(0,40) }; });
  })).then(function(rows){
    var html = '<div style="display:grid;grid-template-columns:auto auto;gap:4px 12px">';
    rows.forEach(function(r){
      html += '<div style="font-family:monospace">'+escText(r.label)+':</div>';
      html += '<div>'+ageStr(r.ts)+'</div>';
    });
    html += '</div>';
    html += '<div style="font-size:9px;color:var(--text-dim);margin-top:6px">'
         + '🟢 ≤10分 / 🟠 ≤30分 / 🔴 >30分。Worker 経路が緑なら GHA / openapi 障害でも動作中。'
         + '</div>';
    panel.innerHTML = html;
  }).catch(function(){
    panel.innerHTML = '<span style="color:#C62828">鮮度取得失敗</span>';
  });
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
  // B14 (2026-05-16): 旧仕様は LS 削除のみで再描画せず、画面に古い render が残り
  //   「削除されない」とユーザが誤認していた。rebuildDB と同様に location.reload()
  //   で完全リフレッシュ。また migration flag / corrupt backup も同時掃除し、
  //   完全クリーン状態から再起動する。
  if(_confirmDestructive('成績履歴を全て削除しますか?')){
    try { localStorage.removeItem('boatrace_history'); } catch(_){}
    // 関連 key も掃除
    try { localStorage.removeItem('boatrace_history_migrated_v21'); } catch(_){}
    try {
      // corrupt backup の掃除
      var _toRm = [];
      for(var i=0;i<localStorage.length;i++){
        var k = localStorage.key(i);
        if(k && k.indexOf('boatrace_history__corrupt_') >= 0) _toRm.push(k);
      }
      _toRm.forEach(function(k){ try { localStorage.removeItem(k); } catch(_){} });
    } catch(_){}
    alert('履歴を削除しました。画面を再読込します。');
    location.reload();
  }
}
function rebuildDB(){
  if(_confirmDestructive('選手/場/対戦DBを再構築しますか?')){
    localStorage.removeItem('boatrace_racerDB');
    localStorage.removeItem('boatrace_stadiumDB');
    localStorage.removeItem('boatrace_pairwiseDB');
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
  // B15 (2026-05-17): diag_* (診断ログ) を default 非表示にして「エラーが出ている」
  //   誤認を防ぐ。真のエラー (error/reject/warn/worker_error) のみを目立たせ、
  //   診断ログ数は footer に内訳表示。詳細は「コピー」ボタンで JSON 全文を取得可能。
  var errs = [], diags = [];
  buf.forEach(function(e){
    var t = e.type || '';
    if(t.indexOf('diag_') === 0) diags.push(e);
    else errs.push(e);
  });
  if(errs.length === 0){
    var diagSummary = {};
    diags.forEach(function(d){ var t=d.type||'?'; diagSummary[t]=(diagSummary[t]||0)+1; });
    var summaryStr = Object.keys(diagSummary).map(function(k){return k+'='+diagSummary[k];}).join(', ');
    alert('✅ エラーはありません。\n\n（診断ログ '+diags.length+' 件: '+summaryStr+'）\n'
        + '※ 診断ログはアプリ正常動作の点検記録です。気になる場合は「コピー」で全文確認できます。');
    return;
  }
  var lines = errs.slice(-30).map(function(e){
    var head = '['+(e.iso||new Date(e.ts).toISOString()).slice(11,19)+'] '+(e.type||'?')+': '+(e.msg||'');
    if(e.src) head += ' @ '+e.src+':'+(e.line||0);
    if(e.type === 'worker_error'){
      head += ' target='+(e.target||'(none)')+' eventType='+(e.eventType||'?');
    }
    return head;
  });
  var footer = '';
  if(diags.length > 0){
    footer = '\n\n[+'+diags.length+' 件の診断ログ (正常動作の記録) を非表示。詳細は「コピー」ボタンで確認可]';
  }
  alert('⚠ エラー '+errs.length+' 件 (直近 '+lines.length+' 件表示):\n\n'+lines.join('\n')+footer);
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
          // rt-fix3 P0-3 (2026-06-27): bulk の全置換 (oddsData=od) を撤去し単調性マージへ。
          //   そのまま代入すると、直前に /odds-proxy で取得した live オッズを GH Pages の
          //   stale bulk で巻き戻していた（_mergeOddsSnapshot が _live_at を温存する）。
          if(oddsDate===todayDate2){_mergeOddsSnapshot(od);oddsLastFetched=Date.now();}
        }
      }
      // この 1 レースの live オッズも即時取得（throttle/dedupe 済）
      try{ if(typeof _kickOffLiveOddsRefresh==='function') _kickOffLiveOddsRefresh(currentStadium,currentRace); }catch(e){}
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
// =============================================================================
// LIVE ODDS via Cloudflare Worker — 「常に最新」を保証する保険ルート
//
// GH Actions / scrape_odds_fast.py が止まっても、PWA が直接 Worker 経由で
// boatrace.jp から実時間オッズを取得する。
//
// アーキテクチャ:
//   PWA → Worker.workers.dev/odds-proxy?type=...&sid=...&rno=...&hd=...
//   Worker → boatrace.jp/owpc/pc/race/{oddstf|odds2tf|odds3t} (CORS pass-through)
//   PWA で DOMParser でパース → oddsData にマージ → 詳細画面再描画
// =============================================================================
var _LIVE_ODDS_WORKER = 'https://boatrace-scrape-trigger.inotaka1979.workers.dev';
var _liveOddsLastFetched = {};   // {"22-5": ms timestamp} — throttle (30s 同レース)
var _liveOddsInflight = {};      // 重複 fetch 抑止

function _parseWinHtml(html){
  try {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tbl = doc.querySelector('table.is-w495');
    if(!tbl) return null;
    var odds = {};
    tbl.querySelectorAll('tbody tr').forEach(function(row){
      var tds = row.querySelectorAll('td');
      if(tds.length >= 3){
        var boat = tds[0].textContent.trim();
        var val = tds[2].textContent.trim();
        if(val.indexOf('-')>=0 && val.indexOf('.')>=0) val = val.split('-')[0];
        var v = parseFloat(val);
        if(v > 0) odds[boat] = v;
      }
    });
    return Object.keys(odds).length ? odds : null;
  } catch(e){ return null; }
}

function _parseExactaHtml(html){
  try {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tables = doc.querySelectorAll('table');
    var target = null;
    for(var i=0;i<tables.length;i++){ if(tables[i].querySelector('td.oddsPoint')){ target = tables[i]; break; } }
    if(!target) return null;
    var odds = {};
    target.querySelectorAll('tbody tr').forEach(function(row){
      var cells = []; for(var c=0;c<row.children.length;c++){ if(row.children[c].tagName === 'TD') cells.push(row.children[c]); }
      if(cells.length !== 12) return;
      for(var col=0; col<6; col++){
        var base = col * 2;
        var ni = parseInt(cells[base].textContent.trim());
        var cv = cells[base+1];
        if(!cv.classList.contains('oddsPoint')) continue;
        var v = parseFloat(cv.textContent.trim());
        var ichi = col + 1;
        if(ichi>=1 && ichi<=6 && ni>=1 && ni<=6 && ichi!==ni && v>0){
          odds[ichi+'-'+ni] = v;
        }
      }
    });
    return Object.keys(odds).length ? odds : null;
  } catch(e){ return null; }
}

function _parseTrifectaHtml(html){
  try {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tables = doc.querySelectorAll('table');
    var target = null;
    for(var i=0;i<tables.length;i++){ if(tables[i].querySelector('td.oddsPoint')){ target = tables[i]; break; } }
    if(!target) return null;
    var odds = {};
    var currentSeconds = [null,null,null,null,null,null];
    target.querySelectorAll('tbody tr').forEach(function(row){
      var cells = []; for(var c=0;c<row.children.length;c++){ if(row.children[c].tagName === 'TD') cells.push(row.children[c]); }
      var n = cells.length;
      var stride, offsetSan, offsetOdds, updateSecond;
      if(n === 18){ stride = 3; offsetSan = 1; offsetOdds = 2; updateSecond = true; }
      else if(n === 12){ stride = 2; offsetSan = 0; offsetOdds = 1; updateSecond = false; }
      else return;
      for(var col=0; col<6; col++){
        var base = col * stride;
        if(base + offsetOdds >= n) break;
        if(updateSecond){
          var ni0 = parseInt(cells[base].textContent.trim());
          currentSeconds[col] = isNaN(ni0) ? null : ni0;
        }
        var san = parseInt(cells[base + offsetSan].textContent.trim());
        var cv = cells[base + offsetOdds];
        if(!cv.classList.contains('oddsPoint')) continue;
        var v = parseFloat(cv.textContent.trim());
        var ichi = col + 1;
        var ni = currentSeconds[col];
        if(ni == null || isNaN(san)) continue;
        if(ichi>=1 && ichi<=6 && ni>=1 && ni<=6 && san>=1 && san<=6
           && ichi!==ni && ichi!==san && ni!==san && v>0){
          odds[ichi+'-'+ni+'-'+san] = v;
        }
      }
    });
    return Object.keys(odds).length ? odds : null;
  } catch(e){ return null; }
}

function _todayYyyymmddJST(){
  var d = new Date(Date.now() + 9*3600*1000);
  return d.getUTCFullYear() + ('0'+(d.getUTCMonth()+1)).slice(-2) + ('0'+d.getUTCDate()).slice(-2);
}

async function _fetchLiveOddsForRace(sid, rn){
  var hd = _todayYyyymmddJST();
  var u = function(type){ return _LIVE_ODDS_WORKER+'/odds-proxy?type='+type+'&sid='+sid+'&rno='+rn+'&hd='+hd; };
  try {
    var [winHtml, exaHtml, triHtml] = await Promise.all([
      fetch(u('win')).then(function(r){ return r.ok ? r.text() : null; }).catch(function(){return null;}),
      fetch(u('exacta')).then(function(r){ return r.ok ? r.text() : null; }).catch(function(){return null;}),
      fetch(u('trifecta')).then(function(r){ return r.ok ? r.text() : null; }).catch(function(){return null;}),
    ]);
    var result = { stadium: parseInt(sid), race: parseInt(rn) };
    if(winHtml){ var w = _parseWinHtml(winHtml); if(w) result.win = w; }
    if(exaHtml){ var e = _parseExactaHtml(exaHtml); if(e) result.exacta = e; }
    if(triHtml){ var t = _parseTrifectaHtml(triHtml); if(t) result.trifecta = t; }
    if(!result.win && !result.exacta && !result.trifecta) return null;
    return result;
  } catch(err){
    return null;
  }
}

function _kickOffLiveOddsRefresh(sid, rn){
  var key = sid + '-' + rn;
  var now = Date.now();
  // throttle 30s 同レース
  if(_liveOddsLastFetched[key] && now - _liveOddsLastFetched[key] < 30000) return;
  if(_liveOddsInflight[key]) return;
  _liveOddsInflight[key] = true;

  _fetchLiveOddsForRace(sid, rn).then(function(live){
    _liveOddsInflight[key] = false;
    if(!live) return;
    _liveOddsLastFetched[key] = Date.now();

    // oddsData にマージ
    if(!oddsData) oddsData = { updated_at: new Date().toISOString(), odds: [] };
    if(!Array.isArray(oddsData.odds)) oddsData.odds = [];
    // rt-fix2 P0-A: race 単位の live 取得時刻を刻む。
    //   _mergeOddsSnapshot がこれを見て、古い bulk snapshot による巻き戻りから温存する。
    live._live_at = Date.now();
    var idx = -1;
    for(var i=0;i<oddsData.odds.length;i++){
      if(oddsData.odds[i].stadium === parseInt(sid) && oddsData.odds[i].race === parseInt(rn)){ idx = i; break; }
    }
    if(idx >= 0){
      oddsData.odds[idx] = Object.assign({}, oddsData.odds[idx], live);
    } else {
      oddsData.odds.push(live);
    }
    // この race の updated_at を新しく
    oddsData.updated_at = new Date().toISOString();
    oddsLastFetched = Date.now();

    // FIX: 全画面 openRace 再描画 (= predictRace 再実行) は重く
    //   展示 / 展示後予想が flicker するため、auto refresh では DOM を触らない。
    //   silent merge のみ — 次の openRace (タブ切替 / 別レース閲覧後復帰) で
    //   新しいオッズが反映される。即時反映したいユーザは下部の
    //   「オッズ更新」ボタン (refreshOdds, full re-render) を使用。
    //   stale 警告バナーだけは updateOddsUI で消す (DOM 軽量更新)。
    if(currentStadium == sid && currentRace == rn){
      try {
        if(typeof updateOddsUI === 'function') updateOddsUI();
        // FIX: 起動時の stale banner (詳細画面トップ赤バナー) を live fetch 成功後に消す
        var _dw = document.getElementById('detailWeather');
        if(_dw){
          var _staleBanner = _dw.querySelector('div[style*="#D32F2F"]');
          if(_staleBanner) _staleBanner.remove();
        }
        // FIX: 3連単オッズテーブル (detailOdds) も最新値で部分再描画
        //   renderOddsSection は predictRace 不要 (pred 引数未使用) → 軽量
        //   展示・予想 (detailPrediction) は触らない → flicker なし
        var _race = programData && programData[sid] && programData[sid][rn] ? programData[sid][rn] : null;
        var _raceOdds = (typeof getOddsForRace === 'function') ? getOddsForRace(sid, rn) : null;
        var _detailOdds = document.getElementById('detailOdds');
        if(_detailOdds && typeof renderOddsSection === 'function' && _raceOdds){
          _detailOdds.innerHTML = renderOddsSection(sid, rn, _raceOdds, null, _race);
        }
        // rt-fix2 P0-A3: 買い目 (detailPrediction) は openRace 時点の stale オッズで
        //   計算済みのまま。flicker 回避のため自動再描画はせず、ユーザー主導の
        //   再計算ボタンを買い目セクション先頭に 1 つだけ差し込む。
        var _dp = document.getElementById('detailPrediction');
        if(_dp && !document.getElementById('liveOddsRecalcBtn')){
          var _note = document.createElement('div');
          _note.id = 'liveOddsRecalcBtn';
          _note.style.cssText = 'margin:6px 0;padding:8px;background:#1B5E20;border-radius:8px;'+
            'text-align:center;color:#fff;font-size:13px;cursor:pointer';
          _note.setAttribute('role','button');
          _note.setAttribute('tabindex','0');
          _note.textContent = '📈 実時間オッズ取得済 — タップで買い目を再計算';
          _note.onclick = function(){ openRace(sid, rn); };
          _dp.insertBefore(_note, _dp.firstChild);
        }
      } catch(_){}
    }
  }).catch(function(){
    _liveOddsInflight[key] = false;
  });
}

async function refreshOdds(){
  var btn=document.getElementById('oddsRefreshBtn');
  if(btn){btn.disabled=true;btn.textContent='取得中...';}

  try {
    // Step 1: GH Pages の最新 JSON を fetch (cron が動いていれば 5 分鮮度)
    // rt-fix2 P0-A: 単調性ガード付きマージ (live 取得分を温存)
    var r = await fetch('data/odds/today.json?t='+Date.now());
    if(r.ok){
      _mergeOddsSnapshot(await r.json());
    }

    // Step 2: GH Pages のオッズが古い (>5min) かつ詳細画面表示中なら、
    //   Cloudflare Worker 経由で boatrace.jp から実時間オッズを fetch
    var staleMin = null;
    if(oddsData && oddsData.updated_at){
      var t = Date.parse(oddsData.updated_at);
      if(!isNaN(t)) staleMin = (Date.now() - t) / 60000;
    }
    if(currentStadium && currentRace && (staleMin == null || staleMin >= 5)){
      if(btn) btn.textContent='実時間取得中...';
      var live = await _fetchLiveOddsForRace(currentStadium, currentRace);
      if(live){
        if(!oddsData) oddsData = { updated_at: new Date().toISOString(), odds: [] };
        if(!Array.isArray(oddsData.odds)) oddsData.odds = [];
        live._live_at = Date.now();   // rt-fix2 P0-A: 巻き戻り温存マーカー
        var idx = -1;
        for(var i=0;i<oddsData.odds.length;i++){
          if(oddsData.odds[i].stadium === parseInt(currentStadium) && oddsData.odds[i].race === parseInt(currentRace)){ idx = i; break; }
        }
        if(idx >= 0) oddsData.odds[idx] = Object.assign({}, oddsData.odds[idx], live);
        else oddsData.odds.push(live);
        oddsData.updated_at = new Date().toISOString();
        oddsLastFetched = Date.now();
      }
    }

    if(btn){btn.textContent='✅ 更新完了';btn.disabled=false;}
    updateOddsUI();
    // 全 DOM 再描画は manual button のみ実施 (auto-refresh では行わない)
    if(currentStadium && currentRace) openRace(currentStadium, currentRace);
    setTimeout(function(){if(btn) btn.textContent='🔄 オッズ更新'},2000);
  } catch(err){
    if(btn){btn.textContent='🔄 オッズ更新';btn.disabled=false;}
  }
}

function startOddsAutoRefresh(){
  stopOddsAutoRefresh();
  oddsAutoRefreshTimer=setInterval(function(){
    fetch('data/odds/today.json?t='+Date.now())
      .then(function(r){if(r.ok) return r.json();throw new Error('fail')})
      .then(function(d){
        // rt-fix2 P0-A: 無条件全置換をやめ単調性ガード付きマージへ
        //   (詳細画面で取得済みの実時間オッズを stale snapshot で巻き戻さない)
        _mergeOddsSnapshot(d);
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
  // FIX: oddsLastFetched は GitHub Pages からの fetch 時刻であり、
  //   JSON 内部の updated_at (実際のスクレイプ時刻) と区別する必要がある。
  //   cron が止まると fetch は成功しても JSON は何時間も古いオッズになるため、
  //   updated_at からの経過時間で stale を判定する。
  var staleMin = null;
  if(oddsData && oddsData.updated_at){
    var t = Date.parse(oddsData.updated_at);
    if(!isNaN(t)) staleMin = Math.round((Date.now()-t)/60000);
  }
  if(staleMin == null){
    if(!oddsLastFetched){ msg.textContent=''; return; }
    var fetchedMin=Math.round((Date.now()-oddsLastFetched)/60000);
    msg.textContent='('+fetchedMin+'分前)';
    msg.style.color = '';
    return;
  }
  if(staleMin >= 30){
    // 30分以上古いオッズはレース直前の市場と大きく乖離する可能性あり
    var hh = staleMin >= 60 ? Math.floor(staleMin/60)+'時間'+(staleMin%60)+'分' : staleMin+'分';
    msg.textContent='⚠ オッズが '+hh+'前 — 古い可能性あり';
    msg.style.color = '#D32F2F';
    msg.style.fontWeight = '700';
  } else if(staleMin > 0){
    msg.textContent='('+staleMin+'分前)';
    msg.style.color = '';
    msg.style.fontWeight = '';
  } else {
    msg.textContent='(最新)';
    msg.style.color = '';
    msg.style.fontWeight = '';
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
  // 直接 setTimeout fallback も capabilities.runIdle が同等カバー、ただし requestIdleCallback を
  // 含めると 3 ms 単位の遅延が増えるためここは scheduler.postTask または setTimeout の 2 段。
  if(capabilities.has('scheduler_post_task')){
    return scheduler.postTask(fn, {priority:'background'});
  }
  return setTimeout(fn, delay || 0);
}

// PH-3: SW 登録は load 後 + 余裕をもった setTimeout でさらに遅延
//   これにより HTML parse + first paint 期に SW 登録が混入しない
function _setupServiceWorker(){
  if(!capabilities.has('service_worker')) return;
  // updateViaCache:'none' で sw.js 自体を HTTP cache から外し、
  //   iOS が古い VERSION を見続ける事故を防ぐ
  // D6 (2026-05-17): reg.update() の rejection を catch してエラーログを汚さない。
  //   "Failed to update a ServiceWorker ... unknown error" は GitHub Pages 一時障害や
  //   ネットワーク blip で発生する transient エラーで、アプリ動作には影響しない。
  //   未捕捉だと boatrace_errors に reject 型で記録されてユーザを混乱させる。
  function _safeSwUpdate(reg){
    try {
      var p = reg.update();
      if (p && typeof p.catch === 'function') {
        p.catch(function(err){
          try { console.warn('[SW] update transient error:', err && err.message); } catch(_){}
        });
      }
    } catch(e){ try { console.warn('[SW] update threw:', e && e.message); } catch(_){} }
  }
  navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'})
    .then(function(reg){
      console.log('[SW] registered scope=', reg.scope);
      _runIdleTask(function(){ _safeSwUpdate(reg); }, 100);
      setInterval(function(){ _safeSwUpdate(reg); }, 1800000);
      // Epic 18 (P2-7): URL ?coi=1 が opt-in されている場合のみ COI reload を実施
      try {
        var _coiOptIn = (new URLSearchParams(location.search)).get('coi') === '1';
        if(_coiOptIn && navigator.serviceWorker.controller && !capabilities.has('cross_origin_isolated')
           && !sessionStorage.getItem('_coi_reloaded')){
          sessionStorage.setItem('_coi_reloaded', '1');
          console.log('[SW] coi opt-in: reloading once to activate cross-origin isolation');
          setTimeout(function(){ location.reload(); }, 100);
          return;
        }
      } catch(_){}
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
    // FIX: 初回 SW install + clients.claim() でも controllerchange が発火するため、
    //   user 操作（更新トースト tap → SKIP_WAITING）起点の場合のみ reload する。
    //   これで初回訪問者の余計な reload と、Lighthouse / VRT テストの誤動作を防ぐ。
    if(_swReloadDone) return;
    if(!_userTriggeredSwUpdate) return;
    _swReloadDone = true;
    console.log('[SW] new controller (user-triggered), reloading');
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
  loadAllData().then(function(){
    if(typeof _renderFreshness==='function') _renderFreshness();
    // 設計者A P1: PWA shortcut URL routing
    var routed = false;
    try {
      var qs = new URLSearchParams(location.search || '');
      var tab = qs.get('tab');
      if(tab && /^(stats|settings|backtest)$/.test(tab) && typeof showPage === 'function'){
        showPage(tab);
        routed = true;
      }
    } catch(_){}
    // P0-5: PWA 再起動時のページ復元（shortcut ルーティングが優先）
    if(!routed && typeof _restoreNavState === 'function') _restoreNavState();
    // P2-1 (Epic 14): お気に入りレースの結果確定を 1 通知に集約
    try { if(typeof _maybeNotifyNewResults === 'function') _maybeNotifyNewResults(); } catch(_){}
  });
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
// 自前 data/* の updated_at が GitHub Pages 反映遅延で昨日のままだと、
// OpenAPI から今日のレースが取れていても表示が「待機中」のまま固定される問題への対策。
// OpenAPI raw に含まれる race_date が今日の場合、その fetch 時刻を fallback として記録する。
var _dataTodayConfirmedAt = 0;  // epoch ms (今日の race_date を確認した時刻)
function _noteUpdatedAt(iso){
  if(!iso) return;
  var t = Date.parse(iso);
  if(Number.isFinite(t) && t > _dataLatestUpdatedAt) _dataLatestUpdatedAt = t;
}
function _noteTodayDataFromRaw(raw, key){
  // OpenAPI raw（programs / previews / results）の先頭レコードの race_date を確認し、
  // 今日 (JST) と一致すれば今日のデータが取れていると判定して fallback 時刻を更新
  if(!raw) return;
  var arr = key && raw[key];
  if(!Array.isArray(arr) || !arr.length) return;
  var rd = arr[0].race_date;
  if(!rd) return;
  // race_date は "20260506" or "2026-05-06" の両形式を許容
  var s = String(rd).replace(/-/g,'');
  if(s.length !== 8) return;
  var dataIso = s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
  var todayJst = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  if(dataIso === todayJst) _dataTodayConfirmedAt = Date.now();
}
// _renderFreshness は src/reporting/status_banner.js に移動 (Phase 2d)
// → BUILD:REPORTING_STATUS_BANNER bundle 経由で globalThis に export 済
setManagedInterval(_renderFreshness, 10000);   // 10秒ごとに表示更新
// rt-fix3 P0-6 (2026-06-27): Worker 死活を 5 分毎に検知（起動直後に 1 回 + 以降 5 分間隔）。
if(typeof _probeWorkerHealth==='function'){
  setManagedInterval(_probeWorkerHealth, 300000);
  setTimeout(function(){ try{ _probeWorkerHealth(); }catch(_){} }, 3000);
}

// rt-fix2 P0-A (2026-06-11): オッズ snapshot の単調性ガード付きマージ。
//   従来は 90秒/300秒 poll が `oddsData = 取得JSON` と無条件全置換していたため、
//   /odds-proxy で取得した実時間オッズ (race 単位 _live_at 付き) が最大 90 秒後に
//   数時間前の GitHub Pages snapshot で巻き戻されていた。
//   ルール: (1) snapshot が現 oddsData より古ければ捨てる
//          (2) 採用時も _live_at が snapshot より新しいレースは温存
function _mergeOddsSnapshot(snap){
  if(!snap || !Array.isArray(snap.odds)) return;
  if(!oddsData || !Array.isArray(oddsData.odds) || !oddsData.odds.length){
    oddsData = snap; oddsLastFetched = Date.now(); return;
  }
  var curT = Date.parse(oddsData.updated_at || 0) || 0;
  var newT = Date.parse(snap.updated_at || 0) || 0;
  if(newT < curT) return;   // 古い snapshot で巻き戻さない
  var keep = {};
  oddsData.odds.forEach(function(o){
    if(o && o._live_at && o._live_at > newT) keep[o.stadium + '-' + o.race] = o;
  });
  var merged = snap.odds.map(function(o){
    var k = o.stadium + '-' + o.race;
    return keep[k] ? keep[k] : o;
  });
  Object.keys(keep).forEach(function(k){
    var found = merged.some(function(o){ return (o.stadium + '-' + o.race) === k; });
    if(!found) merged.push(keep[k]);
  });
  oddsData = { updated_at: snap.updated_at, scrape_stats: snap.scrape_stats, odds: merged };
  oddsLastFetched = Date.now();
}

// rt-fix2 P0-D (2026-06-11): previewData の展示退行防止マージ。
//   Worker の live 縮退パス (_source:'live') は exhibition merge 無しの素 openapi を
//   返すため、90秒毎の全置換で「展示が出たり消えたり」していた。
//   レース単位で展示タイム保有艇数を比較し、新データの方が貧しければ旧を温存する。
function _previewRichness(p){
  if(!p || !p.boats) return 0;
  var bs = p.boats;
  if(!Array.isArray(bs)) bs = Object.keys(bs).map(function(k){ return bs[k]; });
  var n = 0;
  bs.forEach(function(b){ if(b && (b.racer_exhibition_time || 0) > 0) n++; });
  return n;
}
function _mergePreviewIndex(newIdx){
  if(!newIdx) return previewData;
  if(!previewData) return newIdx;
  for(var sid in newIdx){
    for(var rn in newIdx[sid]){
      var op = previewData[sid] && previewData[sid][rn];
      if(op && _previewRichness(op) > _previewRichness(newIdx[sid][rn])){
        newIdx[sid][rn] = op;
      }
    }
  }
  return newIdx;
}

// rt-fix2 P0-B: 前回 auto-render 時のデータ世代 (無変化なら再描画しない)
var _lastAutoRenderKey = '';

setManagedInterval(async function(){
  try{
    var t=Date.now();
    // rt-fix P1-4 (2026-06-04): programs/previews/results/odds/local-previews を並列 fetch。
    //   従来は直列 await で、Worker 沈黙時に各 4-8s 待ちが累積し 1 周が 24s+ に
    //   膨らんでレース直前の体感が死んでいた。Promise.allSettled で最悪 ~8s に短縮。
    var _localOdds=fetch('data/odds/today.json?t='+t).then(function(o){return o.ok?o.json():null;}).catch(function(){return null;});
    var _localPv=fetch('data/previews/today.json?t='+t).then(function(p){return p.ok?p.json():null;}).catch(function(){return null;});
    var _settled=await Promise.allSettled([
      fetchWithFallback(API_BASE+'/programs/v2/today.json?_='+t),
      fetchWithFallback(API_BASE+'/previews/v2/today.json?_='+t),
      fetchWithFallback(API_BASE+'/results/v2/today.json?_='+t),
      _localOdds,
      _localPv
    ]);
    function _val(i){ return _settled[i].status==='fulfilled'?_settled[i].value:null; }
    var rawP=_val(0);
    if(rawP){ programData=indexByStadiumRace(rawP,'programs'); _noteUpdatedAt(rawP.updated_at); _noteTodayDataFromRaw(rawP,'programs'); }
    var rawPv=_filterStalePreviews(_val(1));
    // rt-fix2 P0-D: 全置換ではなく展示退行防止マージ (live 縮退の素データで上書きしない)
    if(rawPv){ previewData=_mergePreviewIndex(indexPreviews(rawPv)); _noteUpdatedAt(rawPv.updated_at); _noteTodayDataFromRaw(rawPv,'previews'); }
    var rawR=_val(2);
    if(rawR){
      resultData=indexResults(rawR);
      _noteUpdatedAt(rawR.updated_at);
      _noteTodayDataFromRaw(rawR,'results');
      if(programData)updateDBFromResults(resultData,programData);
      await learnFromResults();   // PE-9: async
      updateHistoryWithResults();
    }
    var od=_val(3);
    // rt-fix2 P0-A: 無条件全置換 (oddsData=od) をやめ単調性ガード付きマージへ
    if(od){ _mergeOddsSnapshot(od); _noteUpdatedAt(od.updated_at); }
    // F5: 自前 previews を merge して finished/result を反映
    // D4a: local が 20 分以上古い場合は skip (Worker の方が新しい)
    var pd=_val(4);
    if(pd){
      if(_shouldApplyLocalMerge(pd)) _applyLiveDataMerge(pd);
      _noteUpdatedAt(pd.updated_at);
    }
    // B12 (2026-05-16): 日中に新たに終了したレースを history に backfill。
    //   旧仕様は _backfillTodayPredictions を初回 load + 「更新」ボタン押下時のみ
    //   実行していたため、ユーザがアプリを開きっぱなしだと成績トラッカーが
    //   「本日 判定済 = 0」または「昨日のまま」になる問題があった。
    //   90秒毎の auto refresh で新規 finished race を毎回 backfill し、
    //   成績タブが active なら即時再描画する。
    if(typeof _backfillTodayPredictions === 'function' && programData && resultData){
      try {
        await _backfillTodayPredictions();
        if(typeof updateHistoryWithResults === 'function') updateHistoryWithResults();
        var statsPage = document.getElementById('pageStats');
        if(statsPage && statsPage.classList.contains('active') && typeof renderStats === 'function'){
          renderStats();
          if(typeof renderStatsChart === 'function') renderStatsChart();
        }
      } catch(e){ console.warn('auto-backfill error:', e); }
    }
    // rt-fix2 P0-B (2026-06-11): poll で更新したデータを表示中ページの DOM へ反映。
    //   従来はメモリ更新のみで、トップ/レース一覧は suspend 前の表示のまま
    //   「鮮度バッジは緑なのに中身が古い」という UX 矛盾が起きていた
    //   (visibilitychange 復帰時はこの poll 関数が即時 1 回呼ばれるため復帰も対象)。
    //   データ世代が前回 render と同じ時はスキップし、無駄な再描画を避ける。
    //   pageDetail は openRace 全再描画が flicker するため除外
    //   (オッズ表は _kickOffLiveOddsRefresh / updateOddsUI が部分更新する)。
    try{
      var _rk=(rawP&&rawP.updated_at||'')+'|'+(rawPv&&rawPv.updated_at||'')+'|'+
              (rawR&&rawR.updated_at||'')+'|'+(oddsData&&oddsData.updated_at||'');
      if(_rk!==_lastAutoRenderKey){
        _lastAutoRenderKey=_rk;
        var _pg=document.querySelector('.page.active');
        if(_pg && _pg.id==='pageTop' && typeof renderStadiums==='function'){
          renderStadiums();
        } else if(_pg && _pg.id==='pageRaces' && currentStadium && typeof openStadium==='function'){
          var _sy=window.scrollY;
          openStadium(currentStadium);
          window.scrollTo(0,_sy);
        }
      }
    }catch(e){}
    // rt-fix3 P0-1 (2026-06-27): 一覧/詳細を閲覧中は、締切が近づくレースの live オッズを
    //   90 秒毎に継続取得する（openStadium 時の 1 回だけでは閲覧中に締切が近づくレースを
    //   取りこぼす）。_prefetchLiveOddsForUpcoming 内で 400ms stagger + 30s throttle 済。
    try{
      var _apg=document.querySelector('.page.active');
      if(_apg && (_apg.id==='pageRaces'||_apg.id==='pageDetail') && currentStadium
         && typeof _prefetchLiveOddsForUpcoming==='function'){
        _prefetchLiveOddsForUpcoming(currentStadium);
      }
    }catch(e){}
    // rt-fix3 P0-5 (2026-06-27): データ世代が大きく停滞したら自動復旧。
    //   Worker cron / KV が静かに止まると /api/* が stale を返し続け、誰も気付けない。
    //   データ世代が 25 分以上古い場合のみ、Worker /api/refresh-now を 5 分 1 回まで
    //   叩いて KV 再生成を促す（refreshAll は KV write + scrape を伴うため必ずレート制限）。
    //   programs/previews/results の cache-bust 再取得は本 poll の ?_= で既に毎回実施済。
    try{
      // rt-fix3 fix: データ世代は updated_at(_dataLatestUpdatedAt) のみで判定する。
      //   旧実装は Math.max(_dataLatestUpdatedAt, _dataTodayConfirmedAt) だったが、
      //   _dataTodayConfirmedAt は「今日のデータを確認した壁時計時刻(≒now)」のため
      //   (now-_gen)≒0 となり 25 分判定が永久に発火せず、自己復旧トリガが死んでいた。
      var _gen=_dataLatestUpdatedAt||0;
      if(_gen && (Date.now()-_gen)/60000 >= 25){
        var _le=globalThis._lastEscalateAt||0;
        if(Date.now()-_le >= 300000){
          globalThis._lastEscalateAt=Date.now();
          try{ fetch((globalThis.WORKER_BASE||'')+'/api/refresh-now',{cache:'no-store'}).catch(function(){}); }catch(e){}
        }
      }
    }catch(e){}
    _renderFreshness();
  }catch(e){console.warn('Auto refresh error:',e)}
}, 90000);   // F2: 90 秒

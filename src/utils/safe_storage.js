// PE-4 (PC-7 Step 2): safe_storage モジュール
//
// localStorage の安全 parse / set / スキーマバリデーションを提供する。
// build/build.mjs によって IIFE bundle され index.html の
// <!-- BUILD:SAFE_STORAGE:START --> ... <!-- BUILD:SAFE_STORAGE:END --> 領域に
// 注入される。
//
// 注入後、以下の関数 / 変数がグローバルスコープに公開される（onclick handler 互換のため）:
//   _validateLS / _bootParseLS / safeParse / safeSet / reportError
//
// 設計原則:
//   - 識別子は globalThis.* に明示的に export してインライン script から参照可能に
//   - 副作用なし（このモジュールが読まれた時点では何もしない、関数呼出時のみ動作）

'use strict';

const FEATURE_DIM = 24; // v2 (2026-05-24): 12 → 24 拡張
const ERROR_BUF_MAX = 100;

// P1-C3: localStorage キー正規一覧（参照用カタログ）
//   既存 literal 散在は段階移行。新規コードはこの定数経由で参照すること。
//   schema migration / 容量監視 / cleanup スクリプトのターゲットとしても利用。
const STORAGE_KEYS = Object.freeze({
  SCHEMA_VERSION: 'boatrace_schema_version', // P0-6: 互換性管理
  SETTINGS: 'boatrace_settings',
  RACER_DB: 'boatrace_racerDB',
  STADIUM_DB: 'boatrace_stadiumDB',
  MOTOR_STATS: 'boatrace_motorStats',
  EXHIBITION_STATS: 'boatrace_exhibitionStats',
  PAIRWISE_DB: 'boatrace_pairwiseDB',
  WEIGHTS: 'boatrace_weights', // PB-1: L2 学習重み
  LEARNED: 'boatrace_learned', // PB-1: 学習ガード
  TRAINSTEP: 'boatrace_trainstep', // PB-2: LR decay 用
  FEATURE_STATS: 'boatrace_featurestats', // PB-7: rolling stats
  PLATT: 'boatrace_platt', // PB-6: Platt 校正
  HISTORY: 'boatrace_history',
  ERRORS: 'boatrace_errors', // PC-6: エラーログ
  DIAG: 'boatrace_diag', // PI 診断オーバーレイ
  NAV: 'boatrace_nav', // P0-5: PWA 状態復元（sessionStorage 側）
});

// L2_INIT_WEIGHTS は index.html の constants 部で定義済（global）。
// _validateLS が weights schema 検証で参照する。
// P1-Q4 (QA-B): nested 型検証ヘルパ — racerDB.courseStats.*.count 等が文字列でも素通り
//   していた問題を防ぐ。サンプリング検査（全件は重いので先頭 50 件のみ）。
function _isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
function _validateRacerDBSample(value) {
  var ids = Object.keys(value);
  var sample = ids.slice(0, 50);
  for (var i = 0; i < sample.length; i++) {
    var r = value[sample[i]];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    if (r.courseStats && typeof r.courseStats === 'object') {
      for (var c in r.courseStats) {
        var cs = r.courseStats[c];
        if (!cs || typeof cs !== 'object') return false;
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
    if (!s || typeof s !== 'object') return false;
    if (s.courseWinRate && typeof s.courseWinRate === 'object') {
      for (var c in s.courseWinRate) {
        var cw = s.courseWinRate[c];
        if (cw && typeof cw === 'object') {
          if (cw.races != null && !_isFiniteNum(cw.races)) return false;
          if (cw.win != null && !_isFiniteNum(cw.win)) return false;
        }
      }
    }
  }
  return true;
}

function _validateLS(key, value) {
  if (value === null || value === undefined) return null;
  switch (key) {
    case 'boatrace_settings':
      return typeof value === 'object' && !Array.isArray(value) ? value : null;
    case 'boatrace_racerDB':
      if (typeof value !== 'object' || Array.isArray(value)) return null;
      if (Object.keys(value).length > 10000) return null;
      if (!_validateRacerDBSample(value)) return null;
      return value;
    case 'boatrace_stadiumDB':
      if (typeof value !== 'object' || Array.isArray(value)) return null;
      if (Object.keys(value).length > 10000) return null;
      if (!_validateStadiumDBSample(value)) return null;
      return value;
    case 'boatrace_motorStats':
    case 'boatrace_exhibitionStats':
    case 'boatrace_pairwiseDB':
      if (typeof value !== 'object' || Array.isArray(value)) return null;
      if (Object.keys(value).length > 10000) return null;
      return value;
    case 'boatrace_weights':
      if (!Array.isArray(value)) return null;
      // L2_INIT_WEIGHTS は global from index.html
      const expectedLen = typeof L2_INIT_WEIGHTS !== 'undefined' ? L2_INIT_WEIGHTS.length : 12;
      if (value.length !== expectedLen) return null;
      for (let i = 0; i < value.length; i++) {
        if (!Number.isFinite(value[i]) || Math.abs(value[i]) > 1000) return null;
      }
      return value;
    case 'boatrace_history':
      if (!Array.isArray(value)) return null;
      return value.length > 50000 ? value.slice(-1000) : value;
    case 'boatrace_learned':
      if (typeof value !== 'object' || Array.isArray(value)) return null;
      if (Object.keys(value).length > 50000) return null;
      return value;
    case 'boatrace_trainstep':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e10 ? value : null;
    case 'boatrace_featurestats':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      if (!Array.isArray(value.mean) || value.mean.length !== FEATURE_DIM) return null;
      if (!Array.isArray(value.m2) || value.m2.length !== FEATURE_DIM) return null;
      if (typeof value.n !== 'number' || !Number.isFinite(value.n) || value.n < 0) return null;
      for (let i = 0; i < FEATURE_DIM; i++) {
        if (!Number.isFinite(value.mean[i]) || !Number.isFinite(value.m2[i])) return null;
      }
      return value;
    case 'boatrace_platt':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      if (!Number.isFinite(value.a) || !Number.isFinite(value.b)) return null;
      if (Math.abs(value.a) > 10 || Math.abs(value.b) > 10) return null;
      return value;
    case 'boatrace_platt_perstadium':
      // 2026-05-24 (Tier 2): { sid: { a, b, n, fittedAt } }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      if (Object.keys(value).length > 30) return null; // 24 場 + 余裕
      for (var sid in value) {
        var ps = value[sid];
        if (!ps || typeof ps !== 'object') return null;
        if (!Number.isFinite(ps.a) || !Number.isFinite(ps.b)) return null;
        if (Math.abs(ps.a) > 10 || Math.abs(ps.b) > 10) return null;
      }
      return value;
    case 'boatrace_isotonic':
      // 2026-05-24 (Tier 2): { points: [{x, y}, ...], fittedAt, n }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      if (!Array.isArray(value.points)) return null;
      if (value.points.length > 100) return null; // PAV 後の breakpoints は通常 < 20
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
        localStorage.setItem(key + '__corrupt_' + Date.now(), raw);
      } catch (_) {}
      try {
        localStorage.removeItem(key);
      } catch (_) {}
      console.warn('[boot] schema invalid, restored fallback:', key);
      return fallback;
    }
    return validated !== null ? validated : fallback;
  } catch (e) {
    console.warn('[boot] parse failed', key, e);
    try {
      if (raw) localStorage.setItem(key + '__corrupt_' + Date.now(), raw);
    } catch (_) {}
    return fallback;
  }
}

function safeParse(key, fallback) {
  let raw;
  try {
    raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    if (v === null || v === undefined) return fallback;
    const validated = _validateLS(key, v);
    if (validated === null) {
      try {
        localStorage.setItem(key + '__corrupt_' + Date.now(), raw);
      } catch (_) {}
      try {
        localStorage.removeItem(key);
      } catch (_) {}
      console.warn('[storage] schema invalid, restored fallback:', key);
      return fallback;
    }
    return validated;
  } catch (e) {
    console.warn('[storage] parse failed', key, e);
    try {
      if (raw) localStorage.setItem(key + '__corrupt_' + Date.now(), raw);
    } catch (_) {}
    return fallback;
  }
}

// Epic 28h: 大型キー (racerDB / stadiumDB / pairwiseDB / motorStats / exhibitionStats) は
//   safeSet 内で IDB に直接ルーティングする。
//   従来は LS に書いた後、起動時 idbMigrateFromLS が「IDB に既存 → LS 重複」を毎回削除し
//   diag に `deduped=3` を残していた (~745KB を毎セッション再生成する loop)。
//   これらは idb_store.js の IDB_KEYS_LARGE と同期させること。
const _IDB_KEYS_LARGE_SET = {
  boatrace_racerDB: 1,
  boatrace_stadiumDB: 1,
  boatrace_pairwiseDB: 1,
  boatrace_motorStats: 1,
  boatrace_exhibitionStats: 1,
};

function safeSet(key, value) {
  // Epic 28h: 大型キーは IDB へ。IDB 未対応環境では下の LS 経路にフォールバック。
  if (_IDB_KEYS_LARGE_SET[key] && typeof globalThis.idbPut === 'function') {
    try {
      globalThis.idbPut(key, value);
    } catch (_) {}
    // 旧 LS コピーが残っていれば除去（migration とのレース防止 / 再起動後 deduped を発生させない）
    try {
      localStorage.removeItem(key);
    } catch (_) {}
    return true;
  }
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    localStorage.setItem(key, s);
    return true;
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      try {
        const hist = JSON.parse(localStorage.getItem('boatrace_history') || '[]');
        if (hist.length > 1000) {
          localStorage.setItem('boatrace_history', JSON.stringify(hist.slice(-1000)));
        }
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('bc_') === 0) keys.push(k);
        }
        keys.forEach(function (k) {
          try {
            localStorage.removeItem(k);
          } catch (_) {}
        });
        localStorage.setItem(key, s);
        // P1-Q6: history 削減で復旧したことを UI 監視可能に
        try {
          reportError({ type: 'warn', msg: 'storage quota recovered by history trim', key: key });
        } catch (_) {}
        return true;
      } catch (_) {}
    }
    console.warn('[storage] set failed', key, e);
    // P1-Q6: 呼出側が戻り値を見落としても reportError 経由で UI に到達する
    try {
      reportError({ type: 'error', msg: 'storage set failed: ' + ((e && e.message) || 'unknown'), key: key });
    } catch (_) {}
    return false;
  }
}

function reportError(payload) {
  try {
    const raw = localStorage.getItem('boatrace_errors');
    let buf = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) buf = parsed;
      } catch (_) {}
    }
    const entry = { ts: Date.now(), iso: new Date().toISOString() };
    for (const k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) entry[k] = payload[k];
    }
    buf.push(entry);
    if (buf.length > ERROR_BUF_MAX) buf = buf.slice(-ERROR_BUF_MAX);
    try {
      localStorage.setItem('boatrace_errors', JSON.stringify(buf));
    } catch (_) {}
  } catch (_) {
    /* reporter 自身の失敗は無視（無限ループ防止） */
  }
}

// P0-6: スキーマバージョン管理 + マイグレーション
//   旧端末で localStorage が古いスキーマのまま放置されると新コードが silent fail する。
//   起動時に boot から `_runMigrations()` を呼び、CURRENT_SCHEMA まで段階適用する。
//   各 migration は idempotent（多重実行しても無害）に書くこと。
const SCHEMA_KEY = 'boatrace_schema_version';
const CURRENT_SCHEMA = 3;
const MIGRATIONS = {
  // v1→v2: P0-3 で追加した kpiMode のデフォルト値を settings に流し込む
  2: function () {
    try {
      const raw = localStorage.getItem('boatrace_settings');
      const s = raw ? JSON.parse(raw) : {};
      if (s && typeof s === 'object' && s.kpiMode == null) {
        s.kpiMode = 'balanced';
        localStorage.setItem('boatrace_settings', JSON.stringify(s));
      }
    } catch (_) {
      /* migration 失敗は致命にしない、次回再試行 */
    }
  },
  // v2→v3 (2026-05-24): FEATURE_DIM 12 → 24 拡張に伴う localStorage 移行
  //   - boatrace_weights: 12 要素 → 24 要素 (新 12 weights = 0 init)
  //   - boatrace_featurestats: mean[12] / m2[12] → mean[24] / m2[24]
  //     mean は 0 padding、m2 は **1.0 padding** (z-score の divide by zero 防止 —
  //     学習が進むまで identity transform 同等に動作)
  //   既存 weights/stats が壊れない後方互換が最重要 (致命: R1/R2 リスク回避)
  3: function () {
    // weights migration
    try {
      const wRaw = localStorage.getItem('boatrace_weights');
      if (wRaw) {
        const w = JSON.parse(wRaw);
        if (Array.isArray(w) && w.length === 12) {
          const newW = w.slice();
          for (let i = 0; i < 12; i++) newW.push(0);
          localStorage.setItem('boatrace_weights', JSON.stringify(newW));
        }
      }
    } catch (_) {}
    // featurestats migration
    try {
      const fRaw = localStorage.getItem('boatrace_featurestats');
      if (fRaw) {
        const f = JSON.parse(fRaw);
        if (f && Array.isArray(f.mean) && f.mean.length === 12
                && Array.isArray(f.m2) && f.m2.length === 12) {
          const newMean = f.mean.slice();
          const newM2 = f.m2.slice();
          for (let i = 0; i < 12; i++) {
            newMean.push(0);
            newM2.push(1); // ← variance=1 for safe z-score (divide by zero 防止)
          }
          // n は保持 (旧 warmup 完了状態を維持)
          localStorage.setItem('boatrace_featurestats', JSON.stringify({
            mean: newMean, m2: newM2, n: f.n,
          }));
        }
      }
    } catch (_) {}
  },
};
function _runMigrations() {
  let cur = 1;
  try {
    const raw = localStorage.getItem(SCHEMA_KEY);
    const v = raw ? parseInt(raw, 10) : 1;
    if (Number.isFinite(v) && v >= 1 && v <= 1000) cur = v;
  } catch (_) {}
  if (cur >= CURRENT_SCHEMA) return;
  for (let v = cur + 1; v <= CURRENT_SCHEMA; v++) {
    const fn = MIGRATIONS[v];
    if (typeof fn === 'function') {
      try {
        fn();
      } catch (e) {
        console.warn('[migrate] v' + v + ' failed', e);
      }
    }
    try {
      localStorage.setItem(SCHEMA_KEY, String(v));
    } catch (_) {}
  }
}

// グローバルへ export（index.html の他のインライン JS / onclick handler が参照可能）
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

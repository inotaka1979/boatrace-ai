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

const FEATURE_DIM = 12;
const ERROR_BUF_MAX = 100;

// P1-C3: localStorage キー正規一覧（参照用カタログ）
//   既存 literal 散在は段階移行。新規コードはこの定数経由で参照すること。
//   schema migration / 容量監視 / cleanup スクリプトのターゲットとしても利用。
const STORAGE_KEYS = Object.freeze({
  SCHEMA_VERSION:   'boatrace_schema_version', // P0-6: 互換性管理
  SETTINGS:         'boatrace_settings',
  RACER_DB:         'boatrace_racerDB',
  STADIUM_DB:       'boatrace_stadiumDB',
  MOTOR_STATS:      'boatrace_motorStats',
  EXHIBITION_STATS: 'boatrace_exhibitionStats',
  PAIRWISE_DB:      'boatrace_pairwiseDB',
  WEIGHTS:          'boatrace_weights',        // PB-1: L2 学習重み
  LEARNED:          'boatrace_learned',        // PB-1: 学習ガード
  TRAINSTEP:        'boatrace_trainstep',      // PB-2: LR decay 用
  FEATURE_STATS:    'boatrace_featurestats',   // PB-7: rolling stats
  PLATT:            'boatrace_platt',          // PB-6: Platt 校正
  HISTORY:          'boatrace_history',
  ERRORS:           'boatrace_errors',         // PC-6: エラーログ
  DIAG:             'boatrace_diag',           // PI 診断オーバーレイ
  NAV:              'boatrace_nav',            // P0-5: PWA 状態復元（sessionStorage 側）
});

// L2_INIT_WEIGHTS は index.html の constants 部で定義済（global）。
// _validateLS が weights schema 検証で参照する。
function _validateLS(key, value) {
  if (value === null || value === undefined) return null;
  switch (key) {
    case 'boatrace_settings':
      return (typeof value === 'object' && !Array.isArray(value)) ? value : null;
    case 'boatrace_racerDB':
    case 'boatrace_stadiumDB':
    case 'boatrace_motorStats':
    case 'boatrace_exhibitionStats':
    case 'boatrace_pairwiseDB':
      if (typeof value !== 'object' || Array.isArray(value)) return null;
      if (Object.keys(value).length > 10000) return null;
      return value;
    case 'boatrace_weights':
      if (!Array.isArray(value)) return null;
      // L2_INIT_WEIGHTS は global from index.html
      const expectedLen = (typeof L2_INIT_WEIGHTS !== 'undefined') ? L2_INIT_WEIGHTS.length : 12;
      if (value.length !== expectedLen) return null;
      for (let i = 0; i < value.length; i++) {
        if (!Number.isFinite(value[i]) || Math.abs(value[i]) > 1000) return null;
      }
      return value;
    case 'boatrace_history':
      if (!Array.isArray(value)) return null;
      return (value.length > 50000) ? value.slice(-1000) : value;
    case 'boatrace_learned':
      if (typeof value !== 'object' || Array.isArray(value)) return null;
      if (Object.keys(value).length > 50000) return null;
      return value;
    case 'boatrace_trainstep':
      return (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e10) ? value : null;
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
      try { localStorage.setItem(key + '__corrupt_' + Date.now(), raw); } catch (_) {}
      try { localStorage.removeItem(key); } catch (_) {}
      console.warn('[boot] schema invalid, restored fallback:', key);
      return fallback;
    }
    return (validated !== null) ? validated : fallback;
  } catch (e) {
    console.warn('[boot] parse failed', key, e);
    try { if (raw) localStorage.setItem(key + '__corrupt_' + Date.now(), raw); } catch (_) {}
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
      try { localStorage.setItem(key + '__corrupt_' + Date.now(), raw); } catch (_) {}
      try { localStorage.removeItem(key); } catch (_) {}
      console.warn('[storage] schema invalid, restored fallback:', key);
      return fallback;
    }
    return validated;
  } catch (e) {
    console.warn('[storage] parse failed', key, e);
    try { if (raw) localStorage.setItem(key + '__corrupt_' + Date.now(), raw); } catch (_) {}
    return fallback;
  }
}

function safeSet(key, value) {
  const s = (typeof value === 'string') ? value : JSON.stringify(value);
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
        keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
        localStorage.setItem(key, s);
        // P1-Q6: history 削減で復旧したことを UI 監視可能に
        try { reportError({ type:'warn', msg:'storage quota recovered by history trim', key:key }); } catch(_){}
        return true;
      } catch (_) {}
    }
    console.warn('[storage] set failed', key, e);
    // P1-Q6: 呼出側が戻り値を見落としても reportError 経由で UI に到達する
    try { reportError({ type:'error', msg:'storage set failed: '+(e&&e.message||'unknown'), key:key }); } catch(_){}
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
    for (const k in payload) { if (Object.prototype.hasOwnProperty.call(payload, k)) entry[k] = payload[k]; }
    buf.push(entry);
    if (buf.length > ERROR_BUF_MAX) buf = buf.slice(-ERROR_BUF_MAX);
    try { localStorage.setItem('boatrace_errors', JSON.stringify(buf)); } catch (_) {}
  } catch (_) { /* reporter 自身の失敗は無視（無限ループ防止） */ }
}

// P0-6: スキーマバージョン管理 + マイグレーション
//   旧端末で localStorage が古いスキーマのまま放置されると新コードが silent fail する。
//   起動時に boot から `_runMigrations()` を呼び、CURRENT_SCHEMA まで段階適用する。
//   各 migration は idempotent（多重実行しても無害）に書くこと。
const SCHEMA_KEY = 'boatrace_schema_version';
const CURRENT_SCHEMA = 2;
const MIGRATIONS = {
  // v1→v2: P0-3 で追加した kpiMode のデフォルト値を settings に流し込む
  2: function(){
    try {
      const raw = localStorage.getItem('boatrace_settings');
      const s = raw ? JSON.parse(raw) : {};
      if(s && typeof s === 'object' && s.kpiMode == null){
        s.kpiMode = 'balanced';
        localStorage.setItem('boatrace_settings', JSON.stringify(s));
      }
    } catch(_){ /* migration 失敗は致命にしない、次回再試行 */ }
  }
};
function _runMigrations(){
  let cur = 1;
  try {
    const raw = localStorage.getItem(SCHEMA_KEY);
    const v = raw ? parseInt(raw, 10) : 1;
    if(Number.isFinite(v) && v >= 1 && v <= 1000) cur = v;
  } catch(_){}
  if(cur >= CURRENT_SCHEMA) return;
  for(let v = cur + 1; v <= CURRENT_SCHEMA; v++){
    const fn = MIGRATIONS[v];
    if(typeof fn === 'function'){
      try { fn(); } catch(e){ console.warn('[migrate] v'+v+' failed', e); }
    }
    try { localStorage.setItem(SCHEMA_KEY, String(v)); } catch(_){}
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

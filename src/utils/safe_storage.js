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
        return true;
      } catch (_) {}
    }
    console.warn('[storage] set failed', key, e);
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

// グローバルへ export（index.html の他のインライン JS / onclick handler が参照可能）
globalThis._validateLS = _validateLS;
globalThis._bootParseLS = _bootParseLS;
globalThis.safeParse = safeParse;
globalThis.safeSet = safeSet;
globalThis.reportError = reportError;
globalThis.ERROR_BUF_MAX = ERROR_BUF_MAX;

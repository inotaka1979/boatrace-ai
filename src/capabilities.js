// Phase 1 (Clearwing patterns): src/capabilities.js
//
// 散在していた feature detection (typeof X === 'undefined' / X in Y / try/catch)
// を一元集約し、`capabilities.has(name)` で一意に問い合わせ可能にする。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:CAPABILITIES:START */ ... /* BUILD:CAPABILITIES:END */
// マーカー領域に注入する。注入後、`globalThis.capabilities` が利用可能。
//
// 設計原則:
//   - sync 検出は起動時 1 回 (detectSync) で確定
//   - async 検出は probe(name) で on-demand、結果はキャッシュ
//   - polyfill (makeTimeoutSignal) は capability の延長として同居
//   - 副作用なし: モジュール読込時点で globalThis に capabilities を 1 個 export するだけ
//
// Phase 2 (4 層分離) では worker_predictor.js 側にも軽量版 capabilities を配置予定。

'use strict';

/**
 * 主スレッド用の capability registry。
 * 各 capability は文字列キーで識別され、同期検出 (detectSync) または非同期 probe
 * で boolean を返す。makeTimeoutSignal は AbortSignal.timeout polyfill としても機能。
 */
class Capabilities {
  constructor() {
    /** @type {Map<string, boolean>} */
    this._sync = new Map();
    /** @type {Map<string, boolean>} */
    this._async = new Map();
  }

  // ─────────────────────────────────────────────
  // 同期検出（起動時 1 回）
  // ─────────────────────────────────────────────
  detectSync() {
    // ─── ネットワーク / SW / ストレージ ───
    this._set('abort_timeout', typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function');
    this._set('service_worker', typeof navigator !== 'undefined' && 'serviceWorker' in navigator);
    this._set('indexed_db', typeof indexedDB !== 'undefined');
    this._set('cache_api', typeof caches !== 'undefined');
    this._set(
      'local_storage',
      (() => {
        try {
          if (typeof localStorage === 'undefined') return false;
          const k = '__br_cap_probe__';
          localStorage.setItem(k, '1');
          localStorage.removeItem(k);
          return true;
        } catch (_) {
          return false;
        }
      })()
    );

    // ─── スケジューリング ───
    this._set('scheduler_post_task', typeof scheduler !== 'undefined' && typeof scheduler.postTask === 'function');
    this._set('scheduler_yield', typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function');
    this._set('request_idle_callback', typeof requestIdleCallback === 'function');

    // ─── UI / API ───
    this._set('document', typeof document !== 'undefined' && typeof document.querySelectorAll === 'function');
    this._set('notification', typeof Notification !== 'undefined');
    this._set('chart', typeof Chart !== 'undefined'); // 動的 import 後は refresh('chart') で更新
    this._set('worker', typeof Worker !== 'undefined');

    // ─── 高度な機能 (cross-origin isolation) ───
    this._set(
      'shared_array_buffer',
      typeof window !== 'undefined' && window.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined'
    );
    this._set('cross_origin_isolated', typeof window !== 'undefined' && window.crossOriginIsolated === true);

    // ─── オフライン状態 (動的) ───
    this._set('online', this._detectOnline());

    // online 状態は変化するため listener も attach
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      try {
        window.addEventListener('online', () => this._set('online', true));
        window.addEventListener('offline', () => this._set('online', false));
      } catch (_) {
        /* SSR / worker context */
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
    if (typeof navigator === 'undefined') return true;
    if (typeof navigator.onLine !== 'boolean') return true;
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
    if (name === 'chart') this._set('chart', typeof Chart !== 'undefined');
    else if (name === 'online') this._set('online', this._detectOnline());
    else this.detectSync(); // 全体再走査
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
      if (name === 'openapi_fresh') result = await this._probeOpenapiFresh(opts);
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
    if (typeof fetch !== 'function') return false;
    const url = (opts && opts.url) || 'https://boatraceopenapi.github.io/programs/v2/today.json';
    const ttlMs = (opts && opts.ttlMs) || 30 * 60 * 1000;
    const r = await fetch(url, {
      method: 'HEAD',
      signal: this.makeTimeoutSignal(3000),
      cache: 'no-store',
    });
    if (!r.ok) return false;
    const lm = r.headers.get('last-modified');
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
    if (this.has('abort_timeout')) {
      return AbortSignal.timeout(ms);
    }
    const c = new AbortController();
    const ctxScheduler = typeof setTimeout === 'function' ? setTimeout : null;
    if (ctxScheduler)
      ctxScheduler(() => {
        try {
          c.abort();
        } catch (_) {}
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
    const _gAny = /** @type {any} */ (globalThis);
    if (this.has('scheduler_post_task')) {
      return _gAny.scheduler.postTask(fn, { priority: 'background', ...(opts || {}) });
    }
    if (this.has('request_idle_callback')) {
      return _gAny.requestIdleCallback(fn, { timeout: (opts && opts.timeout) || 3000 });
    }
    return setTimeout(fn, (opts && opts.delay) || 0);
  }
}

const capabilities = new Capabilities();
capabilities.detectSync();

// 公開: 既存の inline コードからは globalThis.capabilities 経由で参照
// JSDoc 型キャストで BoatRaceGlobalAPI (src/types/globals.d.ts) と整合
/** @type {BoatRaceGlobalAPI & typeof globalThis} */
const _g = /** @type {any} */ (globalThis);
_g.capabilities = capabilities;
// class 自体 (`Capabilities`) は debug 用に保持。型に含めず any 経由で export。
/** @type {any} */ (_g).Capabilities = Capabilities;

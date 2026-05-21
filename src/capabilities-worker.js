// Phase 2 (Clearwing patterns): src/capabilities-worker.js
//
// Web Worker (DedicatedWorkerGlobalScope) コンテキスト用の capabilities。
// main thread 用 src/capabilities.js とは別 bundle として注入される。
//
// 理由:
//   - Worker は main の globalThis とメモリ空間を共有しない
//   - Worker は window / document / Notification / Chart 不在
//   - importScripts 経由で worker_predictor.js が読み込まれた後、capabilities が
//     必要なので bundle order と marker 位置で順序保証する
//
// build/build.mjs が IIFE bundle して assets/worker_predictor.js の
//   /* BUILD:CAPABILITIES_WORKER:START */ ... /* BUILD:CAPABILITIES_WORKER:END */
// に注入する。
//
// API 互換性:
//   main 用 src/capabilities.js と同じインタフェース（has / refresh / probe / makeTimeoutSignal / runIdle / list）
//   だが DOM 系 capability は省略。

'use strict';

class WorkerCapabilities {
  constructor() {
    this._sync = new Map();
    this._async = new Map();
  }

  detectSync() {
    this._set('abort_timeout', typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function');
    this._set('fetch', typeof fetch === 'function');
    this._set('indexed_db', typeof indexedDB !== 'undefined');
    this._set('cache_api', typeof caches !== 'undefined');
    // Dedicated/Shared Worker は仕様上 localStorage を持たない（同期 API は Worker で禁止）。
    // worker_predictor.js の旧 localStorage.setItem は try/catch で握り潰される dead code。
    // 互換性のため capability キー自体は残しつつ常に false を返す。
    this._set('local_storage', false);

    // Worker でも scheduler API は利用可能 (Chrome 94+)
    this._set('scheduler_post_task', typeof scheduler !== 'undefined' && typeof scheduler.postTask === 'function');
    this._set('scheduler_yield', typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function');

    // Nested Worker は仕様上 Dedicated Worker でのみ可能
    this._set('worker', typeof Worker !== 'undefined');
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
    if (this.has('abort_timeout')) {
      return AbortSignal.timeout(ms);
    }
    const c = new AbortController();
    setTimeout(() => {
      try {
        c.abort();
      } catch (_) {}
    }, ms);
    return c.signal;
  }

  runIdle(fn, opts) {
    if (this.has('scheduler_post_task')) {
      return scheduler.postTask(fn, { priority: 'background', ...(opts || {}) });
    }
    return setTimeout(fn, (opts && opts.delay) || 0);
  }
}

const capabilities = new WorkerCapabilities();
capabilities.detectSync();

// Worker global は self / globalThis のどちらでも届く
globalThis.capabilities = capabilities;
globalThis.WorkerCapabilities = WorkerCapabilities;

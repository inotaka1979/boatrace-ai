/**
 * 共通 vm ハーネス: assets/app.js を sandbox に読み込み、top-level 関数を
 * ctx.<name> として公開したコンテキストを返す。
 *
 * 各テストで localStorage / document / MessageChannel 等のスタブを重複定義
 * していたのを一本化する（PR-1 / PR-2）。予測パス (predictRace 等) を実データ
 * 形状で叩くテストはこのハーネスを使う。
 *
 *   const { makeCtx } = require('./_vm_harness');
 *   const ctx = makeCtx();
 *   ctx.programData = ...; const bets = ctx.predictRace(7, 3);
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_CODE = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

function makeCtx() {
  const localStore = {};
  const stub = {
    console, Date, Math, Number, Array, Object, JSON, String, Boolean,
    Map, Set, WeakMap, WeakSet, Promise, Error, TypeError, RangeError,
    setTimeout, setInterval, clearInterval, clearTimeout,
    parseInt, parseFloat, isNaN, isFinite,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    MessageChannel: class {
      constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => {} }; }
    },
    fetch: () => Promise.reject(new Error('no network in vm harness')),
    localStorage: {
      getItem: (k) => (k in localStore ? localStore[k] : null),
      setItem: (k, v) => { localStore[k] = String(v); },
      removeItem: (k) => { delete localStore[k]; },
      key: (i) => Object.keys(localStore)[i] || null,
      get length() { return Object.keys(localStore).length; },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    document: {
      getElementById: () => ({ innerHTML: '', addEventListener: () => {}, value: '', style: {}, textContent: '' }),
      createElement: () => ({ textContent: '', innerHTML: '', addEventListener: () => {}, style: {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      head: { appendChild: () => {} },
    },
    navigator: { onLine: true, serviceWorker: undefined },
    location: { hostname: 'test', search: '', pathname: '/', hash: '', reload: () => {}, replace: () => {} },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    alert: () => {}, confirm: () => true, prompt: () => '',
    caches: undefined, indexedDB: undefined, scheduler: undefined,
    requestIdleCallback: undefined, Notification: undefined, Chart: undefined, Worker: undefined,
    SharedArrayBuffer: undefined,
  };
  stub.globalThis = stub;
  stub.self = stub;
  const ctx = vm.createContext(stub);
  try {
    vm.runInContext(APP_CODE, ctx, { timeout: 8000 });
  } catch (_) {
    // 起動時 loadAllData 等が fetch reject / 未定義 browser API で例外になるが、
    // 関数定義は同期的に完了済み。予測パスの呼び出しには影響しない。
  }
  return ctx;
}

module.exports = { makeCtx };

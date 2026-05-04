/**
 * P3 共通ヘルパのユニットテスト (Node.js 標準 assert で実行)
 *
 *   node scripts/tests/test_predictor_helpers.js
 *
 * テスト対象は index.html 内の <script> ブロックから抽出した関数:
 *   softmax / safeDiv / safeParse / safeSet / jstYmd
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 1) index.html から <script> を抽出
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = scripts.join('\n');

// 2) ブラウザ依存 API (window/document/localStorage) を最低限スタブ
const localStore = {};
const stub = {
  console,
  Date,
  Math,
  Number,
  Array,
  Object,
  JSON,
  setTimeout,
  setInterval,
  clearInterval,
  clearTimeout,
  Promise,
  fetch: () => Promise.reject(new Error('no network in test')),
  localStorage: {
    getItem: (k) => (k in localStore ? localStore[k] : null),
    setItem: (k, v) => { localStore[k] = String(v); },
    removeItem: (k) => { delete localStore[k]; },
    key: (i) => Object.keys(localStore)[i] || null,
    get length() { return Object.keys(localStore).length; },
  },
  window: { addEventListener: () => {} },
  document: {
    getElementById: () => ({ innerHTML: '', addEventListener: () => {}, value: '' }),
    createElement: () => ({ textContent: '', innerHTML: '' }),
    addEventListener: () => {},
  },
  navigator: { serviceWorker: undefined },
  location: { hostname: 'test', reload: () => {} },
  AbortController: class { constructor(){ this.signal={}; } abort(){} },
  alert: () => {},
  confirm: () => true,
};
stub.globalThis = stub;
stub.self = stub;

// 3) 実行（top-level の loadAllData() などは fetch でこけて catch される）
//    関数定義を取り出すため runInNewContext
const ctx = vm.createContext(stub);
try {
  vm.runInContext(code, ctx, { timeout: 5000 });
} catch (e) {
  // 起動時の loadAllData は fetch reject で例外になりうるが、関数定義は完了している
  if (!/no network|fetch/i.test(String(e))) console.warn('[setup] non-fatal:', e.message);
}

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); console.log('  PASS:', name); pass++; }
  catch(e){ console.log('  FAIL:', name, '\n   ', e.message); fail++; }
}

console.log('[softmax]');
t('basic equal logits → uniform', () => {
  const r = ctx.softmax([1,1,1,1,1,1]);
  assert.strictEqual(r.length, 6);
  r.forEach(p => assert.ok(Math.abs(p - 1/6) < 1e-9));
});
t('large logits do not overflow', () => {
  const r = ctx.softmax([1000, 1000, 1000]);
  r.forEach(p => assert.ok(Math.abs(p - 1/3) < 1e-9));
});
t('NaN element treated as 0', () => {
  const r = ctx.softmax([NaN, NaN, NaN]);
  r.forEach(p => assert.ok(Math.abs(p - 1/3) < 1e-9));
});
t('mixed Infinity', () => {
  const r = ctx.softmax([Infinity, 0, 0]);
  // Infinity は finite==false で 0 扱い → 一様分布
  assert.ok(r.every(p => p > 0 && p <= 1));
  const sum = r.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});
t('empty array', () => {
  const r = ctx.softmax([]);
  assert.strictEqual(r.length, 0);
});

console.log('[safeDiv]');
t('basic', () => assert.strictEqual(ctx.safeDiv(10, 2), 5));
t('div by zero → fallback', () => assert.strictEqual(ctx.safeDiv(10, 0, 999), 999));
t('div by zero default 0', () => assert.strictEqual(ctx.safeDiv(10, 0), 0));
t('NaN num → fallback', () => assert.strictEqual(ctx.safeDiv(NaN, 2, 7), 7));

console.log('[safeParse]');
t('missing key returns fallback', () => {
  const r = ctx.safeParse('nope', {a:1});
  assert.strictEqual(r.a, 1);
});
t('valid JSON', () => {
  ctx.localStorage.setItem('k', '{"x":42}');
  const r = ctx.safeParse('k', null);
  assert.strictEqual(r.x, 42);
});
t('corrupt JSON returns fallback and quarantines', () => {
  ctx.localStorage.setItem('bad', '{ not valid');
  const r = ctx.safeParse('bad', {ok:true});
  assert.strictEqual(r.ok, true);
  const keys = Object.keys(localStore);
  assert.ok(keys.some(k => k.startsWith('bad__corrupt_')));
});

console.log('[safeSet]');
t('basic write', () => {
  ctx.safeSet('w', {n:1});
  assert.deepStrictEqual(JSON.parse(ctx.localStorage.getItem('w')), {n:1});
});

console.log('[jstYmd]');
t('format YYYYMMDD 8 digits', () => {
  const s = ctx.jstYmd(0);
  assert.match(s, /^\d{8}$/);
});
t('offset days', () => {
  const today = ctx.jstYmd(0);
  const yest = ctx.jstYmd(-1);
  assert.notStrictEqual(today, yest);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

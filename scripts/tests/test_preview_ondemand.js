/**
 * 2026-06-30: 直前情報(展示情報テーブル)オンデマンド補完の回帰テスト。
 *   bulk /api/previews が朝の一斉展示で全場を覆えず、一部の場の「展示情報」が
 *   丸ごと出ない。Worker /beforeinfo-proxy で 1 レース単位に補完する。
 *   _isPreviewIncomplete / _sweepMissingPreviews(展示窓・締切近い順・上限) を固定。
 *
 *   node scripts/tests/test_preview_ondemand.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

const localStore = {};
const stub = {
  console, Date, Math, Number, Array, Object, JSON, Set,
  setTimeout, setInterval, clearInterval, clearTimeout, Promise,
  parseInt, parseFloat, isNaN, String, Boolean, RegExp,
  fetch: () => Promise.reject(new Error('no network')),
  localStorage: {
    getItem: (k) => (k in localStore ? localStore[k] : null),
    setItem: (k, v) => { localStore[k] = String(v); },
    removeItem: (k) => { delete localStore[k]; },
    key: (i) => Object.keys(localStore)[i] || null,
    get length() { return Object.keys(localStore).length; },
  },
  window: { addEventListener: () => {} },
  document: {
    getElementById: () => ({ innerHTML: '', addEventListener: () => {}, value: '', classList: { contains: () => false } }),
    createElement: () => ({ textContent: '', innerHTML: '' }),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {},
  },
  navigator: { serviceWorker: undefined },
  location: { hostname: 'test', reload: () => {} },
  AbortController: class { constructor(){ this.signal={}; } abort(){} },
  alert: () => {}, confirm: () => true,
};
stub.globalThis = stub; stub.self = stub;

const ctx = vm.createContext(stub);
try { vm.runInContext(code, ctx, { timeout: 5000 }); } catch(_) {}

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); console.log('  PASS:', name); pass++; }
  catch(e){ console.log('  FAIL:', name, '\n   ', e.message); fail++; }
}

// JST で「締切まで N 分」の race_closed_at 文字列。N>0=未来(締切前)、N<0=過去。
function closeInMin(min){
  const jst = new Date(Date.now() + 9 * 3600000 + min * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return jst.getUTCFullYear() + '-' + p(jst.getUTCMonth() + 1) + '-' + p(jst.getUTCDate()) +
    ' ' + p(jst.getUTCHours()) + ':' + p(jst.getUTCMinutes()) + ':' + p(jst.getUTCSeconds());
}

console.log('[_isPreviewIncomplete]');

t('null は未完(補完対象)', () => {
  assert.strictEqual(ctx._isPreviewIncomplete(null), true);
});
t('boats なしは未完', () => {
  assert.strictEqual(ctx._isPreviewIncomplete({ race_number: 1 }), true);
});
t('展示タイムが1つも無ければ未完', () => {
  assert.strictEqual(ctx._isPreviewIncomplete({ boats: { 1: { racer_exhibition_time: 0 }, 2: {} } }), true);
});
t('1艇でも展示タイムがあれば完了', () => {
  assert.strictEqual(ctx._isPreviewIncomplete({ boats: { 1: { racer_exhibition_time: 6.78 } } }), false);
});

console.log('[_sweepMissingPreviews]');

t('展示窓内で展示情報が欠けるレースを締切が近い順・上限件数だけ補完', () => {
  const calls = [];
  ctx._loadPreviewLive = (sid, rno) => { calls.push([sid, rno]); };
  ctx._pvLiveTried = {};
  // R1: 締切まで5分(窓内) / R2: 締切まで30分(窓内) / R3: 締切まで90分(窓外=まだ展示前)
  ctx.programData = { 10: {
    1: { race_closed_at: closeInMin(5) },
    2: { race_closed_at: closeInMin(30) },
    3: { race_closed_at: closeInMin(90) },
  }};
  ctx.previewData = {};
  ctx._sweepMissingPreviews(1);
  assert.strictEqual(calls.length, 1, '上限 1 件');
  assert.deepStrictEqual(calls[0], [10, 1], '締切が近い R1 が先');
});

t('既に展示があるレースは対象外', () => {
  const calls = [];
  ctx._loadPreviewLive = (sid, rno) => { calls.push([sid, rno]); };
  ctx._pvLiveTried = {};
  ctx.programData = { 23: { 1: { race_closed_at: closeInMin(10) } } };
  ctx.previewData = { 23: { 1: { boats: { 1: { racer_exhibition_time: 6.9 } } } } };
  ctx._sweepMissingPreviews(6);
  assert.strictEqual(calls.length, 0);
});

t('展示窓を過ぎた(締切+30分)レースは対象外', () => {
  const calls = [];
  ctx._loadPreviewLive = (sid, rno) => { calls.push([sid, rno]); };
  ctx._pvLiveTried = {};
  ctx.programData = { 16: { 1: { race_closed_at: closeInMin(-30) } } };
  ctx.previewData = {};
  ctx._sweepMissingPreviews(6);
  assert.strictEqual(calls.length, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

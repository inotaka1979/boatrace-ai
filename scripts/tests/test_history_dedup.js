/**
 * 2026-06-29: boatrace_history 重複登録バグ (savePrediction の型不一致 dedup) の回帰テスト。
 *   _backfillTodayPredictions は for-in キー(=文字列)で、openStadium は数値で
 *   savePrediction を呼ぶため、同一レースが二重登録され「本日 場別」の R 数が
 *   12 を超えていた。_dedupHistory が (date,stadium,race) を数値正規化して畳み込む。
 *
 *   node scripts/tests/test_history_dedup.js
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
  parseInt, parseFloat, isNaN, String, Boolean,
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
    getElementById: () => ({ innerHTML: '', addEventListener: () => {}, value: '' }),
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

function setHist(arr){ localStore['boatrace_history'] = JSON.stringify(arr); }
function getHist(){ return JSON.parse(localStore['boatrace_history'] || '[]'); }

console.log('[_dedupHistory]');

t('型不一致 (string vs number stadium) の重複を畳み込む', () => {
  setHist([
    { date: '20260629', stadium: '21', race: '1', actual: [1,2,3], trifecta_hit: true, payout3: 1200 },
    { date: '20260629', stadium: 21,  race: 1,   actual: [1,2,3], trifecta_hit: true, payout3: 1200 },
  ]);
  ctx._dedupHistory();
  const h = getHist();
  assert.strictEqual(h.length, 1, '重複が 1 件に畳まれる');
  assert.strictEqual(h[0].stadium, 21, 'stadium が number に正規化');
  assert.strictEqual(h[0].race, 1, 'race が number に正規化');
});

t('actual あり > actual なし を優先して残す', () => {
  setHist([
    { date: '20260629', stadium: 1, race: 5, actual: null },
    { date: '20260629', stadium: '1', race: '5', actual: [3,1,2], trifecta_hit: true, payout3: 5000 },
  ]);
  ctx._dedupHistory();
  const h = getHist();
  assert.strictEqual(h.length, 1);
  assert.ok(h[0].actual && h[0].actual.length === 3, 'actual ありが残る');
  assert.strictEqual(h[0].payout3, 5000);
});

t('両方 actual なら払戻が多い方を残す', () => {
  setHist([
    { date: '20260629', stadium: 12, race: 3, actual: [1,2,3], trifecta_hit: true, payout3: 800, payout2: 0 },
    { date: '20260629', stadium: '12', race: '3', actual: [1,2,3], trifecta_hit: true, payout3: 0, payout2: 0 },
  ]);
  ctx._dedupHistory();
  const h = getHist();
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].payout3, 800, '払戻が多い方を残す');
});

t('別レースは畳まない (date/stadium/race が違えば別物)', () => {
  setHist([
    { date: '20260629', stadium: 1, race: 1, actual: [1,2,3] },
    { date: '20260629', stadium: 1, race: 2, actual: [1,2,3] },
    { date: '20260628', stadium: 1, race: 1, actual: [1,2,3] },
  ]);
  ctx._dedupHistory();
  assert.strictEqual(getHist().length, 3);
});

t('重複なしなら順序を保ったまま据え置き', () => {
  const orig = [
    { date: '20260629', stadium: 5, race: 1, actual: [1,2,3] },
    { date: '20260629', stadium: 6, race: 1, actual: [4,5,6] },
  ];
  setHist(orig);
  ctx._dedupHistory();
  const h = getHist();
  assert.strictEqual(h.length, 2);
  assert.strictEqual(h[0].stadium, 5);
  assert.strictEqual(h[1].stadium, 6);
});

t('12R 上限: 24 件 (各 R 二重) → 12 件', () => {
  const arr = [];
  for (let r = 1; r <= 12; r++) {
    arr.push({ date: '20260629', stadium: '21', race: String(r), actual: [1,2,3], trifecta_hit: true, payout3: 1000 });
    arr.push({ date: '20260629', stadium: 21,  race: r,         actual: [1,2,3], trifecta_hit: true, payout3: 1000 });
  }
  setHist(arr);
  ctx._dedupHistory();
  const h = getHist().filter((x) => x.stadium === 21 && x.date === '20260629');
  assert.strictEqual(h.length, 12, '芦屋 24 → 12 に正規化');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

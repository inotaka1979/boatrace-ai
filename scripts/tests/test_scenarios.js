/**
 * X5: 局面別予測（シナリオ展開モデル / グレード別補正）テスト
 *
 *   node scripts/tests/test_scenarios.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');
// PE-5: assets/app.js は JS 直接、wrapper 不要
const code = HTML;

const localStore = {};
const stub = {
  console, Date, Math, Number, Array, Object, JSON, Set,
  setTimeout, setInterval, clearInterval, clearTimeout, Promise,
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
try { vm.runInContext(code, ctx, { timeout: 5000 }); } catch(e) {}

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); console.log('  PASS:', name); pass++; }
  catch(e){ console.log('  FAIL:', name, '\n   ', e.message); fail++; }
}

console.log('[predictScenarios]');
t('一般戦の確率合計 = 1', () => {
  const r = ctx.predictScenarios([], null, null, 1, 0);
  let sum = 0;
  for(const k in r) sum += r[k];
  assert.ok(Math.abs(sum - 1.0) < 0.001);
});

t('女子戦は逃げ確率が一般より高い', () => {
  const general = ctx.predictScenarios([], null, null, 1, 0);
  const ladies  = ctx.predictScenarios([], null, null, 1, 5);
  assert.ok(ladies.nige > general.nige);
});

t('SG は逃げ崩れ多い (一般より逃げ率低)', () => {
  const general = ctx.predictScenarios([], null, null, 1, 0);
  const sg      = ctx.predictScenarios([], null, null, 1, 4);
  assert.ok(sg.nige < general.nige);
});

t('荒天で逃げ率が下がる', () => {
  const calm = ctx.predictScenarios([], null, {wind_speed:0, wave_height:0}, 1, 0);
  const stormy = ctx.predictScenarios([], null, {wind_speed:8, wave_height:10}, 1, 0);
  assert.ok(stormy.nige < calm.nige);
  assert.ok(stormy.makuri > calm.makuri);
});

console.log('[predictWithScenarios]');
t('120 通り全網羅で確率合計 = 1', () => {
  const r = ctx.predictWithScenarios([], null, null, 1, 0);
  let sum = 0;
  for(const k in r.dist) sum += r.dist[k];
  assert.ok(Math.abs(sum - 1.0) < 0.01);
  // 120 通り（自己重複を除く）
  assert.strictEqual(Object.keys(r.dist).length, 120);
});

t('1-2-3 が最頻 (一般戦)', () => {
  const r = ctx.predictWithScenarios([], null, null, 1, 0);
  let maxKey = null, maxVal = 0;
  for(const k in r.dist){ if(r.dist[k] > maxVal){ maxVal = r.dist[k]; maxKey = k; } }
  assert.strictEqual(maxKey, '1-2-3');
});

t('女子戦では 1-始まりがより多い', () => {
  const general = ctx.predictWithScenarios([], null, null, 1, 0);
  const ladies = ctx.predictWithScenarios([], null, null, 1, 5);
  let g = 0, l = 0;
  for(const k in general.dist){ if(k.startsWith('1-')) g += general.dist[k]; }
  for(const k in ladies.dist){ if(k.startsWith('1-')) l += ladies.dist[k]; }
  assert.ok(l > g);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

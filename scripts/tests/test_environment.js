/**
 * X4: 環境データ（潮汐 / 場別風向 / 風波交差項）テスト
 *
 *   node scripts/tests/test_environment.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = scripts.join('\n');

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

console.log('[isHeadWind / isTailWind]');
t('戸田 (sid=2): 北東風 dir=4 が向かい風', () => {
  assert.strictEqual(ctx.isHeadWind(4, 2), true);
});
t('戸田 (sid=2): dir=12 は追い風', () => {
  assert.strictEqual(ctx.isTailWind(12, 2), true);
});
t('未登録場 (sid=99): GLOBAL_HEAD_DIRS にフォールバック', () => {
  assert.strictEqual(ctx.isHeadWind(8, 99), true);   // 8 は GLOBAL に含まれる
});

console.log('[stormBonus]');
t('風 5m + 波 5cm + 1コース = -8', () => {
  assert.strictEqual(ctx.stormBonus(5, 5, 1), -8);
});
t('風 5m + 波 5cm + 5コース = +4 (有利)', () => {
  assert.strictEqual(ctx.stormBonus(5, 5, 5), 4);
});
t('風 2m + 波 2cm = 0', () => {
  assert.strictEqual(ctx.stormBonus(2, 2, 1), 0);
});

console.log('[classifyTidePhase]');
t('high tide 検出', () => {
  // 潮位最高がhour=12のとき
  const today = [];
  for(let h=0;h<24;h++) today.push({hour:h, level_cm: h===12 ? 200 : 50 + (h%5)*10});
  const r = ctx.classifyTidePhase({type:'saltwater', today}, 12);
  assert.strictEqual(r, 'high');
});
t('low tide 検出', () => {
  const today = [];
  for(let h=0;h<24;h++) today.push({hour:h, level_cm: h===6 ? -20 : 100 + (h%5)*10});
  const r = ctx.classifyTidePhase({type:'saltwater', today}, 6);
  assert.strictEqual(r, 'low');
});
t('freshwater は null', () => {
  assert.strictEqual(ctx.classifyTidePhase({type:'freshwater'}, 12), null);
});

console.log('[tideScore]');
t('saltwater 場で値が返る', () => {
  ctx.tideData = {
    stadiums: {
      '12': {
        type: 'saltwater',
        today: (function(){
          const a = []; for(let h=0;h<24;h++) a.push({hour:h, level_cm: h===6 ? -20 : 100});
          return a;
        })()
      }
    }
  };
  const s = ctx.tideScore(12, 1, 6);   // low tide → 1コース有利
  assert.strictEqual(s, 5);
});
t('freshwater 場は 0', () => {
  ctx.tideData = { stadiums: { '1': { type: 'freshwater' } } };
  assert.strictEqual(ctx.tideScore(1, 1, 12), 0);
});
t('tideData 無しは 0', () => {
  ctx.tideData = null;
  assert.strictEqual(ctx.tideScore(12, 1, 12), 0);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

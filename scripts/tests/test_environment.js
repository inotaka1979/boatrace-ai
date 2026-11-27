/**
 * X4: 環境データ（潮汐 / 場別風向 / 風波交差項）テスト
 *
 *   node scripts/tests/test_environment.js
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
try { vm.runInContext(code, ctx, { timeout: 5000 }); } catch(_) {}

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); console.log('  PASS:', name); pass++; }
  catch(e){ console.log('  FAIL:', name, '\n   ', e.message); fail++; }
}

console.log('[isHeadWind / isTailWind]');
// 2026-11-27: 風向の番号は公式ページのコース図の上の矢印（1 = 上向きから時計回り、17 = 無風）。
//   右向き (5) が追い風、左向き (13) が向かい風。方位ではないので、場による違いは無い。
t('左向きの矢印 (11〜15) が向かい風、右向き (3〜7) が追い風', () => {
  for (let n = 0; n <= 18; n++) {
    assert.strictEqual(ctx.isHeadWind(n), n >= 11 && n <= 15, 'isHeadWind(' + n + ')');
    assert.strictEqual(ctx.isTailWind(n), n >= 3 && n <= 7, 'isTailWind(' + n + ')');
  }
});
t('横風 (16, 1, 2 / 8, 9, 10)・無風 (17)・不明 (0) はどちらでもない', () => {
  for (const n of [16, 1, 2, 8, 9, 10, 17, 0, undefined, null, '13']) {
    assert.strictEqual(ctx.isHeadWind(n), false, 'isHeadWind(' + n + ')');
    assert.strictEqual(ctx.isTailWind(n), false, 'isTailWind(' + n + ')');
  }
});
t('場によって変わらない（従来は 7 場だけ別の表で、同じ番号が場によって追い風にも向かい風にもなった）', () => {
  for (const sid of [1, 2, 3, 4, 12, 14, 19, 20, 24, 99]) {
    assert.strictEqual(ctx.isHeadWind(13, sid), true, 'sid ' + sid);
    assert.strictEqual(ctx.isTailWind(5, sid), true, 'sid ' + sid);
    assert.strictEqual(ctx.isHeadWind(5, sid), false, 'sid ' + sid);
  }
  assert.strictEqual(typeof ctx.STADIUM_WIND_PROFILE, 'undefined', '方位を仮定した場別の表が残っている');
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

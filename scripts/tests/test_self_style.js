/**
 * F13: 自分のコース別決まり手スコア (selfStyleScore) テスト
 *
 *   node scripts/tests/test_self_style.js
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

function setStyle(rid, course, style){
  ctx.racerDB[rid] = ctx.racerDB[rid] || { courseStats:{}, courseStyle:{} };
  ctx.racerDB[rid].courseStyle = ctx.racerDB[rid].courseStyle || {};
  ctx.racerDB[rid].courseStyle[course] = style;
}

console.log('[selfStyleScore]');

t('1コース 逃げ率 90% → 大きい正スコア', () => {
  setStyle(101, 1, { nige: 27, sashi: 0, makuri: 0, makuriSashi: 0, nuki: 1, megumare: 2 });
  const r = ctx.selfStyleScore(101, 1);
  assert.ok(r.score >= 4);   // conf=1 で +5
  assert.ok(r.reason && r.reason.indexOf('超鉄板') >= 0);
});

t('1コース 逃げ率 25% → 大きい負スコア (conf=1.0)', () => {
  // total=32 (conf=1.0), nige=8 → 25%
  setStyle(102, 1, { nige: 8, sashi: 0, makuri: 0, makuriSashi: 0, nuki: 4, megumare: 20 });
  const r = ctx.selfStyleScore(102, 1);
  assert.ok(r.score <= -4);
  assert.ok(r.risk && r.risk.indexOf('イン弱い') >= 0);
});

t('1コース 逃げ率 75% → 中程度の正スコア', () => {
  setStyle(103, 1, { nige: 15, sashi: 0, makuri: 0, makuriSashi: 0, nuki: 2, megumare: 3 });
  const r = ctx.selfStyleScore(103, 1);
  assert.ok(r.score > 0 && r.score <= 3);
});

t('2コース 差し率 60% → 正スコア (差し巧者)', () => {
  setStyle(201, 2, { nige: 0, sashi: 18, makuri: 5, makuriSashi: 2, nuki: 1, megumare: 4 });
  const r = ctx.selfStyleScore(201, 2);
  assert.ok(r.score > 0);
  assert.ok(r.reason.indexOf('差し巧者') >= 0);
});

t('3コース まくり/まくり差し合計 50% → 強気スコア', () => {
  setStyle(301, 3, { nige: 0, sashi: 4, makuri: 12, makuriSashi: 6, nuki: 2, megumare: 6 });
  const r = ctx.selfStyleScore(301, 3);
  assert.ok(r.score > 0);
  assert.ok(r.reason.indexOf('センター強') >= 0 || r.reason.indexOf('捲り') >= 0);
});

t('4コース 攻撃率 50% → +スコア (カド強)', () => {
  setStyle(401, 4, { nige: 0, sashi: 5, makuri: 12, makuriSashi: 8, nuki: 2, megumare: 3 });
  const r = ctx.selfStyleScore(401, 4);
  assert.ok(r.score > 0);
});

t('4コース 攻撃率 10% → -スコア', () => {
  setStyle(402, 4, { nige: 0, sashi: 8, makuri: 1, makuriSashi: 1, nuki: 2, megumare: 18 });
  const r = ctx.selfStyleScore(402, 4);
  assert.ok(r.score < 0);
  assert.ok(r.risk && r.risk.indexOf('攻めれない') >= 0);
});

t('5コース 攻撃率 35% → +スコア (穴開け)', () => {
  setStyle(501, 5, { nige: 0, sashi: 3, makuri: 6, makuriSashi: 4, nuki: 1, megumare: 16 });
  const r = ctx.selfStyleScore(501, 5);
  assert.ok(r.score > 0);
});

t('サンプル 7 件未満 → スコア 0', () => {
  setStyle(601, 1, { nige: 5, sashi: 1, makuri: 0, makuriSashi: 0, nuki: 0, megumare: 0 });   // total=6
  const r = ctx.selfStyleScore(601, 1);
  assert.strictEqual(r.score, 0);
});

t('データ無し → スコア 0', () => {
  delete ctx.racerDB[9999];
  const r = ctx.selfStyleScore(9999, 1);
  assert.strictEqual(r.score, 0);
});

t('信頼度補間: 8 件 → 約 0.27 倍', () => {
  setStyle(701, 1, { nige: 7, sashi: 0, makuri: 0, makuriSashi: 0, nuki: 0, megumare: 1 });   // total=8, nige=87.5%
  const r = ctx.selfStyleScore(701, 1);
  // conf = 8/30 ≈ 0.267, base = +5 → ~1.33
  assert.ok(r.score > 0.5 && r.score < 2.5);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

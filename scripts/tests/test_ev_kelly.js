/**
 * X1: EV / Kelly / オッズ乖離 ヘルパのテスト
 *
 *   node scripts/tests/test_ev_kelly.js
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
  console, Date, Math, Number, Array, Object, JSON,
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
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  navigator: { serviceWorker: undefined },
  location: { hostname: 'test', reload: () => {} },
  AbortController: class { constructor(){ this.signal={}; } abort(){} },
  alert: () => {},
  confirm: () => true,
};
stub.globalThis = stub; stub.self = stub;

const ctx = vm.createContext(stub);
try { vm.runInContext(code, ctx, { timeout: 5000 }); } catch(_) {}

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); console.log('  PASS:', name); pass++; }
  catch(e){ console.log('  FAIL:', name, '\n   ', e.message); fail++; }
}
// eslint-disable-next-line no-unused-vars -- 数値比較ヘルパ、追加テスト時に使用
function close(a, b, eps){ return Math.abs(a-b) < (eps||1e-6); }

console.log('[selectBetsByEV]');
t('basic EV filter (>= 1.15)', () => {
  const probs = { 'A': 0.20, 'B': 0.05, 'C': 0.10 };
  const odds  = { 'A': 8.0,  'B': 5.0,  'C': 12.0 };  // EVs: 1.6, 0.25, 1.2
  const r = ctx.selectBetsByEV(probs, odds, {evMin: 1.15, kellyFrac: 0});
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].combo, 'A');
  assert.strictEqual(r[1].combo, 'C');
  assert.ok(r[0].ev > r[1].ev);
});
t('all below threshold returns []', () => {
  const probs = { 'A': 0.10 };
  const odds  = { 'A': 5.0 };  // EV=0.5
  const r = ctx.selectBetsByEV(probs, odds, {evMin: 1.15});
  assert.strictEqual(r.length, 0);
});
t('Kelly stake calculation (half-Kelly)', () => {
  // p=0.5, odds=3 → b=2, q=0.5, f* = (2*0.5 - 0.5) / 2 = 0.25
  // half-Kelly: 0.125 → bankroll 10000 → 1250 → round to 100 → 1300
  const r = ctx.selectBetsByEV({ 'A': 0.5 }, { 'A': 3.0 },
    {evMin: 1.0, kellyFrac: 0.5, bankroll: 10000});
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].stakeYen >= 1100 && r[0].stakeYen <= 1400);
});
t('full-Kelly larger than half-Kelly', () => {
  const opt = {evMin: 1.0, bankroll: 10000};
  const half = ctx.selectBetsByEV({'A':0.5},{'A':3.0},Object.assign({},opt,{kellyFrac:0.5}));
  const full = ctx.selectBetsByEV({'A':0.5},{'A':3.0},Object.assign({},opt,{kellyFrac:1.0}));
  assert.ok(full[0].stakeYen > half[0].stakeYen);
});
t('maxBets cap (P1-A6: 高EV時は dynamic 圧縮)', () => {
  // 旧: avgEV 1.5 でも maxBets=5 が cap → 5点
  // 新: avgEV >= 1.35 → dynMaxBets=3 が更に効いて 3点に圧縮（高EV厳選）
  const probs = {}, odds = {};
  for(let i=0;i<20;i++){ probs['x'+i]=0.10; odds['x'+i]=15; }   // EV=1.5 each
  const r = ctx.selectBetsByEV(probs, odds, {evMin:1.0, maxBets:5});
  assert.strictEqual(r.length, 3);
});
t('maxBets cap (低EV時は maxBets 通り)', () => {
  // avgEV 1.18 (1.20未満) → dynamic 圧縮なし、maxBets=5 が cap
  const probs = {}, odds = {};
  for(let i=0;i<20;i++){ probs['x'+i]=0.10; odds['x'+i]=11.8; }   // EV=1.18 each
  const r = ctx.selectBetsByEV(probs, odds, {evMin:1.0, maxBets:5});
  assert.strictEqual(r.length, 5);
});

console.log('[calcOddsDivergence]');
t('positive delta (AI sees value)', () => {
  // 6艇均等オッズ、AI が艇1を高評価
  const win = {'1':6, '2':6, '3':6, '4':6, '5':6, '6':6};   // market_prob = 1/6 each
  const ai = [0.40, 0.12, 0.12, 0.12, 0.12, 0.12];
  const r = ctx.calcOddsDivergence(ai, win);
  assert.ok(r[1].delta > 0.2);   // AI 0.40 vs 市場 0.167 → +0.23
  assert.ok(r[2].delta < 0);
});
t('returns null on no odds', () => {
  assert.strictEqual(ctx.calcOddsDivergence([0.5,0.5,0,0,0,0], null), null);
});
t('market_prob sums to ~1', () => {
  const win = {'1':2.0, '2':4.0, '3':6.0, '4':10.0, '5':20.0, '6':30.0};
  const ai = [0.4, 0.2, 0.15, 0.1, 0.1, 0.05];
  const r = ctx.calcOddsDivergence(ai, win);
  let s = 0;
  for(let b=1;b<=6;b++) s += r[b].market_prob;
  assert.ok(Math.abs(s - 1.0) < 0.01);
});

console.log('[buildTrifectaProbDist]');
t('120 combos for 6 marks', () => {
  const marks = [];
  for(let i=1;i<=6;i++) marks.push({boat:i, prob:1/6});
  const dist = ctx.buildTrifectaProbDist(marks);
  assert.strictEqual(Object.keys(dist).length, 120);
});
t('1-2-3 prob > 1-6-5 prob when ordered', () => {
  const marks = [
    {boat:1, prob:0.40}, {boat:2, prob:0.20}, {boat:3, prob:0.15},
    {boat:4, prob:0.12}, {boat:5, prob:0.08}, {boat:6, prob:0.05}
  ];
  const dist = ctx.buildTrifectaProbDist(marks);
  assert.ok(dist['1-2-3'] > dist['1-6-5']);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

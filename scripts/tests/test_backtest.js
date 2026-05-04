/**
 * X7: バックテストエンジンテスト
 *
 *   node scripts/tests/test_backtest.js
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

console.log('[runBacktestEngine]');

t('空履歴で 0 結果', () => {
  const r = ctx.runBacktestEngine([], { periodDays: 0 });
  assert.strictEqual(r.samples, 0);
  assert.strictEqual(r.roi, 0);
  assert.strictEqual(r.totalStake, 0);
});

t('単一的中レースで roi 計算', () => {
  const history = [{
    date: '20260504', stadium: 14, race: 1, raceType: 'honmei',
    actual: [1,2,3], trifecta_hit: true, exacta_hit: true,
    trifecta_bets: ['1-2-3', '1-3-2', '1-2-4'],   // 3点
    exacta_bets:   ['1-2', '1-3'],                  // 2点
    payout3: 3000, payout2: 800,
  }];
  const r = ctx.runBacktestEngine(history, { periodDays: 0, stakePerBet: 100 });
  assert.strictEqual(r.samples, 1);
  assert.strictEqual(r.totalBets, 5);
  assert.strictEqual(r.totalStake, 500);   // 5 * 100
  assert.strictEqual(r.totalPayout, 3800);
  assert.strictEqual(r.netProfit, 3300);
  assert.ok(r.roi > 7);
  assert.strictEqual(r.hitRate3, 1);
});

t('外れレースで損失', () => {
  const history = [{
    date: '20260504', stadium: 14, race: 1, raceType: 'middle',
    actual: [4,5,6], trifecta_hit: false, exacta_hit: false,
    trifecta_bets: ['1-2-3', '1-3-2'],
    exacta_bets:   [],
    payout3: 0, payout2: 0,
  }];
  const r = ctx.runBacktestEngine(history, { periodDays: 0, stakePerBet: 100 });
  assert.strictEqual(r.netProfit, -200);
  assert.strictEqual(r.roi, 0);
});

t('レースタイプ別集計', () => {
  const history = [
    { date:'20260501', raceType:'honmei', actual:[1], trifecta_hit:true,  trifecta_bets:['1-2-3'], exacta_bets:[], payout3:1000 },
    { date:'20260502', raceType:'honmei', actual:[2], trifecta_hit:false, trifecta_bets:['1-2-3'], exacta_bets:[], payout3:0 },
    { date:'20260503', raceType:'ana',    actual:[5], trifecta_hit:true,  trifecta_bets:['5-1-2'], exacta_bets:[], payout3:50000 },
  ];
  const r = ctx.runBacktestEngine(history, { periodDays: 0, stakePerBet: 100 });
  assert.strictEqual(r.byType.honmei.n, 2);
  assert.strictEqual(r.byType.honmei.hits, 1);
  assert.strictEqual(r.byType.ana.n, 1);
  assert.strictEqual(r.byType.ana.hits, 1);
  assert.strictEqual(r.byType.ana.payout, 50000);
});

t('期間フィルタが効く', () => {
  // 100 日前と今日のレース
  const oldDate = (function(){
    const d = new Date(); d.setDate(d.getDate()-100);
    return d.getFullYear() + ('0'+(d.getMonth()+1)).slice(-2) + ('0'+d.getDate()).slice(-2);
  })();
  const today = (function(){
    const d = new Date();
    return d.getFullYear() + ('0'+(d.getMonth()+1)).slice(-2) + ('0'+d.getDate()).slice(-2);
  })();
  const history = [
    { date: oldDate, actual:[1], trifecta_hit:true, trifecta_bets:['1-2-3'], exacta_bets:[], payout3:1000 },
    { date: today,   actual:[1], trifecta_hit:true, trifecta_bets:['1-2-3'], exacta_bets:[], payout3:2000 },
  ];
  const r = ctx.runBacktestEngine(history, { periodDays: 14, stakePerBet: 100 });
  assert.strictEqual(r.samples, 1);   // 100日前は除外
  assert.strictEqual(r.totalPayout, 2000);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

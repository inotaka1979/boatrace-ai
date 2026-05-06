/**
 * X6: 節間 / 対戦相性テスト
 *
 *   node scripts/tests/test_series_pairwise.js
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

console.log('[linearSlope]');
t('上昇トレンド +5/step', () => {
  const slope = ctx.linearSlope([10, 15, 20, 25, 30]);
  assert.ok(Math.abs(slope - 5) < 0.001);
});
t('下降トレンド -3/step', () => {
  const slope = ctx.linearSlope([20, 17, 14, 11, 8]);
  assert.ok(Math.abs(slope - (-3)) < 0.001);
});
t('1 点で 0', () => {
  assert.strictEqual(ctx.linearSlope([10]), 0);
});

console.log('[seriesAdjustmentScore]');
t('上昇トレンドで +3', () => {
  ctx.racerDB[7001] = {
    courseStats: {},
    seriesProgress: {
      '12': [
        {date:'a', motorRate: 30},
        {date:'b', motorRate: 33},
        {date:'c', motorRate: 36},
        {date:'d', motorRate: 39},
      ]
    }
  };
  const r = ctx.seriesAdjustmentScore(7001, 12);
  assert.strictEqual(r.score, 3);
  assert.ok(r.slope >= 3);
});
t('下降トレンドで -3', () => {
  ctx.racerDB[7002] = {
    courseStats: {},
    seriesProgress: {
      '12': [
        {date:'a', motorRate: 40},
        {date:'b', motorRate: 36},
        {date:'c', motorRate: 32},
        {date:'d', motorRate: 28},
      ]
    }
  };
  const r = ctx.seriesAdjustmentScore(7002, 12);
  assert.strictEqual(r.score, -3);
});
t('データ不足で 0', () => {
  ctx.racerDB[7003] = { courseStats: {}, seriesProgress: { '12': [{date:'a', motorRate: 35}] } };
  const r = ctx.seriesAdjustmentScore(7003, 12);
  assert.strictEqual(r.score, 0);
});

console.log('[motorTrendWarning]');
t('上昇は up 警告', () => {
  ctx.racerDB[7001] = {
    courseStats: {},
    seriesProgress: { '12': [
      {date:'a', motorRate: 30}, {date:'b', motorRate: 35},
      {date:'c', motorRate: 40},
    ]}
  };
  const w = ctx.motorTrendWarning(7001, 12);
  assert.ok(w);
  assert.strictEqual(w.kind, 'up');
});

console.log('[pairwiseScore]');
t('オーバーシップで positive', () => {
  ctx.pairwiseDB['8001-8002'] = { races: 10, head2head: { '8001': 8, '8002': 2 } };
  const r = ctx.pairwiseScore(8001, 12, [8002]);
  assert.ok(r.score > 0);
  assert.strictEqual(r.hits, 1);
});
t('対戦データ不足 (<5) は 0', () => {
  ctx.pairwiseDB['9001-9002'] = { races: 3, head2head: { '9001': 3 } };
  const r = ctx.pairwiseScore(9001, 12, [9002]);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.hits, 0);
});

console.log('[learnSeriesAndPairwiseFromResults]');
t('1 レース 1 ペア 1 カウント (重複加算なし)', () => {
  // クリーン
  Object.keys(ctx.pairwiseDB).forEach(k => delete ctx.pairwiseDB[k]);
  ctx.racerDB[100] = { courseStats: {} };
  ctx.racerDB[200] = { courseStats: {} };
  ctx.racerDB[300] = { courseStats: {} };
  const results = {
    '12': {
      '1': {
        results: [
          { racer_number: 100, place: 1 },
          { racer_number: 200, place: 2 },
          { racer_number: 300, place: 3 },
        ]
      }
    }
  };
  ctx.learnSeriesAndPairwiseFromResults(results);
  assert.strictEqual(ctx.pairwiseDB['100-200'].races, 1, '100-200 は 1 戦');
  assert.strictEqual(ctx.pairwiseDB['100-300'].races, 1, '100-300 は 1 戦');
  assert.strictEqual(ctx.pairwiseDB['200-300'].races, 1, '200-300 は 1 戦');
  assert.strictEqual(ctx.pairwiseDB['100-200'].head2head['100'], 1, '100 が 200 に勝利');
  assert.strictEqual(ctx.pairwiseDB['100-300'].head2head['100'], 1, '100 が 300 に勝利');
  assert.strictEqual(ctx.pairwiseDB['200-300'].head2head['200'], 1, '200 が 300 に勝利');
});

t('racerDB 未登録選手のペアも対称にカウントされる', () => {
  Object.keys(ctx.pairwiseDB).forEach(k => delete ctx.pairwiseDB[k]);
  // 100 のみ racerDB 登録、200 と 300 は未登録
  delete ctx.racerDB[200];
  delete ctx.racerDB[300];
  ctx.racerDB[100] = { courseStats: {} };
  const results = {
    '12': {
      '1': {
        results: [
          { racer_number: 100, place: 1 },
          { racer_number: 200, place: 2 },
          { racer_number: 300, place: 3 },
        ]
      }
    }
  };
  ctx.learnSeriesAndPairwiseFromResults(results);
  // 全ペアが 1 戦であるべき (旧バグでは 100 の絡む 2 ペアが 1, 200-300 が 0 になっていた)
  assert.strictEqual(ctx.pairwiseDB['100-200'].races, 1);
  assert.strictEqual(ctx.pairwiseDB['100-300'].races, 1);
  assert.strictEqual(ctx.pairwiseDB['200-300'].races, 1);
});

t('失格艇 (place が範囲外) は除外', () => {
  Object.keys(ctx.pairwiseDB).forEach(k => delete ctx.pairwiseDB[k]);
  ctx.racerDB[100] = { courseStats: {} };
  ctx.racerDB[200] = { courseStats: {} };
  const results = {
    '12': {
      '1': {
        results: [
          { racer_number: 100, place: 1 },
          { racer_number: 200, place: null },  // DSQ 想定
        ]
      }
    }
  };
  ctx.learnSeriesAndPairwiseFromResults(results);
  // 失格艇は除外されるのでペア記録は作られない
  assert.strictEqual(ctx.pairwiseDB['100-200'], undefined);
});

t('複数レースで累積', () => {
  Object.keys(ctx.pairwiseDB).forEach(k => delete ctx.pairwiseDB[k]);
  ctx.racerDB[100] = { courseStats: {} };
  ctx.racerDB[200] = { courseStats: {} };
  const results = {
    '12': {
      '1': { results: [{racer_number:100, place:1}, {racer_number:200, place:2}] },
      '2': { results: [{racer_number:100, place:2}, {racer_number:200, place:1}] },
      '3': { results: [{racer_number:100, place:1}, {racer_number:200, place:2}] },
    }
  };
  ctx.learnSeriesAndPairwiseFromResults(results);
  assert.strictEqual(ctx.pairwiseDB['100-200'].races, 3, '3 戦');
  assert.strictEqual(ctx.pairwiseDB['100-200'].head2head['100'], 2, '100 が 2 勝');
  assert.strictEqual(ctx.pairwiseDB['100-200'].head2head['200'], 1, '200 が 1 勝');
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

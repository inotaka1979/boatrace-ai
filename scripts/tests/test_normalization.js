/**
 * X2: 場別正規化（モーター z-score / 展示時間 z-score / ST 個人乖離）テスト
 *
 *   node scripts/tests/test_normalization.js
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

console.log('[learnMotorStatsFromPrograms]');
t('builds mean/std from programs', () => {
  // クリア
  Object.keys(ctx.stadiumMotorStats).forEach(k => delete ctx.stadiumMotorStats[k]);
  const programs = {
    programs: [
      { race_stadium_number:1, boats:[
        {racer_assigned_motor_top_2_percent:30},
        {racer_assigned_motor_top_2_percent:35},
        {racer_assigned_motor_top_2_percent:40},
        {racer_assigned_motor_top_2_percent:45},
        {racer_assigned_motor_top_2_percent:50},
        {racer_assigned_motor_top_2_percent:55},
      ]},
    ],
  };
  // count >= 50 が必要なため、複数レース分を投入
  for(let r=1; r<=10; r++){
    programs.programs.push({ race_stadium_number:1, boats: [
      {racer_assigned_motor_top_2_percent:30+(r%6)*5},
      {racer_assigned_motor_top_2_percent:35+(r%6)*5},
      {racer_assigned_motor_top_2_percent:40+(r%6)*5},
      {racer_assigned_motor_top_2_percent:25+(r%6)*5},
      {racer_assigned_motor_top_2_percent:42+(r%6)*5},
      {racer_assigned_motor_top_2_percent:38+(r%6)*5},
    ]});
  }
  ctx.learnMotorStatsFromPrograms(programs);
  const s = ctx.stadiumMotorStats['1'];
  assert.ok(s);
  assert.ok(s.count >= 60);
  assert.ok(s.mean > 30 && s.mean < 60);
  assert.ok(s.std >= 0.5);
});

t('motorScoreNormalized: high z → 超抜', () => {
  // mean=40, std=5 を用意
  ctx.stadiumMotorStats['99'] = { mean:40, std:5, count:100 };
  const r = ctx.motorScoreNormalized(50, '99');   // z=2.0
  assert.strictEqual(r.label, '超抜');
  assert.ok(r.score >= 12);
});

t('motorScoreNormalized: low z → 整備要', () => {
  ctx.stadiumMotorStats['99'] = { mean:40, std:5, count:100 };
  const r = ctx.motorScoreNormalized(30, '99');   // z=-2.0
  assert.strictEqual(r.label, '整備要');
});

t('motorScoreNormalized: count<50 falls back', () => {
  ctx.stadiumMotorStats['98'] = { mean:40, std:5, count:10 };
  const r = ctx.motorScoreNormalized(50, '98');
  // 旧 5 段階閾値で 50 → 超抜 score=12
  assert.strictEqual(r.score, 12);
});

console.log('[exhibitionZScore]');
t('returns z-score', () => {
  ctx.stadiumExhibitionStats['1'] = { mean: 6.85, std: 0.05, count: 100 };
  const z = ctx.exhibitionZScore(6.75, '1');   // (-0.10)/0.05 = -2.0
  assert.ok(z < -1.5);   // 速い
});
t('returns 0 on insufficient samples', () => {
  ctx.stadiumExhibitionStats['97'] = { mean: 6.85, std: 0.05, count: 10 };
  assert.strictEqual(ctx.exhibitionZScore(6.75, '97'), 0);
});

console.log('[stDivergenceScore]');
t('flying ST returns -6', () => {
  assert.strictEqual(ctx.stDivergenceScore(-0.05, 9999, 1), -6);
});
t('uses personal mean when sample >= 5', () => {
  ctx.racerDB[8888] = {
    courseStats: {}, stStats: { '1': { mean: 0.18, count: 10 } },
  };
  // 自分平均 0.18 に対して 0.10 → z = (0.10-0.18)/0.04 = -2 → +5
  const r = ctx.stDivergenceScore(0.10, 8888, 1);
  assert.strictEqual(r, 5);
});
t('falls back to absolute when no personal data', () => {
  delete ctx.racerDB[7777];
  // 0.05 → +4 (absolute fallback)
  assert.strictEqual(ctx.stDivergenceScore(0.05, 7777, 1), 4);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

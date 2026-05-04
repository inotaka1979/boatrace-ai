/**
 * X3: 進入予想エンジンのテスト
 *
 *   node scripts/tests/test_entry_predict.js
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

console.log('[predictEntryCourses]');
t('枠通り進入が最頻 (デフォルト)', () => {
  const boats = [
    {racer_boat_number:1, racer_number:0},
    {racer_boat_number:2, racer_number:0},
    {racer_boat_number:3, racer_number:0},
    {racer_boat_number:4, racer_number:0},
    {racer_boat_number:5, racer_number:0},
    {racer_boat_number:6, racer_number:0},
  ];
  const r = ctx.predictEntryCourses(boats, 1);   // 桐生 = 前付け少なめ
  // 全艇枠通り
  for(let b=1;b<=6;b++) assert.strictEqual(r.byBoat[b], b);
});

t('全コースが 1〜6 で重複なし', () => {
  const boats = [];
  for(let b=1;b<=6;b++) boats.push({racer_boat_number:b, racer_number:b*1000});
  const r = ctx.predictEntryCourses(boats, 12);
  const courses = Object.values(r.byBoat).sort();
  assert.deepStrictEqual(courses, [1,2,3,4,5,6]);
});

t('個人前付け癖が反映される (周囲が譲歩する条件で)', () => {
  // 4 号艇選手が 95% で 2 コース前付け
  // 2 号艇選手も「3 コースに下がる癖」を持つ（前付けは周囲の譲歩が必要）
  ctx.racerDB[5001] = {
    courseStats: {},
    entryPattern: { byBoat: { '4': { '2': 0.95, '4': 0.05 } }, samples: 30 }
  };
  ctx.racerDB[5002] = {
    courseStats: {},
    entryPattern: { byBoat: { '2': { '3': 0.80, '2': 0.20 } }, samples: 30 }
  };
  const boats = [
    {racer_boat_number:1, racer_number:1000},
    {racer_boat_number:2, racer_number:5002},
    {racer_boat_number:3, racer_number:3000},
    {racer_boat_number:4, racer_number:5001},
    {racer_boat_number:5, racer_number:5000},
    {racer_boat_number:6, racer_number:6000},
  ];
  const r = ctx.predictEntryCourses(boats, 12);
  assert.strictEqual(r.byBoat[4], 2);
  assert.strictEqual(r.byBoat[2], 3);
});

console.log('[learnEntryPatternFromResults]');
t('結果から個人パターン蓄積', () => {
  delete ctx.racerDB[6001];
  ctx.racerDB[6001] = { courseStats:{}, courseStyle:{}, recentResults:[] };
  const results = {
    '1': {
      '1': {
        isFinished:true,
        results: [{racer_number:6001, racer_boat_number:4, racer_course_number:2, place:1}]
      },
      '2': {
        isFinished:true,
        results: [{racer_number:6001, racer_boat_number:4, racer_course_number:2, place:3}]
      },
      '3': {
        isFinished:true,
        results: [{racer_number:6001, racer_boat_number:4, racer_course_number:4, place:5}]
      }
    }
  };
  ctx.learnEntryPatternFromResults(results);
  const ep = ctx.racerDB[6001].entryPattern;
  assert.ok(ep);
  assert.ok(ep.byBoat['4']);
  // 2 コース 2 回 / 4 コース 1 回 → 正規化後 2/3, 1/3
  assert.ok(Math.abs(ep.byBoat['4']['2'] - 2/3) < 0.01);
  assert.ok(Math.abs(ep.byBoat['4']['4'] - 1/3) < 0.01);
});

console.log('[getEntryDist]');
t('場別デフォルトを返す (個人なし)', () => {
  const d = ctx.getEntryDist(0, 4, 12);   // 住之江
  assert.ok(d['4'] >= 0.5);   // 4 → 4 が最頻
});
t('GLOBAL_DEFAULT に fallback', () => {
  const d = ctx.getEntryDist(0, 1, 99);   // 存在しない場
  assert.ok(d['1'] >= 0.9);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

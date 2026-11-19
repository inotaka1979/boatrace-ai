/**
 * Web Worker プロトコル smoke test（2026-08-11 追加）
 *
 * 背景: assets/worker.js + assets/worker_predictor.js を読み込むテストが 1 本も
 * 無く、commit 1e25058c が worker のローカル state 宣言
 * (l2trainStep / l2learnedKeys / L2_LR0 / L2_LR_TAU / L2_LAMBDA / L2_KEY_LIMIT)
 * を巻き込み削除したことに気付けなかった。worker_predictor.js は 'use strict'
 * なので、worker.js の `l2trainStep = state.trainStep` が未宣言代入 →
 * ReferenceError となり、sync_state / batch_learn が全滅、predict は
 * programData 未設定のまま null を返す（実ブラウザ 100% で Worker 経路が沈黙）。
 *
 * 本テストは worker を実際の message protocol で 1 往復させ、
 *   - error 応答が返らないこと
 *   - predict が null ではなく実際の予想を返すこと
 * を検証する。
 *
 *   node scripts/tests/test_worker_protocol.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const PREDICTOR = fs.readFileSync(path.join(ROOT, 'assets', 'worker_predictor.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'assets', 'worker.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

function boat(bn, cls, nat) {
  return {
    racer_boat_number: bn, racer_number: 4000 + bn, racer_class_number: cls,
    racer_national_top_1_percent: nat, racer_local_top_2_percent: 30 + nat * 3,
    racer_assigned_motor_top_2_percent: 35, racer_assigned_boat_top_2_percent: 34,
    racer_flying_count: 0, racer_late_start_count_in_current_term: 0,
  };
}

/** worker context を組み立て、送信したメッセージへの応答配列を返すハンドルを作る */
function makeWorker() {
  const posted = [];
  const listeners = [];
  const store = {};
  const self = {
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    // 実ブラウザの postMessage と同じく structured clone する（関数を含む結果は DataCloneError）
    postMessage: (m) => posted.push(structuredClone(m)),
    location: { href: 'https://example.test/assets/worker.js' },
    importScripts: () => { /* 下で明示的に評価済み */ },
    fetch: () => Promise.reject(new Error('no network in worker smoke test')),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, Promise, Error, TypeError,
    Map, Set, isNaN, isFinite, parseInt, parseFloat, setTimeout, clearTimeout,
  };
  self.self = self;
  self.globalThis = self;
  const ctx = vm.createContext(self);
  // worker.js は importScripts('worker_predictor.js') で読むので、先に評価しておく
  vm.runInContext(PREDICTOR, ctx, { filename: 'worker_predictor.js' });
  vm.runInContext(WORKER, ctx, { filename: 'worker.js' });
  return {
    ctx,
    posted,
    send(msg) { listeners.forEach((fn) => fn({ data: msg })); return posted; },
  };
}

const RACE = {
  race_closed_at: '2026-08-11 15:30', race_grade_number: 1,
  boats: [boat(1, 1, 7), boat(2, 2, 5), boat(3, 2, 5), boat(4, 3, 4.5), boat(5, 3, 4), boat(6, 4, 3.5)],
};
const PREVIEW = {
  weather: { wind_speed: 2, wind_direction: 1, wave_height: 2, water_temperature: 24 },
  boats: {
    1: { racer_course_number: 1, racer_exhibition_time: 6.70, racer_start_timing: 0.13 },
    2: { racer_course_number: 2, racer_exhibition_time: 6.75, racer_start_timing: 0.15 },
    3: { racer_course_number: 3, racer_exhibition_time: 6.80, racer_start_timing: 0.16 },
    4: { racer_course_number: 4, racer_exhibition_time: 6.83, racer_start_timing: 0.17 },
    5: { racer_course_number: 5, racer_exhibition_time: 6.86, racer_start_timing: 0.18 },
    6: { racer_course_number: 6, racer_exhibition_time: 6.90, racer_start_timing: 0.20 },
  },
};

console.log('[worker: 必須ローカル state の宣言]');
t('l2trainStep / l2learnedKeys / L2_* が worker context に定義されている', () => {
  const w = makeWorker();
  ['l2trainStep', 'l2learnedKeys', 'L2_LR0', 'L2_LR_TAU', 'L2_LAMBDA', 'L2_KEY_LIMIT'].forEach((n) => {
    const v = vm.runInContext('typeof ' + n, w.ctx);
    assert.notStrictEqual(v, 'undefined', n + ' が未定義（1e25058c の退行）');
  });
});

console.log('[worker protocol の 1 往復]');
t('sync_state が error を返さない（strict mode の未宣言代入で落ちない）', () => {
  const w = makeWorker();
  w.send({ type: 'sync_state', state: { l2weights: [], trainStep: 42, programData: {}, previewData: {} } });
  const errs = w.posted.filter((m) => m && m.type === 'error');
  assert.strictEqual(errs.length, 0, 'error: ' + JSON.stringify(errs[0] || {}));
  assert.ok(w.posted.some((m) => m.type === 'sync_done'), 'sync_done が返らない');
  assert.strictEqual(vm.runInContext('l2trainStep', w.ctx), 42, 'trainStep が反映されない');
});

t('predict がエラーを返さず、6 艇の正規化された予想を返す', () => {
  // 2026-11-19: 従来は「結果 or 明示エラー」を許容していたため、worker が毎回
  //   ReferenceError (CLASS_COURSE_MULT / DEFAULT_ENTRY_BY_STADIUM 未定義) で落ちて
  //   main thread fallback していたのを検出できなかった。エラーは不合格とする。
  for (const pv of [PREVIEW, undefined]) {
    const w = makeWorker();
    w.send({
      type: 'predict', reqId: 1,
      input: { sid: 7, raceNum: 3, state: { programData: { 7: { 3: RACE } }, previewData: pv ? { 7: { 3: pv } } : {} } },
    });
    const err = w.posted.find((m) => m && m.type === 'error');
    assert.ok(!err, (pv ? '展示あり' : '展示なし') + ' で worker error: ' + (err && err.error));
    const done = w.posted.find((m) => m && m.type === 'predict_done');
    assert.ok(done && done.result, 'predict_done / result が無い');
    assert.ok(Array.isArray(done.result.marks) && done.result.marks.length === 6, 'marks が 6 艇でない');
    const sum = done.result.marks.reduce((a, m) => a + m.prob, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, 'marks の確率和が 1 でない: ' + sum);
  }
});

t('batch_learn が state 未宣言で落ちない', () => {
  const w = makeWorker();
  w.send({ type: 'batch_learn', reqId: 2, input: { state: { l2weights: [], trainStep: 0, learnedKeys: {} } } });
  const errs = w.posted.filter((m) => m && m.type === 'error' && /is not defined/.test(String(m.error)));
  assert.strictEqual(errs.length, 0, '未宣言参照: ' + JSON.stringify(errs[0] || {}));
});

// =============================================================================
// main thread との等価性（2026-11-19 追加）
//   worker 経路が「動く」だけでなく「main と同じ予想・同じ学習結果を返す」ことを固定する。
//   従来は worker の定数が手作業コピーで、L2_INIT_WEIGHTS[3] / STADIUM_WIND_PROFILE が
//   main から乖離しており、動いたとしても main と違う予想を出す状態だった。
// =============================================================================
const { makeCtx } = require('./_vm_harness');
const FIX_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden');
const GOLDEN = ['race_honmei', 'race_konsen', 'race_arare'];
const SETTINGS = { betCount3: 10, betCount2: 5, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'balanced' };
// harness の document は innerHTML が常に '' なので、main の escText を実ブラウザと同じ結果にする
//   （実 DOM の textContent → innerHTML は & < > U+00A0 のみ変換。Chromium で確認済み）
const domEscText = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const loadFx = (name) => JSON.parse(fs.readFileSync(path.join(FIX_DIR, name + '.json'), 'utf8'));

console.log('[worker ≡ main: predictRace]');
for (const name of GOLDEN) {
  for (const withPv of [true, false]) {
    t(name + (withPv ? ' 展示あり' : ' 展示なし') + ': worker の予想が main と完全一致', () => {
      const fx = loadFx(name);
      const programData = { [fx.sid]: { [fx.rno]: fx.program } };
      const previewData = withPv ? { [fx.sid]: { [fx.rno]: fx.preview } } : {};
      const oddsData = { odds: [fx.odds] };

      const m = makeCtx();
      Object.assign(m, { programData, previewData, oddsData, racerDB: {}, stadiumDB: {}, l2trainStep: 0, settings: SETTINGS });
      m.escText = domEscText;
      const expected = JSON.parse(JSON.stringify(m.predictRace(fx.sid, fx.rno)));

      const w = makeWorker();
      w.send({ type: 'sync_state', state: { programData, previewData, oddsData, racerDB: {}, stadiumDB: {}, trainStep: 0, settings: SETTINGS } });
      w.send({ type: 'predict', reqId: 1, input: { sid: fx.sid, raceNum: fx.rno } });
      const err = w.posted.find((p) => p && p.type === 'error');
      assert.ok(!err, 'worker error: ' + (err && err.error));
      const got = JSON.parse(JSON.stringify(w.posted.find((p) => p.type === 'predict_done').result));
      assert.deepStrictEqual(got, expected);
    });
  }
}

console.log('[worker ≡ main: main の _syncWorkerState 経由（DB・校正が効いている状態）]');
// golden は DB 空・校正 identity なので、それらを worker に送らなくても一致してしまう。
//   選手 / 場 DB に中身を入れた状態と、場別 Platt / isotonic を効かせた状態で、
//   main が実際に送る sync_state を受けた worker が main と一致することを確認する。
// 2026-11-19: worker は DB を自前 fetch していたが /assets/data/db/ を取りに行き 404 で常に空、
//   実データで 30/30 レース main と食い違っていた。main から送る方式に変えたのを固定する。
const RACER_DB = {};
[4101, 4102, 4103, 4104, 4105, 4106].forEach((rn, i) => {
  RACER_DB[rn] = {
    name: 'R' + rn, classNum: 1 + (i % 4),
    courseStats: { [String(i + 1)]: { races: 40, win: 18 - i * 3, top2: 26 - i * 3, top3: 30 - i * 2, avgST: 0.14 + i * 0.01 } },
    courseStyle: {},
    recentResults: [1, 2, 3, 4, 5].map((k) => ({ date: '2026111' + k, place: ((i + k) % 6) + 1, course: i + 1 })),
    lastUpdated: '20261118',
  };
});
const STADIUM_DB = { 12: { courseWinRate: { 1: { races: 500, win: 220 }, 2: { races: 500, win: 80 }, 3: { races: 500, win: 70 },
  4: { races: 500, win: 60 }, 5: { races: 500, win: 40 }, 6: { races: 500, win: 30 } }, techniqueRate: {}, courseTechnique: {} } };
const CALIB_CASES = {
  '選手 / 場 DB あり': () => ({ racerDB: RACER_DB, stadiumDB: STADIUM_DB }),
  '場別 Platt': (sid) => ({ calibrationMethod: 'platt', plattCoeffsByStadium: { [String(sid)]: { a: 1.6, b: 0.3, n: 150, fittedAt: 1 } } }),
  isotonic: () => ({
    calibrationMethod: 'isotonic',
    isotonicCoeffs: { points: [{ x: 0, y: 0.02 }, { x: 0.2, y: 0.15 }, { x: 0.5, y: 0.55 }, { x: 1, y: 0.95 }], fittedAt: 1, n: 300 },
  }),
};
// main ctx に case の state を反映（DB は main が読み書きするので複製して渡す）
function applyCase(m, c) {
  if (c.calibrationMethod) m._calibrationMethod = c.calibrationMethod;
  if (c.plattCoeffsByStadium) m._plattCoeffsByStadium = c.plattCoeffsByStadium;
  if (c.isotonicCoeffs) m._isotonicCoeffs = c.isotonicCoeffs;
  if (c.racerDB) m.racerDB = structuredClone(c.racerDB);
  if (c.stadiumDB) m.stadiumDB = structuredClone(c.stadiumDB);
}
for (const label of Object.keys(CALIB_CASES)) {
  t(label + ' の予想が main と完全一致（かつ既定状態とは異なる）', () => {
    const fx = loadFx('race_konsen');
    const programData = { [fx.sid]: { [fx.rno]: fx.program } };
    const previewData = { [fx.sid]: { [fx.rno]: fx.preview } };
    const oddsData = { odds: [fx.odds] };
    const calib = CALIB_CASES[label](fx.sid);
    const mainPredict = (withCalib) => {
      const m = makeCtx();
      Object.assign(m, { programData, previewData, oddsData, racerDB: {}, stadiumDB: {}, l2trainStep: 0, settings: SETTINGS });
      m.escText = domEscText;
      if (withCalib) applyCase(m, calib);
      return JSON.parse(JSON.stringify(m.predictRace(fx.sid, fx.rno)));
    };
    const expected = mainPredict(true);
    assert.notDeepStrictEqual(expected.marks, mainPredict(false).marks, '既定状態と同じ予想になった（テストの前提が崩れている）');

    // worker へ渡す state は手作りせず、main の _syncWorkerState が実際に送るものを使う
    //   （main 側の送り忘れも検出するため）
    const m = makeCtx();
    Object.assign(m, { programData, previewData, oddsData, racerDB: {}, stadiumDB: {}, l2trainStep: 0, settings: SETTINGS });
    applyCase(m, calib);
    const sent = [];
    m._getAppWorker = () => ({ postMessage: (msg) => sent.push(structuredClone(msg)) });
    m._syncWorkerState();
    const syncMsg = sent.find((x) => x.type === 'sync_state');
    assert.ok(syncMsg, 'main の _syncWorkerState が sync_state を送らない');

    const w = makeWorker();
    w.send(syncMsg);
    w.send({ type: 'predict', reqId: 1, input: { sid: fx.sid, raceNum: fx.rno } });
    const err = w.posted.find((p) => p && p.type === 'error');
    assert.ok(!err, 'worker error: ' + (err && err.error));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.posted.find((p) => p.type === 'predict_done').result)), expected);
  });
}

console.log('[worker ≡ main: 共有定数]');
t('WORKER_SHARED_CONSTANTS の全定数が worker と main で同じ値', () => {
  // 名前の一覧は build/build.mjs から読む（二重管理しない）
  const buildSrc = fs.readFileSync(path.join(ROOT, 'build', 'build.mjs'), 'utf8');
  const mm = /const WORKER_SHARED_CONSTANTS = \[([\s\S]*?)\];/.exec(buildSrc);
  assert.ok(mm, 'build.mjs に WORKER_SHARED_CONSTANTS が無い');
  const names = mm[1].match(/'([A-Z0-9_]+)'/g).map((q) => q.slice(1, -1));
  assert.ok(names.length >= 20, '定数リストが短すぎる: ' + names.length);
  const m = makeCtx();
  const w = makeWorker();
  for (const n of names) {
    const mv = JSON.stringify(vm.runInContext(n, m));
    const wv = JSON.stringify(vm.runInContext(n, w.ctx));
    assert.strictEqual(wv, mv, n + ' が main と異なる');
  }
});

console.log('[worker: DOM 非依存]');
t('escText が document 無しで実 DOM と同じ結果を返す', () => {
  const w = makeWorker();
  const esc = (v) => vm.runInContext('escText(' + JSON.stringify(v) + ')', w.ctx);
  // 期待値は Chromium の textContent → innerHTML で採取
  assert.strictEqual(esc('a&b'), 'a&amp;b');
  assert.strictEqual(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.strictEqual(esc('"q" \'s\''), '"q" \'s\'');
  assert.strictEqual(esc('a b'), 'a&nbsp;b');
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(''), '');
});

// learnFromResults は async なので最後にまとめて await する
console.log('[worker ≡ main: 学習 (batch_learn ≡ learnFromResults)]');
async function learnEquivalence() {
  const programData = {}, previewData = {}, resultData = {};
  const winners = { race_honmei: 1, race_konsen: 3, race_arare: 5 };
  for (const name of GOLDEN) {
    const fx = loadFx(name);
    (programData[fx.sid] = programData[fx.sid] || {})[fx.rno] = fx.program;
    (previewData[fx.sid] = previewData[fx.sid] || {})[fx.rno] = fx.preview;
    const order = [winners[name]].concat([1, 2, 3, 4, 5, 6].filter((b) => b !== winners[name]));
    (resultData[fx.sid] = resultData[fx.sid] || {})[fx.rno] = {
      isFinished: true, results: order.map((b, i) => ({ place: i + 1, racer_boat_number: b })),
    };
  }
  const freshStats = () => ({ mean: new Array(24).fill(0), m2: new Array(24).fill(0), n: 0 });

  const m = makeCtx();
  const init = vm.runInContext('L2_INIT_WEIGHTS.slice()', m);
  Object.assign(m, { programData, previewData, resultData, l2weights: init.slice(), l2trainStep: 0, l2learnedKeys: {}, _featureStats: freshStats() });
  await m.learnFromResults();

  const w = makeWorker();
  w.send({ type: 'batch_learn', reqId: 1, input: { resultData, programData, previewData,
    state: { l2weights: init.slice(), featureStats: freshStats(), trainStep: 0, learnedKeys: {} } } });
  const done = w.posted.find((p) => p.type === 'batch_learn_done');
  assert.ok(done && done.result, 'batch_learn_done が無い: ' + JSON.stringify(w.posted.find((p) => p.type === 'error') || {}));
  const r = done.result;
  assert.strictEqual(r.trainStep, 3, '3 レース学習していない: ' + r.trainStep);
  assert.strictEqual(r.trainStep, m.l2trainStep, 'trainStep 不一致');
  assert.deepStrictEqual(Object.keys(r.learnedKeys).sort(), Object.keys(m.l2learnedKeys).sort(), '学習済みキー不一致');
  assert.deepStrictEqual(r.l2weights, Array.from(m.l2weights), '学習後の重み不一致');
  assert.deepStrictEqual(r.featureStats, JSON.parse(JSON.stringify(m._featureStats)), 'featureStats 不一致');
}

learnEquivalence().then(
  () => { console.log('  PASS: 3 レース分の学習で重み・学習回数・学習済みキー・featureStats が main と完全一致'); pass++; },
  (e) => { console.log('  FAIL: 学習の等価性\n    ', e.message); fail++; }
).then(() => {
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail);
});

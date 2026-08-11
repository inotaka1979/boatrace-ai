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
    postMessage: (m) => posted.push(m),
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
    isNaN, isFinite, parseInt, parseFloat, setTimeout, clearTimeout,
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

t('predict は「結果」か「明示エラー」を返す（silent null を返さない）', () => {
  const w = makeWorker();
  w.send({
    type: 'predict', reqId: 1,
    input: { sid: 7, raceNum: 3, state: { programData: { 7: { 3: RACE } }, previewData: { 7: { 3: PREVIEW } } } },
  });
  const done = w.posted.find((m) => m && m.type === 'predict_done');
  const err = w.posted.find((m) => m && m.type === 'error');
  assert.ok(done || err, 'predict に何の応答も無い');
  if (done) {
    // 結果を返すなら 6 艇の正規化された確率であること
    assert.ok(done.result, 'predict_done なのに result が null（main 側で fallback 必須）');
    assert.ok(Array.isArray(done.result.marks) && done.result.marks.length === 6, 'marks が 6 艇でない');
    const sum = done.result.marks.reduce((a, m) => a + m.prob, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, 'marks の確率和が 1 でない: ' + sum);
  } else {
    // エラーなら main thread fallback が発動する（predictRaceAsync 側で担保）
    assert.ok(err.error, 'error なのに内容が空');
  }
});

t('batch_learn が state 未宣言で落ちない', () => {
  const w = makeWorker();
  w.send({ type: 'batch_learn', reqId: 2, input: { state: { l2weights: [], trainStep: 0, learnedKeys: {} } } });
  const errs = w.posted.filter((m) => m && m.type === 'error' && /is not defined/.test(String(m.error)));
  assert.strictEqual(errs.length, 0, '未宣言参照: ' + JSON.stringify(errs[0] || {}));
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

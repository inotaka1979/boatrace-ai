/**
 * A-03 / PR-10: 信頼度★をベースライン超過 (lift) で判定するテスト。
 *
 * 旧: confStars = conf >= 40 ? 5 : ...（絶対確率）。1 コース勝率のベースレートは
 * 0.55 なので「1 号艇が普通に強いだけ」のレースが★5 になっていた。
 * 新: lift = topProb / baseline(top 艇の進入コース) で切る。
 *
 *   node scripts/tests/test_conf_stars.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

// 本番コードと同じしきい値マッピング（意図の記録 + 退行ガード）。
function starsFromLift(lift) {
  return lift >= 1.35 ? 5 : lift >= 1.2 ? 4 : lift >= 1.08 ? 3 : lift >= 0.95 ? 2 : 1;
}

function makeCtx() {
  const localStore = {};
  const stub = {
    console, Date, Math, Number, Array, Object, JSON,
    setTimeout, setInterval, clearInterval, clearTimeout, Promise,
    MessageChannel: class { constructor() { this.port1 = {}; this.port2 = { postMessage: () => {} }; } },
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
      querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
    },
    navigator: { serviceWorker: undefined },
    location: { hostname: 'test', reload: () => {} },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    alert: () => {}, confirm: () => true,
  };
  stub.globalThis = stub; stub.self = stub;
  const ctx = vm.createContext(stub);
  try { vm.runInContext(code, ctx, { timeout: 5000 }); } catch (_) { /* async timer noise */ }
  return ctx;
}

function boat(n, cls, natTop1, locTop2) {
  return {
    racer_boat_number: n, racer_number: 4000 + n, racer_class_number: cls,
    racer_national_top_1_percent: natTop1, racer_local_top_2_percent: locTop2,
    racer_assigned_motor_top_2_percent: 35, racer_assigned_boat_top_2_percent: 35,
    racer_flying_count: 0, racer_late_start_count_in_current_term: 0,
  };
}

function seedRace(ctx, boats, previewBoats) {
  ctx.programData = { '7': { '3': { race_closed_at: '2026-07-26 15:30', race_grade_number: 1, boats } } };
  ctx.previewData = { '7': { '3': {
    weather: { wind_speed: 2, wind_direction: 1, wave_height: 2, water_temperature: 22 },
    boats: previewBoats,
  } } };
  ctx.oddsData = null; ctx.stadiumDB = {}; ctx.racerDB = {}; ctx.l2trainStep = 0;
  ctx.settings = { betCount3: 10, betCount2: 5, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'balanced' };
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

console.log('[lift → stars mapping (intent guard)]');
t('baseline (lift 1.0) → ★2', () => { assert.strictEqual(starsFromLift(1.0), 2); });
t('lift 1.36 → ★5', () => { assert.strictEqual(starsFromLift(1.36), 5); });
t('outsider lift 3.33 → ★5', () => { assert.strictEqual(starsFromLift(3.33), 5); });
t('lift 0.94 → ★1', () => { assert.strictEqual(starsFromLift(0.94), 1); });
t('boundaries', () => {
  assert.strictEqual(starsFromLift(1.35), 5);
  assert.strictEqual(starsFromLift(1.2), 4);
  assert.strictEqual(starsFromLift(1.08), 3);
  assert.strictEqual(starsFromLift(0.95), 2);
});

console.log('[predictRace — confStars derived from real lift, not absolute %]');
t('confLift = topProb / baseline(top course); confStars matches mapping', () => {
  const ctx = makeCtx();
  const boats = [boat(1, 1, 7.5, 60), boat(2, 2, 5, 35), boat(3, 3, 5, 35),
    boat(4, 3, 5, 35), boat(5, 4, 4, 30), boat(6, 4, 4, 30)];
  seedRace(ctx, boats, {
    '1': { racer_course_number: 1, racer_exhibition_time: 6.68, racer_start_timing: 0.12 },
    '2': { racer_course_number: 2, racer_exhibition_time: 6.80, racer_start_timing: 0.16 },
    '3': { racer_course_number: 3, racer_exhibition_time: 6.82, racer_start_timing: 0.17 },
    '4': { racer_course_number: 4, racer_exhibition_time: 6.84, racer_start_timing: 0.18 },
    '5': { racer_course_number: 5, racer_exhibition_time: 6.88, racer_start_timing: 0.19 },
    '6': { racer_course_number: 6, racer_exhibition_time: 6.92, racer_start_timing: 0.21 },
  });
  const bets = ctx.predictRace(7, 3);
  const cwr = { 1: 0.55, 2: 0.14, 3: 0.12, 4: 0.11, 5: 0.06, 6: 0.02 };
  const topProb = bets.marks[0].prob;
  const baseline = cwr[bets.marks[0].course] || 0.16;
  const expectLift = Math.round((topProb / baseline) * 100) / 100;
  assert.ok(typeof bets.confLift === 'number', 'confLift missing');
  assert.ok(Math.abs(bets.confLift - expectLift) < 1e-9, `confLift ${bets.confLift} vs ${expectLift}`);
  assert.strictEqual(bets.confStars, starsFromLift(bets.confLift));
  // confidence (絶対%) は confStars と独立に存在する
  assert.strictEqual(bets.confidence, Math.round(topProb * 100));
});

t('a strong-1-course race is NOT auto-★5 (absolute-% regression)', () => {
  const ctx = makeCtx();
  // 1 号艇が「普通に強い」だけ (prob が baseline 0.55 近傍) のレース。
  // 旧ロジックでは confidence>=40 で★5 だったが、lift≈1 なら★は低いはず。
  const boats = [boat(1, 2, 5.5, 45), boat(2, 2, 5.2, 42), boat(3, 3, 5, 38),
    boat(4, 3, 5, 38), boat(5, 4, 4.5, 33), boat(6, 4, 4.2, 30)];
  seedRace(ctx, boats, {
    '1': { racer_course_number: 1, racer_exhibition_time: 6.75, racer_start_timing: 0.15 },
    '2': { racer_course_number: 2, racer_exhibition_time: 6.77, racer_start_timing: 0.15 },
    '3': { racer_course_number: 3, racer_exhibition_time: 6.80, racer_start_timing: 0.16 },
    '4': { racer_course_number: 4, racer_exhibition_time: 6.82, racer_start_timing: 0.17 },
    '5': { racer_course_number: 5, racer_exhibition_time: 6.85, racer_start_timing: 0.18 },
    '6': { racer_course_number: 6, racer_exhibition_time: 6.88, racer_start_timing: 0.19 },
  });
  const bets = ctx.predictRace(7, 3);
  if (bets.marks[0].course === 1 && bets.confLift < 1.35) {
    assert.ok(bets.confStars < 5, `1-course lift ${bets.confLift} should not be ★5`);
  }
  // いずれにせよ confStars は lift マッピングと一致する
  assert.strictEqual(bets.confStars, starsFromLift(bets.confLift));
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

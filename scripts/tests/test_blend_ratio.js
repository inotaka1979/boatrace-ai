/**
 * S-01 / PR-4: L1/L2 融合比 α のテスト。
 *
 * 旧実装は α = N0 / (N0 + racerDB のキー数) で、L2 の学習量と無関係な定数
 * (≈0.156) に固定されていた。修正後は α = N0 / (N0 + l2trainStep)。
 *
 * ここでは predictRace を実際に走らせ、観測可能な性質で検証する:
 *   1. racerDB のサイズを変えても予測が変わらない (= 分母から racerDB が消えた)
 *   2. l2trainStep を変えると予測が変わる (= l2trainStep が融合比を駆動する)
 *   3. _syncWorkerState の payload に trainStep が含まれる (worker drift 防止)
 *
 *   node scripts/tests/test_blend_ratio.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

function makeCtx() {
  const localStore = {};
  const stub = {
    console, Date, Math, Number, Array, Object, JSON,
    setTimeout, setInterval, clearInterval, clearTimeout, Promise,
    MessageChannel: class { constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => {} }; } },
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
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    alert: () => {},
    confirm: () => true,
  };
  stub.globalThis = stub; stub.self = stub;
  const ctx = vm.createContext(stub);
  try { vm.runInContext(code, ctx, { timeout: 5000 }); } catch (_) { /* async timer noise */ }
  return ctx;
}

function boat(n, cls) {
  return {
    racer_boat_number: n, racer_number: 4000 + n, racer_class_number: cls,
    racer_national_top_1_percent: 6, racer_local_top_2_percent: 40,
    racer_assigned_motor_top_2_percent: 35, racer_assigned_boat_top_2_percent: 35,
    racer_flying_count: 0, racer_late_start_count_in_current_term: 0,
  };
}

function seedRace(ctx) {
  ctx.programData = { '7': { '3': {
    race_closed_at: '2026-07-26 15:30', race_grade_number: 1,
    boats: [boat(1, 1), boat(2, 2), boat(3, 3), boat(4, 3), boat(5, 4), boat(6, 4)],
  } } };
  ctx.previewData = { '7': { '3': {
    weather: { wind_speed: 2, wind_direction: 1, wave_height: 2, water_temperature: 22 },
    boats: {
      '1': { racer_course_number: 1, racer_exhibition_time: 6.70, racer_start_timing: 0.13, racer_tilt_adjustment: -0.5 },
      '2': { racer_course_number: 2, racer_exhibition_time: 6.75, racer_start_timing: 0.15 },
      '3': { racer_course_number: 3, racer_exhibition_time: 6.80, racer_start_timing: 0.16 },
      '4': { racer_course_number: 4, racer_exhibition_time: 6.82, racer_start_timing: 0.17 },
      '5': { racer_course_number: 5, racer_exhibition_time: 6.85, racer_start_timing: 0.18 },
      '6': { racer_course_number: 6, racer_exhibition_time: 6.90, racer_start_timing: 0.20 },
    },
  } } };
  ctx.oddsData = null;
  ctx.stadiumDB = {};
  ctx.settings = { betCount3: 10, betCount2: 5, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'balanced' };
}

function probsOf(ctx) {
  const bets = ctx.predictRace(7, 3);
  // boat 番号順で確率を返す (marks は確率降順なので並べ替え)
  const byBoat = {};
  bets.marks.forEach((m) => { byBoat[m.boat] = m.prob; });
  return [1, 2, 3, 4, 5, 6].map((b) => byBoat[b]);
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

console.log('[blend ratio — racerDB independence (S-01 retrogression)]');
t('racerDB size does NOT change predictions (denominator no longer racerDB)', () => {
  const ctx = makeCtx();
  seedRace(ctx);
  ctx.l2trainStep = 0;
  ctx.racerDB = {};
  const p0 = probsOf(ctx);
  // 5000 個のダミー選手を注入 (旧実装ならここで α が 300/5300≈0.057 に激変した)
  const big = {};
  for (let i = 0; i < 5000; i++) big[String(10000 + i)] = { classNum: 4, courseStats: {}, recentResults: [] };
  ctx.racerDB = big;
  const p1 = probsOf(ctx);
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(p0[i] - p1[i]) < 1e-9, `boat ${i + 1}: ${p0[i]} vs ${p1[i]}`);
  }
});

console.log('[blend ratio — l2trainStep drives the blend]');
t('changing l2trainStep changes predictions (n now drives alpha)', () => {
  const ctx = makeCtx();
  seedRace(ctx);
  ctx.racerDB = {};
  ctx.l2trainStep = 0;          // alpha = 1 → L1 のみ
  const p0 = probsOf(ctx);
  ctx.l2trainStep = 1000000;    // alpha → ALPHA_MIN → ほぼ L2
  const p1 = probsOf(ctx);
  const moved = p0.some((v, i) => Math.abs(v - p1[i]) > 1e-4);
  assert.ok(moved, 'l2trainStep を極端に変えても予測が動かない → 融合比が n 依存でない');
});

t('probabilities stay a valid distribution across l2trainStep', () => {
  const ctx = makeCtx();
  seedRace(ctx);
  ctx.racerDB = {};
  [0, 300, 3000, 1000000].forEach((n) => {
    ctx.l2trainStep = n;
    const p = probsOf(ctx);
    const s = p.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(s - 1) < 1e-6, `n=${n}: sum=${s}`);
    p.forEach((v) => assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `n=${n}: prob ${v}`));
  });
});

console.log('[worker integrity — _syncWorkerState sends trainStep]');
t('_syncWorkerState payload includes trainStep', () => {
  const ctx = makeCtx();
  const seen = [];
  // _getAppWorker を差し替えて postMessage を捕捉
  ctx._getAppWorker = () => ({ postMessage: (m) => seen.push(m) });
  ctx.l2trainStep = 500;
  ctx._syncWorkerState();
  const sync = seen.find((m) => m && m.type === 'sync_state');
  assert.ok(sync, 'sync_state message not sent');
  assert.strictEqual(sync.state.trainStep, 500);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

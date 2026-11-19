/**
 * 今節成績の組み立て（2026-11-20）
 *
 *   - 前日の racedata は今日のレースに使わない（艇番で並ぶため別の選手の成績になる）
 *   - 今日の racedata が無ければ前日の series.json（選手番号で引く）を土台にし、今日は前日の日目 + 1
 *     （前日が最終日なら使わない、前日が中止なら日目は進まない）
 *   - 今日の確定結果で今日の枠を埋める（その選手の今日の n 走目 → 今日の n 番目の枠）
 *
 *   node scripts/tests/test_series_results.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

const E = (place, waku) => ({ waku, course: waku, place, st: '.15' });

function setup(ctx, { rdDate, seriesDate, ssExtra } = {}) {
  const today = ctx.todayStr();
  const yday = ctx.jstYmd(-1);
  // 15 場。選手 4001 は 3R (1 号艇) と 9R (4 号艇) に出る
  ctx.programData = { 15: {
    3: { boats: [{ racer_boat_number: 1, racer_number: 4001 }, { racer_boat_number: 2, racer_number: 4002 }] },
    9: { boats: [{ racer_boat_number: 4, racer_number: 4001 }] },
    10: { boats: [{ racer_boat_number: 1, racer_number: 4002 }] },
  } };
  ctx.resultData = { 15: {
    3: { isFinished: true, results: [{ place: 2, racer_boat_number: 1, racer_course_number: 2, racer_start_timing: 0.11 }] },
  } };
  ctx.raceData = rdDate ? {
    race_date: rdDate === 'today' ? today : yday,
    racedata: [{ stadium: 15, race: 3, day_label: '3日目', boats: [
      { boat_number: 1, current_series_results: [E(1, 1), null, E(3, 2), null] },
      { boat_number: 2, current_series_results: [E(6, 6)] },
    ] }],
  } : null;
  ctx.globalThis._seriesData = seriesDate ? {
    date: seriesDate === 'today' ? today : yday,
    stadiums: { 15: Object.assign({ day: 2, day_label: '2日目', final: false, held: true, racers: {
      4001: [E(1, 1), null, E(3, 2), E(4, 5)].concat(new Array(10).fill(null)),
    } }, ssExtra || {}) },
  } : undefined;
}

console.log('[今節成績]');
t('前日の racedata は使わない（getRaceDataForRace が null）', () => {
  const ctx = makeCtx();
  setup(ctx, { rdDate: 'yday' });
  assert.strictEqual(ctx.getRaceDataForRace(15, 3), null);
  setup(ctx, { rdDate: 'today' });
  assert.ok(ctx.getRaceDataForRace(15, 3));
});

t('前日の series.json + 今日の確定結果（今日 = 3 日目、1 走目 3R の 2 着が 5 枠目に入る）', () => {
  const ctx = makeCtx();
  setup(ctx, { seriesDate: 'yday' });
  const s = ctx._seriesSlotsFor(15, null, 1, 4001);
  assert.strictEqual(s.length, 14);
  assert.strictEqual(s[3].place, 4, '前日の 2 走目');
  assert.strictEqual(JSON.stringify(s[4]), JSON.stringify({ waku: 1, course: 2, place: 2, st: '.11' }));
  assert.strictEqual(s[5], null, '9R は未確定');
});

t('前日が最終日なら前日の series は使わない（新しい節）', () => {
  const ctx = makeCtx();
  setup(ctx, { seriesDate: 'yday', ssExtra: { final: true } });
  const s = ctx._seriesSlotsFor(15, null, 1, 4001);
  assert.ok(s.every((x) => x == null), JSON.stringify(s));
});

t('前日が中止なら日目は進まない', () => {
  const ctx = makeCtx();
  setup(ctx, { seriesDate: 'yday', ssExtra: { held: false } });
  const s = ctx._seriesSlotsFor(15, null, 1, 4001);
  assert.strictEqual(s[2].place, 2, '今日 = 2 日目の 1 走目');
});

t('今日の racedata: 日目はラベルから、取得後に確定したレースを今日の枠に足す', () => {
  const ctx = makeCtx();
  setup(ctx, { rdDate: 'today' });
  const rd = ctx.getRaceDataForRace(15, 3);
  const s = ctx._seriesSlotsFor(15, rd, 1, 4001);
  assert.strictEqual(s[0].place, 1);
  assert.strictEqual(s[4].place, 2, '3 日目の 1 走目');
});

t('今日の series.json があれば racedata より優先（取得後の結果入り）', () => {
  const ctx = makeCtx();
  setup(ctx, { rdDate: 'today', seriesDate: 'today' });
  const s = ctx._seriesSlotsFor(15, ctx.getRaceDataForRace(15, 3), 1, 4001);
  assert.strictEqual(s[3].place, 4, 'series 側の枠');
  assert.strictEqual(s[2].place, 2, '今日 (2 日目) の 1 走目');
});

t('結果の ST が無い（旧形式）なら進入は出さない', () => {
  const ctx = makeCtx();
  setup(ctx, { seriesDate: 'yday' });
  ctx.resultData[15][3].results[0].racer_start_timing = null;
  const s = ctx._seriesSlotsFor(15, null, 1, 4001);
  assert.strictEqual(s[4].course, null);
  assert.strictEqual(s[4].st, '');
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

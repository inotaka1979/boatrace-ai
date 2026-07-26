/**
 * PR-11: オフライン履歴バックテスト CLI のテスト。
 *
 *   node scripts/tests/test_backtest_offline.mjs
 *
 * 合成 3 日分アーカイブで CLI を完走させ、5 戦略の指標 + notes を検証する。
 * baseline_inner の的中率が「1 号艇勝率」の設計値近傍に出ることを sanity とし、
 * forward-chain によるリーク防止（stadiumDB が予測に効く）も確認する。
 */

'use strict';

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'scripts', 'backtest_offline.mjs');
const require = createRequire(import.meta.url);
const { makeCtx } = require('./_vm_harness.js');
const bt = await import('../backtest_offline.mjs');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

// ---- 合成データ生成 ----
function boat(bn, cls, nat) {
  return {
    racer_boat_number: bn, racer_number: 4000 + bn, racer_class_number: cls,
    racer_national_top_1_percent: nat, racer_local_top_2_percent: 30 + nat * 3,
    racer_assigned_motor_top_2_percent: 35, racer_assigned_boat_top_2_percent: 34,
    racer_flying_count: 0, racer_late_count: 0,
  };
}
function makeDay(dir, date, nRaces, winnerFor) {
  fs.mkdirSync(dir, { recursive: true });
  const programs = [], results = [], odds = [];
  for (let i = 0; i < nRaces; i++) {
    const sid = (i % 6) + 1, rno = (i % 12) + 1;
    const winner = winnerFor(i);
    const boats = [boat(1, 1, 7), boat(2, 2, 5), boat(3, 2, 5), boat(4, 3, 4.5), boat(5, 3, 4), boat(6, 4, 3.5)];
    programs.push({ race_stadium_number: sid, race_number: rno, race_grade_number: 1, boats });
    // 着順: winner を 1 着、残りは番号順
    const order = [winner].concat([1, 2, 3, 4, 5, 6].filter((b) => b !== winner));
    const rboats = order.map((bn, idx) => ({ racer_boat_number: bn, racer_place_number: idx + 1, racer_course_number: bn }));
    const tri = order.slice(0, 3).join('-');
    results.push({
      race_stadium_number: sid, race_number: rno, boats: rboats,
      payouts: { trifecta: [{ combination: tri, amount: 2000 }], win: [{ combination: String(winner), amount: winner === 1 ? 150 : 600 }] },
    });
    const triOdds = {}; triOdds[tri] = 20; triOdds['1-2-3'] = 6; triOdds['2-1-3'] = 15;
    odds.push({ stadium: sid, race: rno, trifecta: triOdds, win: { 1: 1.5, 2: 5, 3: 6, 4: 9, 5: 14, 6: 22 } });
  }
  fs.writeFileSync(path.join(dir, 'programs.json'), JSON.stringify({ programs }));
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ results }));
  fs.writeFileSync(path.join(dir, 'odds.json'), JSON.stringify({ odds }));
}

function buildArchive() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-'));
  const arch = path.join(base, 'archive');
  // 1 号艇が 12 レース中 7 レース勝つ (~58%、実際の 1 コース勝率近傍) パターン
  const winnerFor = (i) => (i % 12 < 7 ? 1 : ((i % 5) + 2));
  ['20260401', '20260402', '20260403'].forEach((d) => makeDay(path.join(arch, d), d, 12, winnerFor));
  return { base, arch };
}

console.log('[CLI integration — 3 days x 12 races]');
t('runs, emits 5 strategies + notes + calibration', () => {
  const { arch } = buildArchive();
  const out = path.join(arch, 'out.json');
  execFileSync('node', [CLI, '--from', '20260401', '--to', '20260403', '--archive', arch, '--out', out], { stdio: 'pipe' });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(r.daysUsed, 3);
  assert.strictEqual(r.racesScored, 36);
  ['model_prob', 'model_ev', 'baseline_inner', 'baseline_fav', 'baseline_pop3'].forEach((s) => {
    assert.ok(r.strategies[s], 'missing ' + s);
    assert.ok(r.strategies[s].roiCI && typeof r.strategies[s].roiCI.lo === 'number', s + ' roiCI');
  });
  assert.ok(r.leakageNote && r.oddsNote, 'notes present');
  assert.ok(r.modelCalibration && typeof r.modelCalibration.logLoss === 'number');
});
t('baseline_inner hitRate near the 1-boat win rate (~0.55)', () => {
  const { arch } = buildArchive();
  const out = path.join(arch, 'out.json');
  execFileSync('node', [CLI, '--from', '20260401', '--to', '20260403', '--archive', arch, '--out', out], { stdio: 'pipe' });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  // 合成では 1 号艇が 55% 勝つ設計 → baseline_inner の hitRate はその近傍
  assert.ok(Math.abs(r.strategies.baseline_inner.hitRate - 0.55) < 0.12,
    'hitRate=' + r.strategies.baseline_inner.hitRate);
});
t('no archive days → exit 3', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-empty-'));
  let code = 0;
  try { execFileSync('node', [CLI, '--from', '20260401', '--to', '20260401', '--archive', empty], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  assert.strictEqual(code, 3);
});

console.log('[unit — forward-chain / leak sensitivity]');
t('foldResultsIntoDB accumulates stadiumDB wins/races and recentResults', () => {
  const racerDB = {}, stadiumDB = {};
  const day = {
    programs: [{ race_stadium_number: 7, race_number: 1, boats: [{ racer_boat_number: 1, racer_number: 9001 }] }],
    results: [{ race_stadium_number: 7, race_number: 1, boats: [{ racer_boat_number: 1, racer_course_number: 1, racer_place_number: 1 }] }],
  };
  bt.foldResultsIntoDB(day, racerDB, stadiumDB);
  assert.strictEqual(stadiumDB[7].courseWinRate[1].win, 1);
  assert.strictEqual(stadiumDB[7].courseWinRate[1].races, 1);
  assert.deepStrictEqual(racerDB['9001'].recentResults, [1]);
});
t('stadiumDB favoring course 1 raises the 1-boat probability (why leak matters)', () => {
  const ctx = makeCtx();
  ctx.programData = { 7: { 1: { race_grade_number: 1, boats: [
    { racer_boat_number: 1, racer_number: 5001, racer_class_number: 2, racer_national_top_1_percent: 5, racer_local_top_2_percent: 35, racer_assigned_motor_top_2_percent: 35, racer_assigned_boat_top_2_percent: 34, racer_flying_count: 0, racer_late_count: 0 },
    { racer_boat_number: 2, racer_number: 5002, racer_class_number: 2, racer_national_top_1_percent: 5, racer_local_top_2_percent: 35, racer_assigned_motor_top_2_percent: 35, racer_assigned_boat_top_2_percent: 34, racer_flying_count: 0, racer_late_count: 0 },
    { racer_boat_number: 3, racer_number: 5003, racer_class_number: 2, racer_national_top_1_percent: 5, racer_local_top_2_percent: 35, racer_assigned_motor_top_2_percent: 35, racer_assigned_boat_top_2_percent: 34, racer_flying_count: 0, racer_late_count: 0 },
    { racer_boat_number: 4, racer_number: 5004, racer_class_number: 3, racer_national_top_1_percent: 4, racer_local_top_2_percent: 30, racer_assigned_motor_top_2_percent: 33, racer_assigned_boat_top_2_percent: 32, racer_flying_count: 0, racer_late_count: 0 },
    { racer_boat_number: 5, racer_number: 5005, racer_class_number: 3, racer_national_top_1_percent: 4, racer_local_top_2_percent: 30, racer_assigned_motor_top_2_percent: 33, racer_assigned_boat_top_2_percent: 32, racer_flying_count: 0, racer_late_count: 0 },
    { racer_boat_number: 6, racer_number: 5006, racer_class_number: 4, racer_national_top_1_percent: 3, racer_local_top_2_percent: 26, racer_assigned_motor_top_2_percent: 31, racer_assigned_boat_top_2_percent: 31, racer_flying_count: 0, racer_late_count: 0 } ] } } };
  ctx.previewData = {}; ctx.oddsData = null; ctx.racerDB = {}; ctx.l2trainStep = 0;
  ctx.settings = { betCount3: 10, betCount2: 5, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'off' };

  ctx.stadiumDB = {};
  const probEmpty = probOfBoat(ctx.predictRace(7, 1), 1);
  // course 1 が高勝率の stadiumDB を注入 (leak を模擬)
  ctx.stadiumDB = { 7: { courseWinRate: { 1: { races: 50, win: 45 }, 2: { races: 50, win: 5 } } } };
  const probLeak = probOfBoat(ctx.predictRace(7, 1), 1);
  assert.ok(probLeak > probEmpty, `leak ${probLeak} should exceed clean ${probEmpty}`);
});

console.log('[unit — flat layout loadDay (archive_daily 出力)]');
t('loadDay reads flat data/<domain>/<date>.json', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-flat-'));
  fs.mkdirSync(path.join(base, 'programs'), { recursive: true });
  fs.mkdirSync(path.join(base, 'results'), { recursive: true });
  fs.mkdirSync(path.join(base, 'odds'), { recursive: true });
  fs.writeFileSync(path.join(base, 'programs', '20260401.json'),
    JSON.stringify({ programs: [{ race_stadium_number: 1, race_number: 1, boats: [] }] }));
  fs.writeFileSync(path.join(base, 'results', '20260401.json'),
    JSON.stringify({ results: [{ race_stadium_number: 1, race_number: 1, boats: [] }] }));
  fs.writeFileSync(path.join(base, 'odds', '20260401.json'),
    JSON.stringify({ odds: [{ stadium: 1, race: 1, win: { 1: 1.5 } }] }));
  const day = bt.loadDay(base, '20260401');
  assert.ok(day, 'flat layout should load');
  assert.strictEqual(day.programs.length, 1);
  assert.strictEqual(day.results.length, 1);
  assert.strictEqual(day.odds.length, 1);
});
t('loadDay returns null when programs/results missing', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-none-'));
  assert.strictEqual(bt.loadDay(base, '20260401'), null);
});

console.log('[unit — scoring helpers]');
t('favoriteBoat picks the lowest win odds', () => {
  assert.strictEqual(bt.favoriteBoat({ 1: 3.0, 2: 1.8, 3: 5.0 }), 2);
});
t('actualOrder sorts by finishing place', () => {
  assert.deepStrictEqual(bt.actualOrder({ boats: [
    { racer_boat_number: 4, racer_place_number: 2 },
    { racer_boat_number: 2, racer_place_number: 1 },
    { racer_boat_number: 6, racer_place_number: 3 }] }), [2, 4, 6]);
});
t('computeECE returns logLoss/brier/ece for a perfect and a wrong call', () => {
  const c = bt.computeECE([
    { logLoss: 0.1, brier: 0.05, topProb: 0.9, correct: true },
    { logLoss: 2.0, brier: 0.8, topProb: 0.9, correct: false },
  ]);
  assert.ok(c.logLoss > 0 && c.brier > 0 && c.ece >= 0 && c.n === 2);
});
t('scoreWinBet pays only on a hit', () => {
  const rec = { races: 0, bets: 0, stake: 0, payout: 0, hits: 0, perRace: [] };
  bt.scoreWinBet(rec, 1, 1, { 1: 150 });
  bt.scoreWinBet(rec, 1, 2, { 2: 600 });
  assert.strictEqual(rec.hits, 1);
  assert.strictEqual(rec.payout, 150);
  assert.strictEqual(rec.stake, 200);
});

function probOfBoat(bets, boat) {
  const m = bets.marks.find((x) => x.boat === boat);
  return m ? m.prob : 0;
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

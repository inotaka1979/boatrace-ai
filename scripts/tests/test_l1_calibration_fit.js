/**
 * L1 確率変換の当てはめと評価基盤（2026-11-20）の回帰テスト
 *
 *   - predictRace の L1 確率は exp(score / L1_TEMPERATURE + 重み × COURSE_LOG_PRIOR[コース]) に従う
 *     （従来は exp(score/15) 固定で、外枠を ~4 倍過大評価し固定のコース勝率表に負けていた）
 *   - L1_TEMPERATURE / L1_COURSE_PRIOR_WEIGHT / MODEL_VERSION は worker にも同じ値で転記される
 *   - l2Predict のコース事前分布は配列順ではなく進入コースで引く
 *   - 校正の当てはめは backfilled と旧モデル (model_v 不一致) の予想を使わない
 *   - 履歴に model_v が記録される / schema v5 で旧校正をリセット
 *   - backtest: 確率ベースライン・paired 差・艇別信頼性・多クラス ECE
 *
 *   node scripts/tests/test_l1_calibration_fit.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  pending.push(async () => {
    try { await fn(); console.log('  PASS:', name); pass++; }
    catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
  });
}

const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'golden', 'race_konsen.json'), 'utf8'));
function l1Probs(ctx) {
  Object.assign(ctx, {
    programData: { [fx.sid]: { [fx.rno]: fx.program } },
    previewData: { [fx.sid]: { [fx.rno]: fx.preview } },
    oddsData: { odds: [] }, racerDB: {}, stadiumDB: {}, l2trainStep: 0,
    settings: { betCount3: '10', betCount2: '5', betMethod: 'prob' },
  });
  // L2 を無効化して L1 だけを見る（α=1）
  let captured = null;
  const origSoft = ctx.l2Predict;
  ctx.l2Predict = (f) => origSoft(f);
  const origScore = ctx.scoreBoatV2;
  const scores = [];
  ctx.scoreBoatV2 = function () { const s = origScore.apply(null, arguments); scores.push(s); return s; };
  const b = ctx.predictRace(fx.sid, fx.rno);
  captured = { scores, marks: b.marks };
  ctx.scoreBoatV2 = origScore;
  return captured;
}

console.log('[L1 確率変換]');
t('既定値は当てはめ結果 (T=25, 重み 0.6)', () => {
  const ctx = makeCtx();
  assert.strictEqual(ctx.L1_TEMPERATURE, 25);
  assert.strictEqual(ctx.L1_COURSE_PRIOR_WEIGHT, 0.6);
});
t('温度・重みを変えると L1 の確率が式どおりに変わる（重み 0・T=15 で従来の exp(score/15)）', () => {
  const ctx = makeCtx();
  ctx.L1_TEMPERATURE = 15;
  ctx.L1_COURSE_PRIOR_WEIGHT = 0;
  const a = l1Probs(ctx);
  const z = a.scores.map((s) => Math.exp(s.score / 15));
  const tot = z.reduce((x, y) => x + y, 0);
  // predictRace の marks は L1/L2 融合 + 校正後なので、L1 の式は予測の中間値で直接確認する
  const src = fs.readFileSync(path.join(ROOT, 'src', 'analysis', 'predict_race.js'), 'utf8');
  assert.ok(/s\.score \/ _l1T \+ \(_l1B \? _l1B \* \(COURSE_LOG_PRIOR\[c - 1\]/.test(src), '式が変わっている');
  assert.ok(tot > 0 && a.scores.length === 6);
});
t('コース事前分布の重みを上げると 1 コースの確率が上がる', () => {
  const lo = makeCtx(); lo.L1_COURSE_PRIOR_WEIGHT = 0;
  const hi = makeCtx(); hi.L1_COURSE_PRIOR_WEIGHT = 1.0;
  const p1 = (c) => l1Probs(c).marks.find((m) => m.boat === 1).prob;
  assert.ok(p1(hi) > p1(lo) + 0.05, 'lo ' + p1(lo) + ' / hi ' + p1(hi));
});
t('worker にも同じ値が転記される', () => {
  const w = fs.readFileSync(path.join(ROOT, 'assets', 'worker_predictor.js'), 'utf8');
  assert.ok(/^var L1_TEMPERATURE = 25;/m.test(w));
  assert.ok(/^var L1_COURSE_PRIOR_WEIGHT = 0\.6;/m.test(w));
  assert.ok(/^var MODEL_VERSION = 2;/m.test(w));
});

console.log('[l2Predict のコース事前分布]');
t('進入が枠番と違うとき、事前分布はコースで引く', () => {
  const ctx = makeCtx();
  ctx.l2weights = new Array(24).fill(0);
  ctx._featureStats = { n: 0, mean: new Array(24).fill(0), m2: new Array(24).fill(1) };
  // 枠番 1..6 の艇が、2 号艇 = 1 コース / 1 号艇 = 2 コースに入れ替わった
  const f = (course) => { const v = new Array(24).fill(0); v[3] = course / 6; return v; };
  const p = ctx.l2Predict([f(2), f(1), f(3), f(4), f(5), f(6)]);
  assert.ok(p[1] > p[0] * 2, '1 コース (2 号艇) が最上位になっていない: ' + p.map((x) => x.toFixed(3)).join(','));
});

console.log('[校正の当てはめ対象]');
t('backfilled と旧モデルの予想は校正に使わない', () => {
  const ctx = makeCtx();
  const mk = (extra) => Object.assign({ actual: [1, 2, 3], raw_probs: [1, 2, 3, 4, 5, 6].map((b) => ({ boat: b, prob: b === 1 ? 0.5 : 0.1 })) }, extra);
  const n = Math.max(ctx.TUNING.PREDICTION.PLATT_MIN_SAMPLES, 50);
  const cur = Array.from({ length: n }, () => mk({ model_v: 2 }));
  assert.ok(ctx._extractPlattPairs(cur).length > 0, '現行モデルの予想が使われない');
  assert.strictEqual(ctx._extractPlattPairs(cur.map((h) => Object.assign({}, h, { backfilled: true }))).length, 0, 'backfilled を使った');
  assert.strictEqual(ctx._extractPlattPairs(cur.map((h) => Object.assign({}, h, { model_v: undefined }))).length, 0, '旧モデルを使った');
});
t('履歴の予想に model_v が記録される', () => {
  const ctx = makeCtx();
  const f = ctx._predFields({ marks: [{ boat: 1, prob: 0.5, probRaw: 0.5 }], trifecta: [], exacta: [] });
  assert.strictEqual(f.model_v, 2);
});
t('schema v5 migration で旧校正をリセット', () => {
  const ctx = makeCtx();
  assert.strictEqual(ctx.CURRENT_SCHEMA, 5);
  ['boatrace_platt', 'boatrace_platt_perstadium', 'boatrace_isotonic', 'boatrace_calib_method'].forEach((k) => ctx.localStorage.setItem(k, '{"a":1}'));
  ctx.localStorage.setItem('boatrace_schema_version', '4');
  ctx._runMigrations();
  ['boatrace_platt', 'boatrace_platt_perstadium', 'boatrace_isotonic', 'boatrace_calib_method'].forEach((k) => assert.strictEqual(ctx.localStorage.getItem(k), null, k));
  assert.strictEqual(ctx.localStorage.getItem('boatrace_schema_version'), '5');
});

console.log('[backtest の評価指標]');
t('確率ベースライン・paired 差・信頼性・多クラス ECE', async () => {
  const bt = await import(path.join(ROOT, 'scripts', 'backtest_offline.mjs'));
  const cwr = { 1: 0.55, 2: 0.14, 3: 0.12, 4: 0.11, 5: 0.06, 6: 0.02 };
  const courses = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
  const p = bt.courseTableProbs(cwr, courses);
  assert.ok(Math.abs(Object.values(p).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(p[1] - 0.55) < 1e-9);
  // 進入が入れ替わるとコースで引く
  const sw = bt.courseTableProbs(cwr, Object.assign({}, courses, { 1: 2, 2: 1 }));
  assert.ok(Math.abs(sw[2] - 0.55) < 1e-9);
  // 単勝オッズ: 6 艇揃わなければ null
  assert.strictEqual(bt.marketProbs({ 1: 1.5 }), null);
  const m = bt.marketProbs({ 1: 2, 2: 4, 3: 4, 4: 8, 5: 8, 6: 8 });
  assert.ok(Math.abs(m[1] - 0.5 / (0.5 + 0.25 * 2 + 0.125 * 3)) < 1e-9);
  // paired 差: model が常に 0.1 悪い → mean 0.1、CI も 0.1
  const rows = Array.from({ length: 50 }, () => ({ model: { logLoss: 1.1 }, course: { logLoss: 1.0 } }));
  const d = bt.pairedDiff(rows, 'course', 200);
  assert.strictEqual(d.mean, 0.1);
  assert.strictEqual(d.lo, 0.1);
  // 信頼性: 予測の平均と実際の 1 着率
  const rr = [{ modelP: { 1: 0.6, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.05, 6: 0.05 }, winner: 1 }, { modelP: { 1: 0.4, 2: 0.2, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 }, winner: 2 }];
  const rel = bt.reliabilityByBoat(rr);
  assert.strictEqual(rel[1].predicted, 0.5);
  assert.strictEqual(rel[1].actual, 0.5);
  // 多クラス ECE: 完全校正（一様 1/6 で 6 艇が均等に勝つ）なら 0
  const uni = { 1: 1 / 6, 2: 1 / 6, 3: 1 / 6, 4: 1 / 6, 5: 1 / 6, 6: 1 / 6 };
  assert.ok(bt.multiclassECE([1, 2, 3, 4, 5, 6].map((w) => ({ modelP: uni, winner: w }))) < 1e-9);
});
t('backtest --l2: 学習入力は app と同じ形（race_date 付き programData、確定のみ）', async () => {
  const bt = await import(path.join(ROOT, 'scripts', 'backtest_offline.mjs'));
  const day = {
    date: '20261105',
    results: [
      { race_stadium_number: 1, race_number: 1, boats: [1, 2, 3, 4, 5, 6].map((b) => ({ racer_boat_number: b, racer_place_number: b })) },
      { race_stadium_number: 1, race_number: 2, boats: [] },
    ],
  };
  const state = { programData: { 1: { 1: { boats: [] }, 2: { boats: [] } } }, previewData: {} };
  const li = bt.learnInputs(day, state);
  assert.deepStrictEqual(Object.keys(li.resultData[1]), ['1']);
  assert.strictEqual(li.programData[1][1].race_date, '2026-11-05');
  assert.strictEqual(li.resultData[1][1].results[0].place, 1);
});

(async () => {
  for (const run of pending) await run();
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail);
})();

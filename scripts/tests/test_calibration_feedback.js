/**
 * 確率校正の再フィット フィードバックループ 回帰テスト（FA-7 / 2026-08-11）
 *
 * 監査で確定したバグ:
 *   savePrediction が履歴に残す mark_probs は「校正“後”」の確率だが、
 *   _refitPlattCoeffs / _refitPerStadiumPlatt / _refitIsotonicCalibration /
 *   _chooseCalibrationMethod は全てその mark_probs で再フィットしていた。
 *   つまり「校正の上に校正を重ねる」ループになっており、実測では不動点に収束せず
 *
 *     round 1: a=0.60 b=-0.50  raw0.5 -> 0.3775
 *     round 2: a=1.00 b= 0.00  raw0.5 -> 0.5000
 *     round 3: a=0.60 b=-0.50  raw0.5 -> 0.3775   (以下 振動)
 *
 *   と 2 値を往復していた。同じレースの表示確率が「設定画面を何回開いたか」で
 *   0.50 ⇔ 0.38 と変わる状態。
 *
 * 修正: 校正“前”の確率を raw_probs として保存し、_extractPlattPairs は raw を使う。
 *   raw_probs を持たない旧エントリは、現在の校正が identity のときだけ採用する。
 *
 *   node scripts/tests/test_calibration_feedback.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');

// ANALYSIS_CALIBRATION bundle を切り出して sandbox で評価する
function extractMarker(name) {
  const s = APP.indexOf(`/* BUILD:${name}:START */`);
  const e = APP.indexOf(`/* BUILD:${name}:END */`);
  assert.ok(s >= 0 && e > s, `marker ${name} が見つからない`);
  return APP.slice(s, e);
}

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

function makeCtx(overrides) {
  const ctx = {
    console,
    Math,
    Number,
    Object,
    Array,
    JSON,
    Date,
    isNaN,
    FEATURE_DIM: 24,
    L2_BIAS: 0,
    COURSE_LOG_PRIOR: [0, 0, 0, 0, 0, 0],
    l2weights: new Array(24).fill(0),
    l2trainStep: 0,
    _stackingGamma: 0,
    _featureStats: { mean: new Array(24).fill(0), m2: new Array(24).fill(0), n: 0 },
    _plattCoeffs: { a: 1, b: 0 },
    _plattCoeffsByStadium: {},
    _isotonicCoeffs: null,
    _calibrationMethod: 'platt',
    softmax: (x) => x,
    safeSet: () => true,
    localStorage: { getItem: () => null, setItem: () => {} },
    TUNING: {
      PREDICTION: {
        ENABLE_PLATT: true,
        ENABLE_ZSCORE: false,
        ZSCORE_WARMUP_N: 100,
        STACKING_MODE: 'shrinkage',
        PLATT_MIN_SAMPLES: 20,
      },
    },
  };
  Object.assign(ctx, overrides || {});
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(extractMarker('ANALYSIS_CALIBRATION'), ctx);
  return ctx;
}

// --- 決定的な合成履歴 -------------------------------------------------------
// 過信モデル: 真の確率 t に対し sigmoid(1.6*logit(t)) を出力する。
function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function sig(z) { return z > 30 ? 1 : z < -30 ? 0 : 1 / (1 + Math.exp(-z)); }
function overconfident(p) {
  const c = Math.min(0.9999, Math.max(0.0001, p));
  return sig(1.6 * Math.log(c / (1 - c)));
}

function buildHistory(n) {
  const rnd = lcg(12345);
  const hist = [];
  for (let i = 0; i < n; i++) {
    const raw = [];
    let s = 0;
    for (let b = 0; b < 6; b++) { const v = Math.exp(rnd() * 2.2); raw.push(v); s += v; }
    const truth = raw.map((v) => v / s);
    let u = rnd(), winner = 6;
    for (let b = 0; b < 6; b++) { u -= truth[b]; if (u <= 0) { winner = b + 1; break; } winner = b + 1; }
    const model = truth.map(overconfident);
    const ms = model.reduce((a, x) => a + x, 0);
    const probs = model.map((x) => x / ms);
    hist.push({
      date: '2026-08-01',
      stadium: (i % 3) + 1,
      race: (i % 12) + 1,
      actual: [winner],
      raw_probs: probs.map((p, b) => ({ boat: b + 1, prob: p })),
      mark_probs: probs.map((p, b) => ({ boat: b + 1, prob: p })),
    });
  }
  return hist;
}

// 履歴の mark_probs を「現在の校正を適用した値」に更新する = 実運用の挙動を模す
function recalibrateMarkProbs(ctx, hist) {
  hist.forEach((h) => {
    const cal = h.raw_probs.map((mp) => ctx._applyCalibration(mp.prob, h.stadium));
    const s = cal.reduce((a, x) => a + x, 0);
    h.mark_probs = cal.map((p, i) => ({ boat: i + 1, prob: s > 0 ? p / s : p }));
  });
}

console.log('=== 校正 再フィットのフィードバックループ (FA-7) ===');

t('raw_probs で再フィットすると係数が不動点に収束する', () => {
  const ctx = makeCtx();
  const hist = buildHistory(300);
  const seen = [];
  for (let round = 0; round < 4; round++) {
    recalibrateMarkProbs(ctx, hist); // mark_probs は毎回 校正後に更新される
    const pairs = ctx._extractPlattPairs(hist);
    assert.ok(pairs.length > 0, 'pairs が空');
    // grid search は _refitPlattCoeffs 内なので、pairs の中身が raw であることを確認
    const first = pairs[0].p;
    seen.push(first);
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(Math.abs(seen[i] - seen[0]) < 1e-12,
      `round ${i} の抽出値が変動している (${seen[0]} -> ${seen[i]}) = 校正後を拾っている`);
  }
});

t('mark_probs が校正で変化しても _extractPlattPairs の出力は不変', () => {
  const ctx = makeCtx();
  const hist = buildHistory(120);
  const before = ctx._extractPlattPairs(hist).map((x) => x.p);
  ctx._plattCoeffs = { a: 0.6, b: -0.5 }; // 校正を非 identity に
  recalibrateMarkProbs(ctx, hist);
  const after = ctx._extractPlattPairs(hist).map((x) => x.p);
  assert.strictEqual(before.length, after.length);
  for (let i = 0; i < before.length; i++) {
    assert.ok(Math.abs(before[i] - after[i]) < 1e-12, 'i=' + i + ' で値が変わった');
  }
});

t('raw_probs 無しの旧エントリは identity のときだけ採用される', () => {
  const hist = buildHistory(120).map((h) => {
    const c = Object.assign({}, h);
    delete c.raw_probs;
    return c;
  });
  const idn = makeCtx();
  assert.ok(idn._extractPlattPairs(hist).length > 0, 'identity なのに旧エントリを捨てている');

  const cal = makeCtx({ _plattCoeffs: { a: 0.6, b: -0.5 } });
  assert.strictEqual(cal._extractPlattPairs(hist).length, 0,
    '非 identity なのに校正後の旧エントリを再フィットに使っている');
});

t('raw_probs 有りエントリは校正が非 identity でも使われる', () => {
  const cal = makeCtx({ _plattCoeffs: { a: 0.6, b: -0.5 } });
  assert.ok(cal._extractPlattPairs(buildHistory(120)).length > 0);
});

t('場別 Platt も raw で fit する（allowLegacy を引き継ぐ）', () => {
  const cal = makeCtx({ _plattCoeffs: { a: 0.6, b: -0.5 } });
  const hist = buildHistory(120).map((h) => {
    const c = Object.assign({}, h);
    delete c.raw_probs;
    return c;
  });
  // allowLegacy=false を明示 → 旧エントリしかないので場別も学習されない
  assert.deepStrictEqual(
    Object.keys(cal._refitPerStadiumPlatt(hist, false)), [],
    '校正後の旧エントリで場別 Platt を学習している');
});

t('pairs は winner に y=1、他艇に y=0 を割り当てる', () => {
  const ctx = makeCtx();
  const hist = buildHistory(30);
  const pairs = ctx._extractPlattPairs(hist);
  const ones = pairs.filter((x) => x.y === 1).length;
  const zeros = pairs.filter((x) => x.y === 0).length;
  assert.strictEqual(ones, 30, '1 レース 1 winner になっていない');
  assert.strictEqual(zeros, 30 * 5);
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

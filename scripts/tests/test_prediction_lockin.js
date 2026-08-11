/**
 * look-ahead leakage 回帰テスト（2026-08-11 追加）
 *
 * 旧実装の savePrediction は「既存が actual 無し + 新規 result あり」で既存を
 * splice し、**確定後に再計算した予想で置き換えて**いた。再計算時点では当該レースの
 * 結果が racerDB.recentResults（getRacerForm が直近 5 走として参照）と L2 に反映済み、
 * オッズも確定値のため、成績タブの的中率・回収率が構造的に楽観化していた。
 *
 * 本テストは「締切前に保存した予想は結果到着後も不変で、結果だけが追記される」
 * ことを固定する。
 *
 *   node scripts/tests/test_prediction_lockin.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

const DATE = '20260811';

/** 締切前の予想（1 号艇本命） */
function prePred() {
  return {
    marks: [
      { boat: 1, prob: 0.45, score: 60, mark: '◎' }, { boat: 2, prob: 0.20, score: 50, mark: '○' },
      { boat: 3, prob: 0.15, score: 45, mark: '▲' }, { boat: 4, prob: 0.10, score: 40, mark: '△' },
      { boat: 5, prob: 0.06, score: 35, mark: '×' }, { boat: 6, prob: 0.04, score: 30, mark: '×' },
    ],
    trifecta: [{ combo: '1-2-3', prob: 0.2 }, { combo: '1-3-2', prob: 0.1 }],
    exacta: [{ combo: '1-2', prob: 0.3 }],
    ana: ['4-5-6'], raceType: 'honmei', confidence: 45, confStars: 4,
  };
}
/** 結果を知った後に再計算した「事後予想」（勝った 5 号艇を本命にしてしまう） */
function postPred() {
  return {
    marks: [
      { boat: 5, prob: 0.80, score: 90, mark: '◎' }, { boat: 1, prob: 0.08, score: 40, mark: '○' },
      { boat: 2, prob: 0.05, score: 35, mark: '▲' }, { boat: 3, prob: 0.04, score: 30, mark: '△' },
      { boat: 4, prob: 0.02, score: 25, mark: '×' }, { boat: 6, prob: 0.01, score: 20, mark: '×' },
    ],
    trifecta: [{ combo: '5-1-2', prob: 0.5 }], exacta: [{ combo: '5-1', prob: 0.6 }],
    ana: [], raceType: 'ana', confidence: 80, confStars: 5,
  };
}
const RESULT = {
  isFinished: true, race_date: '2026-08-11',
  results: [
    { racer_boat_number: 5, place: 1 }, { racer_boat_number: 1, place: 2 },
    { racer_boat_number: 2, place: 3 }, { racer_boat_number: 3, place: 4 },
    { racer_boat_number: 4, place: 5 }, { racer_boat_number: 6, place: 6 },
  ],
  refund: { trifecta: [{ combination: '5-1-2', payout: 12000 }] },
};

function historyOf(ctx) {
  return JSON.parse(ctx.localStorage.getItem('boatrace_history') || '[]');
}

console.log('[締切前予想の lock-in]');
t('結果到着後も締切前の予想が置き換えられない', () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem('boatrace_history', '[]');
  ctx.savePrediction(DATE, 7, 3, prePred(), null);          // 締切前
  ctx.savePrediction(DATE, 7, 3, postPred(), RESULT);       // 確定後の再計算
  const h = historyOf(ctx);
  assert.strictEqual(h.length, 1, '重複エントリ: ' + h.length);
  // 予想は締切前のもののまま
  assert.deepStrictEqual(h[0].predicted, [1, 2, 3, 4, 5, 6], '予想が事後予想で上書きされた');
  assert.deepStrictEqual(h[0].trifecta_bets, ['1-2-3', '1-3-2'], '買い目が上書きされた');
  assert.strictEqual(h[0].raceType, 'honmei', 'raceType が上書きされた');
  const p1 = h[0].mark_probs.find((m) => m.boat === 1).prob;
  assert.ok(Math.abs(p1 - 0.45) < 1e-9, '確率が事後値で上書きされた: ' + p1);
});

t('結果（actual / 的中 / 払戻）は正しく追記される', () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem('boatrace_history', '[]');
  ctx.savePrediction(DATE, 7, 3, prePred(), null);
  ctx.savePrediction(DATE, 7, 3, postPred(), RESULT);
  const e = historyOf(ctx)[0];
  assert.deepStrictEqual(e.actual, [5, 1, 2, 3, 4, 6], 'actual が付かない');
  // 締切前の買い目 1-2-3 は実際の 5-1-2 と一致しない → 不的中が正しい
  assert.strictEqual(e.trifecta_hit, false, '事後予想で的中扱いになっている（leakage）');
});

t('確定後に初めて生成された予想は backfilled 印が付く', () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem('boatrace_history', '[]');
  ctx.savePrediction(DATE, 7, 5, postPred(), RESULT);   // 締切前の保存が無いケース
  const e = historyOf(ctx)[0];
  assert.strictEqual(e.backfilled, true, '事後生成に印が付いていない');
});

t('締切前に保存された予想は backfilled ではない', () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem('boatrace_history', '[]');
  ctx.savePrediction(DATE, 7, 6, prePred(), null);
  assert.strictEqual(historyOf(ctx)[0].backfilled, false);
});

t('確定済エントリは再保存しても不変（従来の lock-in を維持）', () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem('boatrace_history', '[]');
  ctx.savePrediction(DATE, 7, 3, prePred(), RESULT);
  const before = JSON.stringify(historyOf(ctx)[0]);
  ctx.savePrediction(DATE, 7, 3, postPred(), RESULT);
  assert.strictEqual(JSON.stringify(historyOf(ctx)[0]), before, '確定済が書き換わった');
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

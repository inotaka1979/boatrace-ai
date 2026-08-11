/**
 * L2 のコース主効果 二重計上 回帰テスト（2026-08-11 追加）
 *
 * PB-11 で COURSE_LOG_PRIOR（全国コース別 1 着率の log）を logit に加算するように
 * したが、その前から存在した courseNorm（特徴量 index 3 = course/6）の手書き重み
 * -4.0 を残したため、コースの主効果が二重計上されていた。
 * 実測: prior 3.31 logit + courseNorm 3.33 logit = 6.64（オッズ比 765:1）に対し、
 * 実勢の 1 コース/6 コース勝率比は 0.55/0.02 = 27.5:1。約 28 倍の過信だった。
 *
 *   node scripts/tests/test_course_prior.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

const ctx = makeCtx();

console.log('[コース主効果のスプレッド]');
t('COURSE_LOG_PRIOR が全国コース別勝率と整合する', () => {
  const p = ctx.COURSE_LOG_PRIOR;
  const cwr = ctx.COURSE_WIN_RATE;
  assert.strictEqual(p.length, 6);
  for (let c = 1; c <= 6; c++) {
    assert.ok(Math.abs(p[c - 1] - Math.log(cwr[c])) < 1e-9, 'course ' + c + ' の prior が勝率と不一致');
  }
});

t('courseNorm(index 3) の初期重みは 0（主効果は prior が担う）', () => {
  assert.strictEqual(ctx.L2_INIT_WEIGHTS[3], 0,
    'index 3 に重みがあると COURSE_LOG_PRIOR と二重計上になる');
});

t('コースのみの logit スプレッドが実勢勝率比と一致する', () => {
  const p = ctx.COURSE_LOG_PRIOR, w = ctx.L2_INIT_WEIGHTS, cwr = ctx.COURSE_WIN_RATE;
  // 1 コースと 6 コースで、コースに由来する logit の差
  const spread = (p[0] - p[5]) + Math.abs((1 / 6) * w[3] - (6 / 6) * w[3]);
  const impliedRatio = Math.exp(spread);
  const actualRatio = cwr[1] / cwr[6];
  assert.ok(Math.abs(impliedRatio - actualRatio) / actualRatio < 0.01,
    'コース由来のオッズ比 ' + impliedRatio.toFixed(1) + ':1 が実勢 ' + actualRatio.toFixed(1) + ':1 と乖離');
});

console.log('[localStorage migration]');
t('CURRENT_SCHEMA が 4 以上（w[3] リセット migration を含む）', () => {
  assert.ok(ctx.CURRENT_SCHEMA >= 4, 'schema version が上がっていないと既存重みが直らない');
});

t('学習済み重みの index 3 が migration で 0 に戻る', () => {
  const c2 = makeCtx();
  // 旧スキーマのユーザーを再現: schema 3 + index3 に -4.0 を持つ学習済み重み
  const learned = ctx.L2_INIT_WEIGHTS.slice();
  learned[3] = -4.0;
  learned[0] = 3.7;   // 他の次元は学習成果 → 保持されること
  c2.localStorage.setItem('boatrace_weights', JSON.stringify(learned));
  c2.localStorage.setItem('boatrace_schema_version', '3');
  c2._runMigrations();
  const after = JSON.parse(c2.localStorage.getItem('boatrace_weights'));
  assert.strictEqual(after[3], 0, 'index 3 が 0 に戻っていない');
  assert.strictEqual(after[0], 3.7, '他次元の学習成果まで消している');
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

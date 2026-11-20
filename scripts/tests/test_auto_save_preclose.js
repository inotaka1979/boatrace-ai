/**
 * 締切前予想の自動保存（2026-11-20）
 *
 *   - 全場のうち、締切 AUTO_SAVE_WINDOW_MIN 分以内・未確定・未中止・今日のレースだけを保存する
 *   - 保存した予想は事後生成ではない（backfilled=false、結果なし）
 *   - 締切前なら次の poll で最新の予想に更新、締切後は更新しない（savePrediction の lock-in）
 *   - 90 秒 poll と deferred load の後から呼ばれる
 *
 *   node scripts/tests/test_auto_save_preclose.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  pending.push(async () => {
    try { await fn(); console.log('  PASS:', name); pass++; }
    catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
  });
}

// JST の "YYYY-MM-DD HH:MM:SS"（今から min 分後）
function closedIn(min) {
  const d = new Date(Date.now() + min * 60000 + 9 * 3600000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function setup() {
  const ctx = makeCtx();
  const today = ctx.todayStr();
  const iso = today.slice(0, 4) + '-' + today.slice(4, 6) + '-' + today.slice(6, 8);
  const race = (min, extra) => Object.assign({ race_date: iso, race_closed_at: closedIn(min), boats: [] }, extra || {});
  ctx.programData = {
    1: { 1: race(-5), 2: race(5), 3: race(30) },      // 締切済 / 5 分後 / 30 分後
    15: { 1: race(10), 2: race(12), 3: race(8) },     // 2R は確定済、3R は中止
    20: { 1: race(3, { race_date: '2000-01-01' }) },  // 別の日
  };
  ctx.resultData = { 15: { 2: { isFinished: true, results: [] }, 3: { isCancelled: true } } };
  let n = 0;
  ctx._getAppWorker = () => null;
  ctx._yieldToMain = () => Promise.resolve();
  ctx.predictRace = (sid, rn) => ({ marks: [{ boat: 1, prob: 0.5, probRaw: 0.5, mark: '◎' }], trifecta: [], exacta: [], v: ++n, sid, rn });
  ctx.localStorage.setItem('boatrace_history', '[]');
  return ctx;
}
const hist = (ctx) => JSON.parse(ctx.localStorage.getItem('boatrace_history') || '[]');

console.log('[締切前予想の自動保存]');
t('締切 15 分以内・未確定・未中止・今日のレースだけを保存', async () => {
  const ctx = setup();
  const n = await ctx._autoSavePreClosePredictions();
  const keys = hist(ctx).map((h) => h.stadium + '-' + h.race).sort();
  assert.deepStrictEqual(keys, ['1-2', '15-1']);
  assert.strictEqual(n, 2);
});
t('保存した予想は事後生成ではない（結果なし）', async () => {
  const ctx = setup();
  await ctx._autoSavePreClosePredictions();
  hist(ctx).forEach((h) => {
    assert.strictEqual(h.backfilled, false);
    assert.strictEqual(h.actual, null);
  });
});
t('締切前は次の呼び出しで更新、締切後は更新しない', async () => {
  const ctx = setup();
  await ctx._autoSavePreClosePredictions();
  const first = JSON.stringify(hist(ctx).find((h) => h.stadium === 1 && h.race === 2));
  // 予想が変わる（2 回目は別の印）
  ctx.predictRace = () => ({ marks: [{ boat: 2, prob: 0.6, probRaw: 0.6, mark: '◎' }], trifecta: [], exacta: [] });
  await ctx._autoSavePreClosePredictions();
  const second = JSON.stringify(hist(ctx).find((h) => h.stadium === 1 && h.race === 2));
  assert.notStrictEqual(first, second, '締切前なのに更新されない');
  // 締切後: savePrediction は既存の予想を書き換えない
  ctx.programData[1][2].race_closed_at = closedIn(-1);
  ctx.savePrediction(ctx.todayStr(), 1, 2, { marks: [{ boat: 6, prob: 0.9, probRaw: 0.9, mark: '◎' }], trifecta: [], exacta: [] }, null);
  assert.strictEqual(JSON.stringify(hist(ctx).find((h) => h.stadium === 1 && h.race === 2)), second);
});
t('二重起動しない（実行中の呼び出しは 0 を返す）', async () => {
  const ctx = setup();
  const a = ctx._autoSavePreClosePredictions();
  const b = await ctx._autoSavePreClosePredictions();
  assert.strictEqual(b, 0);
  await a;
});
t('90 秒 poll と deferred load の後から呼ばれる', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');
  const calls = src.match(/typeof _autoSavePreClosePredictions==='function'\) _autoSavePreClosePredictions\(\)/g) || [];
  assert.strictEqual(calls.length, 2);
});

(async () => {
  for (const run of pending) await run();
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail);
})();

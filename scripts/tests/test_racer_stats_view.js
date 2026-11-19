/**
 * レース詳細の長期集計 4 行（2026-11-20）
 *
 *   - data/db/racer_stats_view.json を初回だけ取得し、届くまでは何も足さない（描画を待たせない）
 *   - コース成績は展示の進入コースで引く（無ければ枠番）
 *   - 1 コースは逃げ率と負け方（差され / 捲られ…）、他コースは勝ち決まり手の内訳
 *   - 平均 ST と展示とのズレ（3 件以上）、F 回数、モーター 2 連対率（場 × 番号）
 *
 *   node scripts/tests/test_racer_stats_view.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  pending.push(async () => {
    try { await fn(); console.log('  PASS:', name); pass++; }
    catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
  });
}

const VIEW = {
  window: { racer_months: 12, motor_months: 6 },
  racers: {
    4001: { c: { 1: [20, 12, 15, 17], 2: [5, 1, 2, 3] }, kw: { 1: { 1: 11, 5: 1 } }, l1: { 2: 4, 3: 2 }, st: [0.14, 40, 1, 0], sz: [0.03, 0.05, 10] },
    4002: { c: { 2: [10, 2, 4, 6] }, kw: { 2: { 2: 2 } }, st: [0.16, 30, 0, 0], sz: [-0.01, 0.04, 2] },
    4003: { c: { 3: [8, 0, 1, 3] }, st: [0.18, 8, 0, 0] },
  },
  motors: { 15: { 33: [50, 10, 22, 30] } },
};

function setup() {
  const ctx = makeCtx();
  let calls = 0;
  ctx.fetch = (url) => {
    calls++;
    assert.ok(String(url).includes('data/db/racer_stats_view.json'), url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(VIEW) });
  };
  const boatMap = {};
  [1, 2, 3, 4, 5, 6].forEach((b) => { boatMap[b] = { racer_boat_number: b, racer_number: 4000 + b, racer_assigned_motor_number: b === 1 ? 33 : 99 }; });
  return { ctx, boatMap, calls: () => calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

t('初回は空文字で取得を始め、届いた後は 4 行を返す（取得は 1 回だけ）', async () => {
  const s = setup();
  assert.strictEqual(s.ctx._racerStatsRows(s.boatMap, {}, 15), '');
  s.ctx._racerStatsRows(s.boatMap, {}, 15);
  await tick(); await tick(); await tick();
  const html = s.ctx._racerStatsRows(s.boatMap, {}, 15);
  assert.strictEqual(s.calls(), 1);
  ['コース<br>成績', '決まり手', '平均ST', 'モーター'].forEach((k) => assert.ok(html.includes(k), k));
});

t('1 コース: 1着率・逃げ率・負け方、モーター 2連率', async () => {
  const s = setup();
  s.ctx._racerStatsRows(s.boatMap, {}, 15);
  await tick(); await tick(); await tick();
  const html = s.ctx._racerStatsRows(s.boatMap, {}, 15);
  assert.ok(html.includes('<td>60%<br><span class="fs-9">2連75% (20)</span></td>'), '1 号艇のコース成績');
  assert.ok(html.includes('逃げ55%<br><span class="fs-9">差され20% 捲られ10%</span>'), '逃げ率と負け方');
  assert.ok(html.includes('<td>44%<br><span class="fs-9">(50)</span></td>'), 'モーター 22/50');
  assert.ok(html.includes('0.14<br><span class="fs-9">展示比+0.03</span>'), 'ST と展示比');
  assert.ok(/F1<\/span>/.test(html), 'F 回数');
});

t('他コースは勝ち決まり手、展示ズレは 3 件未満なら出さない', async () => {
  const s = setup();
  s.ctx._racerStatsRows(s.boatMap, {}, 15);
  await tick(); await tick(); await tick();
  const html = s.ctx._racerStatsRows(s.boatMap, {}, 15);
  assert.ok(html.includes('<td>差し2</td>'), '2 号艇');
  assert.ok(!html.includes('展示比-0.01'), 'n=2 のズレを出した');
  assert.ok(html.includes('<td>勝ちなし</td>'), '3 号艇');
});

t('進入コースは展示の値で引く（前付けで 2 号艇が 1 コース）', async () => {
  const s = setup();
  s.ctx._racerStatsRows(s.boatMap, {}, 15);
  await tick(); await tick(); await tick();
  // 1 号艇が 2 コースに出た: 4001 の 2 コース成績 (5 走 1 勝) を引く
  const html = s.ctx._racerStatsRows(s.boatMap, { 1: { racer_course_number: 2 }, 2: { racer_course_number: 1 } }, 15);
  assert.ok(html.includes('<td>20%<br><span class="fs-9">2連40% (5)</span></td>'), html.slice(0, 300));
});

(async () => {
  for (const run of pending) await run();
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail);
})();

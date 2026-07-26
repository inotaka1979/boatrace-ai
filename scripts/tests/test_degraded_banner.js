/**
 * PR-6 / S-05: データ縮退バナー検出ロジックのテスト。
 *
 *   node scripts/tests/test_degraded_banner.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

function fullStadiums(n) {
  const s = {};
  for (let i = 1; i <= n; i++) s[String(i)] = { courseWinRate: { 1: 0.55, 2: 0.14 } };
  return s;
}
function racers(count, formLen) {
  const r = {};
  for (let i = 0; i < count; i++) r[String(4000 + i)] = { recentResults: formLen ? new Array(formLen).fill(1) : [] };
  return r;
}

console.log('[_detectDegradedFeatures]');
t('empty stadiumDB → 場別コース傾向 flagged', () => {
  const ctx = makeCtx();
  ctx.stadiumDB = {}; ctx.racerDB = {};
  assert.deepStrictEqual([...ctx._detectDegradedFeatures()],['場別コース傾向']);
});
t('20+ stadiums with courseWinRate → not flagged', () => {
  const ctx = makeCtx();
  ctx.stadiumDB = fullStadiums(22);
  ctx.racerDB = racers(200, 5);
  assert.deepStrictEqual([...ctx._detectDegradedFeatures()],[]);
});
t('all recentResults empty (>=50 racers) → 直近フォーム flagged', () => {
  const ctx = makeCtx();
  ctx.stadiumDB = fullStadiums(22);   // 場別は健全
  ctx.racerDB = racers(200, 0);       // フォーム全欠損
  assert.deepStrictEqual([...ctx._detectDegradedFeatures()],['直近フォーム']);
});
t('both degraded → both flagged (order stadium, form)', () => {
  const ctx = makeCtx();
  ctx.stadiumDB = {};
  ctx.racerDB = racers(200, 0);
  assert.deepStrictEqual([...ctx._detectDegradedFeatures()],['場別コース傾向', '直近フォーム']);
});
t('fewer than 50 racers → form check skipped (no false flag)', () => {
  const ctx = makeCtx();
  ctx.stadiumDB = fullStadiums(22);
  ctx.racerDB = racers(10, 0);   // sample 不足 → 直近フォームは判定しない
  assert.deepStrictEqual([...ctx._detectDegradedFeatures()],[]);
});
t('30% form coverage meets threshold', () => {
  const ctx = makeCtx();
  ctx.stadiumDB = fullStadiums(22);
  const r = {};
  for (let i = 0; i < 100; i++) r[String(4000 + i)] = { recentResults: i < 35 ? [1, 2, 3, 4, 5] : [] };
  ctx.racerDB = r;   // 35% 非空 >= 30%
  assert.deepStrictEqual([...ctx._detectDegradedFeatures()],[]);
});

console.log('[_renderDegradedBanner]');
t('renders text + display:block when degraded; console.error emitted', () => {
  const ctx = makeCtx();
  const el = { style: { display: 'none' }, textContent: '' };
  ctx.document.getElementById = (id) => (id === 'degradedBanner' ? el : null);
  let errored = '';
  ctx.console = Object.assign({}, console, { error: (m) => { errored = String(m); } });
  ctx.stadiumDB = {}; ctx.racerDB = {};
  ctx._renderDegradedBanner();
  assert.strictEqual(el.style.display, 'block');
  assert.ok(el.textContent.indexOf('場別コース傾向') >= 0, el.textContent);
  assert.ok(errored.indexOf('degraded') >= 0, errored);
});
t('hides banner when healthy', () => {
  const ctx = makeCtx();
  const el = { style: { display: 'block' }, textContent: 'x' };
  ctx.document.getElementById = (id) => (id === 'degradedBanner' ? el : null);
  ctx.stadiumDB = fullStadiums(24); ctx.racerDB = racers(200, 5);
  ctx._renderDegradedBanner();
  assert.strictEqual(el.style.display, 'none');
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

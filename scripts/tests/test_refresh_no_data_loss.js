/**
 * 「更新」で表示済みデータが消えない 回帰テスト（2026-08-11）
 *
 * 症状（user 報告）: 更新ボタンを押すと、表示されていた結果の一部が消える。
 *
 * 原因: `resultData` / `previewData` を bulk 応答で**全置換**する経路が残っていた。
 *   - rt-fix3 (2026-07-05) は 90 秒 poll (`_applyResultsRaw`) だけを
 *     `_mergeResultIndex` 化した
 *   - rt-fix2 P0-D は 90 秒 poll だけを `_mergePreviewIndex` 化した
 *   - `loadAllData` / `forceRefresh` / `refreshThisRace` は全置換のまま取り残された
 *
 *   /result-proxy でオンデマンド取得した確定結果は bulk(openapi/Worker KV) にまだ
 *   無いため、全置換すると画面から消える。さらに `_resLiveTried[key]` が true のまま
 *   なので再取得もされず、消えたままになる。
 *
 * 本テストは
 *   (1) マージ関数自体の不変条件（確定→未確定の巻き戻り禁止・欠落分の温存）
 *   (2) 全置換 `resultData=indexResults(...)` / `previewData=indexPreviews(...)` が
 *       ソースに残っていないこと（三度目の取り残し防止）
 * を固定する。
 *
 *   node scripts/tests/test_refresh_no_data_loss.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

// --- 対象関数を切り出して sandbox で評価 -----------------------------------
function extractFn(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const m = re.exec(APP);
  assert.ok(m, name + ' が見つからない');
  let i = APP.indexOf('{', m.index);
  let depth = 0;
  for (let j = i; j < APP.length; j++) {
    if (APP[j] === '{') depth++;
    else if (APP[j] === '}') { depth--; if (depth === 0) return APP.slice(m.index, j + 1); }
  }
  throw new Error(name + ' の本体を切り出せない');
}

const TODAY = '20260811';
function makeCtx(extra) {
  const ctx = Object.assign(
    { console, Object, Array, String, Number, JSON, Date, todayStr: () => TODAY },
    extra || {}
  );
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

function res(sid, rn, finished, payout) {
  return {
    race_stadium_number: sid, race_number: rn, race_date: '2026-08-11',
    isFinished: !!finished,
    results: finished ? [{ place: 1, racer_boat_number: 1 }] : undefined,
    refund: payout ? { trifecta: [{ combination: '1-2-3', amount: payout }] } : undefined,
    payouts: payout ? { trifecta: [{ combination: '1-2-3', amount: payout }] } : undefined,
  };
}

console.log('=== 更新でデータが消えない (results / previews マージ) ===');

// _mergeResultEntry は _mergeResultIndex から呼ばれるので一緒に読み込む
const resultCtx = makeCtx();
vm.runInContext(extractFn('_mergeResultEntry'), resultCtx);
vm.runInContext(extractFn('_mergeResultIndex'), resultCtx);
const mergeResults = resultCtx._mergeResultIndex;

t('bulk に無い「今日の確定結果」が温存される（本症状の中核）', () => {
  // /result-proxy でオンデマンド取得済みの 1R が bulk 応答に含まれないケース
  const oldIdx = { 12: { 1: res(12, 1, true, 5000), 2: res(12, 2, true, 800) } };
  const newIdx = { 12: { 2: res(12, 2, true, 800) } };   // 1R が bulk に無い
  const merged = mergeResults(oldIdx, newIdx);
  assert.ok(merged[12][1], 'オンデマンド取得済みの 1R が消えた');
  assert.strictEqual(merged[12][1].isFinished, true);
});

t('確定済みが未確定で巻き戻らない', () => {
  const merged = mergeResults(
    { 12: { 3: res(12, 3, true, 5000) } },
    { 12: { 3: res(12, 3, false) } }
  );
  assert.strictEqual(merged[12][3].isFinished, true, '確定が未確定で潰された');
});

t('未確定 → 確定 の前進は妨げない', () => {
  const merged = mergeResults(
    { 12: { 4: res(12, 4, false) } },
    { 12: { 4: res(12, 4, true, 1200) } }
  );
  assert.strictEqual(merged[12][4].isFinished, true);
});

t('前日の残骸は温存しない（日跨ぎ）', () => {
  const stale = res(12, 5, true, 900);
  stale.race_date = '2026-08-10';
  const merged = mergeResults({ 12: { 5: stale } }, { 12: {} });
  assert.ok(!merged[12] || !merged[12][5], '前日の確定結果を持ち越している');
});

t('初回ロード（old が null）は new をそのまま返す', () => {
  const newIdx = { 12: { 1: res(12, 1, true, 100) } };
  assert.strictEqual(mergeResults(null, newIdx), newIdx);
});

// --- previews 側 ------------------------------------------------------------
t('previews: 展示を持つ既存が、展示を持たない縮退応答で潰されない', () => {
  const ctx = makeCtx({ previewData: null });
  vm.runInContext(extractFn('_previewRichness'), ctx);
  vm.runInContext(extractFn('_mergePreviewIndex'), ctx);
  ctx.previewData = {
    12: { 1: { boats: { 1: { racer_exhibition_time: 6.7 }, 2: { racer_exhibition_time: 6.8 } } } },
  };
  const merged = ctx._mergePreviewIndex({ 12: { 1: { boats: {} } } });
  const boats = merged[12][1].boats;
  assert.ok(boats && Object.keys(boats).length >= 2, '展示データが縮退応答で消えた');
});

// --- ソース側の不変条件（三度目の取り残し防止） -----------------------------
// 全置換が許されるのは「起動時 1 回だけ走る loadAllData」のみ。そこでは
// resultData / previewData が必ず null なので失うものが無い。
// 更新系の経路 (forceRefresh / refreshThisRace / 90 秒 poll) は必ずマージを通すこと。
t('全置換は loadAllData（起動時 1 回）以外に残っていない', () => {
  const lines = APP.split('\n');
  // 各行の時点で「直近に開始した top-level 関数名」を求める
  let current = '(top-level)';
  const offenders = [];
  lines.forEach((line, i) => {
    const m = /^(?:async\s+)?function\s+(\w+)\s*\(/.exec(line);
    if (m) current = m[1];
    if (/^\s*\/\//.test(line)) return;                 // コメント行は対象外
    const bad =
      /resultData\s*=\s*indexResults\s*\(/.test(line) ||
      /previewData\s*=\s*indexPreviews\s*\(/.test(line);
    if (bad && current !== 'loadAllData') {
      offenders.push('L' + (i + 1) + ' [' + current + '] ' + line.trim().slice(0, 80));
    }
  });
  assert.strictEqual(offenders.length, 0,
    '更新経路に全置換が残っている（_mergeResultIndex / _mergePreviewIndex を通すこと）:\n    '
    + offenders.join('\n    '));
});

t('loadAllData の呼出は起動時 1 箇所だけ（全置換が安全である前提）', () => {
  const calls = APP.split('\n').filter(
    (l) => /\bloadAllData\s*\(/.test(l) && !/function\s+loadAllData/.test(l) && !/^\s*\/\//.test(l)
  );
  assert.strictEqual(calls.length, 1,
    'loadAllData が複数回呼ばれるなら全置換は安全でない。マージを通すこと:\n    '
    + calls.map((l) => l.trim().slice(0, 80)).join('\n    '));
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

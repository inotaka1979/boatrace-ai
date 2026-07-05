/**
 * 2026-06-29: レース結果オンデマンド補完の回帰テスト。
 *   bulk /api/results が夜に止まっても、締切超過で結果/払戻が欠けるレースを
 *   Worker /result-proxy で 1 レース単位に補完する。本テストは純ヘルパ
 *   (_isResultIncomplete / _mergeResultEntry) と _sweepMissingResults の
 *   候補選定(古い順・上限・払戻欠落の検出)を固定する。
 *
 *   node scripts/tests/test_result_ondemand.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

const localStore = {};
const stub = {
  console, Date, Math, Number, Array, Object, JSON, Set,
  setTimeout, setInterval, clearInterval, clearTimeout, Promise,
  parseInt, parseFloat, isNaN, String, Boolean, RegExp,
  fetch: () => Promise.reject(new Error('no network')),
  localStorage: {
    getItem: (k) => (k in localStore ? localStore[k] : null),
    setItem: (k, v) => { localStore[k] = String(v); },
    removeItem: (k) => { delete localStore[k]; },
    key: (i) => Object.keys(localStore)[i] || null,
    get length() { return Object.keys(localStore).length; },
  },
  window: { addEventListener: () => {} },
  document: {
    getElementById: () => ({ innerHTML: '', addEventListener: () => {}, value: '', classList: { contains: () => false } }),
    createElement: () => ({ textContent: '', innerHTML: '' }),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {},
  },
  navigator: { serviceWorker: undefined },
  location: { hostname: 'test', reload: () => {} },
  AbortController: class { constructor(){ this.signal={}; } abort(){} },
  alert: () => {}, confirm: () => true,
};
stub.globalThis = stub; stub.self = stub;

const ctx = vm.createContext(stub);
try { vm.runInContext(code, ctx, { timeout: 5000 }); } catch(_) {}

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); console.log('  PASS:', name); pass++; }
  catch(e){ console.log('  FAIL:', name, '\n   ', e.message); fail++; }
}

// JST で「N 分前」の race_closed_at 文字列 ("YYYY-MM-DD HH:MM:SS") を作る
function closedAgo(min){
  const jst = new Date(Date.now() + 9 * 3600000 - min * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return jst.getUTCFullYear() + '-' + p(jst.getUTCMonth() + 1) + '-' + p(jst.getUTCDate()) +
    ' ' + p(jst.getUTCHours()) + ':' + p(jst.getUTCMinutes()) + ':' + p(jst.getUTCSeconds());
}

console.log('[_isResultIncomplete]');

t('null は未完(補完対象)', () => {
  assert.strictEqual(ctx._isResultIncomplete(null), true);
});
t('未確定 (isFinished=false) は未完', () => {
  assert.strictEqual(ctx._isResultIncomplete({ isFinished: false, results: [], refund: {} }), true);
});
t('着順あり・払戻なし は未完(=払戻未取得)', () => {
  assert.strictEqual(ctx._isResultIncomplete({ isFinished: true, results: [{ place: 1 }], refund: { trifecta: [], exacta: [] } }), true);
});
t('3連単払戻はあるが2連単が空 は未完(2連単払戻未取得を拾う)', () => {
  assert.strictEqual(ctx._isResultIncomplete({ isFinished: true, results: [{ place: 1 }], refund: { trifecta: [{ combination: '1-2-3', amount: 1200 }], exacta: [] } }), true);
});
t('3連単・2連単とも払戻あり は完了', () => {
  assert.strictEqual(ctx._isResultIncomplete({ isFinished: true, results: [{ place: 1 }], refund: { trifecta: [{ combination: '1-2-3', amount: 1200 }], exacta: [{ combination: '1-2', amount: 400 }] } }), false);
});

console.log('[_mergeResultEntry]');

t('新が払戻を持たず旧が持つなら払戻を退行させない', () => {
  const oldR = { isFinished: true, results: [{ place: 1 }], refund: { trifecta: [{ combination: '1-2-3', amount: 900 }] } };
  const newR = { isFinished: true, results: [{ place: 1 }], refund: { trifecta: [] } };
  const m = ctx._mergeResultEntry(oldR, newR);
  assert.strictEqual(m.refund.trifecta.length, 1);
  assert.strictEqual(m.refund.trifecta[0].amount, 900);
});
t('新が払戻を持つならそれを採用', () => {
  const oldR = { refund: { trifecta: [] } };
  const newR = { isFinished: true, results: [{ place: 1 }], refund: { trifecta: [{ combination: '4-5-6', amount: 5000 }] } };
  const m = ctx._mergeResultEntry(oldR, newR);
  assert.strictEqual(m.refund.trifecta[0].amount, 5000);
  assert.strictEqual(m.payouts.trifecta[0].amount, 5000, 'payouts も同期');
});
t('旧 null なら新をそのまま返す', () => {
  const newR = { refund: { trifecta: [{ amount: 1 }] } };
  assert.strictEqual(ctx._mergeResultEntry(null, newR), newR);
});

console.log('[_sweepMissingResults]');

t('締切超過の未完レースを古い順・上限件数だけ補完', () => {
  // _loadResultLive を差し替えて呼び出しを捕捉
  const calls = [];
  ctx._loadResultLive = (sid, rno) => { calls.push([sid, rno]); };
  ctx._resLiveTried = {};
  // 同一場の R1(60分前)/R2(30分前)/R3(10分前)= すべて未完、R4 は締切前(対象外)
  ctx.programData = { 7: {
    1: { race_closed_at: closedAgo(60) },
    2: { race_closed_at: closedAgo(30) },
    3: { race_closed_at: closedAgo(10) },
    4: { race_closed_at: closedAgo(-20) },   // 20分後 = 締切前
  }};
  ctx.resultData = {};   // 全て結果なし=未完
  ctx._sweepMissingResults(2);
  assert.strictEqual(calls.length, 2, '上限 2 件');
  assert.deepStrictEqual(calls[0], [7, 1], '最古(60分前)が先');
  assert.deepStrictEqual(calls[1], [7, 2], '次に古い(30分前)');
});

t('完了済レースは補完対象にしない', () => {
  const calls = [];
  ctx._loadResultLive = (sid, rno) => { calls.push([sid, rno]); };
  ctx._resLiveTried = {};
  ctx.programData = { 12: { 1: { race_closed_at: closedAgo(40) } } };
  ctx.resultData = { 12: { 1: { isFinished: true, results: [{ place: 1 }], refund: { trifecta: [{ amount: 800 }], exacta: [{ amount: 300 }] } } } };
  ctx._sweepMissingResults(6);
  assert.strictEqual(calls.length, 0);
});

t('結果窓(締切+360分)を過ぎたら対象外', () => {
  const calls = [];
  ctx._loadResultLive = (sid, rno) => { calls.push([sid, rno]); };
  ctx._resLiveTried = {};
  ctx.programData = { 1: { 1: { race_closed_at: closedAgo(400) } } };   // 6h40m 前
  ctx.resultData = {};
  ctx._sweepMissingResults(6);
  assert.strictEqual(calls.length, 0);
});

console.log('[_mergeResultIndex]');

t('bulk に無い今日の確定済みレースを温存(オンデマンド取得分の保護)', () => {
  const today = ctx.todayStr ? ctx.todayStr() : '';
  const oldIdx = { 7: { 3: { isFinished: true, race_date: today, results: [{ place: 1 }],
    refund: { trifecta: [{ amount: 1500 }] } } } };
  const newIdx = { 7: { 1: { isFinished: true, race_date: today, results: [{ place: 1 }], refund: {} } } };
  const m = ctx._mergeResultIndex(oldIdx, newIdx);
  assert.ok(m[7][3], '古い bulk で消えない');
  assert.strictEqual(m[7][3].refund.trifecta[0].amount, 1500);
  assert.ok(m[7][1], '新規レースも維持');
});

t('確定→未確定の巻き戻りを防止(openapi の揺らぎ対策)', () => {
  const today = ctx.todayStr ? ctx.todayStr() : '';
  const oldIdx = { 5: { 2: { isFinished: true, race_date: today, results: [{ place: 1 }],
    refund: { trifecta: [{ amount: 900 }] } } } };
  const newIdx = { 5: { 2: { isFinished: false, race_date: today, results: [], refund: {} } } };
  const m = ctx._mergeResultIndex(oldIdx, newIdx);
  assert.strictEqual(m[5][2].isFinished, true, '確定が保持される');
  assert.strictEqual(m[5][2].refund.trifecta[0].amount, 900);
});

t('両方確定なら新エントリ+払戻退行なしのマージ', () => {
  const today = ctx.todayStr ? ctx.todayStr() : '';
  const oldIdx = { 5: { 2: { isFinished: true, race_date: today, results: [{ place: 1 }],
    refund: { trifecta: [{ amount: 900 }], exacta: [] } } } };
  const newIdx = { 5: { 2: { isFinished: true, race_date: today, results: [{ place: 1 }],
    refund: { trifecta: [], exacta: [{ amount: 300 }] } } } };
  const m = ctx._mergeResultIndex(oldIdx, newIdx);
  assert.strictEqual(m[5][2].refund.trifecta[0].amount, 900, '旧払戻を退行させない');
  assert.strictEqual(m[5][2].refund.exacta[0].amount, 300, '新払戻を採用');
});

t('別日の残骸は温存しない(day rollover 対策)', () => {
  const oldIdx = { 9: { 4: { isFinished: true, race_date: '2000-01-01', results: [{ place: 1 }], refund: {} } } };
  const newIdx = { 9: {} };
  const m = ctx._mergeResultIndex(oldIdx, newIdx);
  assert.ok(!m[9][4], '前日の確定結果が今日のレースに化けない');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

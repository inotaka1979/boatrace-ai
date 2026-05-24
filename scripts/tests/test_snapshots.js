/**
 * Phase 5 (Clearwing patterns): Snapshot tests
 *
 *   node scripts/tests/test_snapshots.js                # 検証モード
 *   UPDATE_SNAPSHOTS=1 node scripts/tests/test_snapshots.js  # 再生成
 *
 * 目的:
 *   関数の output を JSON snapshot で固定し、リファクタで挙動が静かに壊れるのを防ぐ。
 *   既存テストは「pass/fail のロジック」に縛られ、構造変化を見落とすことがある。
 *   snapshot は構造全体を比較するため、Phase 4 (strict 型) / Phase 2 残り抽出
 *   時の退行を確実に検出する。
 *
 * カバー対象 (現状 Phase 2 で抽出済の関数群):
 *   - discovery: indexByStadiumRace / indexPreviews / indexResults / _filterStalePreviews
 *   - analysis : runBacktestEngine / runForwardChainBacktest / _computeCalibrationMetrics
 *   - context  : STADIUMS / GRADE_CLASS / WIND_DIR の Object.freeze 状態
 *   - capabilities: list() + has() の出力（Node 環境の capability マップ）
 *   - math     : softmax / safeDiv / Plackett-Luce
 *
 * Snapshot 形式: tests/snapshots/<name>.json  (UTF-8, 末尾改行あり)
 * 比較: JSON.stringify(actual, null, 2) === fs.readFileSync(snapshot)
 *
 * 失敗時の更新:
 *   1. UPDATE_SNAPSHOTS=1 で全件再生成
 *   2. git diff で意図通りの変化か確認
 *   3. 意図的なら commit、意図しないなら原因調査
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT       = path.resolve(__dirname, '..', '..');
const FIX_DIR    = path.join(ROOT, 'tests', 'fixtures');
const SNAP_DIR   = path.join(ROOT, 'tests', 'snapshots');
const UPDATE     = process.env.UPDATE_SNAPSHOTS === '1';

if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });

// ────────────────────────────────────────────────
// 1) assets/app.js を vm sandbox に読込
// ────────────────────────────────────────────────
const APP_CODE = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');

const localStore = {};
const sandbox = {
  console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  Date, Math, Number, Array, Object, JSON, String, Boolean, Symbol,
  Map, Set, WeakMap, WeakSet, Promise, Error, TypeError, RangeError,
  setTimeout, setInterval, clearInterval, clearTimeout,
  // fetch は network 必須なのでスタブ (snapshot 対象外関数からは呼ばれない想定)
  fetch: () => Promise.reject(new Error('no network in snapshot test')),
  localStorage: {
    getItem: (k) => (k in localStore ? localStore[k] : null),
    setItem: (k, v) => { localStore[k] = String(v); },
    removeItem: (k) => { delete localStore[k]; },
    key: (i) => Object.keys(localStore)[i] || null,
    get length() { return Object.keys(localStore).length; },
  },
  sessionStorage: {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
  },
  window: { addEventListener: () => {}, removeEventListener: () => {} },
  document: {
    getElementById: () => null,
    createElement: () => ({ textContent: '', innerHTML: '', addEventListener: () => {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
    head: { appendChild: () => {} },
  },
  navigator: { onLine: true, serviceWorker: undefined },
  location: { hostname: 'test', search: '', pathname: '/', hash: '', reload: () => {}, replace: () => {} },
  AbortController: class { constructor(){ this.signal = {}; } abort(){} },
  AbortSignal: undefined,
  alert: () => {}, confirm: () => true, prompt: () => '',
  URL, URLSearchParams, TextEncoder, TextDecoder,
  Number, parseInt, parseFloat, isNaN, isFinite,
  // PWA / Worker / browser API は無し (capability detection で false 化される)
  caches: undefined, indexedDB: undefined, scheduler: undefined,
  requestIdleCallback: undefined, Notification: undefined, Chart: undefined, Worker: undefined,
  SharedArrayBuffer: undefined,
  globalThis: undefined, self: undefined,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const ctx = vm.createContext(sandbox);
try {
  vm.runInContext(APP_CODE, ctx, { timeout: 8000 });
} catch (e) {
  // 起動時の loadAllData 等が fetch reject で例外になる。関数定義は完了済。
  if (!/no network|fetch|undefined is not|ReferenceError.*setManagedInterval/i.test(String(e))) {
    console.warn('[setup] non-fatal:', e.message);
  }
}

// ────────────────────────────────────────────────
// 2) Snapshot 比較ヘルパ
// ────────────────────────────────────────────────
let pass = 0, fail = 0, updated = 0;

function snapshot(name, actual){
  const file = path.join(SNAP_DIR, name + '.json');
  const serialized = JSON.stringify(actual, null, 2) + '\n';

  if (UPDATE || !fs.existsSync(file)){
    fs.writeFileSync(file, serialized);
    if (UPDATE) console.log('  UPDATE:', name); else console.log('  CREATE:', name);
    updated++;
    return;
  }

  const expected = fs.readFileSync(file, 'utf8');
  try {
    assert.strictEqual(serialized, expected);
    console.log('  PASS:', name);
    pass++;
  } catch (_) {
    console.log('  FAIL:', name);
    console.log('   ', 'snapshot mismatch — run with UPDATE_SNAPSHOTS=1 if intended');
    // 簡易 diff (最初の差分位置)
    let i = 0;
    while (i < expected.length && i < serialized.length && expected[i] === serialized[i]) i++;
    const a = expected.slice(Math.max(0, i-30), Math.min(expected.length, i+60));
    const b = serialized.slice(Math.max(0, i-30), Math.min(serialized.length, i+60));
    console.log('    expected: ...' + a.replace(/\n/g, '\\n') + '...');
    console.log('    actual:   ...' + b.replace(/\n/g, '\\n') + '...');
    fail++;
  }
}

function loadFixture(name){
  return JSON.parse(fs.readFileSync(path.join(FIX_DIR, name), 'utf8'));
}

// ────────────────────────────────────────────────
// 3) Discovery 層 snapshots
// ────────────────────────────────────────────────
console.log('[discovery / openapi_client]');

const programsFixture = loadFixture('programs-sample.json');
const previewsFixture = loadFixture('previews-sample.json');
const resultsFixture  = loadFixture('results-sample.json');

// 2026-05-25: indexByStadiumRace に race_date == 今日 JST フィルタを追加したため、
//   テスト中は fixture の race_date "2026-05-21" を today として固定する。
//   テスト独立性確保 (本日の date に依存しない再現性)。
ctx.todayStr = function () { return '20260521'; };

snapshot('discovery_indexByStadiumRace_programs',
  ctx.indexByStadiumRace(programsFixture, 'programs'));

snapshot('discovery_indexPreviews',
  ctx.indexPreviews(previewsFixture));

snapshot('discovery_indexResults',
  ctx.indexResults(resultsFixture));

snapshot('discovery_filterStalePreviews_today',
  ctx._filterStalePreviews(previewsFixture));

// stale な previews (異なる日付): 全件 skip
const stalePreviews = JSON.parse(JSON.stringify(previewsFixture));
stalePreviews.previews.forEach(p => { p.race_date = '2025-01-01'; });
snapshot('discovery_filterStalePreviews_stale',
  ctx._filterStalePreviews(stalePreviews));

snapshot('discovery_validateApiPayload_results',
  {
    valid_real:    ctx.validateApiPayload(resultsFixture, 'results'),
    valid_empty:   ctx.validateApiPayload({ results: [] }, 'results'),
    invalid_null:  ctx.validateApiPayload(null, 'results'),
    invalid_shape: ctx.validateApiPayload({ wrong: [] }, 'results'),
  });

snapshot('discovery_mapToWorkerUrl',
  {
    programs: ctx._mapToWorkerUrl('https://boatraceopenapi.github.io/programs/v2/today.json'),
    previews: ctx._mapToWorkerUrl('https://boatraceopenapi.github.io/previews/v2/today.json'),
    results:  ctx._mapToWorkerUrl('https://boatraceopenapi.github.io/results/v2/today.json'),
    other:    ctx._mapToWorkerUrl('https://example.com/foo'),
  });

// ────────────────────────────────────────────────
// 4) Analysis 層 snapshots
// ────────────────────────────────────────────────
console.log('[analysis / backtest]');

const historyFixture = loadFixture('history-sample.json');

// runBacktestEngine の dailyROI には Date.now() ベースの cutoff を内部で計算するが、
// 履歴側の date 文字列は固定で、cutoff (periodDays=0 で全件) を渡せば決定的。
snapshot('analysis_runBacktestEngine_all',
  ctx.runBacktestEngine(historyFixture, { periodDays: 0, stakePerBet: 100 }));

snapshot('analysis_runForwardChainBacktest_warmup1',
  ctx.runForwardChainBacktest(historyFixture, { warmupRaces: 1 }));

snapshot('analysis_computeCalibrationMetrics',
  ctx._computeCalibrationMetrics(historyFixture));

snapshot('analysis_btParseDate',
  {
    valid:    ctx._btParseDate('20260521').toISOString().slice(0, 10),
    null_in:  ctx._btParseDate(null),
    short:    ctx._btParseDate('2026'),
    invalid:  ctx._btParseDate(12345),
  });

// ────────────────────────────────────────────────
// 5) Context 層 snapshots (Object.freeze + 値の固定)
// ────────────────────────────────────────────────
console.log('[context / domain_constants]');

snapshot('context_STADIUMS',          ctx.STADIUMS);
snapshot('context_CLASS_NAME',        ctx.CLASS_NAME);
snapshot('context_CLASS_COLOR',       ctx.CLASS_COLOR);
snapshot('context_BOAT_COLORS',       ctx.BOAT_COLORS);
snapshot('context_BOAT_TEXT',         ctx.BOAT_TEXT);
snapshot('context_TECHNIQUE',         ctx.TECHNIQUE);
snapshot('context_WIND_DIR',          ctx.WIND_DIR);
snapshot('context_GRADE_CLASS',       ctx.GRADE_CLASS);

// frozen であることの確認 (mutation 試行 → 値が変わっていない)
snapshot('context_STADIUMS_frozen', (() => {
  const before = Object.assign({}, ctx.STADIUMS);
  try { ctx.STADIUMS[1] = 'NOPE'; } catch (_) { /* strict mode で throw する */ }
  const after = ctx.STADIUMS;
  return { before_1: before[1], after_1: after[1], unchanged: before[1] === after[1] };
})());

// ────────────────────────────────────────────────
// 6) Capabilities snapshots
// ────────────────────────────────────────────────
console.log('[capabilities]');

// list() は順序保証ありの配列を返す。Node 環境では browser API 全 false。
snapshot('capabilities_list', ctx.capabilities.list().sort());

snapshot('capabilities_node_env_values', (() => {
  const out = {};
  ctx.capabilities.list().forEach(name => { out[name] = ctx.capabilities.has(name); });
  // sort で order 依存を排除
  const sorted = {};
  Object.keys(out).sort().forEach(k => { sorted[k] = out[k]; });
  return sorted;
})());

// makeTimeoutSignal は signal object を返すが内部状態は object identity に依存するため
// 「呼んでも例外が出ない」「期待 type の何かが返る」だけスナップショット
snapshot('capabilities_makeTimeoutSignal_works', (() => {
  const s = ctx.capabilities.makeTimeoutSignal(1000);
  return {
    has_aborted_prop: typeof s.aborted !== 'undefined' || typeof s === 'object',
    not_null: s !== null,
  };
})());

// ────────────────────────────────────────────────
// 7) Math (Plackett-Luce / softmax / safeDiv)
// ────────────────────────────────────────────────
console.log('[math]');

snapshot('math_softmax_balanced', ctx.softmax([1, 1, 1, 1, 1, 1]).map(x => +x.toFixed(8)));
snapshot('math_softmax_skewed',   ctx.softmax([3, 1, 0.5, 0, -0.5, -1]).map(x => +x.toFixed(8)));

snapshot('math_plackettLuce_trifecta_top3', (() => {
  const p = [0, 0.55, 0.18, 0.12, 0.08, 0.04, 0.03];  // index 0 ダミー
  return {
    '1-2-3': +ctx._plackettLuceTrifectaProb(p, 1, 2, 3).toFixed(8),
    '2-1-3': +ctx._plackettLuceTrifectaProb(p, 2, 1, 3).toFixed(8),
    '3-2-1': +ctx._plackettLuceTrifectaProb(p, 3, 2, 1).toFixed(8),
  };
})());

snapshot('math_safeDiv', {
  basic:     ctx.safeDiv(10, 2),
  by_zero:   ctx.safeDiv(10, 0),
  with_fb:   ctx.safeDiv(10, 0, 99),
  NaN_num:   ctx.safeDiv(NaN, 2),
  NaN_den:   ctx.safeDiv(10, NaN),
});

// ────────────────────────────────────────────────
// 結果
// ────────────────────────────────────────────────
console.log('');
console.log('=== Snapshot test result ===');
console.log(`pass: ${pass}  fail: ${fail}  updated: ${updated}`);
if (fail > 0) {
  console.log('');
  console.log('Some snapshots failed. If the change is intentional, run:');
  console.log('  UPDATE_SNAPSHOTS=1 node scripts/tests/test_snapshots.js');
  process.exit(1);
}
process.exit(0);

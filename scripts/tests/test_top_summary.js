/**
 * TOP の成績サマリー (判定済 / 3連単的中 / 的中率) の回帰テスト（2026-11-14 追加）
 *
 * 症状（ユーザー報告「TOP の的中数等が表示されていない」）:
 *   その日最初に開いた時、TOP は「0 判定済 / 0 3連単的中 / 0.0%」のまま。実ブラウザで
 *   計測すると、数字が入るのは約 100 秒後で、しかもその瞬間に TOP を表示している場合だけ。
 *
 * 原因:
 *   1. 履歴を埋める backfill が起動 60 秒後まで走らない
 *   2. backfill / 結果到着で履歴が変わっても TOP のサマリーを描き直す処理が無い
 *      （場一覧と一緒に描かれるだけ。再描画は 90 秒 poll がデータ世代の変化を検知した時のみ）
 *   3. showPage('top') がサマリーを描き直さない
 *
 * 併せて固定するもの:
 *   - backfill は結果付きで保存済みのレースを再計算しない（90 秒 poll 毎の無駄を除去）
 *   - backfill の履歴書込は 1 回（従来は 1 レース毎に履歴全体を parse + stringify）
 *   - savePrediction の batch モードは lock-in の意味を変えない
 *   - predictRaceAsync は worker が失敗し続けたら worker を使うのをやめる
 *
 *   node scripts/tests/test_top_summary.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

let pass = 0;
let fail = 0;
const queue = [];
function t(name, fn) {
  queue.push([name, fn]);
}

const TODAY = (ctx) => ctx.todayStr();

function boat(bn, cls, nat) {
  return {
    racer_boat_number: bn,
    racer_number: 4000 + bn,
    racer_class_number: cls,
    racer_national_top_1_percent: nat,
    racer_local_top_2_percent: 30 + nat * 3,
    racer_assigned_motor_top_2_percent: 35,
    racer_assigned_boat_top_2_percent: 34,
    racer_flying_count: 0,
    racer_late_start_count_in_current_term: 0,
  };
}
function race() {
  return {
    race_closed_at: '2026-01-01 09:00:00',
    race_grade_number: 1,
    boats: [boat(1, 1, 7), boat(2, 2, 5), boat(3, 2, 5), boat(4, 3, 4.5), boat(5, 3, 4), boat(6, 4, 3.5)],
  };
}
function result(order, ymd) {
  return {
    isFinished: true,
    race_date: ymd,
    results: order.map((b, i) => ({ racer_boat_number: b, place: i + 1 })),
    refund: { trifecta: [{ combination: order.slice(0, 3).join('-'), payout: 1230 }] },
  };
}
/** 1 号艇本命の予想 */
function pred() {
  return {
    marks: [
      { boat: 1, prob: 0.45, score: 60, mark: '◎' },
      { boat: 2, prob: 0.2, score: 50, mark: '○' },
      { boat: 3, prob: 0.15, score: 45, mark: '▲' },
      { boat: 4, prob: 0.1, score: 40, mark: '△' },
      { boat: 5, prob: 0.06, score: 35, mark: '×' },
      { boat: 6, prob: 0.04, score: 30, mark: '×' },
    ],
    trifecta: [
      { combo: '1-2-3', prob: 0.2 },
      { combo: '1-3-2', prob: 0.1 },
    ],
    exacta: [{ combo: '1-2', prob: 0.3 }],
    ana: [],
    raceType: 'honmei',
    confidence: 45,
    confStars: 4,
  };
}

/**
 * 3 場 × 4R、うち確定は (1,1) (1,2) (2,1) の 3 レース。
 *   買い目は 1-2-3 / 1-3-2 固定なので、的中は (1,1)=1-2-3 と (2,1)=1-3-2 の 2 件、(1,2)=4-1-2 は外れ。
 * predictRace は呼出を記録する stub に差し替える（Worker は harness に無いので main 経路）。
 */
function setup() {
  const ctx = makeCtx();
  const ymd = TODAY(ctx);
  const dashed = ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
  ctx.programData = {};
  for (const sid of [1, 2, 3]) {
    ctx.programData[sid] = {};
    for (const rn of [1, 2, 3, 4]) ctx.programData[sid][rn] = race();
  }
  ctx.resultData = {
    1: { 1: result([1, 2, 3, 4, 5, 6], dashed), 2: result([4, 1, 2, 3, 5, 6], dashed) },
    2: { 1: result([1, 3, 2, 4, 5, 6], dashed) },
  };
  ctx.previewData = {};
  // harness の MessageChannel は応答しないので、main thread を譲る処理は即時解決に差し替える
  ctx._yieldToMain = async () => {};
  ctx.localStorage.setItem('boatrace_history', '[]');
  // 一度でも起動した端末を模す（getAccuracy 初回の一回限り migration v21 を済ませておく）
  ctx.localStorage.setItem('boatrace_history_migrated_v21', '1');
  const calls = [];
  ctx.predictRace = (sid, rn) => {
    calls.push(sid + '-' + rn);
    return pred();
  };
  // localStorage への履歴書込回数を数える
  let histWrites = 0;
  const origSet = ctx.localStorage.setItem;
  ctx.localStorage.setItem = (k, v) => {
    if (k === 'boatrace_history') histWrites++;
    return origSet(k, v);
  };
  return {
    ctx,
    ymd,
    calls,
    histWrites: () => histWrites,
    history: () => JSON.parse(ctx.localStorage.getItem('boatrace_history') || '[]'),
  };
}

/** #topSummary と「現在のページ」を持つ最小 document に差し替える */
function withDom(ctx, activePageId) {
  const summary = { innerHTML: '' };
  const pageTop = { classList: { add() {}, remove() {} } };
  const generic = () => ({
    innerHTML: '',
    style: {},
    textContent: '',
    value: '',
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
  });
  const state = { active: activePageId };
  ctx.document.getElementById = (id) => (id === 'topSummary' ? summary : id === 'pageTop' ? pageTop : generic());
  ctx.document.querySelector = (sel) => (sel === '.page.active' && state.active ? { id: state.active } : null);
  ctx.document.querySelectorAll = () => [];
  ctx.window.scrollTo = () => {};
  return { summary, state };
}
/** サマリーの数字 3 つ（判定済 / 3連単的中 / 的中率）をテキストで取り出す */
function nums(summary) {
  return Array.from(summary.innerHTML.matchAll(/<div class="s-num[^>]*>([^<]*)<\/div>/g)).map((m) => m[1]);
}

// ---------------------------------------------------------------------------
t('backfill: 確定レースを履歴に保存し、件数を返す。履歴の書込は 1 回', async () => {
  const s = setup();
  const n = await s.ctx._backfillTodayPredictions();
  assert.strictEqual(n, 3, '保存件数: ' + n);
  assert.deepStrictEqual(s.calls.sort(), ['1-1', '1-2', '2-1']);
  const h = s.history();
  assert.strictEqual(h.length, 3);
  assert.ok(
    h.every((e) => e.date === s.ymd && e.actual && e.actual.length === 6 && e.backfilled === true),
    '結果付き・事後生成の印が付いていない'
  );
  assert.strictEqual(s.histWrites(), 1, '履歴を ' + s.histWrites() + ' 回書いている（1 レース毎の書込に戻った）');
  const acc = s.ctx.getAccuracy();
  assert.strictEqual(acc.total, 3);
  assert.strictEqual(acc.trifectaHit, 2);
});

t('backfill: 結果付きで保存済みのレースは再計算しない（90 秒 poll 毎の無駄を除去）', async () => {
  const s = setup();
  await s.ctx._backfillTodayPredictions();
  s.calls.length = 0;
  const w = s.histWrites();
  const n = await s.ctx._backfillTodayPredictions(); // 2 回目 = poll 相当
  assert.strictEqual(n, 0);
  assert.deepStrictEqual(s.calls, [], '保存済みレースを再計算した: ' + s.calls.join(','));
  assert.strictEqual(s.histWrites(), w, '変化が無いのに履歴を書いた');
  // 新しく 1 レース確定 → その 1 件だけ計算する
  const dashed = s.ymd.slice(0, 4) + '-' + s.ymd.slice(4, 6) + '-' + s.ymd.slice(6, 8);
  s.ctx.resultData[3] = { 2: result([2, 1, 3, 4, 5, 6], dashed) };
  const n2 = await s.ctx._backfillTodayPredictions();
  assert.strictEqual(n2, 1);
  assert.deepStrictEqual(s.calls, ['3-2']);
  assert.strictEqual(s.history().length, 4);
});

t('backfill: 締切前に保存した予想は置き換えず、結果だけ付ける（lock-in は batch でも同じ）', async () => {
  const s = setup();
  // (1,2) の予想を締切前に保存しておく（4 号艇本命 = 実際の 1 着）
  const pre = pred();
  pre.marks = [4, 1, 2, 3, 5, 6].map((b, i) => ({
    boat: b,
    prob: [0.5, 0.2, 0.1, 0.1, 0.06, 0.04][i],
    score: 50,
    mark: '◎',
  }));
  pre.trifecta = [{ combo: '4-1-2', prob: 0.3 }];
  s.ctx.savePrediction(s.ymd, 1, 2, pre, null);
  await s.ctx._backfillTodayPredictions();
  const e = s.history().find((x) => x.stadium === 1 && x.race === 2);
  assert.deepStrictEqual(e.trifecta_bets, ['4-1-2'], '締切前の買い目が事後予想で上書きされた');
  assert.strictEqual(e.backfilled, false, '締切前の予想に事後生成の印が付いた');
  assert.deepStrictEqual(e.actual, [4, 1, 2, 3, 5, 6]);
  assert.strictEqual(e.trifecta_hit, true);
  assert.strictEqual(e.payout3, 1230, '払戻が付いていない');
});

t('backfill: 終わったら TOP のサマリーを描き直す（表示中の場合）', async () => {
  const s = setup();
  const dom = withDom(s.ctx, 'pageTop');
  s.ctx._histReady = false;
  s.ctx._renderTopSummary();
  assert.deepStrictEqual(nums(dom.summary).slice(0, 3), ['…', '…', '…'], '集計前は「…」のはず');
  await s.ctx._backfillTodayPredictions();
  assert.strictEqual(s.ctx._histReady, true, '_histReady が立っていない');
  assert.deepStrictEqual(nums(dom.summary).slice(0, 3), ['3', '2', '66.7%'], 'backfill 後に TOP が描き直されていない');
});

t('backfill: TOP 以外を表示中は DOM に触らず、showPage(top) で戻った時に描き直す', async () => {
  const s = setup();
  const dom = withDom(s.ctx, 'pageStats');
  s.ctx.stopOddsAutoRefresh = () => {};
  dom.summary.innerHTML = 'STALE';
  await s.ctx._backfillTodayPredictions();
  assert.strictEqual(dom.summary.innerHTML, 'STALE', '表示していない TOP を描き直した');
  dom.state.active = 'pageTop';
  s.ctx.showPage('top');
  assert.deepStrictEqual(nums(dom.summary).slice(0, 3), ['3', '2', '66.7%'], 'TOP に戻ってもサマリーが古いまま');
});

t('backfill: データが無くて早期 return しても集計済みの印は立つ（朝イチに「…」が残らない）', async () => {
  const s = setup();
  const dom = withDom(s.ctx, 'pageTop');
  s.ctx._histReady = false;
  s.ctx.resultData = null;
  const n = await s.ctx._backfillTodayPredictions();
  assert.strictEqual(n, 0);
  assert.strictEqual(s.ctx._histReady, true);
  assert.deepStrictEqual(nums(dom.summary).slice(0, 3), ['0', '0', '0.0%']);
});

t('サマリー: 履歴に本日分があれば、集計前でも実数を出す（再訪時は即表示）', async () => {
  const s = setup();
  await s.ctx._backfillTodayPredictions();
  const dom = withDom(s.ctx, 'pageTop');
  s.ctx._histReady = false; // ページを開き直した直後を模す
  s.ctx._renderTopSummary();
  assert.deepStrictEqual(nums(dom.summary).slice(0, 3), ['3', '2', '66.7%']);
});

t('結果が後から付いた時（updateHistoryWithResults）も TOP を描き直す', async () => {
  const s = setup();
  const dom = withDom(s.ctx, 'pageTop');
  s.ctx._histReady = true;
  // (3,1) は未確定のまま予想だけ保存 → 後から結果が届く
  s.ctx.savePrediction(s.ymd, 3, 1, pred(), null);
  s.ctx._renderTopSummary();
  assert.deepStrictEqual(nums(dom.summary).slice(0, 3), ['0', '0', '0.0%']);
  const dashed = s.ymd.slice(0, 4) + '-' + s.ymd.slice(4, 6) + '-' + s.ymd.slice(6, 8);
  s.ctx.resultData[3] = { 1: result([1, 2, 3, 4, 5, 6], dashed) };
  s.ctx.updateHistoryWithResults();
  assert.deepStrictEqual(nums(dom.summary).slice(0, 3), ['1', '1', '100.0%'], '結果が付いたのに TOP が古いまま');
});

t('起動後の backfill は 60 秒も待たない（数秒以内に予約される）', async () => {
  const s = setup();
  assert.ok(s.ctx.BACKFILL_DELAY_MS <= 5000, 'BACKFILL_DELAY_MS=' + s.ctx.BACKFILL_DELAY_MS);
  const delays = [];
  s.ctx._backfillDone = false;
  s.ctx._backfillTimer = null;
  s.ctx.setTimeout = (fn, ms) => {
    delays.push(ms);
    return 1;
  };
  s.ctx._scheduleLazyBackfill();
  assert.deepStrictEqual(delays, [s.ctx.BACKFILL_DELAY_MS]);
});

/** Worker / openapi の results 生形式 (indexResults が読む形) */
function rawResult(sid, rn, order, dashed) {
  return {
    race_stadium_number: sid,
    race_number: rn,
    race_date: dashed,
    race_technique_number: 1,
    boats: order.map((b, i) => ({ racer_boat_number: b, racer_place_number: i + 1, racer_course_number: b })),
    payouts: { trifecta: [{ combination: order.slice(0, 3).join('-'), payout: 1230 }] },
  };
}

t('起動直後: ローカルの結果が古くても、最新の結果を取り込んでから集計する（90 秒 poll を待たない）', async () => {
  const s = setup();
  const dom = withDom(s.ctx, 'pageTop');
  const dashed = s.ymd.slice(0, 4) + '-' + s.ymd.slice(4, 6) + '-' + s.ymd.slice(6, 8);
  // 起動時 (loadAllData) に読めたローカルの結果は (1,1) の 1 レースだけ
  s.ctx.resultData = { 1: { 1: result([1, 2, 3, 4, 5, 6], dashed) } };
  s.ctx._histReady = false;
  // Worker は (1,2) (2,1) も確定済み
  const fresh = {
    updated_at: new Date().toISOString(),
    results: [
      rawResult(1, 1, [1, 2, 3, 4, 5, 6], dashed),
      rawResult(1, 2, [4, 1, 2, 3, 5, 6], dashed),
      rawResult(2, 1, [1, 3, 2, 4, 5, 6], dashed),
    ],
  };
  const fetched = [];
  s.ctx.fetchWithFallback = async (url) => {
    fetched.push(url);
    return url.indexOf('/results/') >= 0 ? fresh : null;
  };
  s.ctx.console = Object.assign({}, s.ctx.console, { log() {}, warn() {} });
  // lazy backfill の予約を捕まえる（他の setTimeout は発火させない）
  const scheduled = [];
  s.ctx.setTimeout = (fn, ms) => {
    scheduled.push({ fn, ms });
    return scheduled.length;
  };
  s.ctx._backfillDone = false;
  s.ctx._backfillTimer = null;

  await s.ctx.loadDeferredData(null, null);

  assert.ok(
    fetched.some((u) => u.indexOf('/results/v2/today.json') >= 0),
    '起動直後に最新の結果を取りに行っていない'
  );
  assert.ok(s.ctx.resultData[1][2] && s.ctx.resultData[1][2].isFinished, '最新の結果 (1,2) が取り込まれていない');
  assert.ok(s.ctx.resultData[2][1] && s.ctx.resultData[2][1].isFinished, '最新の結果 (2,1) が取り込まれていない');
  const bf = scheduled.filter((x) => x.ms === s.ctx.BACKFILL_DELAY_MS);
  assert.strictEqual(bf.length, 1, 'backfill が予約されていない: ' + JSON.stringify(scheduled.map((x) => x.ms)));
  // 予約された backfill を実行 → TOP は最新の 3 レース分になる
  bf[0].fn();
  for (let i = 0; i < 50 && !s.ctx._histReady; i++) await new Promise((r) => setImmediate(r));
  assert.strictEqual(s.ctx._histReady, true, 'backfill が完了しない');
  assert.deepStrictEqual(nums(dom.summary).slice(0, 3), ['3', '2', '66.7%']);
});

t('savePrediction(batch): localStorage に触らず配列を更新し dirty を立てる', async () => {
  const s = setup();
  const batch = { history: [], dirty: false };
  const dashed = s.ymd.slice(0, 4) + '-' + s.ymd.slice(4, 6) + '-' + s.ymd.slice(6, 8);
  s.ctx.savePrediction(s.ymd, 5, 7, pred(), result([1, 2, 3, 4, 5, 6], dashed), batch);
  assert.strictEqual(batch.dirty, true);
  assert.strictEqual(batch.history.length, 1);
  assert.strictEqual(batch.history[0].trifecta_hit, true);
  assert.strictEqual(s.histWrites(), 0, 'batch 指定なのに localStorage へ書いた');
  // 確定済みの再保存は不変 = dirty を立てない
  const b2 = { history: batch.history, dirty: false };
  s.ctx.savePrediction(s.ymd, 5, 7, pred(), result([6, 5, 4, 3, 2, 1], dashed), b2);
  assert.strictEqual(b2.dirty, false, '確定済みエントリを書き換えた');
  assert.deepStrictEqual(b2.history[0].actual, [1, 2, 3, 4, 5, 6]);
});

t('predictRaceAsync: worker が失敗し続けたら 3 回で worker を使うのをやめる', async () => {
  const s = setup();
  let posted = 0;
  s.ctx._appWorker = {
    postMessage(m) {
      posted++;
      const cb = s.ctx._appWorkerCallbacks.get(m.reqId);
      s.ctx._appWorkerCallbacks.delete(m.reqId);
      cb({ type: 'error', reqId: m.reqId, error: 'X is not defined' });
    },
  };
  s.ctx.console = Object.assign({}, s.ctx.console, { warn() {} });
  for (let i = 0; i < 8; i++) {
    // fallback は bundle 内の predictRace（本物）を呼ぶので、返るのは実際の予想
    const p = await s.ctx.predictRaceAsync(1, 1);
    assert.ok(p && Array.isArray(p.marks) && p.marks.length === 6, 'main fallback の結果が返らない');
  }
  assert.strictEqual(posted, 3, 'worker へ ' + posted + ' 回投げた（3 回で打ち切るはず）');
});

t('predictRaceAsync: worker が無応答 (timeout) なら 1 回で worker を使うのをやめる', async () => {
  const s = setup();
  let posted = 0;
  s.ctx._appWorker = {
    postMessage() {
      posted++; // 返事をしない
    },
  };
  // 8 秒の timeout を即時発火させる
  const realSetTimeout = s.ctx.setTimeout;
  s.ctx.setTimeout = (fn, ms) => realSetTimeout(fn, ms >= 8000 ? 0 : ms);
  s.ctx.console = Object.assign({}, s.ctx.console, { warn() {} });
  for (let i = 0; i < 4; i++) {
    const p = await s.ctx.predictRaceAsync(1, 1);
    assert.ok(p && p.marks.length === 6);
  }
  assert.strictEqual(posted, 1, 'timeout 後も worker へ投げ続けた: ' + posted);
});

t('predictRaceAsync: worker が成功すれば失敗カウントは戻る（断続的な失敗では止めない）', async () => {
  const s = setup();
  let posted = 0;
  const script = ['error', 'error', 'ok', 'error', 'error', 'ok', 'error', 'error', 'ok'];
  s.ctx._appWorker = {
    postMessage(m) {
      const kind = script[posted++];
      const cb = s.ctx._appWorkerCallbacks.get(m.reqId);
      s.ctx._appWorkerCallbacks.delete(m.reqId);
      if (kind === 'ok') cb({ type: 'predict_done', reqId: m.reqId, result: pred() });
      else cb({ type: 'error', reqId: m.reqId, error: 'transient' });
    },
  };
  s.ctx.console = Object.assign({}, s.ctx.console, { warn() {} });
  for (let i = 0; i < script.length; i++) await s.ctx.predictRaceAsync(1, 1);
  assert.strictEqual(posted, script.length, '成功を挟んでいるのに worker を止めた');
});

(async () => {
  console.log('=== TOP 成績サマリー / backfill ===');
  for (const [name, fn] of queue) {
    try {
      await fn();
      console.log('  PASS:', name);
      pass++;
    } catch (e) {
      console.log('  FAIL:', name, '\n    ', e.message);
      fail++;
    }
  }
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})();

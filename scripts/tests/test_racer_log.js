/**
 * 選手ごとの出走ログ（2026-11-26、第 3 段階）
 *   src/discovery/racer_profiles_loader.js（_loadRacerLog / _racerLogOf）
 *   src/reporting/racer_detail.js（_racerLogCard）
 *   データ: data/db/racer_log/NN.json（scripts/build_racer_log.py。NN = 登録番号 % 100）
 *     1 行 = [ymd, sid, rno, boat, course, st, place, tech, out, grade]
 *
 *   - 取得: その選手の入った 1 ファイルだけ / 30 分は取り直さない / 失敗は 3 分 / 取り直しの失敗で前の内容を捨てない
 *   - 表示: 日付・場・枠・進入・ST・着順・決まり手、着順なし（F・転 など）、要約、折りたたみ
 *   - 形の合わない行・HTML の混ざった値を出さない
 *   - 行があるときだけ「直近の着順」と入れ替える
 *
 *   node scripts/tests/test_racer_log.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const J = (x) => JSON.parse(JSON.stringify(x));
let pass = 0,
  fail = 0;
const queue = [];
function t(name, fn) {
  queue.push({ name, fn });
}
function section(title) {
  queue.push({ title });
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const NOW = Date.parse('2026-11-26T09:00:00+09:00');
const MIN = 60000;
// [ymd, sid, rno, boat, course, st, place, tech, out, grade]
const ROWS = [
  [20261125, 8, 10, 4, 4, 16, 5, 1, '', 1],
  [20261125, 8, 6, 6, 6, 14, 4, 1, '', 1],
  [20261124, 8, 12, 1, 1, 6, 1, 1, '', 1],
  [20261120, 15, 12, 2, 3, 14, 1, 4, '', 2],
  [20261119, 15, 10, 1, null, null, 1, 0, '', 2],
  [20261118, 15, 11, 2, null, null, 2, 0, '', 5],
];
function okFetch(ctx, body, log) {
  ctx.fetch = (url, opt) => {
    if (log) log.push({ url, opt });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(typeof body === 'function' ? body(url) : body) });
  };
}
function detailCtx(rows, state) {
  const ctx = makeCtx();
  ctx.programData = {};
  ctx.resultData = {};
  ctx.predictRace = () => null;
  ctx._racerProfiles = { 4320: { name: '峰　　　　竜　太', kana: 'ﾐﾈ ﾘｭｳﾀ', branch: '佐賀', classNum: 1, winRate: 8.85, courseStats: {}, recentResults: [3, 1, 2] } };
  ctx._racerStatsView = { racers: {}, window: { racer_months: 12 } };
  ctx._racerExt = { racers: {}, term: null };
  ctx._loadRacerOfficial = () => false;
  ctx._racerOfficialOf = () => null;
  ctx._loadRacerLog = () => false;
  ctx._racerLogOf = () => (rows === undefined ? null : Object.assign({ loading: false, failed: false, rows }, state || {}));
  return ctx;
}
const card = (rows, state) => detailCtx(rows, state)._racerLogCard({ id: '4320' });
// 1 行を「|」区切りの文字にする（タグの境目が「|」。グレードの印は別の要素なので「常滑 10R |SG|」になる）
const trs = (html) => (html.match(/<tr><td>.*?<\/tr>/g) || []).map((r) => r.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'));

section('[取得]');
t('その選手の入った 1 ファイルだけ取る（登録番号 % 100、2 桁にそろえる）', async () => {
  const ctx = makeCtx();
  const log = [];
  okFetch(ctx, { v: 1, racers: { 4320: ROWS } }, log);
  assert.strictEqual(ctx._racerLogOf('4320'), null, '取りに行く前は null');
  assert.strictEqual(ctx._loadRacerLog('4320', null, NOW), true);
  assert.deepStrictEqual(J(ctx._racerLogOf('4320')), { loading: true, failed: false, rows: null });
  await tick();
  assert.deepStrictEqual(log.map((x) => x.url), ['data/db/racer_log/20.json']);
  assert.strictEqual(log[0].opt.cache, 'no-cache');
  assert.deepStrictEqual(J(ctx._racerLogOf('4320')), { loading: false, failed: false, rows: ROWS });
  ctx._racerLogCache = null;
  const ctx2 = makeCtx();
  const log2 = [];
  okFetch(ctx2, { v: 1, racers: {} }, log2);
  ctx2._loadRacerLog('3305', null, NOW);
  ctx2._loadRacerLog('5000', null, NOW);
  assert.deepStrictEqual(log2.map((x) => x.url), ['data/db/racer_log/05.json', 'data/db/racer_log/00.json']);
});
t('同じファイルの別の選手は取り直さない。行の無い選手は空の配列', async () => {
  const ctx = makeCtx();
  const log = [];
  okFetch(ctx, { v: 1, racers: { 4320: ROWS } }, log);
  ctx._loadRacerLog('4320', null, NOW);
  await tick();
  assert.strictEqual(ctx._loadRacerLog('4420', null, Date.now() + MIN), false, '4420 も 20.json');
  assert.strictEqual(log.length, 1);
  assert.deepStrictEqual(J(ctx._racerLogOf('4420')), { loading: false, failed: false, rows: [] });
});
t('30 分は取り直さない。過ぎたら取り直す。取得中は重ねて取らない', async () => {
  const ctx = makeCtx();
  const log = [];
  let release;
  ctx.fetch = (url) => {
    log.push(url);
    return new Promise((res) => (release = () => res({ ok: true, json: () => Promise.resolve({ racers: { 4320: ROWS } }) })));
  };
  assert.strictEqual(ctx._loadRacerLog('4320', null, NOW), true);
  assert.strictEqual(ctx._loadRacerLog('4320', null, NOW), false, '取得中');
  assert.strictEqual(ctx._loadRacerLog('4320', null, NOW + 31 * MIN), false, '取得が長引いていても重ねて取らない');
  assert.strictEqual(log.length, 1);
  release();
  await tick();
  const at = Date.now(); // 取得が終わった時刻（loader は実時計で記録する）
  assert.strictEqual(ctx._loadRacerLog('4320', null, at + 29 * MIN), false);
  assert.strictEqual(ctx._loadRacerLog('4320', null, at + 31 * MIN), true);
  assert.strictEqual(log.length, 2);
  release();
  await tick();
  assert.strictEqual(ctx._loadRacerLog('4320', null, Date.now() - 5 * MIN), true, '時計が戻っていたら取り直す');
});
t('失敗（404 / 通信エラー / 形の違う応答）は 3 分覚える。その間は取りに行かない', async () => {
  const bad = [
    () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({ racers: [1, 2] }) }),
    () => Promise.resolve({ ok: true, json: () => Promise.resolve(null) }),
    () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('not json')) }),
  ];
  for (const f of bad) {
    const ctx = makeCtx();
    let n = 0;
    ctx.fetch = () => (n++, f());
    let called = null;
    ctx._loadRacerLog('4320', (id) => (called = id), NOW);
    await tick();
    await tick();
    assert.strictEqual(called, '4320', '失敗しても onLoaded を呼ぶ');
    assert.deepStrictEqual(J(ctx._racerLogOf('4320')), { loading: false, failed: true, rows: null });
    const at = Date.now();
    assert.strictEqual(ctx._loadRacerLog('4320', null, at + 2 * MIN), false);
    assert.strictEqual(ctx._loadRacerLog('4320', null, at + 4 * MIN), true);
    assert.strictEqual(n, 2);
  }
});
t('取り直しに失敗しても、前に取れた内容は残す', async () => {
  const ctx = makeCtx();
  okFetch(ctx, { racers: { 4320: ROWS } });
  ctx._loadRacerLog('4320', null, NOW);
  await tick();
  ctx.fetch = () => Promise.reject(new Error('offline'));
  ctx._loadRacerLog('4320', null, Date.now() + 31 * MIN);
  assert.deepStrictEqual(J(ctx._racerLogOf('4320').rows), ROWS, '取り直し中も前の内容');
  await tick();
  const o = J(ctx._racerLogOf('4320'));
  assert.strictEqual(o.failed, true);
  assert.deepStrictEqual(o.rows, ROWS);
});
t('時間切れを付けて取る（capabilities.makeTimeoutSignal）', async () => {
  const ctx = makeCtx();
  const sig = { tag: 'signal' };
  let ms = 0;
  const caps = Object.create(ctx.capabilities);
  Object.defineProperty(caps, 'makeTimeoutSignal', { value: (n) => ((ms = n), sig) });
  ctx.capabilities = caps;
  const log = [];
  okFetch(ctx, { racers: {} }, log);
  ctx._loadRacerLog('4320', null, NOW);
  assert.strictEqual(ms, 10000);
  assert.strictEqual(log[0].opt.signal, sig);
});
t('登録番号でない値では取りに行かない', () => {
  const ctx = makeCtx();
  let n = 0;
  ctx.fetch = () => (n++, Promise.reject(new Error('x')));
  for (const bad of ['abc', '', null, undefined, '123', '123456', '43 20', '../20', {}]) {
    assert.strictEqual(ctx._loadRacerLog(bad, null, NOW), false, String(bad));
    assert.strictEqual(ctx._racerLogOf(bad), null, String(bad));
  }
  assert.strictEqual(n, 0);
});

section('[表示]');
t('1 行: 日付・場と R・枠・進入・ST・着順・決まり手（勝った走だけ）', () => {
  const html = card(ROWS);
  const r = trs(html);
  assert.strictEqual(r.length, 6);
  assert.strictEqual(r[0], '|11/25|常滑 10R |SG|4|4|.16|5|', '5 着に決まり手は出さない');
  assert.strictEqual(r[2], '|11/24|常滑 12R |SG|1|1|.06|1|逃げ|', 'ST 0.06 は .06');
  assert.strictEqual(r[3], '|11/20|丸亀 12R |G1|2|3|.14|1|まくり差し|', '進入は枠と別（前付け・枠なり以外）');
  assert.ok(html.indexOf('<span class="pl pl-1">1</span>') >= 0);
  assert.ok(html.indexOf('<span class="gr gr-sg">SG</span>') >= 0);
  assert.ok(html.indexOf('前日までの 6 走') >= 0);
});
t('グレードは決まった番号（数値の 1〜4）のときだけ印を付ける', () => {
  const g = (v) => trs(card([[20261118, 15, 11, 2, 2, 15, 2, 2, '', v]]))[0];
  assert.strictEqual(g(1), '|11/18|丸亀 11R |SG|2|2|.15|2|');
  assert.strictEqual(g(4), '|11/18|丸亀 11R |G3|2|2|.15|2|');
  for (const v of ['1', 1.5, true, null, [1], { valueOf: () => 1 }]) {
    assert.strictEqual(g(v), '|11/18|丸亀 11R|2|2|.15|2|', JSON.stringify(v));
  }
});
t('一般戦にグレードの印は付けない。知らないグレード番号でも落ちない', () => {
  const r = trs(card([[20261118, 15, 11, 2, 2, 15, 2, 2, '', 5], [20261117, 15, 1, 3, 3, 15, 3, 2, '', 0], [20261116, 15, 1, 3, 3, 15, 3, 2, '', 99]]));
  assert.deepStrictEqual(r, ['|11/18|丸亀 11R|2|2|.15|2|', '|11/17|丸亀 1R|3|3|.15|3|', '|11/16|丸亀 1R|3|3|.15|3|']);
});
t('着順だけの行（記録開始前）は進入・ST・決まり手を「-」/ 空に。注記を出す', () => {
  const html = card(ROWS);
  assert.strictEqual(trs(html)[4], '|11/19|丸亀 10R |G1|1|-|-|1|', '勝っていても決まり手は分からない');
  assert.ok(html.indexOf('進入・ST・決まり手は 2026/11/20 以降のレースから記録しています') >= 0);
  assert.ok(card(ROWS.slice(0, 4)).indexOf('2026/11/20 以降') < 0, '全部そろっていれば注記は出さない');
});
t('着順なし: F・L・転 などはその文字、理由が分からなければ「—」', () => {
  const r = trs(
    card([
      [20261125, 8, 10, 4, 4, -1, 0, 3, 'F', 5],
      [20261124, 8, 9, 3, 3, null, 0, 1, 'L', 5],
      [20261123, 8, 8, 2, 2, 18, 0, 2, '転', 5],
      [20261122, 8, 7, 5, null, null, 0, 0, '?', 5],
      [20261121, 8, 6, 5, null, null, 0, 0, '', 5],
    ])
  );
  assert.deepStrictEqual(r, [
    '|11/25|常滑 10R|4|4|F.01|F|',
    '|11/24|常滑 9R|3|3|L|L|',
    '|11/23|常滑 8R|2|2|.18|転|',
    '|11/22|常滑 7R|5|-|-|—|',
    '|11/21|常滑 6R|5|-|-|—|',
  ]);
});
t('ST が 1 秒以上（大きな出遅れ）でも桁を崩さない', () => {
  const r = trs(card([[20261125, 8, 10, 4, 4, 105, 6, 1, '', 5], [20261124, 8, 10, 4, 4, 100, 6, 1, '', 5], [20261123, 8, 10, 4, 4, 0, 1, 1, '', 5]]));
  assert.deepStrictEqual(r, ['|11/25|常滑 10R|4|4|1.05|6|', '|11/24|常滑 10R|4|4|1.00|6|', '|11/23|常滑 10R|4|4|.00|1|逃げ|']);
});
t('表は横に長くなってもページをはみ出させない（入れ物の中で横スクロール）', () => {
  const html = card(ROWS);
  assert.ok(html.indexOf('<div class="lg-wrap"><table class="ct lg">') >= 0);
  assert.ok(/\.lg-wrap\{overflow-x:auto\}/.test(read('index.html')));
});
t('要約: 着順の内訳と平均 ST。F は平均に入れず回数で出す。ST の分かる走が無ければ平均は出さない', () => {
  const rows = [
    [20261125, 8, 10, 1, 1, 10, 1, 1, '', 5],
    [20261125, 8, 4, 2, 2, 20, 2, 1, '', 5],
    [20261124, 8, 10, 3, 3, 15, 3, 1, '', 5],
    [20261124, 8, 4, 4, 4, -2, 0, 1, 'F', 5],
    [20261123, 8, 4, 4, 4, 6, 1, 3, '', 5],
    [20261119, 8, 4, 4, null, null, 6, 0, '', 5],
  ];
  const html = card(rows);
  assert.ok(html.indexOf('1 着 2 回・2 着 1 回・3 着 1 回 / 平均 ST .13（4 走） / F 1 回') >= 0, html.match(/lg-sum">[^<]*/)[0]);
  const noSt = card([[20261119, 8, 4, 4, null, null, 6, 0, '', 5]]);
  assert.ok(noSt.indexOf('1 着 0 回・2 着 0 回・3 着 0 回</div>') >= 0);
  assert.ok(card([[20261125, 8, 10, 1, 1, 5, 1, 1, '', 5]]).indexOf('平均 ST .05（1 走）') >= 0, '1 桁は 0 を補う');
});
t('15 走までそのまま、残りは折りたたみ', () => {
  const many = [];
  for (let i = 0; i < 40; i++) many.push([20261125 - Math.floor(i / 2), 8, 12 - (i % 12), 1 + (i % 6), 1 + (i % 6), 15, 1 + (i % 6), 1, '', 5]);
  const html = card(many);
  const [head, rest] = html.split('<details class="lg-more">');
  assert.strictEqual(trs(head).length, 15);
  assert.strictEqual(trs(rest).length, 25);
  assert.ok(rest.indexOf('<summary>さらに 25 走を表示</summary>') === 0);
  assert.ok(html.indexOf('前日までの 40 走') >= 0);
  assert.ok(card(many.slice(0, 15)).indexOf('<details') < 0, '15 走以下なら折りたたみは無い');
});
t('形の合わない行は出さない。HTML の混ざった値はそのまま出さない', () => {
  const good = [20261125, 8, 10, 4, 4, 16, 5, 1, '', 1];
  const bad = [
    null,
    'x',
    {},
    [20261125, 8, 10, 4],
    ['<img src=x onerror=1>', 8, 10, 4, 4, 16, 5, 1, '', 1],
    [20261125, 99, 10, 4, 4, 16, 5, 1, '', 1],
    [20261125, 8, 13, 4, 4, 16, 5, 1, '', 1],
    [20261125, 8, 10, 7, 4, 16, 5, 1, '', 1],
    [20261125, 8, 10, 4, 9, 16, 5, 1, '', 1],
    [20261125, 8, 10, 4, 4, '16', 5, 1, '', 1],
    [20261125, 8, 10, 4, 4, 16, 7, 1, '', 1],
    [20261125, 8, 10, 4, 4, 16, '<b>1</b>', 1, '', 1],
    [20261125.5, 8, 10, 4, 4, 16, 5, 1, '', 1],
  ];
  const html = card(bad.concat([good]));
  assert.strictEqual(trs(html).length, 1);
  assert.ok(html.indexOf('前日までの 1 走') >= 0);
  assert.strictEqual(card(bad), '', '出せる行が無ければカードごと出さない');
  // 着順なしの理由・決まり手・グレードに変な値
  const h2 = card([[20261125, 8, 10, 4, 4, 16, 0, '<i>', '<script>alert(1)</script>', '<u>'], [20261124, 8, 10, 4, 4, 16, 1, { a: 1 }, 5, 'constructor']]);
  assert.ok(h2.indexOf('<script') < 0 && h2.indexOf('<i>') < 0 && h2.indexOf('<u>') < 0, h2);
  assert.ok(h2.indexOf('&lt;s') >= 0, '理由は 2 文字に切って escape して出す');
  assert.strictEqual(trs(h2)[1], '|11/24|常滑 10R|4|4|.16|1|', '決まり手・グレードが変でも行は出す');
  const h3 = card([[20261124, 8, 10, 4, 4, 16, 1, 'constructor', '', 'toString'], [20261123, 8, 10, 4, 4, 16, 1, 7, '', -1]]);
  assert.deepStrictEqual(trs(h3), ['|11/24|常滑 10R|4|4|.16|1|', '|11/23|常滑 10R|4|4|.16|1|'], 'Object の既定の項目を拾わない');
  assert.ok(h3.indexOf('function') < 0 && h3.indexOf('native') < 0);
});
t('行が無い・まだ届いていない・失敗 のときはカードを出さない', () => {
  assert.strictEqual(card(undefined), '');
  assert.strictEqual(card(null, { loading: true }), '');
  assert.strictEqual(card(null, { failed: true }), '');
  assert.strictEqual(card([]), '');
  assert.strictEqual(card({ length: 3 }), '', '配列でなければ出さない');
});
t('取り直しに失敗していても、前に取れた行があれば出す', () => {
  assert.ok(card(ROWS, { failed: true }).indexOf('出走ログ') >= 0);
});

section('[選手詳細]');
t('行があれば「出走ログ」を出し、「直近の着順」は出さない。出典にも書く', () => {
  const html = detailCtx(ROWS)._racerDetailHtml('4320', null, NOW);
  assert.ok(html.indexOf('出走ログ') >= 0);
  assert.ok(html.indexOf('走の着順') < 0);
  assert.ok(html.indexOf('確定結果の記録（出走ログ）') >= 0);
  assert.ok(html.indexOf('出走ログ') > html.indexOf('峰'), 'プロフィールより後');
});
t('行が無い間（未取得・取得中・失敗・0 件）は従来の「直近の着順」を出す', () => {
  for (const [rows, state] of [[undefined], [null, { loading: true }], [null, { failed: true }], [[]]]) {
    const html = detailCtx(rows, state)._racerDetailHtml('4320', null, NOW);
    assert.ok(html.indexOf('直近 3 走の着順') >= 0, JSON.stringify([rows, state]));
    assert.ok(html.indexOf('出走ログ') < 0);
  }
});
t('開いた選手のログを取りに行き、届いたら描き直す', () => {
  const ctx = detailCtx(undefined);
  const calls = [];
  ctx._loadRacerLog = (id, cb) => (calls.push({ id, cb }), true);
  let redraw = 0;
  ctx._racerRerender = () => redraw++;
  ctx._racerDetailHtml('4320', null, NOW);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].id, '4320');
  calls[0].cb('4320');
  assert.strictEqual(redraw, 1);
});
t('取得のしくみが無くても落ちない（古い chunk との組合せ）', () => {
  const ctx = detailCtx(ROWS);
  ctx._loadRacerLog = undefined;
  assert.ok(ctx._racerDetailHtml('4320', null, NOW).indexOf('直近 3 走の着順') >= 0);
  const ctx2 = detailCtx(ROWS);
  ctx2._racerLogOf = undefined;
  assert.ok(ctx2._racerDetailHtml('4320', null, NOW).indexOf('直近 3 走の着順') >= 0);
});

section('[配線]');
t('選手ページの chunk に入り、起動時の bundle には入らない', () => {
  const racer = read('assets/app-rest-racer.js');
  const critical = read('assets/app-critical.js');
  for (const name of ['function _loadRacerLog', 'function _racerLogCard', 'function _racerLogOf']) {
    assert.ok(racer.indexOf(name) >= 0, name + ' が racer chunk に無い');
    assert.ok(critical.indexOf(name) < 0, name + ' が critical に入っている');
  }
});
t('reporting 層から直接 fetch しない（取得は discovery 層）', () => {
  assert.ok(!/\bfetch\(/.test(read('src/reporting/racer_detail.js')));
  assert.ok(/fetch\('data\/db\/racer_log\/'/.test(read('src/discovery/racer_profiles_loader.js')));
});
t('実データ（data/db/racer_log）が、画面の受け付ける形になっている', () => {
  const idx = JSON.parse(read('data/db/racer_log/index.json'));
  assert.strictEqual(idx.v, 1);
  assert.ok(idx.racers > 1000 && idx.entries > 10000, JSON.stringify(idx));
  const ctx = detailCtx(undefined);
  let rows = 0;
  let shown = 0;
  for (let n = 0; n < 100; n++) {
    const d = JSON.parse(read('data/db/racer_log/' + String(n).padStart(2, '0') + '.json'));
    for (const id of Object.keys(d.racers)) {
      assert.strictEqual(Number(id) % 100, n, id + ' が違うファイルにいる');
      ctx._racerLogOf = () => ({ loading: false, failed: false, rows: d.racers[id] });
      const html = ctx._racerLogCard({ id });
      rows += d.racers[id].length;
      shown += trs(html).length;
    }
  }
  assert.strictEqual(rows, idx.entries);
  assert.strictEqual(shown, rows, '捨てられた行がある');
});

(async () => {
  for (const q of queue) {
    if (q.title) {
      console.log(q.title);
      continue;
    }
    try {
      await q.fn();
      console.log('  PASS:', q.name);
      pass++;
    } catch (e) {
      console.log('  FAIL:', q.name, '\n    ', e.message);
      fail++;
    }
  }
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();

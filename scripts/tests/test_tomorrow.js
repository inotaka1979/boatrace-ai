/**
 * 明日の出走（2026-11-26、選手機能 第 3 段階 B）
 *   src/discovery/tomorrow_loader.js（_loadTomorrow / _tomorrowEntriesOf / _tomorrowInfo / _tomorrowYmd）
 *   src/reporting/racer_fav.js（TOP の帯の「明日」の部分）
 *   src/reporting/racer_detail.js（選手詳細の「明日の出走」）
 *   src/reporting/racer_page.js（お気に入り一覧の「明日 常滑 6R・10R」）
 *   データ: data/schedule/tomorrow.json（scripts/scrape_tomorrow.py）。
 *     フィクスチャ tomorrow_sample.json は scraper の出力そのもの（test_scrape_tomorrow.py が同じ内容を固定している）
 *
 *   node scripts/tests/test_tomorrow.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const J = (x) => JSON.parse(JSON.stringify(x));
const SAMPLE = JSON.parse(read('scripts/tests/fixtures/tomorrow_sample.json')); // date 20261126、場 8（常滑 12R）と 20（1R）、12 は未公開
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

const MIN = 60000;
const NOW = Date.parse('2026-11-25T19:30:00+09:00'); // 明日 = 11/26（サンプルの日付）
const jst = (s) => Date.parse(s + '+09:00');

function withData(ctx, data) {
  ctx._tomorrow.data = data === undefined ? J(SAMPLE) : data;
  ctx._tomorrow.at = NOW;
  ctx._tomorrow.failed = false;
  ctx._tomorrow.loading = false;
  return ctx;
}
function boat(n, id, name) {
  return { racer_boat_number: n, racer_number: id, racer_name: name, racer_class_number: 1 };
}
// 今日（11/25）の番組表: 峰 竜太 が 常滑 10R（締切 20:10）に出る
function topCtx(favs, opt) {
  const ctx = makeCtx();
  ctx.programData = (opt && opt.program) || { 8: { 10: { race_closed_at: '2026-11-25 20:10:00', race_title: 'テスト杯', race_grade_number: 5, boats: [boat(4, 4320, '峰 竜太'), boat(1, 4500, '山田 康二')] } } };
  ctx.resultData = {};
  ctx.predictRace = () => null;
  ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify(favs || []));
  if (!(opt && opt.noData)) withData(ctx, opt && opt.data);
  ctx._loadTomorrow = () => false; // 取得は [取得] の節で確かめる
  return ctx;
}
const FAV = (id, name, ts) => ({ id: String(id), name, ts: ts || 1 });
const text = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const rowsOf = (html, cls) => (html.match(new RegExp('<div class="fav-row ' + cls + '".*?</div>', 'g')) || []).map(text);

section('[取得]');
t('15 時 (JST) より前は取りに行かない。15 時からは data/schedule/tomorrow.json を取る', async () => {
  const ctx = makeCtx();
  const log = [];
  ctx.fetch = (url, opt) => (log.push({ url, opt }), Promise.resolve({ ok: true, json: () => Promise.resolve(J(SAMPLE)) }));
  assert.strictEqual(ctx._loadTomorrow(null, jst('2026-11-25T08:00:00')), false);
  assert.strictEqual(ctx._loadTomorrow(null, jst('2026-11-25T14:59:00')), false);
  assert.strictEqual(log.length, 0);
  assert.strictEqual(ctx._loadTomorrow(null, jst('2026-11-25T15:00:00')), true);
  await tick();
  assert.deepStrictEqual(log.map((x) => x.url), ['data/schedule/tomorrow.json']);
  assert.strictEqual(log[0].opt.cache, 'no-cache');
  assert.strictEqual(ctx._tomorrowInfo(jst('2026-11-25T15:00:00')).date, '20261126');
});
t('10 分は取り直さない。失敗は 3 分。取得中は重ねて取らない', async () => {
  const ctx = makeCtx();
  let n = 0;
  let release;
  ctx.fetch = () => (n++, new Promise((res) => (release = (v) => res(v))));
  assert.strictEqual(ctx._loadTomorrow(null, NOW), true);
  assert.strictEqual(ctx._loadTomorrow(null, NOW + 11 * MIN), false, '取得中');
  release({ ok: true, json: () => Promise.resolve(J(SAMPLE)) });
  await tick();
  const at = Date.now();
  // 実時計の時刻（at）が 15 時前でも確かめられるよう、15 時以降の時刻に合わせた差で見る
  const base = at + ((15 + 24 - new Date(at + 9 * 3600000).getUTCHours()) % 24) * 3600000;
  ctx._tomorrow.at = base;
  assert.strictEqual(ctx._loadTomorrow(null, base + 9 * MIN), false);
  assert.strictEqual(ctx._loadTomorrow(null, base + 11 * MIN), true);
  release({ ok: false, status: 404, json: () => Promise.resolve({}) });
  await tick();
  assert.strictEqual(ctx._tomorrow.failed, true);
  ctx._tomorrow.at = base;
  assert.strictEqual(ctx._loadTomorrow(null, base + 2 * MIN), false);
  assert.strictEqual(ctx._loadTomorrow(null, base + 4 * MIN), true);
  assert.strictEqual(n, 3);
});
t('失敗（404 / 通信エラー / 形の違う応答）しても前の内容は残す。終わったら onLoaded を呼ぶ', async () => {
  const bad = [
    () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({ stadiums: {} }) }),
    () => Promise.resolve({ ok: true, json: () => Promise.resolve([1]) }),
    () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('not json')) }),
  ];
  for (const f of bad) {
    const ctx = makeCtx();
    withData(ctx);
    ctx._tomorrow.at = NOW - 20 * MIN;
    ctx.fetch = f;
    let called = 0;
    assert.strictEqual(ctx._loadTomorrow(() => called++, NOW), true);
    await tick();
    await tick();
    assert.strictEqual(called, 1);
    assert.strictEqual(ctx._tomorrow.failed, true);
    assert.strictEqual(ctx._tomorrowEntriesOf(4320, NOW).length, 3, '前の内容で引ける');
  }
});
t('時間切れを付けて取る（capabilities.makeTimeoutSignal）', () => {
  const ctx = makeCtx();
  const sig = { tag: 'signal' };
  let ms = 0;
  const caps = Object.create(ctx.capabilities);
  Object.defineProperty(caps, 'makeTimeoutSignal', { value: (n) => ((ms = n), sig) });
  ctx.capabilities = caps;
  const log = [];
  ctx.fetch = (url, opt) => (log.push(opt), new Promise(() => {}));
  ctx._loadTomorrow(null, NOW);
  assert.strictEqual(ms, 10000);
  assert.strictEqual(log[0].signal, sig);
});

section('[日付]');
t('明日の日付は日本時間で決める（月末・年末をまたぐ）', () => {
  const ctx = makeCtx();
  assert.strictEqual(ctx._tomorrowYmd(jst('2026-11-25T19:30:00')), '20261126');
  assert.strictEqual(ctx._tomorrowYmd(jst('2026-11-25T23:59:59')), '20261126');
  assert.strictEqual(ctx._tomorrowYmd(jst('2026-11-26T00:00:00')), '20261127');
  assert.strictEqual(ctx._tomorrowYmd(jst('2026-11-30T08:00:00')), '20261201');
  assert.strictEqual(ctx._tomorrowYmd(jst('2026-12-31T22:00:00')), '20270101');
  assert.strictEqual(ctx._tomorrowYmd(Date.parse('2026-11-25T16:00:00Z')), '20261127', 'UTC 16 時は日本の翌 1 時');
});
t('日付が「明日」でない内容は使わない（日付が変わった後の古いファイル）', () => {
  const ctx = withData(makeCtx());
  assert.ok(ctx._tomorrowEntriesOf(4320, NOW).length > 0);
  const next = jst('2026-11-26T00:05:00');
  assert.strictEqual(ctx._tomorrowEntriesOf(4320, next), null, '11/26 になったら、11/26 のデータは「今日」');
  assert.strictEqual(ctx._tomorrowInfo(next), null);
  assert.strictEqual(ctx._tomorrowEntriesOf(4320, jst('2026-11-24T20:00:00')), null);
});

section('[選手ごとの出走]');
t('登録番号で引く。締切の早い順。出走の無い選手は空、データが無ければ null', () => {
  const ctx = withData(makeCtx());
  assert.deepStrictEqual(J(ctx._tomorrowEntriesOf(4320, NOW)), [
    { sid: 8, rno: 6, hm: '12:43', boat: 5, name: '峰 竜太', cls: 1, label: '3日目' },
    { sid: 8, rno: 10, hm: '14:55', boat: 3, name: '峰 竜太', cls: 1, label: '3日目' },
    { sid: 20, rno: 1, hm: '15:20', boat: 1, name: '峰 竜太', cls: 1, label: '初日' },
  ]);
  assert.deepStrictEqual(J(ctx._tomorrowEntriesOf('3618', NOW)).map((e) => [e.sid, e.rno, e.boat]), [[8, 1, 1]], '文字の登録番号でも引ける');
  assert.deepStrictEqual(J(ctx._tomorrowEntriesOf(1234, NOW)), []);
  assert.strictEqual(makeCtx()._tomorrowEntriesOf(4320, NOW), null);
});
t('選手ごとの並びは締切の早い順（場番号やレース番号の順ではない）', () => {
  const data = { date: '20261126', pending: [], stadiums: {
    8: { label: '', races: [{ r: 6, t: '12:43', b: [[5, 4320, '峰 竜太', 1]] }, { r: 2, t: '18:00', b: [[1, 4320, '峰 竜太', 1]] }] },
    20: { label: '', races: [{ r: 9, t: '09:00', b: [[1, 4320, '峰 竜太', 1]] }] },
  } };
  const ctx = withData(makeCtx(), data);
  assert.deepStrictEqual(J(ctx._tomorrowEntriesOf(4320, NOW)).map((e) => [e.hm, e.sid, e.rno]), [['09:00', 20, 9], ['12:43', 8, 6], ['18:00', 8, 2]]);
  assert.deepStrictEqual(J(ctx._favEntriesTomorrow === undefined ? [] : topCtx([FAV(4320, '峰 竜太')], { data })._favEntriesTomorrow(NOW).rows).map((r) => r.e.hm), ['09:00', '12:43', '18:00']);
});
t('概要: 公開済みの場の数と、未公開の場の数', () => {
  const ctx = withData(makeCtx());
  assert.deepStrictEqual(J(ctx._tomorrowInfo(NOW)), { date: '20261126', stadiums: 2, pending: 1 });
  withData(ctx, { date: '20261126', stadiums: {}, pending: 'x' });
  assert.deepStrictEqual(J(ctx._tomorrowInfo(NOW)), { date: '20261126', stadiums: 0, pending: 0 });
});
t('形の合わない場・レース・艇は入れない', () => {
  const good = { r: 3, t: '11:00', b: [[2, 4320, '峰 竜太', 1]] };
  const data = {
    date: '20261126',
    pending: [],
    stadiums: {
      8: { label: 12345, races: [good, null, 'x', { r: 13, t: '11:00', b: [[1, 4320, 'a', 1]] }, { r: 4, t: '11:30', b: 'x' }, { r: 5, t: '25時', b: [[7, 4320, 'a', 1], [1, 'x', 'a', 1], [1, 99, 'a', 1], 'x', [3, 4320, { n: 1 }, 9]] }] },
      99: { races: [good] },
      abc: { races: [good] },
      9: null,
      10: { races: 'x' },
      constructor: { races: [good] },
    },
  };
  const ctx = withData(makeCtx(), data);
  assert.deepStrictEqual(J(ctx._tomorrowEntriesOf(4320, NOW)), [
    { sid: 8, rno: 5, hm: '', boat: 3, name: '', cls: 0, label: '' }, // 時刻・名前・級が読めなくても、艇と登録番号が合っていれば入れる（時刻なしは最後）
    { sid: 8, rno: 3, hm: '11:00', boat: 2, name: '峰 竜太', cls: 1, label: '' },
  ].sort((a, b) => (a.hm || '99:99').localeCompare(b.hm || '99:99')));
  for (const bad of [{ date: '20261126' }, { date: '20261126', stadiums: [] }, { date: '20261126', stadiums: 'x' }]) {
    assert.deepStrictEqual(J(withData(makeCtx(), bad)._tomorrowEntriesOf(4320, NOW)), []);
  }
  assert.deepStrictEqual(J(ctx._tomorrowEntriesOf('constructor', NOW)), [], 'Object の既定の項目を拾わない');
  assert.deepStrictEqual(J(ctx._tomorrowEntriesOf('__proto__', NOW)), []);
});

section('[TOP の帯]');
t('本日の出走の下に「明日」: 日付・人数・走数、締切・場と R・枠・名前。押すと選手のページ', () => {
  const ctx = topCtx([FAV(4320, '峰 竜太'), FAV(3618, '海野 ゆかり'), FAV(1234, '出走 なし')]);
  const html = ctx._favStripHtml(NOW);
  assert.ok(html.indexOf('お気に入り選手の出走（本日 1 人・1 走）') >= 0);
  assert.ok(html.indexOf('<div class="fav-sub">明日 11/26（木） 2 人・4 走') >= 0, html.match(/fav-sub">[^<]*/));
  assert.deepStrictEqual(rowsOf(html, 'fav-tm'), ['|10:27|常滑 |1R|1| |海野 ゆかり|', '|12:43|常滑 |6R|5| |峰 竜太|', '|14:55|常滑 |10R|3| |峰 竜太|', '|15:20|若松 |1R|1| |峰 竜太|']);
  assert.ok(html.indexOf('data-action="openRacer" data-arg-id="3618"') >= 0);
  assert.ok(html.indexOf('明日') > html.indexOf('data-action="openRace"'), '本日の行より後');
});
t('未公開の場があれば添える', () => {
  const html = topCtx([FAV(4320, '峰 竜太')])._favStripHtml(NOW);
  assert.ok(html.indexOf('（1 場は出走表が未公開）') >= 0);
  const all = J(SAMPLE);
  all.pending = [];
  assert.ok(topCtx([FAV(4320, '峰 竜太')], { data: all })._favStripHtml(NOW).indexOf('未公開') < 0);
});
t('本日の出走が無くても、明日の出走があれば出す', () => {
  const ctx = topCtx([FAV(3618, '海野 ゆかり')]);
  const html = ctx._favStripHtml(NOW);
  assert.ok(html.indexOf('お気に入り選手の出走（本日はなし）') >= 0);
  assert.ok(html.indexOf('fav-empty') < 0);
  assert.deepStrictEqual(rowsOf(html, 'fav-tm'), ['|10:27|常滑 |1R|1| |海野 ゆかり|']);
});
t('明日のデータが無い・誰も出ないときは、これまでどおり', () => {
  const noData = topCtx([FAV(4320, '峰 竜太')], { noData: true })._favStripHtml(NOW);
  assert.ok(noData.indexOf('明日') < 0 && noData.indexOf('本日 1 人・1 走') >= 0);
  const none = topCtx([FAV(1234, '出走 なし')])._favStripHtml(NOW);
  assert.ok(none.indexOf('本日の出走はありません') >= 0 && none.indexOf('明日') < 0);
  const nofav = topCtx([])._favStripHtml(NOW);
  assert.ok(nofav.indexOf('お気に入り選手を登録すると') >= 0 && nofav.indexOf('明日') < 0);
  const late = topCtx([FAV(4320, '峰 竜太')])._favStripHtml(jst('2026-11-26T00:10:00'));
  assert.ok(late.indexOf('明日') < 0, '日付が変わったら出さない');
});
t('8 走まで。超えた分は「明日 ほか N 走」', () => {
  const data = { date: '20261126', pending: [], stadiums: { 8: { label: '', races: [] } } };
  for (let r = 1; r <= 11; r++) data.stadiums[8].races.push({ r, t: (r < 10 ? '0' : '') + r + ':00', b: [[1, 4320, '峰 竜太', 1]] });
  const html = topCtx([FAV(4320, '峰 竜太')], { data })._favStripHtml(NOW);
  assert.strictEqual(rowsOf(html, 'fav-tm').length, 8);
  assert.ok(html.indexOf('明日 ほか 3 走を見る') >= 0);
  assert.ok(html.indexOf('明日 11/26（木） 1 人・11 走') >= 0);
});
t('名前は escape する。データに名前が無ければ、登録した時の名前で出す', () => {
  const data = { date: '20261126', pending: [], stadiums: { 8: { label: '', races: [{ r: 1, t: '10:00', b: [[1, 4320, '<img src=x onerror=1>', 1], [2, 3618, '', 1]] }] } } };
  const html = topCtx([FAV(4320, '峰 竜太'), FAV(3618, '海野 ゆかり')], { data })._favStripHtml(NOW);
  assert.ok(html.indexOf('<img') < 0 && html.indexOf('&lt;img') >= 0);
  assert.ok(rowsOf(html, 'fav-tm')[1].indexOf('海野 ゆかり') >= 0);
});
t('TOP の描画で、お気に入りがある時だけ取りに行く。届いたら描き直す', () => {
  const calls = [];
  const ctx = topCtx([FAV(4320, '峰 竜太')]);
  ctx._loadTomorrow = (cb, now) => (calls.push({ cb, now }), true);
  const el = { innerHTML: '' };
  ctx.document.getElementById = (id) => (id === 'favStrip' ? el : null);
  ctx._renderFavTop(NOW);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].now, NOW);
  el.innerHTML = '';
  calls[0].cb();
  assert.ok(el.innerHTML.indexOf('お気に入り選手の出走') >= 0, '届いたら描き直す');
  const none = topCtx([]);
  let n = 0;
  none._loadTomorrow = () => (n++, true);
  none.document.getElementById = () => ({ innerHTML: '' });
  none._renderFavTop(NOW);
  assert.strictEqual(n, 0, 'お気に入りが無ければ取りに行かない');
});

section('[選手詳細]');
function detailCtx(opt) {
  const ctx = topCtx([], opt);
  ctx._racerProfiles = { 4320: { name: '峰　　　　竜　太', kana: 'ﾐﾈ ﾘｭｳﾀ', branch: '佐賀', classNum: 1, courseStats: {}, recentResults: [1, 2] } };
  ctx._racerStatsView = { racers: {}, window: { racer_months: 12 } };
  ctx._racerExt = { racers: {}, term: null };
  ctx._loadRacerOfficial = () => false;
  ctx._racerOfficialOf = () => null;
  ctx._loadRacerLog = () => false;
  ctx._racerLogOf = () => null;
  return ctx;
}
t('「明日の出走」: 日付・場・何日目と、締切・R・枠', () => {
  const html = detailCtx()._racerDetailHtml('4320', null, NOW);
  const i = html.indexOf('明日の出走');
  assert.ok(i >= 0);
  const card = html.slice(i, html.indexOf('</div></div>', html.indexOf('racer-note', i)));
  assert.ok(card.indexOf('11/26（木） 常滑 3日目') >= 0, card.slice(0, 200));
  assert.deepStrictEqual(rowsOf(card, 'tm-row'), ['|12:43|6R|5| 5号艇|', '|14:55|10R|3| 3号艇|', '|15:20|1R|1| 1号艇|']);
  assert.ok(i > html.indexOf('本日の出走') && i < html.indexOf('直近 2 走の着順'), '本日の出走の次');
});
t('出走が無い・データが無い選手には出さない', () => {
  assert.ok(detailCtx()._racerDetailHtml('1234', null, NOW).indexOf('明日の出走') < 0);
  assert.ok(detailCtx({ noData: true })._racerDetailHtml('4320', null, NOW).indexOf('明日の出走') < 0);
  assert.ok(detailCtx()._racerDetailHtml('4320', null, jst('2026-11-26T09:00:00')).indexOf('明日の出走') < 0);
});
t('開いたら取りに行き、届いたら描き直す。取得のしくみが無くても落ちない', () => {
  const ctx = detailCtx();
  const calls = [];
  ctx._loadTomorrow = (cb, now) => (calls.push({ cb, now }), true);
  let redraw = 0;
  ctx._racerRerender = () => redraw++;
  ctx._racerDetailHtml('4320', null, NOW);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].now, NOW);
  calls[0].cb();
  assert.strictEqual(redraw, 1);
  const old = detailCtx();
  old._tomorrowEntriesOf = undefined;
  assert.ok(old._racerDetailHtml('4320', null, NOW).indexOf('明日の出走') < 0);
});

section('[お気に入り一覧]');
t('1 行に「明日 常滑 6R」。公式の次節があれば続けて出す', () => {
  const ctx = detailCtx();
  assert.strictEqual(ctx._racerTomorrowLine('3618', NOW), '明日 常滑 1R');
  assert.strictEqual(ctx._racerTomorrowLine('4320', NOW), '明日 常滑 6R・10R、若松 1R', '場ごとにまとめる');
  assert.strictEqual(ctx._racerTomorrowLine('1234', NOW), '');
  assert.strictEqual(ctx._racerNextLine('3618', NOW), '明日 常滑 1R');
  ctx._racerOfficialOf = () => ({ data: { found: true, schedule: [{ from: '2026-12-06', to: '2026-12-11', stadium: '蒲郡', grade: 'G1', title: 'x' }] } });
  assert.strictEqual(ctx._racerNextLine('3618', NOW), '明日 常滑 1R / 次節 12/6〜12/11 蒲郡 G1');
  assert.strictEqual(ctx._racerNextLine('1234', NOW), '次節 12/6〜12/11 蒲郡 G1');
  assert.strictEqual(detailCtx({ noData: true })._racerNextLine('3618', NOW), '');
});

section('[配線]');
t('取得は rest bundle（TOP が使う）。起動時の bundle には入らない', () => {
  const rest = read('assets/app-rest.js');
  const critical = read('assets/app-critical.js');
  for (const name of ['function _loadTomorrow', 'function _tomorrowEntriesOf', 'function _favEntriesTomorrow']) {
    assert.ok(rest.indexOf(name) >= 0, name + ' が rest に無い');
    assert.ok(critical.indexOf(name) < 0, name + ' が critical に入っている');
  }
  assert.ok(read('assets/app-rest-racer.js').indexOf('function _racerTomorrowCard') >= 0);
});
t('reporting 層から直接 fetch しない（取得は discovery 層）', () => {
  for (const f of ['src/reporting/racer_fav.js', 'src/reporting/racer_detail.js', 'src/reporting/racer_page.js']) {
    assert.ok(!/\bfetch\(/.test(read(f)), f);
  }
  assert.ok(/fetch\('data\/schedule\/tomorrow\.json'/.test(read('src/discovery/tomorrow_loader.js')));
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

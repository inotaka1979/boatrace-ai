/**
 * お気に入り選手（2026-11-25、src/reporting/racer_fav.js）
 *
 *   - 保存: 登録 / 解除、選手番号で一意、壊れた値の除去、上限
 *   - 本日の出走の索引と 1 走の状態（締切前 / 結果待ち / 確定 / 中止）
 *   - TOP の帯: 場一覧の「下」に出す、並び順、未登録・出走なしの案内、行数の上限、AI の印は描画ごとに計算
 *   - ★: 場カード / レース一覧 / まもなく締切 / 出走表
 *   - 選手ページへの入口: openRacer → showPage('racer') → chunk 読込 → _renderRacerPage
 *   - レース単位の印の呼び名は「注目レース」（選手の ★ と区別）
 *
 *   node scripts/tests/test_racer_fav.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0,
  fail = 0;
// 非同期のテストがあるので、登録しておいて最後に順に実行する
const queue = [];
function t(name, fn) {
  queue.push({ name, fn });
}
function section(title) {
  queue.push({ title });
}

// vm の中で作られた配列・オブジェクトは prototype が別物なので、JSON を通してから比べる
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = Date.parse('2026-11-25T14:45:00+09:00');
const boat = (n, id, name, cls) => ({ racer_boat_number: n, racer_number: id, racer_name: name, racer_class_number: cls || 1 });
function race(hhmm, boats) {
  return { race_closed_at: '2026-11-25 ' + hhmm + ':00', race_title: 'テスト杯', race_grade_number: 5, boats };
}
// 常滑(8): 3R 11:21 / 6R 12:45 / 10R 14:55 / 12R 16:10、びわこ(11): 9R 14:42
function program() {
  return {
    8: {
      3: race('11:21', [boat(1, 4238, '毒島 誠'), boat(5, 4500, '山田 康二'), null, { racer_boat_number: 2 }]),
      6: race('12:45', [boat(3, 3897, '白井 英治'), boat(6, 4320, '峰 竜太')]),
      10: race('14:55', [boat(1, 4500, '山田 康二'), boat(4, 4320, '峰 竜太')]),
      12: race('16:10', [boat(1, 3941, '池田 浩二'), boat(5, 3897, '白井 英治')]),
    },
    11: { 9: race('14:42', [boat(3, 2538, '高橋 二朗', 3)]) },
  };
}
function results() {
  const fin = (rows) => ({ isFinished: true, results: rows.map(([b, p]) => ({ racer_boat_number: b, place: p })) });
  return {
    8: {
      3: fin([
        [1, 1],
        [5, 2],
      ]),
      6: fin([[3, 2]]), // 6 号艇（峰）は着順なし
    },
  };
}
function fakeEl(attrs) {
  const cls = new Set();
  const a = Object.assign({}, attrs);
  return {
    innerHTML: '',
    textContent: '',
    hidden: false,
    children: [],
    classList: {
      toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)),
      add: (c) => cls.add(c),
      contains: (c) => cls.has(c),
    },
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => {
      a[k] = v;
    },
    has: (c) => cls.has(c),
  };
}
function ctxWith(favs) {
  const ctx = makeCtx();
  ctx.programData = program();
  ctx.resultData = results();
  ctx.predictRace = () => null;
  if (favs) ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify(favs));
  return ctx;
}
const FAVS = [
  { id: '4320', name: '峰 竜太', ts: 5 },
  { id: '3941', name: '池田 浩二', ts: 4 },
  { id: '4238', name: '毒島 誠', ts: 3 },
  { id: '2538', name: '高橋 二朗', ts: 2 },
];

section('[保存]');
t('登録 → 解除。選手番号で一意、名前は「姓 名」に整える', () => {
  const ctx = makeCtx();
  assert.strictEqual(ctx._toggleFavRacer(4320, '峰　　　　竜　太'), true);
  assert.strictEqual(ctx._toggleFavRacer('3941', '池田 浩二'), true);
  assert.deepStrictEqual(J(ctx._favRacers().map((f) => [f.id, f.name])), [
    ['4320', '峰 竜太'],
    ['3941', '池田 浩二'],
  ]);
  assert.strictEqual(ctx._isFavRacer(4320), true);
  assert.strictEqual(ctx._isFavRacer('9999'), false);
  assert.strictEqual(ctx._toggleFavRacer('4320', '峰 竜太'), false); // 解除
  assert.deepStrictEqual(J(Object.keys(ctx._favIdSet())), ['3941']);
  assert.strictEqual(JSON.parse(ctx.localStorage.getItem('boatrace_fav_racers')).length, 1);
});
t('壊れた保存値は捨てる（配列でない / 番号が不正 / 重複）', () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify({ id: '4320' }));
  assert.strictEqual(ctx._favRacers().length, 0);
  ctx.localStorage.setItem(
    'boatrace_fav_racers',
    JSON.stringify([{ id: '4320', name: 'A' }, null, { id: 'abc' }, { id: 4320, name: 'B' }, { name: 'x' }, { id: '12345678' }, { id: 3941 }])
  );
  assert.deepStrictEqual(J(ctx._favRacers().map((f) => f.id)), ['4320', '3941']);
  assert.strictEqual(ctx._toggleFavRacer('abc', 'x'), false);
  assert.strictEqual(ctx._toggleFavRacer('', 'x'), false);
});
t('上限 100 人: 101 人目は登録せず、知らせる', () => {
  const ctx = makeCtx();
  let alerts = 0;
  ctx.alert = () => alerts++;
  for (let i = 0; i < 100; i++) assert.strictEqual(ctx._toggleFavRacer(String(1000 + i), 'n' + i), true);
  assert.strictEqual(ctx._toggleFavRacer('2000', '超過'), false);
  assert.strictEqual(ctx._favRacers().length, 100);
  assert.strictEqual(alerts, 1);
  assert.strictEqual(ctx._isFavRacer('2000'), false);
  assert.strictEqual(ctx._toggleFavRacer('1000', 'n0'), false); // 上限でも解除はできる
  assert.strictEqual(ctx._favRacers().length, 99);
});
t('_racerDispName: ファン手帳の 8 文字（全角空白埋め）と出走表の名前', () => {
  const ctx = makeCtx();
  assert.strictEqual(ctx._racerDispName('峰　　　　竜　太'), '峰 竜太');
  assert.strictEqual(ctx._racerDispName('高　橋　　二　朗'), '高橋 二朗');
  assert.strictEqual(ctx._racerDispName('堀之内　　紀代子'), '堀之内 紀代子');
  assert.strictEqual(ctx._racerDispName('平田 健之佑'), '平田 健之佑');
  assert.strictEqual(ctx._racerDispName(null), '');
});

section('[本日の出走]');
t('_racerTodayIndex: 選手番号 → 出走（レース番号順）。欠けた艇は無視', () => {
  const ctx = ctxWith();
  const idx = ctx._racerTodayIndex();
  assert.deepStrictEqual(J(idx['4320'].map((e) => [e.sid, e.rno, e.boat, e.hm])), [
    [8, 6, 6, '12:45'],
    [8, 10, 4, '14:55'],
  ]);
  assert.strictEqual(idx['4320'][1].closedMs, Date.parse('2026-11-25T14:55:00+09:00'));
  assert.strictEqual(Object.keys(idx).length, 6);
  ctx.programData = null;
  assert.strictEqual(Object.keys(ctx._racerTodayIndex()).length, 0);
});
t('_racerEntryStatus: 締切前 / 結果待ち / 確定（着順・着順なし）/ 中止', () => {
  const ctx = ctxWith();
  const idx = ctx._racerTodayIndex();
  const st = (id, i) => J(ctx._racerEntryStatus(idx[id][i], NOW));
  assert.deepStrictEqual(st('4320', 1), { kind: 'open', mins: 10, text: 'あと 10 分' });
  assert.deepStrictEqual(st('3941', 0), { kind: 'open', mins: 85, text: '' }); // 60 分より先は時刻だけ
  assert.deepStrictEqual(st('2538', 0), { kind: 'wait', text: '結果待ち' }); // 14:42 締切・結果なし
  assert.deepStrictEqual(st('4238', 0), { kind: 'done', place: 1, text: '1着' });
  assert.deepStrictEqual(st('4320', 0), { kind: 'done', place: null, text: '着順なし' });
  ctx.resultData[8][10] = { isCancelled: true };
  assert.deepStrictEqual(st('4320', 1), { kind: 'cancel', text: '中止' });
  // 場が全日中止・順延（結果ページ未判定のレース）
  delete ctx.resultData[8][10];
  ctx._raceCancelled = (sid, rno) => sid === 8 && rno === 12;
  assert.deepStrictEqual(st('3941', 0), { kind: 'cancel', text: '中止' });
  assert.strictEqual(st('4320', 1).kind, 'open');
});
t('_favInRace: お気に入り選手が出るレースだけ true', () => {
  const ctx = ctxWith([{ id: '4320', name: '峰 竜太', ts: 1 }]);
  assert.strictEqual(ctx._favInRace(8, 10), true);
  assert.strictEqual(ctx._favInRace(8, 12), false);
  assert.strictEqual(ctx._favInRace(99, 1), false);
});

section('[TOP: お気に入り選手の出走]');
t('並び: 締切前（近い順）→ 結果待ち → 確定（新しい順）', () => {
  const ctx = ctxWith(FAVS);
  const r = ctx._favEntriesToday(NOW);
  assert.strictEqual(r.racers, 4);
  assert.deepStrictEqual(J(r.rows.map((x) => x.e.id + '@' + x.e.rno + ':' + x.st.kind)), [
    '4320@10:open',
    '3941@12:open',
    '2538@9:wait',
    '4320@6:done',
    '4238@3:done',
  ]);
});
t('帯の HTML: 件数・レース詳細へのリンク・着順・あと N 分・選手一覧への入口', () => {
  const ctx = ctxWith(FAVS);
  ctx.predictRace = (sid, rno) =>
    rno === 10 ? { marks: [{ boat: 1, mark: '◎', prob: 0.61 }, { boat: 4, mark: '○', prob: 0.214 }] } : null;
  const html = ctx._favStripHtml(NOW);
  assert.ok(html.includes('お気に入り選手の出走（本日 4 人・5 走）'), html.slice(0, 300));
  assert.ok(html.includes('data-action="showPage" data-arg-page="racer"'));
  const rows = html.split('<div class="fav-row').slice(1);
  assert.strictEqual(rows.length, 5);
  assert.ok(rows[0].includes('data-action="openRace" data-arg-sid="8" data-arg-rn="10"'));
  assert.ok(/峰 竜太<\/span> <span class="fav-note">○ 21%<\/span>/.test(rows[0]), rows[0]);
  assert.ok(/class="fav-st">あと 10 分</.test(rows[0]));
  assert.ok(!rows[0].startsWith(' done'));
  assert.ok(rows[2].startsWith(' done') && rows[2].includes('びわこ') && rows[2].includes('結果待ち'));
  assert.ok(/class="fav-st res-1">1着</.test(rows[4]));
  assert.ok(rows[3].includes('着順なし') && !rows[3].includes('fav-note')); // 確定したレースに AI の印は出さない
});
t('未登録 / 登録はあるが出走なし / 番組表なし', () => {
  const ctx = ctxWith();
  let html = ctx._favStripHtml(NOW);
  assert.ok(html.includes('お気に入り選手を登録すると、本日の出走がここに出ます') && html.includes('選手を探す'));
  assert.ok(!html.includes('fav-row'));
  ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify([{ id: '9999', name: 'X', ts: 1 }]));
  html = ctx._favStripHtml(NOW);
  assert.ok(html.includes('お気に入り選手（1 人）の本日の出走はありません'));
  ctx.programData = null;
  assert.strictEqual(ctx._favStripHtml(NOW), null); // 置き場は書き換えない
});
t('行は 12 まで。残りは「ほか N 走」で選手タブへ。AI の印は 6 行まで', () => {
  const ctx = makeCtx();
  const st = {};
  const favs = [];
  for (let r = 1; r <= 12; r++) {
    const bs = [];
    for (let b = 1; b <= 2; b++) {
      const id = 3000 + r * 10 + b;
      bs.push(boat(b, id, '選手' + id));
      favs.push({ id: String(id), name: '選手' + id, ts: id });
    }
    st[r] = race('15:' + String(r + 10), bs);
  }
  ctx.programData = { 8: st };
  ctx.resultData = {};
  let calls = 0;
  ctx.predictRace = () => {
    calls++;
    return { marks: [{ boat: 1, mark: '◎', prob: 0.5 }, { boat: 2, mark: '○', prob: 0.2 }] };
  };
  ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify(favs));
  const html = ctx._favStripHtml(NOW);
  assert.strictEqual(html.split('data-action="openRace"').length - 1, 12);
  assert.ok(html.includes('ほか 12 走を見る'));
  assert.strictEqual(html.split('class="fav-note">◎').length - 1 + (html.split('class="fav-note">○').length - 1), 6);
  assert.strictEqual(calls, 3, 'predictRace は同じレースを 1 回の描画で計算し直さない'); // 6 行 = 3 レース
});
t('AI の印は描画のたびに計算し直す（選手 DB 到着前の結果を残さない）', () => {
  const ctx = ctxWith([{ id: '4320', name: '峰 竜太', ts: 1 }]);
  let mark = '△';
  ctx.predictRace = () => ({ marks: [{ boat: 4, mark, prob: 0.1 }] });
  assert.ok(ctx._favStripHtml(NOW).includes('△ 10%'));
  mark = '◎';
  assert.ok(ctx._favStripHtml(NOW + 1000).includes('◎ 10%'));
});
t('選手名は escape する', () => {
  const ctx = makeCtx();
  ctx.programData = { 8: { 1: race('15:00', [boat(1, 4320, '<img src=x onerror=alert(1)>')]) } };
  ctx.resultData = {};
  ctx.predictRace = () => null;
  ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify([{ id: '4320', name: 'x', ts: 1 }]));
  const html = ctx._favStripHtml(NOW);
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&lt;img'));
});
t('_renderFavTop: #favStrip に書き、出走のある場カードにだけ ★ (has-fav)', () => {
  const ctx = ctxWith([{ id: '2538', name: '高橋 二朗', ts: 1 }]);
  const strip = fakeEl();
  const cards = [fakeEl({ 'data-sid': '8' }), fakeEl({ 'data-sid': '11' }), fakeEl({})];
  cards[0].classList.add('has-fav'); // 前回の描画の残り
  ctx.document.getElementById = (id) => (id === 'favStrip' ? strip : null);
  ctx.document.querySelectorAll = (sel) => (sel === '#stadiumList .stadium-card' ? cards : []);
  ctx._renderFavTop(NOW);
  assert.ok(strip.innerHTML.includes('びわこ') && strip.innerHTML.includes('本日 1 人・1 走'));
  assert.deepStrictEqual(
    cards.map((c) => c.has('has-fav')),
    [false, true, false]
  );
});

section('[TOP への配置と ★]');
t('index.html: 置き場は場一覧の「下」、下メニューに「選手」、選手ページの入れ物', () => {
  const html = read('index.html');
  const iList = html.indexOf('id="stadiumList"');
  const iFav = html.indexOf('id="favStrip"');
  const iFoot = html.indexOf('class="footer-note"');
  assert.ok(iList > 0 && iFav > iList && iFav < iFoot, 'favStrip は stadiumList の後・TOP のフッタの前');
  assert.ok(html.indexOf('id="soonStrip"') < iList, 'まもなく締切は場一覧の上のまま');
  assert.ok(/<button class="nav-btn" data-action="showPage" data-arg-page="racer" id="navRacer">/.test(html));
  assert.ok(/<div class="page" id="pageRacer">\s*<div id="racerView">/.test(html));
  assert.strictEqual((html.match(/class="nav-btn/g) || []).length, 7);
});
t('renderStadiums の最後で _renderFavTop を呼ぶ（場カードを描いた後）', () => {
  const ctx = ctxWith(FAVS);
  const order = [];
  const list = { style: {}, set innerHTML(v) { order.push('grid'); } };
  ctx.document.getElementById = (id) => (id === 'stadiumList' ? list : { style: {}, innerHTML: '' });
  ctx._renderFavTop = () => order.push('fav');
  ctx.renderStadiums();
  assert.deepStrictEqual(order, ['grid', 'fav']);
});
t('まもなく締切: お気に入り選手の出るレースに ★', () => {
  const ctx = ctxWith([{ id: '4320', name: '峰 竜太', ts: 1 }]);
  const el = { innerHTML: '', style: {} };
  ctx.document.getElementById = (id) => (id === 'soonStrip' ? el : null);
  ctx._renderSoonStrip(NOW);
  assert.ok(/常滑 10R <span class="fav-mark"[^>]*>★<\/span>/.test(el.innerHTML), el.innerHTML);
  assert.ok(/常滑 12R<\/span>/.test(el.innerHTML), '出ないレースには付けない');
});
t('_markFavRaceList: レース一覧の選手セルに fav-racer（位置 = 艇番、結果行は対象外）', () => {
  const ctx = ctxWith([{ id: '4320', name: '峰 竜太', ts: 1 }]);
  const mkRow = (rn, withCells) => {
    const row = fakeEl({ 'data-arg-rn': String(rn) });
    row.children = [fakeEl()];
    for (let b = 1; b <= 6; b++) {
      const td = fakeEl();
      if (withCells) td.classList.add('racer-cell');
      row.children.push(td);
    }
    return row;
  };
  const rows = [mkRow(6, true), mkRow(6, false), mkRow(10, true)];
  rows[2].children[1].classList.add('fav-racer'); // 解除済みの古い印
  const list = { querySelectorAll: (sel) => (sel === 'tr[data-arg-rn]' ? rows : []) };
  ctx.document.getElementById = (id) => (id === 'racesList' ? list : null);
  ctx._markFavRaceList('8');
  assert.strictEqual(rows[0].children[6].has('fav-racer'), true); // 6R 6 号艇
  assert.strictEqual(rows[0].children[3].has('fav-racer'), false);
  assert.strictEqual(rows[1].children[6].has('fav-racer'), false); // 結果行
  assert.strictEqual(rows[2].children[4].has('fav-racer'), true); // 10R 4 号艇
  assert.strictEqual(rows[2].children[1].has('fav-racer'), false);
  assert.ok(/markFav\(sid\)/.test(read('src/reporting/stadium_results.js')), '_applyRacesView から呼ぶ');
});
t('登録を変えると、表示中のボタン・印・帯に反映する', () => {
  const ctx = ctxWith();
  const btnFull = fakeEl({ 'data-fav-style': 'full' });
  const btnS = fakeEl({});
  const mark = fakeEl({});
  mark.hidden = true;
  const strip = fakeEl();
  let hook = null;
  ctx.document.getElementById = (id) => (id === 'favStrip' ? strip : null);
  ctx.document.querySelectorAll = (sel) =>
    sel === '[data-fav-id="4320"]' ? [btnFull, btnS] : sel === '[data-fav-mark="4320"]' ? [mark] : [];
  ctx._onFavRacerChanged = (id, on) => (hook = [id, on]);
  ctx._toggleFavRacer('4320', '峰 竜太');
  assert.strictEqual(btnFull.textContent, '★ 登録済み');
  assert.strictEqual(btnS.textContent, '★');
  assert.strictEqual(btnFull.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(mark.hidden, false);
  assert.ok(strip.innerHTML.includes('本日 1 人・2 走'));
  assert.deepStrictEqual(hook, ['4320', true]);
  ctx._toggleFavRacer('4320', '峰 竜太');
  assert.strictEqual(btnFull.textContent, '☆ お気に入りに登録');
  assert.strictEqual(btnS.textContent, '☆');
  assert.strictEqual(mark.hidden, true);
});
t('出走表: 選手のセルから選手ページへ。お気に入り選手に ★', () => {
  const src = read('src/reporting/race_detail_boats.js');
  assert.ok(/data-action="openRacer" data-arg-id="' \+ rid \+ '"/.test(src));
  assert.ok(/data-fav-mark="' \+ rid \+ '"' \+ \(favSet\[String\(rid\)\] \? '' : ' hidden'\)/.test(src));
});

section('[選手ページへの入口]');
function routerCtx() {
  const ctx = makeCtx();
  const els = {};
  ctx.document.getElementById = (id) => els[id] || (els[id] = fakeEl());
  ctx.window.scrollTo = () => {};
  return { ctx, els };
}
t("showPage('racer'): ページと下メニューを切り替え、選手ページの描画を呼ぶ", () => {
  const { ctx, els } = routerCtx();
  let shown = 0;
  ctx._onShowRacerPage = () => shown++;
  ctx.showPage('racer');
  assert.strictEqual(els.pageRacer.has('active'), true);
  assert.strictEqual(els.navRacer.has('active'), true);
  assert.strictEqual(els.navRacer.getAttribute('aria-current'), 'page');
  assert.strictEqual(shown, 1);
});
t('openRacer: chunk 読込済みなら {id, from} を渡してすぐ描く。下メニューからは一覧 (null)', () => {
  const { ctx } = routerCtx();
  const calls = [];
  ctx._renderRacerPage = (next) => calls.push(next ? next.id + '<' + next.from : null);
  ctx.document.querySelector = (sel) => (sel === '.page.active' ? { id: 'pageDetail' } : null);
  ctx.openRacer(4320);
  ctx.openRacer('3941', 'racer');
  ctx.showPage('racer');
  assert.deepStrictEqual(calls, ['4320<detail', '3941<racer', null]);
});
t('chunk が未読込なら読み込んでから描く。失敗したら案内を出す', async () => {
  const { ctx, els } = routerCtx();
  ctx._renderRacerPage = undefined; // harness は app.js を丸ごと読むので、外して「未読込」にする
  let loads = 0;
  ctx._ensureRacerChunk = () => {
    loads++;
    ctx._renderRacerPage = (next) => (els.racerView.innerHTML = 'RENDER:' + (next ? next.id : 'list'));
    return Promise.resolve();
  };
  ctx.openRacer('4320', 'top');
  assert.strictEqual(els.racerView.innerHTML, '<div class="card">読込中...</div>');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(loads, 1);
  assert.strictEqual(els.racerView.innerHTML, 'RENDER:4320');

  const b = routerCtx();
  b.ctx._renderRacerPage = undefined;
  b.ctx._ensureRacerChunk = () => Promise.reject(new Error('offline'));
  b.ctx.showPage('racer');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(b.els.racerView.innerHTML.includes('選手ページの読込に失敗しました'));
});
t('data-action: openRacer / toggleFavRacer を登録している', () => {
  const ctx = makeCtx();
  assert.strictEqual(typeof ctx.ACTION_HANDLERS.openRacer, 'function');
  assert.strictEqual(typeof ctx.ACTION_HANDLERS.toggleFavRacer, 'function');
  ctx.ACTION_HANDLERS.toggleFavRacer({ dataset: { argId: '4320', argName: '峰 竜太' } });
  assert.strictEqual(ctx._isFavRacer('4320'), true);
});
t('画面を復元するとき「選手」も戻す', () => {
  assert.ok(/st\.page === 'backtest' \|\| st\.page === 'racer'\)\{ showPage\(st\.page\); \}/.test(read('assets/app.js')));
});

section('[注目レース（レース単位の印）]');
t('呼び名を「お気に入り」から「注目レース」に（選手の ★ と区別）', () => {
  const ctx = makeCtx();
  assert.strictEqual(ctx.I18N_TABLES.ja['notify.title'], '注目レースの結果が確定');
  assert.ok(read('src/reporting/race_detail.js').includes('aria-label="注目レースに登録・解除"'));
  assert.ok(read('assets/app.js').includes("new Notification('注目レースの結果が確定'"));
  assert.ok(!/お気に入りレース/.test(read('index.html')));
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

/**
 * お気に入り選手の締切前通知（2026-11-26、選手機能 第 3 段階 C。アプリを開いている間）
 *   src/reporting/fav_notify.js
 *   sw.js（端末の通知を押した時）
 *   index.html（設定の「お気に入り選手の締切前通知」）
 *
 *   - 設定: 通知しない / 3 / 5 / 10 / 15 分前（既定 5 分前）。「通知しない」(0) が既定値に化けないこと
 *   - 知らせるのは、お気に入り選手の出る・締切まで 0〜N 分の・未確定のレース。1 レース 1 回（その日のうち）
 *   - 画面の下の通知（押すとレースを開く）と、許可済みなら端末の通知
 *
 *   node scripts/tests/test_fav_notify.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

const MIN = 60000;
const jst = (s) => Date.parse(s + '+09:00');
const NOW = jst('2026-11-25T12:40:00');
function boat(n, id, name) {
  return { racer_boat_number: n, racer_number: id, racer_name: name, racer_class_number: 1 };
}
function race(hhmm, boats) {
  return { race_closed_at: '2026-11-25 ' + hhmm + ':00', race_title: 'テスト杯', race_grade_number: 5, boats };
}
// 12:40 の時点: 常滑 6R は締切まで 5 分、桐生 3R は 8 分、常滑 10R は 135 分
function program() {
  return {
    8: {
      6: race('12:45', [boat(3, 3897, '白井 英治'), boat(6, 4320, '峰 竜太')]),
      10: race('14:55', [boat(4, 4320, '峰 竜太')]),
    },
    1: { 3: race('12:48', [boat(1, 3941, '池田 浩二')]) },
  };
}
const FAVS = [
  { id: '4320', name: '峰 竜太', ts: 3 },
  { id: '3897', name: '白井 英治', ts: 2 },
  { id: '3941', name: '池田 浩二', ts: 1 },
];
function fakeDom(ctx) {
  const nodes = [];
  const body = {
    appendChild: (el) => (nodes.push(el), (el.parentNode = body), el),
    removeChild: (el) => (nodes.splice(nodes.indexOf(el), 1), (el.parentNode = null), el),
  };
  ctx.document.body = body;
  ctx.document.createElement = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, innerHTML: '', className: '', id: '' });
  ctx.document.getElementById = (id) => nodes.find((n) => n.id === id) || null;
  return nodes;
}
function mk(opt) {
  const ctx = makeCtx();
  const o = opt || {};
  ctx.programData = o.program === undefined ? program() : o.program;
  ctx.resultData = o.results || {};
  ctx.predictRace = () => null;
  ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify(o.favs || FAVS));
  if (o.min !== undefined) ctx.settings.favNotifyMin = o.min;
  else delete ctx.settings.favNotifyMin;
  if (o.store) ctx.localStorage.setItem('boatrace_fav_notified', JSON.stringify(o.store));
  const nodes = fakeDom(ctx);
  return { ctx, nodes };
}
const keys = (list) => J(list).map((x) => x.sid + '_' + x.rno);
const text = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

section('[設定]');
t('既定は 5 分前。「通知しない」(0) はそのまま 0（既定値に化けない）', () => {
  const { ctx } = mk();
  assert.strictEqual(ctx._favNotifyMin(), 5);
  for (const [v, want] of [['0', 0], [0, 0], ['3', 3], ['5', 5], ['10', 10], [15, 15], ['15', 15]]) {
    ctx.settings.favNotifyMin = v;
    assert.strictEqual(ctx._favNotifyMin(), want, JSON.stringify(v));
  }
  for (const bad of ['7', 'abc', '', null, undefined, -1, 5.5, '5.5', true, [5], '05x', 100]) {
    ctx.settings.favNotifyMin = bad;
    assert.strictEqual(ctx._favNotifyMin(), 5, JSON.stringify(bad));
  }
});
t('設定画面: 選択肢・保存先・既定値がコードと合っている', () => {
  const html = read('index.html');
  const m = /<select id="setFavNotify"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(m, '設定の選択が無い');
  assert.ok(/data-action="saveSetting" data-arg-key="favNotifyMin"/.test(m[0]));
  const opts = [...m[1].matchAll(/<option value="(\d+)"( selected)?>/g)];
  const { ctx } = mk();
  assert.deepStrictEqual(opts.map((o) => Number(o[1])), [0, 3, 5, 10, 15]);
  for (const o of opts) {
    ctx.settings.favNotifyMin = o[1];
    assert.strictEqual(ctx._favNotifyMin(), Number(o[1]), '選択肢 ' + o[1] + ' を読める');
  }
  assert.deepStrictEqual(opts.filter((o) => o[2]).map((o) => Number(o[1])), [5], '既定で選ばれているのは 5 分前');
  assert.ok(html.indexOf('アプリを閉じている間も受け取るには、下の「閉じている間も通知」を有効にしてください') >= 0, '閉じている間は別の設定が要ることを画面に書く');
});
t('設定の説明文は行の高さを px で指定する（小数の高さで下の行をずらさない）', () => {
  // line-height:1.6 だと 12px × 1.6 = 19.2px で説明文の高さが小数になり、下にある表示言語の選択が 0.25px ずれて
  // VRT (locale-dropdown) が 44px → 45px で落ちた（PR #356）。
  const m = /\.setting-note\{([^}]*)\}/.exec(read('index.html'));
  assert.ok(m, '.setting-note の指定が無い');
  const lh = /line-height:([^;]+)/.exec(m[1]);
  assert.ok(lh && /^\d+px$/.test(lh[1].trim()), 'line-height は整数の px: ' + (lh && lh[1]));
  for (const prop of ['padding', 'border-bottom']) {
    const v = new RegExp(prop + ':([^;]+)').exec(m[1]);
    assert.ok(v && !/\d\.\d|em|%/.test(v[1]), prop + ' も小数にならない単位: ' + (v && v[1]));
  }
});
t('設定画面を開くと、選択が保存値に合う', () => {
  const { ctx } = mk({ min: '10' });
  const sel = { value: '' };
  ctx.document.getElementById = (id) => (id === 'setFavNotify' ? sel : null);
  ctx._syncFavNotifyUi();
  assert.strictEqual(sel.value, '10');
  ctx.settings.favNotifyMin = '0';
  ctx._syncFavNotifyUi();
  assert.strictEqual(sel.value, '0');
  assert.ok(/_syncFavNotifyUi\(\)/.test(read('assets/app.js').split('function loadSettings(){')[1].split('\nfunction ')[0]), 'loadSettings から呼ぶ');
});

section('[いつ知らせるか]');
t('締切まで N 分以内の、お気に入り選手の出るレース。締切の近い順', () => {
  const { ctx } = mk({ min: '10' });
  const due = J(ctx._favNotifyDue(NOW));
  assert.deepStrictEqual(due.map((x) => [x.sid, x.rno, x.mins, x.hm]), [[8, 6, 5, '12:45'], [1, 3, 8, '12:48']]);
  assert.deepStrictEqual(due[0].who, [{ name: '白井 英治', boat: 3 }, { name: '峰 竜太', boat: 6 }], '同じレースのお気に入りは 1 件にまとめる（枠番順）');
});
t('分数の設定どおり（3 分前なら 5 分前のレースはまだ）。境界は「N 分ちょうど」を含む', () => {
  assert.deepStrictEqual(keys(mk({ min: '3' }).ctx._favNotifyDue(NOW)), []);
  assert.deepStrictEqual(keys(mk({ min: '5' }).ctx._favNotifyDue(NOW)), ['8_6']);
  assert.deepStrictEqual(keys(mk({ min: '5' }).ctx._favNotifyDue(NOW - 59000)), ['8_6'], '5 分 59 秒前 = あと 5 分');
  assert.deepStrictEqual(keys(mk({ min: '5' }).ctx._favNotifyDue(NOW - 61000)), [], '6 分 1 秒前はまだ');
  assert.deepStrictEqual(keys(mk({ min: '15' }).ctx._favNotifyDue(NOW)), ['8_6', '1_3']);
  assert.deepStrictEqual(keys(mk().ctx._favNotifyDue(NOW)), ['8_6'], '未設定は 5 分前');
});
t('「通知しない」なら何も知らせない', () => {
  const { ctx, nodes } = mk({ min: '0' });
  assert.deepStrictEqual(keys(ctx._favNotifyDue(NOW)), []);
  assert.strictEqual(ctx._favNotifyTick(NOW), 0);
  assert.strictEqual(nodes.length, 0);
  // 締切の分（あと 0 分）になっても出さない
  const at = jst('2026-11-25T12:45:00');
  assert.deepStrictEqual(keys(mk({ min: '5' }).ctx._favNotifyDue(at)), ['8_6', '1_3'], '通知ありなら、あと 0 分のレースも対象');
  assert.deepStrictEqual(keys(ctx._favNotifyDue(at)), []);
  assert.strictEqual(ctx._favNotifyTick(at), 0);
  assert.strictEqual(nodes.length, 0);
});
t('締切を過ぎた・確定した・中止のレース、お気に入りのいないレースは知らせない', () => {
  assert.deepStrictEqual(keys(mk({ min: '15' }).ctx._favNotifyDue(jst('2026-11-25T12:46:00'))), ['1_3'], '常滑 6R は締切後');
  const fin = mk({ min: '15', results: { 8: { 6: { isFinished: true, results: [] } } } });
  assert.deepStrictEqual(keys(fin.ctx._favNotifyDue(NOW)), ['1_3']);
  const can = mk({ min: '15', results: { 8: { 6: { isCancelled: true } } } });
  assert.deepStrictEqual(keys(can.ctx._favNotifyDue(NOW)), ['1_3']);
  assert.deepStrictEqual(keys(mk({ min: '15', favs: [{ id: '9999', name: 'いない', ts: 1 }] }).ctx._favNotifyDue(NOW)), []);
  assert.deepStrictEqual(keys(mk({ min: '15', favs: [] }).ctx._favNotifyDue(NOW)), []);
});
t('知らせるのは「締切前」で残り 0 分以上のレースだけ（状態の形が変わっても、締切後・確定・中止は出さない）', () => {
  const { ctx } = mk({ min: '15' });
  const row = (rno, st) => ({ e: { sid: 8, rno, boat: 1, name: '峰 竜太', hm: '12:45', closedMs: NOW + rno * MIN }, st });
  ctx._favEntriesToday = () => ({
    rows: [
      row(1, { kind: 'open', mins: 3 }),
      row(2, { kind: 'wait', mins: -1 }),
      row(3, { kind: 'wait', mins: 2 }),
      row(4, { kind: 'done', mins: 4, place: 1 }),
      row(5, { kind: 'cancel', mins: 5 }),
      row(6, { kind: 'open', mins: -2 }),
      row(7, { kind: 'open', mins: null }),
      row(8, { kind: 'open', mins: 0 }),
      row(9, { kind: 'open', mins: 15 }),
      row(10, { kind: 'open', mins: 16 }),
    ],
  });
  assert.deepStrictEqual(keys(ctx._favNotifyDue(NOW)), ['8_1', '8_8', '8_9']);
});
t('番組表がまだ無くても落ちない', () => {
  for (const p of [null, {}]) {
    const { ctx } = mk({ program: p });
    assert.deepStrictEqual(keys(ctx._favNotifyDue(NOW)), []);
    assert.strictEqual(ctx._favNotifyTick(NOW), 0);
  }
});

section('[1 レース 1 回]');
t('知らせたレースは、その日のうちは重ねて知らせない。新しく範囲に入ったレースだけ知らせる', () => {
  const { ctx } = mk({ min: '5' });
  assert.strictEqual(ctx._favNotifyTick(NOW), 1);
  assert.strictEqual(ctx._favNotifyTick(NOW + 20000), 0, '20 秒後の次の回');
  assert.strictEqual(ctx._favNotifyTick(NOW + 2 * MIN), 0);
  // 12:43 になると桐生 3R（12:48）が 5 分前に入る
  assert.deepStrictEqual(keys(ctx._favNotifyDue(NOW + 3 * MIN)), ['1_3']);
  assert.strictEqual(ctx._favNotifyTick(NOW + 3 * MIN), 1);
  assert.deepStrictEqual(J(JSON.parse(ctx.localStorage.getItem('boatrace_fav_notified'))), { d: '20261125', k: ['8_6', '1_3'] });
});
t('アプリを開き直しても重ねて知らせない（端末に覚える）。日付が変われば数え直す', () => {
  const a = mk({ min: '5', store: { d: '20261125', k: ['8_6'] } });
  assert.strictEqual(a.ctx._favNotifyTick(NOW), 0);
  const b = mk({ min: '5', store: { d: '20261124', k: ['8_6'] } });
  assert.strictEqual(b.ctx._favNotifyTick(NOW), 1, '前日の記録は使わない');
  assert.strictEqual(JSON.parse(b.ctx.localStorage.getItem('boatrace_fav_notified')).d, '20261125');
  for (const broken of ['x', { d: '20261125' }, { d: '20261125', k: 'x' }, { d: '20261125', k: [1, null, {}] }, [1]]) {
    const c = mk({ min: '5', store: broken });
    assert.strictEqual(c.ctx._favNotifyTick(NOW), 1, '壊れた記録でも落ちない: ' + JSON.stringify(broken));
  }
});
t('画面の通知に失敗しても、覚えて（20 秒ごとに出し直さない）、端末の通知は出す', async () => {
  const { ctx } = mk({ min: '5' });
  ctx.document.createElement = () => {
    throw new Error('dom broken');
  };
  const shown = [];
  ctx.Notification = function () {};
  ctx.Notification.permission = 'granted';
  ctx.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: (title) => (shown.push(title), Promise.resolve()) }) };
  assert.strictEqual(ctx._favNotifyTick(NOW), 1, '例外を外に出さない');
  await tick();
  assert.strictEqual(shown.length, 1, '端末の通知は出す');
  assert.strictEqual(ctx._favNotifyDue(NOW).length, 0, '覚えている');
  assert.strictEqual(ctx._favNotifyTick(NOW + 20000), 0);
});

section('[画面が見えていない間]');
t('端末の通知を出せないなら、覚えずに待つ。画面に戻った時に知らせる', () => {
  const { ctx, nodes } = mk({ min: '5' });
  ctx.document.visibilityState = 'hidden';
  assert.strictEqual(ctx._favNotifyTick(NOW), 0);
  assert.strictEqual(nodes.length, 0, '見えない画面には出さない');
  assert.strictEqual(ctx.localStorage.getItem('boatrace_fav_notified'), null, '1 回を使い切らない');
  assert.strictEqual(ctx._favOnVisibility(), 0, '表示が切り替わっても、まだ見えていなければ待つ');
  ctx.document.visibilityState = 'visible';
  assert.deepStrictEqual(keys(ctx._favNotifyDue(NOW + MIN)), ['8_6'], '待たせていた分が残っている');
  assert.strictEqual(ctx._favNotifyTick(NOW + MIN), 1);
  assert.strictEqual(nodes.length, 1);
  assert.strictEqual(ctx._favNotifyTick(NOW + MIN + 20000), 0);
});
t('裏にいる間に締切を過ぎたレースは、戻っても知らせない', () => {
  const { ctx, nodes } = mk({ min: '5' });
  ctx.document.visibilityState = 'hidden';
  assert.strictEqual(ctx._favNotifyTick(NOW), 0);
  ctx.document.visibilityState = 'visible';
  assert.strictEqual(ctx._favNotifyTick(jst('2026-11-25T12:45:30')), 1, '常滑 6R (12:45) は締切後。桐生 3R (12:48) だけ');
  assert.ok(nodes[0].innerHTML.indexOf('桐生 3R') >= 0 && nodes[0].innerHTML.indexOf('常滑 6R') < 0);
});
t('端末の通知を出せるなら、見えていない間も知らせる', async () => {
  const { ctx } = mk({ min: '5' });
  const shown = [];
  ctx.Notification = function () {};
  ctx.Notification.permission = 'granted';
  ctx.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: (title) => (shown.push(title), Promise.resolve()) }) };
  ctx.document.visibilityState = 'hidden';
  assert.strictEqual(ctx._favNotifyTick(NOW), 1);
  await tick();
  assert.deepStrictEqual(shown, ['まもなく締切 常滑 6R（あと 5 分）']);
  assert.strictEqual(ctx._favNotifyTick(NOW + 20000), 0, '覚える');
  for (const p of ['default', 'denied']) {
    const b = mk({ min: '5' });
    b.ctx.Notification = function () {};
    b.ctx.Notification.permission = p;
    b.ctx.document.visibilityState = 'hidden';
    assert.strictEqual(b.ctx._favNotifyTick(NOW), 0, p + ' なら待つ');
  }
});
t('画面に戻ったらすぐ確かめる（visibilitychange）', () => {
  const src = read('src/reporting/fav_notify.js');
  assert.ok(/document\.addEventListener\('visibilitychange', _favOnVisibility\)/.test(src));
  const { ctx, nodes } = mk({ min: '5' });
  ctx.document.visibilityState = 'visible';
  const real = Date.now;
  ctx.Date.now = () => NOW;
  try {
    assert.strictEqual(ctx._favOnVisibility(), 1);
  } finally {
    ctx.Date.now = real;
  }
  assert.strictEqual(nodes.length, 1);
});

section('[画面の通知]');
t('「あと N 分・場と R・枠と名前」。押すとそのレースを開く', () => {
  const { ctx, nodes } = mk({ min: '10' });
  assert.strictEqual(ctx._favNotifyTick(NOW), 2);
  assert.strictEqual(nodes.length, 1);
  const el = nodes[0];
  assert.strictEqual(el.id, 'favToast');
  assert.strictEqual(el.attrs.role, 'status');
  assert.strictEqual(el.attrs['aria-live'], 'polite');
  const rows = (el.innerHTML.match(/<div class="fav-toast-row".*?<\/div>/g) || []).map(text);
  assert.deepStrictEqual(rows, ['|あと 5 分|常滑 6R|3| 白井 英治 |6| 峰 竜太|', '|あと 8 分|桐生 3R|1| 池田 浩二|']);
  assert.ok(el.innerHTML.indexOf('data-action="favToastOpen" data-arg-sid="8" data-arg-rn="6"') >= 0);
  assert.ok(el.innerHTML.indexOf('お気に入り選手 まもなく締切') >= 0);
  assert.ok(el.innerHTML.indexOf('data-action="favToastClose"') >= 0);
});
t('3 レースまで。超えた分は「ほか N レース」', () => {
  const p = { 8: {} };
  for (let r = 1; r <= 5; r++) p[8][r] = race('12:4' + (r + 1), [boat(1, 4320, '峰 竜太')]);
  const { ctx, nodes } = mk({ min: '15', program: p });
  assert.strictEqual(ctx._favNotifyTick(NOW), 5);
  assert.strictEqual((nodes[0].innerHTML.match(/class="fav-toast-row"/g) || []).length, 3);
  assert.ok(nodes[0].innerHTML.indexOf('ほか 2 レース') >= 0);
});
t('名前は escape する', () => {
  const p = { 8: { 6: race('12:45', [boat(1, 4320, '<img src=x onerror=1>')]) } };
  const { ctx, nodes } = mk({ min: '5', program: p });
  ctx._favNotifyTick(NOW);
  assert.ok(nodes[0].innerHTML.indexOf('<img') < 0 && nodes[0].innerHTML.indexOf('&lt;img') >= 0);
});
t('新しい通知は前の通知と入れ替える。閉じると消える', () => {
  const { ctx, nodes } = mk({ min: '5' });
  ctx._favNotifyTick(NOW);
  const first = nodes[0];
  ctx._favNotifyTick(NOW + 3 * MIN);
  assert.strictEqual(nodes.length, 1);
  assert.notStrictEqual(nodes[0], first);
  assert.ok(nodes[0].innerHTML.indexOf('桐生 3R') >= 0);
  ctx.ACTION_HANDLERS.favToastClose();
  assert.strictEqual(nodes.length, 0);
  ctx._hideFavToast();
});
t('行を押すと、通知を閉じてそのレースを開く', () => {
  const { ctx, nodes } = mk({ min: '5' });
  ctx._favNotifyTick(NOW);
  const opened = [];
  ctx.ACTION_HANDLERS.openRace = (el) => opened.push([el.dataset.argSid, el.dataset.argRn]);
  ctx.ACTION_HANDLERS.favToastOpen({ dataset: { argSid: '8', argRn: '6' } });
  assert.deepStrictEqual(opened, [['8', '6']]);
  assert.strictEqual(nodes.length, 0);
});
t('しばらくすると自動で消える（時間は 10 秒以上）', () => {
  const src = read('src/reporting/fav_notify.js');
  const ms = Number(/var FAV_TOAST_MS = (\d+);/.exec(src)[1]);
  assert.ok(ms >= 10000 && ms <= 60000, String(ms));
  assert.ok(/_favToastTimer = setTimeout\(_hideFavToast, FAV_TOAST_MS\)/.test(src));
});

section('[端末の通知]');
const DUE = [{ sid: 8, rno: 6, mins: 5, hm: '12:45', who: [{ name: '峰 竜太', boat: 6 }, { name: '白井 英治', boat: 3 }] }, { sid: 1, rno: 3, mins: 8, hm: '12:48', who: [{ name: '池田 浩二', boat: 1 }] }];
t('許可されていなければ出さない', () => {
  const { ctx } = mk();
  assert.strictEqual(ctx._favSystemNotify(DUE), false, 'Notification が無い');
  for (const p of ['default', 'denied']) {
    let made = 0;
    ctx.Notification = function () {
      made++;
    };
    ctx.Notification.permission = p;
    assert.strictEqual(ctx._favSystemNotify(DUE), false, p);
    assert.strictEqual(made, 0);
  }
});
t('許可済み: service worker 経由で出す（iOS / Android はこの経路でないと出せない）', async () => {
  const { ctx } = mk();
  const shown = [];
  ctx.Notification = function () {
    throw new Error('constructor は使わない');
  };
  ctx.Notification.permission = 'granted';
  ctx.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: (title, opt) => (shown.push({ title, opt }), Promise.resolve()) }) };
  assert.strictEqual(ctx._favSystemNotify(DUE), true);
  await tick();
  assert.strictEqual(shown.length, 1);
  assert.strictEqual(shown[0].title, 'まもなく締切 常滑 6R（あと 5 分）');
  assert.strictEqual(shown[0].opt.body, '6号艇 峰 竜太、3号艇 白井 英治 ほか 1 レース');
  assert.deepStrictEqual(J(shown[0].opt.data), { sid: 8, rno: 6 });
  assert.strictEqual(shown[0].opt.tag, 'boatrace-fav-8-6');
  assert.strictEqual(shown[0].opt.icon, 'icon-192.png');
});
t('service worker が無ければ Notification で出す。失敗しても落ちない', async () => {
  const { ctx } = mk();
  const made = [];
  ctx.Notification = function (title, opt) {
    made.push({ title, opt });
  };
  ctx.Notification.permission = 'granted';
  assert.strictEqual(ctx._favSystemNotify(DUE.slice(0, 1)), true);
  assert.strictEqual(made[0].opt.body, '6号艇 峰 竜太、3号艇 白井 英治');
  ctx.Notification = function () {
    throw new Error('Illegal constructor');
  };
  ctx.Notification.permission = 'granted';
  assert.strictEqual(ctx._favSystemNotify(DUE), false);
  ctx.navigator.serviceWorker = { ready: Promise.reject(new Error('no sw')) };
  assert.strictEqual(ctx._favSystemNotify(DUE), true);
  await tick();
  ctx.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: () => Promise.reject(new Error('denied')) }) };
  ctx._favSystemNotify(DUE);
  await tick();
});
t('知らせる時は、画面の通知と端末の通知の両方を出す', async () => {
  const { ctx, nodes } = mk({ min: '5' });
  const shown = [];
  ctx.Notification = function () {};
  ctx.Notification.permission = 'granted';
  ctx.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: (title) => (shown.push(title), Promise.resolve()) }) };
  assert.strictEqual(ctx._favNotifyTick(NOW), 1);
  await tick();
  assert.strictEqual(nodes.length, 1);
  assert.deepStrictEqual(shown, ['まもなく締切 常滑 6R（あと 5 分）']);
});

section('[端末の通知を押した時]');
function loadSw(clientsList) {
  const handlers = {};
  const calls = { focus: 0, post: [], opened: [] };
  const mkClient = () => ({ focus: () => (calls.focus++, Promise.resolve()), postMessage: (m) => calls.post.push(m) });
  const list = (clientsList || []).map((c) => (c === 'nofocus' ? { postMessage: (m) => calls.post.push(m) } : mkClient()));
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    clients: { matchAll: () => Promise.resolve(list), openWindow: (u) => (calls.opened.push(u), Promise.resolve()), claim: () => Promise.resolve() },
    skipWaiting: () => {},
    location: { origin: 'https://example.test', href: 'https://example.test/sw.js' },
    registration: {},
  };
  const sandbox = { self, caches: { open: () => Promise.resolve({}), keys: () => Promise.resolve([]) }, fetch: () => Promise.reject(new Error('x')), URL, Request: function () {}, Response: function () {}, Headers: function () {}, console, Promise, Set, Map, setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(read('sw.js'), sandbox);
  return { handlers, calls };
}
async function click(sw, data) {
  let closed = 0;
  let waited = null;
  sw.handlers.notificationclick({ notification: { data, close: () => closed++ }, waitUntil: (p) => (waited = p) });
  await waited;
  return closed;
}
t('開いているアプリがあれば前面に出して、そのレースを開くよう知らせる', async () => {
  const sw = loadSw(['a', 'b']);
  assert.strictEqual(await click(sw, { sid: 8, rno: 6 }), 1, '通知は閉じる');
  assert.strictEqual(sw.calls.focus, 1, '最初の 1 つだけ');
  assert.deepStrictEqual(J(sw.calls.post), [{ type: 'OPEN_RACE', sid: 8, rno: 6 }]);
  assert.deepStrictEqual(sw.calls.opened, []);
});
t('開いているアプリが無ければ、そのレースを指定してアプリを開く。レースの指定が無い通知でも落ちない', async () => {
  const sw = loadSw([]);
  await click(sw, { sid: 8, rno: 6 });
  assert.deepStrictEqual(sw.calls.opened, ['./?race=8-6']);
  const sw2 = loadSw(['a']);
  await click(sw2, undefined);
  assert.strictEqual(sw2.calls.focus, 1);
  assert.deepStrictEqual(sw2.calls.post, []);
  const sw3 = loadSw(['nofocus']);
  await click(sw3, { sid: 8, rno: 6 });
  assert.deepStrictEqual(sw3.calls.opened, ['./?race=8-6'], '前面に出せない相手しかいなければ開く');
  // レースの指定がおかしい通知（テスト通知など）は、アプリを開くだけ
  for (const bad of [undefined, {}, { sid: 99, rno: 1 }, { sid: 8, rno: 13 }, { sid: '8&x=1', rno: 6 }, { sid: 1.5, rno: 2 }, { sid: '../', rno: 1 }]) {
    const s4 = loadSw([]);
    await click(s4, bad);
    assert.deepStrictEqual(s4.calls.opened, ['./'], JSON.stringify(bad));
    const s5 = loadSw(['a']);
    await click(s5, bad);
    assert.deepStrictEqual(s5.calls.post, [], JSON.stringify(bad));
  }
});
t('アプリ側: 知らせを受けたらそのレースを開く。おかしな値は無視する', () => {
  const { ctx, nodes } = mk({ min: '5' });
  ctx._favNotifyTick(NOW);
  const opened = [];
  ctx.ACTION_HANDLERS.openRace = (el) => opened.push([el.dataset.argSid, el.dataset.argRn]);
  assert.strictEqual(ctx._favOnSwMessage({ data: { type: 'OPEN_RACE', sid: 8, rno: 6 } }), true);
  assert.deepStrictEqual(opened, [['8', '6']]);
  assert.strictEqual(nodes.length, 0, '画面の通知は閉じる');
  for (const bad of [null, {}, { type: 'NEW_VERSION' }, { type: 'NEW_VERSION', sid: 8, rno: 6 }, { sid: 8, rno: 6 }, { type: 'OPEN_RACE' }, { type: 'OPEN_RACE', sid: 99, rno: 1 }, { type: 'OPEN_RACE', sid: 8, rno: 13 }, { type: 'OPEN_RACE', sid: '8;alert(1)', rno: 1 }, { type: 'OPEN_RACE', sid: 1.5, rno: 1 }]) {
    assert.strictEqual(ctx._favOnSwMessage({ data: bad }), false, JSON.stringify(bad));
  }
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(ctx._favOnSwMessage(undefined), false);
});

section('[配線]');
t('rest bundle に入り、起動時の bundle には入らない', () => {
  const rest = read('assets/app-rest.js');
  const critical = read('assets/app-critical.js');
  for (const name of ['function _favNotifyTick', 'function _favNotifyDue', 'function _showFavToast']) {
    assert.ok(rest.indexOf(name) >= 0, name + ' が rest に無い');
    assert.ok(critical.indexOf(name) < 0, name + ' が critical に入っている');
  }
});
t('20 秒ごとに確かめる。読込直後にも 1 回', () => {
  const src = read('src/reporting/fav_notify.js');
  assert.ok(/var FAV_NOTIFY_TICK_MS = 20000;/.test(src));
  assert.ok(/setInterval\(function \(\) \{\s*_favNotifyTick\(\);\s*\}, FAV_NOTIFY_TICK_MS\)/.test(src));
  assert.ok(/setTimeout\(function \(\) \{\s*_favNotifyTick\(\);\s*\}, 3000\)/.test(src));
});
t('inline の handler を使わない（CSP）', () => {
  assert.ok(!/\son(click|error|load)=/.test(read('src/reporting/fav_notify.js')));
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

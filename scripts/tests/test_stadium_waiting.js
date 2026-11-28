/**
 * TOP の場カード: 今日開催する場なのに番組表が届いていない時、「次節」と出さない（2026-11-28）
 *
 * 実害: 2026-11-28 の朝、番組表がどの経路からも当日分に切り替わっておらず、開催している 14 場すべてが
 *   「次節 11/29(日)」と表示された。届いていないことが分かる表示（本日開催 / 番組表待ち）にする。
 *
 *   - 今日開催と分かる根拠: 開催日タブ（今日の分）/ 前日までの開催日タブの日程 (tabs) / 次回開催日が今日
 *   - 次回開催日（月間日程が元）は、どの場の番組表も届いていない時だけ使う
 *   - 今日が中止・順延なら、公式の表記で出す（取得待ちとは出さない）
 *   - 番組表のある場・開催の無い場は従来どおり
 *
 *   node scripts/tests/test_stadium_waiting.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

const isoOf = (ymd) => ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
const tab = (date, label) => ({ date, label });

// 場カードを描いて、場番号 → カードの HTML にする
function render(ctx) {
  const el = { innerHTML: '', style: {}, classList: { contains: () => false } };
  ctx.document.getElementById = (id) => (id === 'stadiumList'
    ? el
    : { innerHTML: '', style: {}, textContent: '', classList: { contains: () => false, add() {}, remove() {} } });
  ctx.renderStadiums();
  const cards = el.innerHTML.split('<div class="stadium-card').slice(1).map((c) => '<div class="stadium-card' + c);
  assert.strictEqual(cards.length, 24, '24 場ぶんのカード');
  const by = {};
  cards.forEach((c, i) => { by[i + 1] = c; });
  return by;
}
const text = (card) => card.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const isWaiting = (card) => /data-waiting="1"/.test(card);

function ctxWith({ labels, nextOpen, programs } = {}) {
  const ctx = makeCtx();
  const today = ctx.todayStr();
  const yday = ctx.jstYmd(-1);
  ctx.globalThis._dayLabels = labels
    ? { date: labels.date === 'yday' ? yday : labels.date || today, stadiums: labels.stadiums }
    : undefined;
  ctx._nextOpenMap = nextOpen || {};
  ctx.programData = programs === undefined ? {} : programs;
  ctx.resultData = {};
  return ctx;
}

console.log('[番組表が 1 場も届いていない朝]');
t('開催日タブ（今日の分）に載っている場は「本日開催 / 番組表待ち」、載っていない場は「次節」', () => {
  const ctx = ctxWith({ labels: { stadiums: { 14: { label: '2日目', final: false, cancelled: false }, 8: { label: '初日' } } } });
  const by = render(ctx);
  assert.ok(isWaiting(by[14]) && isWaiting(by[8]));
  assert.strictEqual(text(by[14]), '鳴門 本日開催 番組表待ち');
  assert.strictEqual(text(by[8]), '常滑 本日開催 番組表待ち');
  assert.ok(!/次節/.test(by[14]), '開催している場に「次節」と出さない');
  assert.ok(!isWaiting(by[1]));
  assert.strictEqual(text(by[1]), '桐生 次節');
  assert.strictEqual(Object.keys(by).filter((k) => isWaiting(by[k])).length, 2);
});
t('取得待ちのカードは押せない（開催中のカードの属性を持たない）', () => {
  const ctx = ctxWith({ labels: { stadiums: { 14: { label: '2日目' } } } });
  const card = render(ctx)[14];
  assert.ok(/class="stadium-card inactive-stadium"/.test(card));
  assert.ok(!/data-action=|data-sid=|role="button"/.test(card), card);
});
t('開催日タブが前日までの分でも、その節の日程に今日があれば取得待ち。無ければ「次節」', () => {
  const ctx = makeCtx();
  const today = ctx.todayStr();
  const yday = ctx.jstYmd(-1);
  const tmrw = ctx.jstYmd(1);
  const c = ctxWith({
    labels: {
      date: 'yday',
      stadiums: {
        14: { label: '初日', tabs: [tab(yday, '初日'), tab(today, '2日目'), tab(tmrw, '最終日')] },
        3: { label: '最終日', final: true, tabs: [tab(ctx.jstYmd(-2), '初日'), tab(yday, '最終日')] }, // 前日で終わった節
        5: { label: '2日目' }, // 日程 (tabs) が無い古い形
        6: { label: '初日', tabs: 'x' },
      },
    },
  });
  const by = render(c);
  assert.ok(isWaiting(by[14]));
  assert.ok(!isWaiting(by[3]), '前日が最終日の場は今日は開催しない');
  assert.ok(!isWaiting(by[5]) && !isWaiting(by[6]));
});
t('開催日タブが無くても、次回開催日が今日の場は取得待ち（どの場の番組表も届いていない時）', () => {
  const base = makeCtx();
  const todayIso = isoOf(base.todayStr());
  const tmrwIso = isoOf(base.jstYmd(1));
  const ydayIso = isoOf(base.jstYmd(-1));
  const ctx = ctxWith({ nextOpen: { 14: todayIso, 8: todayIso, 1: tmrwIso, 2: ydayIso } });
  const by = render(ctx);
  assert.ok(isWaiting(by[14]) && isWaiting(by[8]));
  assert.ok(!isWaiting(by[1]), '明日からの場は「次節」');
  assert.ok(/次節/.test(by[1]) && /stadium-next-date/.test(by[1]), '次回開催日は従来どおり出る');
  assert.ok(!isWaiting(by[2]) && !isWaiting(by[3]));
});
t('番組表が null（取得そのものに失敗）でも同じ', () => {
  const base = makeCtx();
  const ctx = ctxWith({ nextOpen: { 14: isoOf(base.todayStr()) }, programs: null });
  assert.ok(isWaiting(render(ctx)[14]));
});

console.log('[一部の場だけ届いている時]');
t('番組表のある場は従来どおり開催中のカード。開催日タブに載っている残りの場は取得待ち', () => {
  const ctx = ctxWith({
    labels: { stadiums: { 14: { label: '2日目' }, 24: { label: '初日' } } },
    programs: { 14: { 1: { race_closed_at: '2999-01-01 10:00:00' } } },
  });
  const by = render(ctx);
  assert.ok(/active-stadium/.test(by[14]) && /data-action="openStadium"/.test(by[14]));
  assert.ok(!isWaiting(by[14]));
  assert.ok(isWaiting(by[24]), '大村（夜の開催。前の晩にまだ取れていなかった場）');
});
t('次回開催日（月間日程）だけが根拠の時は、取得待ちと出さない（日程が古い場を「本日開催」と出さない）', () => {
  const base = makeCtx();
  const ctx = ctxWith({
    nextOpen: { 24: isoOf(base.todayStr()) },
    programs: { 14: { 1: { race_closed_at: '2999-01-01 10:00:00' } } },
  });
  const by = render(ctx);
  assert.ok(!isWaiting(by[24]));
  assert.strictEqual(text(by[24]), '大村 次節');
});

console.log('[中止・順延]');
t('今日が中止・順延の場は、公式の表記で出す（取得待ちとは出さない）', () => {
  const base = makeCtx();
  const ctx = ctxWith({
    labels: {
      date: 'yday',
      stadiums: {
        2: { label: '2日目', tabs: [tab(base.todayStr(), '順延')] },
      },
    },
  });
  ctx.globalThis._dayLabels.stadiums[9] = { label: '初日', tabs: [tab(base.todayStr(), '中止')] };
  const by = render(ctx);
  assert.strictEqual(text(by[2]), '戸田 本日 順延');
  assert.strictEqual(text(by[9]), '津 本日 中止');
  assert.ok(!/番組表待ち/.test(by[2] + by[9]));
  const c2 = ctxWith({ labels: { stadiums: { 9: { label: '中止', cancelled: true } } } });
  assert.strictEqual(text(render(c2)[9]), '津 本日 中止');
});
t('開催日タブの表記はそのまま HTML に入れない', () => {
  const ctx = ctxWith({ labels: { stadiums: { 9: { label: '中止<img src=x onerror=alert(1)>' } } } });
  const card = render(ctx)[9];
  assert.ok(!/<img/.test(card), card);
  assert.ok(/&lt;img/.test(card));
});

console.log('[壊れたデータ・読込の順番]');
t('rest の読込前（_stadiumWaitingCard が無い）は従来どおり「次節」で、例外にならない', () => {
  const ctx = ctxWith({ labels: { stadiums: { 14: { label: '2日目' } } } });
  ctx._stadiumWaitingCard = undefined;
  const by = render(ctx);
  assert.strictEqual(text(by[14]), '鳴門 次節');
});
t('開催日タブ・次回開催日が壊れていても例外にならない', () => {
  for (const labels of [null, 'x', { stadiums: null }, { stadiums: { 14: null } }, { stadiums: { 14: 'x' } },
    { stadiums: { 14: { tabs: [null, 'x', {}, { date: 20261128 }] } } }]) {
    const ctx = ctxWith({});
    ctx.globalThis._dayLabels = labels;
    ctx._nextOpenMap = null;
    const by = render(ctx);
    assert.ok(!isWaiting(by[14]), JSON.stringify(labels));
  }
});
t('今日の日付が分からない時は出さない', () => {
  const ctx = ctxWith({ labels: { stadiums: { 14: { label: '2日目' } } } });
  ctx.globalThis._dayLabels.date = '';
  ctx.todayStr = () => '';
  assert.strictEqual(ctx._stadiumWaitingCard(14, '鳴門'), '');
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

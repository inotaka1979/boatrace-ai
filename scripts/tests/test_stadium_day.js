/**
 * TOP の場カード「何日目 / 最終日 / 中止」（2026-11-20）
 *
 *   - 優先: 公式の開催日タブ (day_labels.json, 今日の分) > 今日の racedata の day_label > 前日の series.json
 *   - 前日の series.json: 前日が最終日なら出さない、中止なら日目は進まない
 *   - 最終日は day-final、中止（開催日タブ・全レース中止）は day-cancel、一部中止は「NR以降中止」
 *   - 場カードに反映され、全レース中止なら次レース欄も「中止」
 *
 *   node scripts/tests/test_stadium_day.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

const RNS = ['1', '2', '3'];

function ctxWith({ labels, series, results } = {}) {
  const ctx = makeCtx();
  const today = ctx.todayStr();
  const yday = ctx.jstYmd(-1);
  ctx.globalThis._dayLabels = labels ? { date: labels.date === 'yday' ? yday : today, stadiums: labels.stadiums } : undefined;
  ctx.globalThis._seriesData = series ? Object.assign({}, series, { date: series.date === 'today' ? today : yday }) : undefined;
  ctx.resultData = results || {};
  return ctx;
}

console.log('[日目]');
t('開催日タブが最優先（racedata のラベルより）', () => {
  const ctx = ctxWith({ labels: { stadiums: { 9: { label: '初日', final: false, cancelled: false } } } });
  const d = ctx._stadiumDayInfo('9', '2日目', RNS);
  assert.strictEqual(d.text, '初日');
  assert.strictEqual(d.cls, '');
});
t('前日の開催日タブは使わない → racedata のラベル', () => {
  const ctx = ctxWith({ labels: { date: 'yday', stadiums: { 9: { label: '初日' } } } });
  assert.strictEqual(ctx._stadiumDayInfo('9', '3日目', RNS).text, '3日目');
});
t('タブも racedata も無ければ前日の series.json + 1 日', () => {
  const ctx = ctxWith({ series: { stadiums: { 1: { day: 3, final: false, held: true } } } });
  assert.strictEqual(ctx._stadiumDayInfo('1', '', RNS).text, '4日目');
});
t('前日が中止なら同じ日目、前日が最終日なら出さない', () => {
  const a = ctxWith({ series: { stadiums: { 9: { day: 1, final: false, held: false } } } });
  assert.strictEqual(a._stadiumDayInfo('9', '', RNS).text, '初日');
  const b = ctxWith({ series: { stadiums: { 11: { day: 5, final: true, held: true } } } });
  assert.strictEqual(b._stadiumDayInfo('11', '', RNS).text, '');
});
t('最終日は day-final', () => {
  const ctx = ctxWith({ labels: { stadiums: { 15: { label: '最終日', final: true, cancelled: false } } } });
  const d = ctx._stadiumDayInfo('15', '', RNS);
  assert.strictEqual(d.text, '最終日');
  assert.strictEqual(d.cls, 'day-final');
});

console.log('[中止]');
t('開催日タブが中止 → 中止 (day-cancel)', () => {
  const ctx = ctxWith({ labels: { stadiums: { 9: { label: '中止', final: false, cancelled: true } } } });
  const d = ctx._stadiumDayInfo('9', '', RNS);
  assert.strictEqual(d.text, '中止');
  assert.strictEqual(d.cls, 'day-cancel');
  assert.strictEqual(d.cancelled, true);
});
t('全レースが「レース中止」 → 中止', () => {
  const ctx = ctxWith({ results: { 9: { 1: { isCancelled: true }, 2: { isCancelled: true }, 3: { isCancelled: true } } } });
  assert.strictEqual(ctx._stadiumDayInfo('9', '2日目', RNS).text, '中止');
});
t('途中から中止 → 「NR以降中止」（最終日でも中止を優先）', () => {
  const ctx = ctxWith({
    labels: { stadiums: { 15: { label: '最終日', final: true, cancelled: false } } },
    results: { 15: { 1: { isFinished: true }, 2: { isCancelled: true }, 3: { isCancelled: true } } },
  });
  const d = ctx._stadiumDayInfo('15', '', RNS);
  assert.strictEqual(d.text, '2R以降中止');
  assert.strictEqual(d.cls, 'day-cancel');
  assert.strictEqual(d.cancelled, false);
});

t('1 レースも確定せず 1R から中止 → 全日中止（後半は未判定でも、開催日タブが古くても）', () => {
  const ctx = ctxWith({
    labels: { stadiums: { 9: { label: '初日', final: false, cancelled: false } } },
    results: { 9: { 1: { isCancelled: true }, 2: { isCancelled: true } } },
  });
  const d = ctx._stadiumDayInfo('9', '', RNS);
  assert.strictEqual(d.text, '中止');
  assert.strictEqual(d.cancelled, true);
});
t('1R が確定済みなら途中中止のまま', () => {
  const ctx = ctxWith({ results: { 9: { 1: { isFinished: true }, 2: { isCancelled: true } } } });
  const d = ctx._stadiumDayInfo('9', '', RNS);
  assert.strictEqual(d.text, '2R以降中止');
  assert.strictEqual(d.cancelled, false);
});

t('開催日タブが「順延」なら途中まで確定していても全日扱い・表記は「順延」', () => {
  const ctx = ctxWith({
    labels: { stadiums: { 2: { label: '順延', final: false, cancelled: true } } },
    results: { 2: { 1: { isFinished: true }, 2: { isFinished: true } } },
  });
  const d = ctx._stadiumDayInfo('2', '', RNS);
  assert.strictEqual(d.text, '順延');
  assert.strictEqual(d.cls, 'day-cancel');
  assert.strictEqual(d.cancelled, true);
});
t('_raceCancelled: レース中止 / 全日中止・順延で未確定 → true、確定済み・通常 → false', () => {
  const ctx = ctxWith({
    labels: { stadiums: { 2: { label: '順延', final: false, cancelled: true } } },
    results: { 2: { 1: { isFinished: true } }, 15: { 3: { isCancelled: true } } },
  });
  ctx.programData = { 2: { 1: {}, 2: {}, 3: {} }, 15: { 1: {}, 2: {}, 3: {} } };
  assert.strictEqual(ctx._raceCancelled(2, 1), false, '確定済み');
  assert.strictEqual(ctx._raceCancelled(2, 3), true, '順延の場の未確定');
  assert.strictEqual(ctx._raceCancelled(15, 3), true, 'レース中止');
  assert.strictEqual(ctx._raceCancelled(15, 1), false, '通常');
});
t('まもなく締切の帯に中止・順延のレースを出さない', () => {
  const ctx = ctxWith({ labels: { stadiums: { 2: { label: '順延', final: false, cancelled: true } } } });
  const closed = (min) => { const d = new Date(Date.now() + min * 60000 + 9 * 3600000); return d.toISOString().slice(0, 19).replace('T', ' '); };
  ctx.programData = { 2: { 5: { race_closed_at: closed(3) } }, 17: { 7: { race_closed_at: closed(4) } } };
  const rs = ctx._soonRaces().map((x) => x.sid + '-' + x.rno);
  assert.strictEqual(JSON.stringify(rs), JSON.stringify(['17-7']));
});

console.log('[場カード]');
t('renderStadiums が日目のクラスと中止を出す', () => {
  const ctx = ctxWith({ labels: { stadiums: {
    15: { label: '最終日', final: true, cancelled: false },
    9: { label: '中止', final: false, cancelled: true },
  } } });
  const el = { innerHTML: '', style: {}, classList: { contains: () => false } };
  ctx.document.getElementById = (id) => (id === 'stadiumList' ? el : { innerHTML: '', style: {}, textContent: '', classList: { contains: () => false, add() {}, remove() {} } });
  const closed = '2999-01-01 10:00:00'; // 締切前 = 次レースあり（全日中止なら「発売なし」）
  ctx.programData = { 15: { 1: { race_closed_at: closed } }, 9: { 1: { race_closed_at: closed } } };
  ctx.renderStadiums();
  assert.ok(/stadium-day day-final">最終日</.test(el.innerHTML), el.innerHTML.slice(0, 400));
  assert.ok(/stadium-day day-cancel">中止<\/span><span class="stadium-day">発売なし</.test(el.innerHTML), '中止の場の次レース欄');
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);

// 2026-11-20: TOP の場カードの「何日目 / 最終日 / 中止」（rest bundle）
//   renderStadiums（critical）から typeof guard で呼ぶ。rest 未 load の間は従来どおり今日の racedata の
//   day_label だけが出て、rest の読込時に描き直す。
//
//   日目の出どころ（上から優先）:
//     1. 公式の開催日タブ data/schedule/day_labels.json（scripts/scrape_day_labels.py。中止・順延も公式表記）
//     2. 今日の racedata の day_label（renderStadiums が渡す）
//     3. 前日の series.json（前日が最終日でなければ前日 + 1 日、前日が中止なら同じ日目）
//   レース単位の中止（結果ページが「レース中止」= resultData[sid][rn].isCancelled）は日目より優先して出す。
//
// Public: _stadiumDayInfo(sid, rdDayLabel, races) → { text, cls, cancelled }

'use strict';

function _stadiumDayInfo(sid, rdDay, races) {
  var key = String(sid);
  var today = typeof todayStr === 'function' ? todayStr() : '';
  var text = '';
  var D = globalThis._dayLabels;
  var e = D && D.date === today && D.stadiums ? D.stadiums[key] : null;
  if (e && e.label) text = e.label;
  else if (rdDay) text = rdDay;
  else {
    var S = globalThis._seriesData;
    var s = S && S.stadiums ? S.stadiums[key] : null;
    if (s && s.day && !s.final && typeof jstYmd === 'function' && S.date === jstYmd(-1)) {
      var n = s.held === false ? s.day : s.day + 1;
      text = n === 1 ? '初日' : n + '日目';
    }
  }

  // レース単位の中止
  var res = typeof resultData !== 'undefined' && resultData ? resultData[key] : null;
  var rns = races || [];
  var cancelled = [];
  var finished = 0;
  for (var i = 0; i < rns.length; i++) {
    var r = res && res[rns[i]];
    if (r && r.isCancelled) cancelled.push(parseInt(rns[i], 10));
    else if (r && r.isFinished) finished++;
  }
  var dayCancelled = !!(e && e.cancelled) || (rns.length > 0 && cancelled.length === rns.length);
  if (dayCancelled) text = '中止';
  else if (cancelled.length) text = Math.min.apply(null, cancelled) + 'R以降中止';

  var cls = '';
  if (dayCancelled || cancelled.length) cls = 'day-cancel';
  else if ((e && e.final) || /最終/.test(text)) cls = 'day-final';
  return { text: text, cls: cls, cancelled: dayCancelled, finished: finished };
}

globalThis._stadiumDayInfo = _stadiumDayInfo;
// rest bundle がデータ読込後に届いたとき、場カードを描き直して日目を出す
try {
  if (typeof programData !== 'undefined' && programData && typeof renderStadiums === 'function') renderStadiums();
} catch (_) {}

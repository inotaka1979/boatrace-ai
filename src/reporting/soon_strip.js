// 2026-11-20: TOP「まもなく締切」帯。
//
// 多視点評価（UX）の指摘: TOP は 24 場を場番号順に同じ大きさで並べるだけで、締切直前に「次にどこで
// 何が締切か」を見るには場を 1 つずつ開くしかなかった。全場から締切の近い未確定レースを最大 5 件、
// 「あと N 分」と AI の ◎ 付きで並べ、タップでレース詳細へ直接飛ぶ。
//
// REST_ONLY。renderStadiums (critical) から typeof guard 付きで呼ぶ。分単位の残り時間を進めるため、
// TOP を表示中は 30 秒ごとに描き直す。
//
// Public: _renderSoonStrip / _soonRaces

/* global programData, resultData, predictRace, escText */
'use strict';

var SOON_STRIP_MAX = 5;
var SOON_STRIP_WINDOW_MIN = 120;

// race_closed_at は JST 壁時計 "YYYY-MM-DD HH:MM(:SS)" → UTC ms
function _soonClosedMs(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]) : null;
}

// 締切まで 0〜SOON_STRIP_WINDOW_MIN 分の未確定レースを締切の近い順に返す
function _soonRaces(now) {
  var t = now || Date.now();
  var out = [];
  if (typeof programData === 'undefined' || !programData) return out;
  for (var sid in programData) {
    var st = programData[sid];
    for (var rno in st) {
      var r = st[rno];
      var ms = _soonClosedMs(r && r.race_closed_at);
      if (ms == null) continue;
      var mins = Math.floor((ms - t) / 60000);
      if (mins < 0 || mins > SOON_STRIP_WINDOW_MIN) continue;
      var res = typeof resultData !== 'undefined' && resultData && resultData[sid] && resultData[sid][rno];
      if (res && res.isFinished) continue;
      // 2026-11-20: 中止・順延のレースは出さない（展示も発売も無い）
      var rc = globalThis._raceCancelled;
      if (typeof rc === 'function' && rc(sid, rno)) continue;
      out.push({ sid: parseInt(sid, 10), rno: parseInt(rno, 10), mins: mins, closedMs: ms });
    }
  }
  out.sort(function (a, b) {
    return a.closedMs - b.closedMs || a.sid - b.sid;
  });
  return out.slice(0, SOON_STRIP_MAX);
}

function _soonTopMark(sid, rno) {
  try {
    var p = typeof predictRace === 'function' ? predictRace(sid, rno) : null;
    return p && p.marks && p.marks[0] ? p.marks[0].boat : null;
  } catch (_) {
    return null;
  }
}

function _renderSoonStrip(now) {
  var el = typeof document !== 'undefined' && document.getElementById('soonStrip');
  if (!el) return;
  var list = _soonRaces(now);
  if (!list.length) {
    el.innerHTML = '';
    el.style.minHeight = '';
    return;
  }
  var html =
    '<div class="soon-strip" role="region" aria-label="まもなく締切"><div class="soon-title">⏱ まもなく締切</div>';
  list.forEach(function (r) {
    var name = (typeof STADIUMS !== 'undefined' && STADIUMS[r.sid]) || '場' + r.sid;
    var mark = _soonTopMark(r.sid, r.rno);
    var urgent = r.mins <= 5;
    html +=
      '<div class="soon-row" role="button" tabindex="0" data-action="openRace" data-arg-sid="' +
      r.sid +
      '" data-arg-rn="' +
      r.rno +
      '"><span class="soon-name">' +
      escText(name) +
      ' ' +
      r.rno +
      'R</span><span class="soon-mins' +
      (urgent ? ' soon-urgent' : '') +
      '">あと ' +
      r.mins +
      ' 分</span><span class="soon-mark">' +
      (mark ? '◎' + mark : '') +
      '</span></div>';
  });
  html += '</div>';
  // 補間は STADIUMS 定数 (escText 済) と数値のみ
  el.innerHTML = html;
}

// TOP 表示中は 30 秒ごとに残り時間を進める（ページが非表示なら何もしない）
if (typeof setInterval === 'function' && typeof document !== 'undefined') {
  setInterval(function () {
    try {
      var top = document.getElementById('pageTop');
      if (top && top.classList && top.classList.contains('active') && !document.hidden) _renderSoonStrip();
    } catch (_) {}
  }, 30000);
}

globalThis._renderSoonStrip = _renderSoonStrip;
// rest bundle はデータ読込後に届くことがある（renderStadiums が先に走ると帯が出ないまま）ため、読込時にも 1 回描く。
try {
  if (typeof programData !== 'undefined' && programData) _renderSoonStrip();
} catch (_) {}
globalThis._soonRaces = _soonRaces;

// 2026-11-25: 選手詳細（lazy chunk app-rest-racer）
//
// racer_page.js の _renderRacerPage({id, from}) から呼ばれ、選手 1 人分の HTML を返す。
//   1. プロフィール（写真・名前・かな・級・登録番号・支部・年齢・体重・出身・F/L）と ★ 登録
//   2. 本日の出走（レースを押すとレース詳細へ）と今節成績
//   3. 成績（本日の出走表の全国 / 当地 / モーター、ファン手帳の期別成績）
//   4. コース別成績（ファン手帳の期別: 出走・1着率・2連対・3連対・平均ST・ST順）
//   5. 直近の着順
//   6. 当アプリの集計（直近 12 か月: コース別の着と勝ち決まり手、本番 ST）
//   7. 公式サイトの選手ページへのリンク
// 項目は「取れているものだけ」出す（出走の無い日は 2 と出走表由来の数字が無い、名簿に無い選手は 3〜5 が無い）。
//
// Public: _racerDetailHtml

/* global programData, escText, boatBadge, renderSeriesCell, getRaceDataForRace, _seriesSlotsFor, _stadiumDayInfo,
   _racerInfo, _racerBackLabel, _racerClsChip, _favBtnHtml, _racerEntryStatus, _racerAiMark, _racerAiMarkReset,
   _loadRacerStatsView,
   _racerRerender */
'use strict';

var RACER_OFFICIAL_URL = 'https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=';
var RACER_DAY_LABELS = ['初日', '2日目', '3日目', '4日目', '5日目', '6日目', '7日目'];
var RACER_AGG_MIN = 3; // 当アプリの集計を出す最少出走数
var RACER_RECENT_MAX = 20; // 直近の着順に並べる数

function _rNum(v, digits) {
  var n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n.toFixed(digits) : '-';
}
function _rPct(a, b) {
  return b > 0 ? Math.round((a / b) * 100) + '%' : '-';
}
function _rTile(value, label) {
  return '<div><b>' + value + '</b><span>' + label + '</span></div>';
}

// ─── 1. プロフィール ───────────────────────────────────────
function _racerProfileCard(info) {
  var meta = [];
  if (info.age) meta.push(escText(info.age) + '歳');
  if (info.weight) meta.push(escText(Number(info.weight) % 1 ? Number(info.weight).toFixed(1) : info.weight) + 'kg');
  if (info.birthplace) meta.push(escText(info.birthplace) + '出身');
  var fl = '';
  if (info.prog) {
    var f = info.prog.racer_flying_count || 0;
    var l = info.prog.racer_late_count || 0;
    fl = '<br>' + (f > 0 ? '<span class="c-danger fw-700">F' + f + '</span>' : 'F0') + ' / L' + l + '（今期）';
  }
  var chips =
    _racerClsChip(info.cls) +
    '<span class="chip">登録 ' +
    escText(info.id) +
    '</span>' +
    (info.branch ? '<span class="chip">' + escText(info.branch) + '支部</span>' : '');
  var unknown = !info.p && !info.prog;
  return (
    '<div class="card"><div class="pf"><img class="pf-photo" src="data/photos/' +
    encodeURIComponent(info.id) +
    '.jpg" alt=""><div class="pf-main"><div class="pf-head"><div><div class="pf-name">' +
    escText(info.name) +
    '</div>' +
    (info.kana ? '<div class="pf-kana">' + escText(info.kana) + '</div>' : '') +
    '</div>' +
    _favBtnHtml(info.id, info.name, true) +
    '</div><div class="pf-chips">' +
    chips +
    '</div><div class="pf-meta">' +
    meta.join(' / ') +
    fl +
    '</div></div></div>' +
    (unknown
      ? '<div class="racer-note">この選手の成績はまだ手元にありません（名簿の更新前、または出走予定の無い選手です）。</div>'
      : '') +
    '</div>'
  );
}

// ─── 2. 本日の出走 + 今節成績 ──────────────────────────────────
function _racerSeriesHtml(info) {
  var e = info.today[0];
  if (!e || typeof _seriesSlotsFor !== 'function' || typeof renderSeriesCell !== 'function') return '';
  var rd = typeof getRaceDataForRace === 'function' ? getRaceDataForRace(e.sid, e.rno) : null;
  var slots = _seriesSlotsFor(String(e.sid), rd, e.boat, Number(info.id)) || [];
  var last = 0;
  for (var i = 0; i < slots.length; i++) if (slots[i] != null) last = i + 1;
  if (!last) return '';
  var days = Math.ceil(last / 2);
  var head = '';
  var cells = '';
  for (var d = 0; d < days; d++) {
    head += '<th colspan="2">' + (RACER_DAY_LABELS[d] || d + 1 + '日目') + '</th>';
    cells += renderSeriesCell(slots[d * 2]) + renderSeriesCell(slots[d * 2 + 1]);
  }
  return (
    '<div class="sec-sub">今節成績 <span class="sec-src">上: 着順 / 下: 進入コースと ST、色は枠</span></div>' +
    '<div class="detail-table-wrap"><table class="racer-series"><tr>' +
    head +
    '</tr><tr>' +
    cells +
    '</tr></table></div>'
  );
}

function _racerTodayCard(info, now) {
  if (!info.today.length) {
    return (
      '<div class="card"><div class="sec-title">本日の出走</div>' +
      '<div class="racer-note">本日の出走はありません。</div></div>'
    );
  }
  var e0 = info.today[0];
  var st = typeof programData !== 'undefined' && programData ? programData[e0.sid] : null;
  var race0 = st ? st[e0.rno] : null;
  var sName = (typeof STADIUMS !== 'undefined' && STADIUMS[e0.sid]) || '場' + e0.sid;
  var grade = race0 && typeof GRADE_CLASS !== 'undefined' ? GRADE_CLASS[race0.race_grade_number || 5] : null;
  var day = '';
  if (st && typeof _stadiumDayInfo === 'function') {
    var rns = Object.keys(st).sort(function (a, b) {
      return parseInt(a, 10) - parseInt(b, 10);
    });
    day = _stadiumDayInfo(e0.sid, '', rns).text || '';
  }
  var src = [sName, grade && grade.name !== '一般' ? grade.name : '', race0 ? race0.race_title || '' : '', day]
    .filter(Boolean)
    .map(escText)
    .join(' ');
  var rows = '';
  info.today.forEach(function (e) {
    var s = _racerEntryStatus(e, now);
    var ai = '';
    if (s.kind === 'open' && typeof _racerAiMark === 'function') {
      var mk = _racerAiMark(e.sid, e.rno, e.boat);
      if (mk && mk.mark)
        ai =
          ' <span class="fav-note">AI ' +
          escText(mk.mark) +
          (typeof mk.prob === 'number' ? ' ' + Math.round(mk.prob * 100) + '%' : '') +
          '</span>';
    }
    var cls = 'fav-st';
    if (s.kind === 'done' && s.place && s.place <= 3) cls += ' res-' + s.place;
    else if (s.kind === 'open' && s.mins != null && s.mins <= 5) cls += ' soon-urgent';
    else if (s.kind === 'cancel') cls += ' c-danger';
    rows +=
      '<div class="fav-row' +
      (s.kind === 'open' ? '' : ' done') +
      '" role="button" tabindex="0" data-action="openRace" data-arg-sid="' +
      e.sid +
      '" data-arg-rn="' +
      e.rno +
      '"><span class="fav-time">' +
      escText(e.hm) +
      '</span><span><b>' +
      e.rno +
      'R</b></span><span class="fav-who">' +
      (typeof boatBadge === 'function' ? boatBadge(e.boat) : e.boat) +
      ' ' +
      e.boat +
      '号艇' +
      ai +
      '</span><span class="' +
      cls +
      '">' +
      escText(s.text || '発売中') +
      '</span></div>';
  });
  return (
    '<div class="card"><div class="sec-title">本日の出走 <span class="sec-src">' +
    src +
    '</span></div>' +
    rows +
    _racerSeriesHtml(info) +
    '</div>'
  );
}

// ─── 3. 成績 ─────────────────────────────────────────────
function _racerFanLine(p) {
  if (!p || p.winRate == null) return '';
  return (
    '期別成績（ファン手帳）: 勝率 ' +
    _rNum(p.winRate, 2) +
    ' ／ 2連対率 ' +
    _rNum(p.top2Rate, 1) +
    '% ／ 平均ST ' +
    _rNum(p.avgST, 2) +
    ' ／ ' +
    (p.totalRaces || 0) +
    ' 走'
  );
}

function _racerStatsCard(info) {
  var b = info.prog;
  var p = info.p;
  if (b) {
    var tiles =
      _rTile(_rNum(b.racer_national_top_1_percent, 2), '全国勝率') +
      _rTile(_rNum(b.racer_national_top_2_percent, 1) + '%', '2連対率') +
      _rTile(_rNum(b.racer_national_top_3_percent, 1) + '%', '3連対率') +
      _rTile(_rNum(b.racer_average_start_timing, 2), '平均ST') +
      _rTile(_rNum(b.racer_local_top_1_percent, 2), '当地勝率') +
      _rTile(_rNum(b.racer_local_top_2_percent, 1) + '%', '当地2連対') +
      _rTile(escText(b.racer_assigned_motor_number || '-'), 'モーター') +
      _rTile(_rNum(b.racer_assigned_motor_top_2_percent, 1) + '%', 'モーター2連');
    var fan = _racerFanLine(p);
    return (
      '<div class="card"><div class="sec-title">成績 <span class="sec-src">本日の出走表より</span></div><div class="kv">' +
      tiles +
      '</div>' +
      (fan ? '<div class="racer-note">' + fan + '</div>' : '') +
      '</div>'
    );
  }
  if (p && p.winRate != null) {
    return (
      '<div class="card"><div class="sec-title">成績 <span class="sec-src">期別成績（ファン手帳）</span></div><div class="kv">' +
      _rTile(_rNum(p.winRate, 2), '勝率') +
      _rTile(_rNum(p.top2Rate, 1) + '%', '2連対率') +
      _rTile(_rNum(p.avgST, 2), '平均ST') +
      _rTile(escText(p.totalRaces || 0), '出走数') +
      '</div></div>'
    );
  }
  return '';
}

// ─── 4. コース別成績（ファン手帳） ─────────────────────────────────
function _racerCourseCard(info) {
  var cs = info.p && info.p.courseStats;
  if (!cs) return '';
  var total = 0;
  var rows = '';
  for (var c = 1; c <= 6; c++) {
    var s = cs[String(c)] || {};
    var n = s.entries || 0;
    total += n;
    var pl = Array.isArray(s.places) ? s.places : [];
    var win = s.wins != null ? s.wins : pl[0] || 0;
    var top3 = (pl[0] || 0) + (pl[1] || 0) + (pl[2] || 0);
    var wr = n > 0 ? Math.round((win / n) * 100) : 0;
    rows +=
      '<tr><td>' +
      (typeof boatBadge === 'function' ? boatBadge(c) : c) +
      '</td><td>' +
      n +
      '</td><td>' +
      (n > 0 ? '<b>' + wr + '%</b><div class="bar"><i style="width:' + Math.min(100, wr) + '%"></i></div>' : '-') +
      '</td><td>' +
      (n > 0 ? _rNum(s.top2Rate, 1) + '%' : '-') +
      '</td><td>' +
      (n > 0 && pl.length ? _rPct(top3, n) : '-') +
      '</td><td>' +
      (n > 0 ? _rNum(s.avgST, 2) : '-') +
      '</td><td>' +
      (n > 0 ? _rNum(s.avgSTRank, 1) : '-') +
      '</td></tr>';
  }
  if (!total) return '';
  return (
    '<div class="card"><div class="sec-title">コース別成績 <span class="sec-src">期別成績（ファン手帳）' +
    total +
    ' 走</span></div><table class="ct"><tr><th>コース</th><th>出走</th><th>1着率</th><th>2連対</th><th>3連対</th>' +
    '<th>平均ST</th><th>ST順</th></tr>' +
    rows +
    '</table></div>'
  );
}

// ─── 5. 直近の着順 ─────────────────────────────────────────
function _racerRecentCard(info) {
  // 末尾が最新。起動後に今日の確定分が後ろへ足されることがある（予測用 DB と同じ配列）ので、新しい 20 走に絞る
  var rr = info.p && Array.isArray(info.p.recentResults) ? info.p.recentResults.slice(-RACER_RECENT_MAX) : [];
  if (!rr.length) return '';
  var chips = '';
  // 保存は古い順（末尾が最新）。新しい順に並べる
  for (var i = rr.length - 1; i >= 0; i--) {
    var v = rr[i];
    var ok = v >= 1 && v <= 6;
    chips += '<span class="pl' + (ok && v <= 3 ? ' pl-' + v : '') + '">' + (ok ? v : '-') + '</span>';
  }
  return (
    '<div class="card"><div class="sec-title">直近 ' +
    rr.length +
    ' 走の着順 <span class="sec-src">左が新しい</span></div><div class="pl-wrap">' +
    chips +
    '</div></div>'
  );
}

// ─── 6. 当アプリの集計（直近 12 か月） ───────────────────────────────
function _racerAggCard(info) {
  var V = globalThis._racerStatsView;
  if (!V) {
    // 未取得なら取りに行き、届いたら描き直す（取得は discovery 層、レース詳細の chunk に同梱）
    if (typeof _loadRacerStatsView === 'function') _loadRacerStatsView(_racerRerender);
    return '';
  }
  var rs = V.racers ? V.racers[info.id] : null;
  if (!rs || !rs.c) return '';
  var total = 0;
  var rows = '';
  for (var c = 1; c <= 6; c++) {
    var a = rs.c[String(c)];
    if (!a || !a[0]) continue;
    total += a[0];
    var kw = (rs.kw && rs.kw[String(c)]) || {};
    var tech = Object.keys(kw)
      .sort(function (x, y) {
        return kw[y] - kw[x];
      })
      .slice(0, 2)
      .map(function (k) {
        return escText((typeof TECHNIQUE !== 'undefined' && TECHNIQUE[k]) || '他') + ' ' + kw[k];
      })
      .join('・');
    rows +=
      '<tr><td>' +
      (typeof boatBadge === 'function' ? boatBadge(c) : c) +
      '</td><td>' +
      a[0] +
      '</td><td>' +
      a[1] +
      '</td><td>' +
      a[2] +
      '</td><td>' +
      a[3] +
      '</td><td class="ta-l">' +
      (tech || '-') +
      '</td></tr>';
  }
  if (total < RACER_AGG_MIN) return '';
  var st = rs.st;
  var sz = rs.sz;
  var line = '';
  if (st && st[0] != null) {
    line = '本番の平均ST ' + _rNum(st[0], 2) + '（' + (st[1] || 0) + ' 走）';
    if (st[2] > 0) line += ' ／ <span class="c-danger">F ' + st[2] + ' 回</span>';
    if (st[3] > 0) line += ' ／ L ' + st[3] + ' 回';
    if (sz && sz[2] >= 3) line += ' ／ 展示との差 ' + (sz[0] >= 0 ? '+' : '') + _rNum(sz[0], 2);
  }
  var months = (V.window && V.window.racer_months) || 12;
  return (
    '<div class="card"><div class="sec-title">当アプリの集計 <span class="sec-src">直近 ' +
    months +
    ' か月・' +
    total +
    ' 走</span></div><table class="ct"><tr><th>コース</th><th>出走</th><th>1着</th><th>2連対</th><th>3連対</th>' +
    '<th class="ta-l">勝ち決まり手</th></tr>' +
    rows +
    '</table>' +
    (line ? '<div class="racer-note">' + line + '</div>' : '') +
    '</div>'
  );
}

// ─── 7. 出典 ─────────────────────────────────────────────
// 実際に画面へ出した情報の出どころだけを並べる
function _racerFootHtml(info, hasAgg) {
  var at = globalThis._racerProfilesAt ? String(globalThis._racerProfilesAt).slice(0, 10) : '';
  var src = [];
  if (info.prog) src.push('本日の出走表');
  if (info.p) src.push('ファン手帳の期別成績' + (at ? '（' + escText(at) + ' 取得）' : ''));
  if (hasAgg) src.push('当アプリの集計');
  return (
    '<div class="racer-foot"><a class="racer-ext" href="' +
    RACER_OFFICIAL_URL +
    encodeURIComponent(info.id) +
    '" target="_blank" rel="noopener noreferrer">公式サイトの選手ページを開く ↗</a>' +
    (src.length ? '<div class="racer-note">出典: ' + src.join(' / ') + '</div>' : '') +
    '</div>'
  );
}

function _racerDetailHtml(id, from, now) {
  var info = _racerInfo(id);
  if (typeof _racerAiMarkReset === 'function') _racerAiMarkReset(); // AI の印は描画のたびに計算し直す
  var agg = _racerAggCard(info);
  return (
    '<button type="button" class="back-btn" data-action="racerBack">' +
    escText(_racerBackLabel(from)) +
    '</button>' +
    _racerProfileCard(info) +
    _racerTodayCard(info, now) +
    _racerStatsCard(info) +
    _racerCourseCard(info) +
    _racerRecentCard(info) +
    agg +
    _racerFootHtml(info, !!agg)
  );
}

globalThis._racerDetailHtml = _racerDetailHtml;

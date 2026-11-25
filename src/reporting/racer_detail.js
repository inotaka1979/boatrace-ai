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
// 2026-11-25（第 2 段階）:
//   - プロフィールに 生年月日・身長・血液型・登録期・来期の級、成績に 1 着 / 2 着回数・優出 / 優勝・能力指数・
//     級の推移（ファン手帳の追加項目 data/db/racer_ext.json）
//   - 今後の出場予定・過去 3 節・直近の優勝（公式の選手ページ。Worker /racer-proxy 経由で、開いた時だけ取得）
// 項目は「取れているものだけ」出す（出走の無い日は 2 と出走表由来の数字が無い、名簿に無い選手は 3〜5 が無い）。
//
// Public: _racerDetailHtml

/* global programData, escText, boatBadge, renderSeriesCell, getRaceDataForRace, _seriesSlotsFor, _stadiumDayInfo,
   _racerInfo, _racerBackLabel, _racerClsChip, _favBtnHtml, _racerEntryStatus, _racerAiMark, _racerAiMarkReset,
   _loadRacerStatsView, _racerRerender, _racerOfficialOf, _loadRacerOfficial, _racerOfficialPaused, _racerIsoDay */
'use strict';

var RACER_OFFICIAL_URL = 'https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=';
var RACER_DAY_LABELS = ['初日', '2日目', '3日目', '4日目', '5日目', '6日目', '7日目'];
var RACER_AGG_MIN = 3; // 当アプリの集計を出す最少出走数
var RACER_RECENT_MAX = 20; // 直近の着順に並べる数
var RACER_CLS = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2' };

function _rNum(v, digits) {
  var n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n.toFixed(digits) : '-';
}
function _rPct(a, b) {
  return b > 0 ? Math.round((a / b) * 100) + '%' : '-';
}
// 回数など整数の表示。数値でなければ '-'
function _rInt(v) {
  var n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? String(Math.round(n)) : '-';
}
// 決まった名前だけを引く表（'constructor' のような名前で Object の既定の項目を拾わない）
function _rPick(table, key) {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : '';
}
function _rTile(value, label) {
  return '<div><b>' + value + '</b><span>' + label + '</span></div>';
}

// 生年月日 'YYYY-MM-DD' と今日（JST）から満年齢。読めなければ null
function _rAge(birth, now) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth || '');
  if (!m) return null;
  var today = _racerIsoDay(now);
  var age = parseInt(today.slice(0, 4), 10) - parseInt(m[1], 10) - (today.slice(5) < m[2] + '-' + m[3] ? 1 : 0);
  return age >= 15 && age <= 90 ? age : null;
}

// ─── 1. プロフィール ───────────────────────────────────────
function _racerProfileCard(info, now) {
  var x = info.ext || {};
  var meta = [];
  var born = _rYmd(x.b);
  // 年齢: 今日の出走表 > 生年月日から計算 > 名簿（名簿の年齢は算出時点のもので、誕生日を過ぎると 1 歳ずれる）
  var age = (info.prog && info.prog.racer_age) || _rAge(x.b, now) || info.age;
  if (age) meta.push(escText(age) + '歳' + (born ? '（' + escText(born) + ' 生）' : ''));
  else if (born) meta.push(escText(born) + ' 生');
  if (x.h) meta.push(escText(x.h) + 'cm');
  if (info.weight) meta.push(escText(Number(info.weight) % 1 ? Number(info.weight).toFixed(1) : info.weight) + 'kg');
  if (x.bl) meta.push(escText(x.bl) + '型');
  if (info.birthplace || x.bp) meta.push(escText(info.birthplace || x.bp) + '出身');
  var fl = '';
  if (info.prog) {
    var f = info.prog.racer_flying_count || 0;
    var l = info.prog.racer_late_count || 0;
    fl = '<br>' + (f > 0 ? '<span class="c-danger fw-700">F' + f + '</span>' : 'F0') + ' / L' + l + '（今期）';
  }
  var chips =
    _racerClsChip(info.cls) +
    (info.nextCls ? '<span class="chip chip-next">来期 ' + _rPick(RACER_CLS, info.nextCls) + '</span>' : '') +
    '<span class="chip">登録 ' +
    escText(info.id) +
    '</span>' +
    (info.branch ? '<span class="chip">' + escText(info.branch) + '支部</span>' : '') +
    (x.ki ? '<span class="chip">' + escText(x.ki) + '期</span>' : '');
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
// ファン手帳の期別成績。追加項目 (racer_ext.json) があれば算出期間・1 着 / 2 着・優出 / 優勝・能力指数・級の推移も出す
function _racerFanLine(p, x) {
  if (!p || p.winRate == null) return '';
  var X = globalThis._racerExt;
  var t = X && X.term ? X.term : null;
  var label = t && t.from && t.to ? _rYmd(t.from) + '〜' + _rYmd(t.to).replace(/^\d{4}\//, '') : 'ファン手帳';
  var out =
    '期別成績（' +
    escText(label) +
    '）: 勝率 ' +
    _rNum(p.winRate, 2) +
    ' ／ 2連対率 ' +
    _rNum(p.top2Rate, 1) +
    '% ／ 平均ST ' +
    _rNum(p.avgST, 2) +
    ' ／ ' +
    (p.totalRaces || 0) +
    ' 走';
  if (!x) return out;
  if (Array.isArray(x.w) && Array.isArray(x.y)) {
    out +=
      '<br>1着 ' +
      _rInt(x.w[0]) +
      ' 回・2着 ' +
      _rInt(x.w[1]) +
      ' 回 ／ 優出 ' +
      _rInt(x.y[0]) +
      ' 回・優勝 ' +
      _rInt(x.y[1]) +
      ' 回';
  }
  if (Array.isArray(x.ab)) {
    out += ' ／ 能力指数 ' + _rNum(x.ab[0], 2) + (x.ab[1] ? '（前期 ' + _rNum(x.ab[1], 2) + '）' : '');
  }
  if (Array.isArray(x.fl) && (x.fl[0] > 0 || x.fl[1] > 0)) {
    out +=
      '<br>' +
      (x.fl[0] > 0 ? '<span class="c-danger">F ' + _rInt(x.fl[0]) + ' 回</span>' : 'F 0 回') +
      ' ／ L ' +
      _rInt(x.fl[1]) +
      ' 回（この期間）';
  }
  // 級の推移: 前々々期 → 前々期 → 前期 → この成績で決まった級（適用期を添える）
  if (Array.isArray(x.pc) && p.classNum) {
    var hist = [x.pc[2], x.pc[1], x.pc[0], p.classNum]
      .map(function (c) {
        return _rPick(RACER_CLS, c);
      })
      .filter(Boolean);
    if (hist.length > 1) {
      out +=
        '<br>級の推移: ' +
        hist.join(' → ') +
        (t && t.year ? '（' + _rInt(t.year) + '年' + (t.half === 2 ? '後期' : '前期') + '）' : '');
    }
  }
  return out;
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
    var fan = _racerFanLine(p, info.ext);
    return (
      '<div class="card"><div class="sec-title">成績 <span class="sec-src">本日の出走表より</span></div><div class="kv">' +
      tiles +
      '</div>' +
      (fan ? '<div class="racer-note">' + fan + '</div>' : '') +
      '</div>'
    );
  }
  if (p && p.winRate != null) {
    var fan2 = info.ext ? _racerFanLine(p, info.ext) : '';
    return (
      '<div class="card"><div class="sec-title">成績 <span class="sec-src">期別成績（ファン手帳）</span></div><div class="kv">' +
      _rTile(_rNum(p.winRate, 2), '勝率') +
      _rTile(_rNum(p.top2Rate, 1) + '%', '2連対率') +
      _rTile(_rNum(p.avgST, 2), '平均ST') +
      _rTile(escText(p.totalRaces || 0), '出走数') +
      '</div>' +
      (fan2 ? '<div class="racer-note">' + fan2 + '</div>' : '') +
      '</div>'
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

// ─── 公式の出場予定 / 過去 3 節（Worker /racer-proxy。取得は discovery 層） ──────────────────────
var RACER_TIME_LABEL = { morning: 'モーニング', summer: 'サマータイム', nighter: 'ナイター', midnight: 'ミッドナイト' };
var RACER_WD = ['日', '月', '火', '水', '木', '金', '土'];

// 'YYYY-MM-DD' → 'M/D(曜)'
function _rMdw(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return '';
  var wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return parseInt(m[2], 10) + '/' + parseInt(m[3], 10) + '(' + RACER_WD[wd] + ')';
}
// 'YYYY-MM-DD' → 'YYYY/M/D'
function _rYmd(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? m[1] + '/' + parseInt(m[2], 10) + '/' + parseInt(m[3], 10) : '';
}
var RACER_GRADE_CLASS = { SG: 'gr-sg', PG1: 'gr-pg1', G1: 'gr-g1', G2: 'gr-g2', G3: 'gr-g3' };
function _rGradeChip(grade) {
  var cls = _rPick(RACER_GRADE_CLASS, grade);
  return cls ? '<span class="gr ' + cls + '">' + escText(grade) + '</span>' : '';
}
// 期間・場・グレード・タイトル（出場予定と過去 3 節で共通）
function _rSeriesHead(s) {
  // シリーズ名（オールレディース等）は、大会名に含まれていれば重ねて出さない
  var series = s.series && String(s.title || '').indexOf(s.series) < 0 ? s.series : '';
  var tags = [series, _rPick(RACER_TIME_LABEL, s.time)].filter(Boolean).map(escText).join('・');
  return (
    '<span class="sr-date">' +
    escText(_rMdw(s.from)) +
    (s.to && s.to !== s.from ? '〜<br>' + escText(_rMdw(s.to)) : '') +
    '</span><b class="sr-place">' +
    escText(s.stadium || '') +
    '</b><span class="sr-title">' +
    _rGradeChip(s.grade) +
    escText(s.title || '') +
    (tags ? ' <span class="fav-note">' + tags + '</span>' : '')
  );
}

// 取得の状態を見て、まだなら取りに行く（終わったら描き直す）。戻り値は _racerOfficialOf と同じ形
function _racerOfficialFor(info) {
  if (typeof _loadRacerOfficial !== 'function' || typeof _racerOfficialOf !== 'function') return null;
  _loadRacerOfficial(info.id, function () {
    _racerRerender();
  });
  var o = _racerOfficialOf(info.id);
  // 続けて失敗して休止中（loader）で、この選手はまだ取れていない → 失敗として見せる（カードを黙って消さない）
  if (!o && typeof _racerOfficialPaused === 'function' && _racerOfficialPaused()) {
    return { data: null, loading: false, failed: true };
  }
  return o;
}

function _racerOfficialNote(o) {
  if (o && o.data && o.data.found === false) return '公式サイトにこの登録番号の選手ページがありません（引退など）。';
  if (!o || (!o.data && o.loading)) return '公式サイトから取得中…';
  if (!o.data)
    return '取得できませんでした（通信状況か、公式サイト側の都合です）。下のリンクから公式サイトで確認できます。';
  return '';
}

// 今後の出場予定
function _racerScheduleCard(info, o, now) {
  if (o === null) return '';
  var note = _racerOfficialNote(o);
  var rows = '';
  if (!note) {
    var iso = _racerIsoDay(now);
    (Array.isArray(o.data.schedule) ? o.data.schedule : []).forEach(function (s) {
      if (!s || (s.to && s.to < iso)) return; // 取得後に終わった節は出さない
      rows +=
        '<div class="sr-row">' +
        _rSeriesHead(s) +
        (s.extra ? ' <span class="fav-note">' + escText(s.extra) + '</span>' : '') +
        '</span></div>';
    });
    if (!rows) note = '発表されている出場予定はありません。';
  }
  return (
    '<div class="card"><div class="sec-title">今後の出場予定 <span class="sec-src">公式サイト（あっせん）</span></div>' +
    (note ? '<div class="racer-note">' + note + '</div>' : rows) +
    '</div>'
  );
}

// 過去 3 節（[ ] は優勝戦）と直近の優勝
function _racerBack3Card(info, o) {
  if (o === null || !o || !o.data || o.data.found === false) return ''; // 状態の説明は出場予定のカードに出す
  var d = o.data;
  var rows = '';
  (Array.isArray(d.back3) ? d.back3 : []).forEach(function (s) {
    if (!s) return;
    var res = escText(s.results || '').replace(/\[1\]/g, '<b class="res-1">[1]</b>');
    var won = /\[1\]\s*$/.test(s.results || '');
    rows +=
      '<div class="sr-row">' +
      _rSeriesHead(s) +
      '</span><span class="sr-res">' +
      (res || '-') +
      (won ? ' <span class="sr-won">優勝</span>' : '') +
      '</span></div>';
  });
  var wins = (Array.isArray(d.wins) ? d.wins : [])
    .filter(Boolean)
    .map(function (w) {
      return (
        escText(_rYmd(w.from)) + ' ' + escText(w.stadium || '') + ' ' + _rGradeChip(w.grade) + escText(w.title || '')
      );
    })
    .join('<br>');
  if (!rows && !wins) {
    return d.back3_ok === false
      ? '<div class="card"><div class="sec-title">過去 3 節</div><div class="racer-note">過去 3 節は取得できませんでした。</div></div>'
      : '';
  }
  return (
    '<div class="card"><div class="sec-title">過去 3 節 <span class="sec-src">公式サイト / [ ] は優勝戦</span></div>' +
    (rows || '<div class="racer-note">過去 3 節の記録はありません。</div>') +
    (wins ? '<div class="racer-note">直近の優勝: ' + wins + '</div>' : '') +
    '</div>'
  );
}

// ─── 7. 出典 ─────────────────────────────────────────────
// 実際に画面へ出した情報の出どころだけを並べる
function _racerFootHtml(info, hasAgg, hasOfficial) {
  var at = globalThis._racerProfilesAt ? String(globalThis._racerProfilesAt).slice(0, 10) : '';
  var src = [];
  if (info.prog) src.push('本日の出走表');
  if (info.p) src.push('ファン手帳の期別成績' + (at ? '（' + escText(at) + ' 取得）' : ''));
  if (hasOfficial) src.push('公式サイト（出場予定・過去 3 節）');
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
  var info = _racerInfo(id, null, now);
  if (typeof _racerAiMarkReset === 'function') _racerAiMarkReset(); // AI の印は描画のたびに計算し直す
  var agg = _racerAggCard(info);
  var official = _racerOfficialFor(info);
  return (
    '<button type="button" class="back-btn" data-action="racerBack">' +
    escText(_racerBackLabel(from)) +
    '</button>' +
    _racerProfileCard(info, now) +
    _racerTodayCard(info, now) +
    _racerScheduleCard(info, official, now) +
    _racerStatsCard(info) +
    _racerCourseCard(info) +
    _racerRecentCard(info) +
    _racerBack3Card(info, official) +
    agg +
    _racerFootHtml(info, !!agg, !!(official && official.data && official.data.found !== false))
  );
}

globalThis._racerDetailHtml = _racerDetailHtml;
globalThis._rAge = _rAge;

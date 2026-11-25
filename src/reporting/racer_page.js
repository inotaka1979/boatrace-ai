// 2026-11-25: 選手ページ（lazy chunk app-rest-racer）— 一覧（★ お気に入り / 本日の出走 / 検索）と画面の切替
//
// 下メニュー「選手」または openRacer(id) で開く。showPage('racer') → racer_fav.js の _onShowRacerPage が
// この chunk を読み込んで _renderRacerPage(next) を呼ぶ。next = {id, from} なら選手詳細
// （racer_detail.js）、無ければ一覧。
//
// データ（すべて既存のもの。新しい取得先は無い）:
//   - 本日の出走: programData（racer_fav.js の _racerTodayIndex）
//   - プロフィール: globalThis._racerProfiles（data/db/racerDB.json の元の形。discovery/racer_profiles_loader.js）
//   - 顔写真: data/photos/{登録番号}.jpg
//
// Public: _renderRacerPage / _racerInfo / _racerSearch / _racerSearchKey / _racerRowHtml / _racerTodayLine

/* global programData, escText, currentStadium, currentRace, showPage, ACTION_HANDLERS, _racerTodayIndex,
   _racerEntryStatus, _racerDispName, _favRacers, _favIdSet, _favBtnHtml, _loadRacerProfiles, _loadRacerExt,
   _racerOfficialOf, _loadRacerOfficialMany */
'use strict';

var RACER_SEARCH_MAX = 50;
var CLS_LABEL = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2' };

// 画面の状態（chunk が生きている間だけ保持。タブ・場・検索語を覚えておく）
var _racerUi = { view: 'list', tab: '', sid: '', q: '', id: '', from: 'top', scroll: 0 };

// ─── データ ───────────────────────────────────────────────

// 半角カナ → 全角カナ、ひらがな → カタカナ、空白を除いて小文字に（検索の突き合わせ用）
function _racerSearchKey(s) {
  s = String(s == null ? '' : s);
  try {
    s = s.normalize('NFKC');
  } catch (_) {}
  return s
    .replace(/[ぁ-ゖ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) + 0x60);
    })
    .replace(/[\s　]/g, '')
    .toLowerCase();
}

function _kanaFull(s) {
  try {
    return String(s || '').normalize('NFKC');
  } catch (_) {
    return String(s || '');
  }
}

// 今日の出走表の艇データ（選手番号で引く）
function _racerProgramBoat(e) {
  var race = typeof programData !== 'undefined' && programData && programData[e.sid] ? programData[e.sid][e.rno] : null;
  if (!race || !Array.isArray(race.boats)) return null;
  for (var i = 0; i < race.boats.length; i++) {
    if (race.boats[i] && String(race.boats[i].racer_number) === String(e.id)) return race.boats[i];
  }
  return null;
}

// 級。今日の出走表が一番確か。ファン手帳の「級」は次の適用期の級（10 月公表版なら翌 1/1 から）なので、
//   適用開始より前は「前期級」が現在の級になる（2026-11-25 の出走表 583 人で、現在の級は全員 前期級 と一致し、
//   うち 136 人は次期の級と違っていた）。
//   戻り値: { cls: 現在の級, next: 適用開始前で級が変わる選手の来期の級（変わらなければ 0） }
function _racerClassOf(id, p, prog, now) {
  var X = globalThis._racerExt;
  var e = X && X.racers ? X.racers[String(id)] : null;
  var newCls = (p && p.classNum) || 0;
  var start = X && X.term && X.term.year ? Date.UTC(X.term.year, X.term.half === 2 ? 6 : 0, 1) - 9 * 3600000 : null;
  var before = start != null && (now || Date.now()) < start;
  var cur = (prog && prog.racer_class_number) || (before && e && e.pc && e.pc[0]) || newCls || 0;
  return { cls: cur, next: before && newCls && cur && newCls !== cur ? newCls : 0 };
}

// 今日（JST）の 'YYYY-MM-DD'。時刻は引数で受ける（実時計を直接読むと、テストが日付で結果を変える）
function _racerIsoDay(now) {
  return new Date((now || Date.now()) + 9 * 3600000).toISOString().slice(0, 10);
}

// 公式の出場予定のうち、まだ終わっていない最初の節（無ければ null）
function _racerNextSeries(id, now) {
  var o = typeof _racerOfficialOf === 'function' ? _racerOfficialOf(id) : null;
  var list = o && o.data && Array.isArray(o.data.schedule) ? o.data.schedule : [];
  var iso = _racerIsoDay(now);
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].to && list[i].to >= iso) return list[i];
  }
  return null;
}

// 'YYYY-MM-DD' → 'M/D'
function _racerMd(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? parseInt(m[2], 10) + '/' + parseInt(m[3], 10) : '';
}

// 一覧の 1 行に出す「次節 12/6〜12/11 蒲郡 G1」
function _racerNextLine(id, now) {
  var s = _racerNextSeries(id, now);
  if (!s) return '';
  return (
    '次節 ' +
    escText(_racerMd(s.from)) +
    '〜' +
    escText(_racerMd(s.to)) +
    ' ' +
    escText(s.stadium || '') +
    (s.grade && s.grade !== '一般' ? ' ' + escText(s.grade) : '')
  );
}

// 選手 1 人分を、取れる所から集める（今日の出走表 > プロフィール DB > お気に入りに保存した名前）
function _racerInfo(id, todayIdx, now) {
  id = String(id);
  var P = globalThis._racerProfiles || {};
  var p = P[id] || null;
  var today = (todayIdx || _racerTodayIndex())[id] || [];
  var prog = today.length ? _racerProgramBoat(today[0]) : null;
  var name = prog && prog.racer_name ? prog.racer_name : p && p.name ? p.name : '';
  if (!name) {
    var fav = _favRacers().filter(function (f) {
      return f.id === id;
    })[0];
    name = fav ? fav.name : '';
  }
  var X = globalThis._racerExt;
  var klass = _racerClassOf(id, p, prog, now);
  return {
    id: id,
    name: _racerDispName(name) || '登録 ' + id,
    kana: p && p.kana ? _kanaFull(p.kana) : '',
    cls: klass.cls,
    nextCls: klass.next,
    ext: X && X.racers ? X.racers[id] || null : null,
    branch: (prog && prog.racer_branch_name) || (p && p.branch) || '',
    birthplace: (prog && prog.racer_birthplace) || '',
    age: (prog && prog.racer_age) || (p && p.age) || null,
    weight: (prog && prog.racer_weight) || (p && p.weight) || null,
    winRate:
      prog && prog.racer_national_top_1_percent != null ? prog.racer_national_top_1_percent : p ? p.winRate : null,
    p: p,
    prog: prog,
    today: today,
  };
}

// 検索用の索引（プロフィール DB の全選手 + 今日の出走表にだけ居る選手）。元データが変わったら作り直す。
var _racerSearchIdx = null;
var _racerSearchSrc = null;
var _racerSearchProg = null;
var _racerSearchExt = null;
function _racerSearchIndex(now) {
  var P = globalThis._racerProfiles || null;
  var prog = typeof programData !== 'undefined' ? programData : null;
  var X = globalThis._racerExt || null;
  if (_racerSearchIdx && _racerSearchSrc === P && _racerSearchProg === prog && _racerSearchExt === X)
    return _racerSearchIdx;
  var today = _racerTodayIndex();
  var out = [];
  var seen = {};
  var id;
  for (id in P || {}) {
    var p = P[id];
    if (!p || !p.name) continue;
    seen[id] = 1;
    out.push({
      id: id,
      nk: _racerSearchKey(_racerDispName(p.name)),
      kk: _racerSearchKey(p.kana),
      cls: _racerClassOf(id, p, null, now).cls || 9,
      wr: p.winRate || 0,
      today: today[id] ? 1 : 0,
    });
  }
  for (id in today) {
    if (seen[id]) continue;
    var e = today[id][0];
    out.push({ id: id, nk: _racerSearchKey(e.name), kk: '', cls: e.cls || 9, wr: 0, today: 1 });
  }
  _racerSearchIdx = out;
  _racerSearchSrc = P;
  _racerSearchProg = prog;
  _racerSearchExt = X;
  return out;
}

// 名前（漢字）・かな（ひらがな / カタカナ / 半角カナ）・登録番号の部分一致。
//   並び: 登録番号の完全一致 → 前方一致 → 部分一致、その中で 本日出走 → 級 → 勝率。
function _racerSearch(q, now) {
  var key = _racerSearchKey(q);
  if (!key) return { total: 0, ids: [] };
  var isNum = /^\d+$/.test(key);
  var hits = [];
  _racerSearchIndex(now).forEach(function (r) {
    var rank = -1;
    if (isNum) {
      if (r.id === key) rank = 0;
      else if (r.id.indexOf(key) === 0) rank = 1;
      else if (r.id.indexOf(key) > 0) rank = 2;
    } else {
      var a = r.nk.indexOf(key);
      var b = r.kk.indexOf(key);
      if (a === 0 || b === 0) rank = 1;
      else if (a > 0 || b > 0) rank = 2;
    }
    if (rank >= 0) hits.push({ r: r, rank: rank });
  });
  hits.sort(function (x, y) {
    return (
      x.rank - y.rank ||
      y.r.today - x.r.today ||
      x.r.cls - y.r.cls ||
      y.r.wr - x.r.wr ||
      Number(x.r.id) - Number(y.r.id)
    );
  });
  return {
    total: hits.length,
    ids: hits.slice(0, RACER_SEARCH_MAX).map(function (h) {
      return h.r.id;
    }),
  };
}

// ─── 一覧の 1 行 ───────────────────────────────────────────

// 「本日 常滑 6R（4着）・10R 14:55」。noStadium = 場名を省く（場で絞った一覧用）
function _racerTodayLine(entries, now, noStadium) {
  if (!entries || !entries.length) return '';
  var parts = entries.map(function (e) {
    var st = _racerEntryStatus(e, now);
    if (st.kind === 'open') return '<b>' + e.rno + 'R ' + escText(e.hm) + '</b>';
    return e.rno + 'R（' + escText(st.text) + '）';
  });
  var name = (typeof STADIUMS !== 'undefined' && STADIUMS[entries[0].sid]) || '場' + entries[0].sid;
  return (noStadium ? '' : '本日 ' + escText(name) + ' ') + parts.join('・');
}

function _clsChip(cls) {
  return CLS_LABEL[cls] ? '<span class="cls-chip cls-' + cls + '">' + CLS_LABEL[cls] + '</span>' : '';
}

// opt: { wr: 名前の横に勝率を出す, noStadium, emptyToday: 出走が無いときの文, next: 次節の行を出す（お気に入り） }
function _racerRowHtml(info, favSet, now, opt) {
  opt = opt || {};
  var sub = [info.kana, info.branch, '登録 ' + info.id].filter(Boolean).map(escText).join('・');
  var wr =
    opt.wr && info.winRate != null
      ? '<span class="racer-li-wr">勝率 ' + Number(info.winRate).toFixed(2) + '</span>'
      : '';
  var today = _racerTodayLine(info.today, now, opt.noStadium) || (opt.emptyToday ? escText(opt.emptyToday) : '');
  return (
    '<div class="racer-li" role="button" tabindex="0" data-action="openRacer" data-arg-id="' +
    escText(info.id) +
    '" data-arg-from="racer"><img class="racer-li-photo" src="data/photos/' +
    encodeURIComponent(info.id) +
    '.jpg" loading="lazy" alt=""><div class="racer-li-main"><div class="racer-li-name">' +
    escText(info.name) +
    ' ' +
    _clsChip(info.cls) +
    wr +
    '</div><div class="racer-li-sub">' +
    sub +
    '</div>' +
    (today ? '<div class="racer-li-today">' + today + '</div>' : '') +
    (opt.next
      ? '<div class="racer-li-next" data-racer-next="' +
        escText(info.id) +
        '">' +
        _racerNextLine(info.id, now) +
        '</div>'
      : '') +
    '</div>' +
    _favBtnHtml(info.id, info.name, false, !!favSet[info.id]) +
    '</div>'
  );
}

// ─── タブの中身 ────────────────────────────────────────────

function _racerFavTabHtml(now) {
  var favs = _favRacers();
  if (!favs.length) {
    return (
      '<div class="card racer-empty"><b>お気に入り選手はまだ登録されていません。</b><br>' +
      '「本日の出走」や「検索」で選手を探して ☆ を押すと登録できます。レース詳細の出走表で選手名を押しても選手のページを開けます。<br>' +
      '登録した選手の本日の出走は、TOP の場一覧の下にも出ます。</div>'
    );
  }
  var idx = _racerTodayIndex();
  var set = _favIdSet();
  var infos = favs.map(function (f) {
    return { info: _racerInfo(f.id, idx, now), ts: f.ts };
  });
  // 本日出走する選手（次の締切が近い順）→ それ以外（登録の新しい順）
  function nextMs(info) {
    var best = null;
    info.today.forEach(function (e) {
      var st = _racerEntryStatus(e, now);
      if (st.kind === 'open' && e.closedMs != null && (best == null || e.closedMs < best)) best = e.closedMs;
    });
    return best;
  }
  infos.forEach(function (x) {
    x.racing = x.info.today.length ? 1 : 0;
    x.next = nextMs(x.info);
  });
  infos.sort(function (a, b) {
    if (a.racing !== b.racing) return b.racing - a.racing;
    if ((a.next == null) !== (b.next == null)) return a.next == null ? 1 : -1;
    if (a.next != null && a.next !== b.next) return a.next - b.next;
    return b.ts - a.ts;
  });
  var html = '<div class="card racer-list">';
  infos.forEach(function (x) {
    html += _racerRowHtml(x.info, set, now, { emptyToday: '本日の出走なし', next: true });
  });
  // 次節（公式の出場予定）。まだ取っていない選手を 1 人ずつ取り、届いた行だけ書き換える
  if (typeof _loadRacerOfficialMany === 'function') {
    _loadRacerOfficialMany(
      favs.map(function (f) {
        return f.id;
      }),
      _racerFillNext
    );
  }
  return html + '</div>';
}

// 一覧に出ている選手の「次節」の行を書き換える（一覧全体は描き直さない）
function _racerFillNext(id, now) {
  try {
    var els = document.querySelectorAll('[data-racer-next="' + String(id) + '"]');
    var line = _racerNextLine(id, now);
    for (var i = 0; i < els.length; i++) els[i].innerHTML = line;
  } catch (_) {}
}

// 開催中の場（番号順）
function _racerActiveSids() {
  if (typeof programData === 'undefined' || !programData) return [];
  return Object.keys(programData)
    .filter(function (s) {
      return programData[s] && Object.keys(programData[s]).length > 0;
    })
    .sort(function (a, b) {
      return parseInt(a, 10) - parseInt(b, 10);
    });
}

function _racerTodayTabHtml(now) {
  var sids = _racerActiveSids();
  if (!sids.length) return '<div class="card racer-empty">本日の出走表がまだ届いていません。</div>';
  // 既定の場: 前に選んだ場 → 直前に見ていた場 → 最初の開催場
  var cur = String(_racerUi.sid || '');
  if (sids.indexOf(cur) < 0)
    cur = typeof currentStadium !== 'undefined' && currentStadium ? String(currentStadium) : '';
  if (sids.indexOf(cur) < 0) cur = sids[0];
  _racerUi.sid = cur;
  var chips = '<div class="racer-sids" role="tablist" aria-label="場の選択">';
  sids.forEach(function (s) {
    var name = (typeof STADIUMS !== 'undefined' && STADIUMS[parseInt(s, 10)]) || '場' + s;
    chips +=
      '<button type="button" class="racer-sid' +
      (s === cur ? ' active' : '') +
      '" role="tab" aria-selected="' +
      (s === cur ? 'true' : 'false') +
      '" data-action="racerSid" data-arg-sid="' +
      s +
      '">' +
      escText(name) +
      '</button>';
  });
  chips += '</div>';
  var idx = _racerTodayIndex();
  var set = _favIdSet();
  var infos = [];
  for (var id in idx) {
    if (String(idx[id][0].sid) === cur) infos.push(_racerInfo(id, idx, now));
  }
  // 級（A1 → B2）→ 全国勝率の高い順
  infos.sort(function (a, b) {
    return (a.cls || 9) - (b.cls || 9) || (b.winRate || 0) - (a.winRate || 0) || Number(a.id) - Number(b.id);
  });
  var html =
    chips + '<div class="racer-count">' + infos.length + ' 人（級 → 全国勝率の順）</div><div class="card racer-list">';
  infos.forEach(function (info) {
    html += _racerRowHtml(info, set, now, { noStadium: true, wr: true });
  });
  return html + '</div>';
}

function _racerSearchResultHtml(now) {
  var q = _racerUi.q;
  if (!_racerSearchKey(q)) {
    return '<div class="card racer-empty">名前（漢字・ひらがな・カタカナ）か登録番号で探せます。<br>例: 「みね」「峰」「4320」</div>';
  }
  if (!globalThis._racerProfiles) {
    // 取得中でも、今日の出走表に居る選手は探せる
    _loadRacerProfiles(_racerRerender);
  }
  var res = _racerSearch(q, now);
  if (!res.total) {
    return (
      '<div class="card racer-empty">「' +
      escText(q) +
      '」に当てはまる選手が見つかりません。' +
      (globalThis._racerProfiles ? '' : '<br>（全選手の名簿を読み込み中です。少し待つと結果が増えることがあります）') +
      '</div>'
    );
  }
  var idx = _racerTodayIndex();
  var set = _favIdSet();
  var html =
    '<div class="racer-count">' +
    res.total +
    ' 人' +
    (res.total > res.ids.length ? '（上位 ' + res.ids.length + ' 人を表示。語を足すと絞れます）' : '') +
    '</div><div class="card racer-list">';
  res.ids.forEach(function (id) {
    html += _racerRowHtml(_racerInfo(id, idx, now), set, now, { wr: true });
  });
  return html + '</div>';
}

// ─── 描画 ─────────────────────────────────────────────────

function _racerView() {
  return typeof document !== 'undefined' ? document.getElementById('racerView') : null;
}

function _racerTabsHtml() {
  var n = _favRacers().length;
  function tab(key, label) {
    var on = _racerUi.tab === key;
    return (
      '<button type="button" class="racer-tab' +
      (on ? ' active' : '') +
      '" role="tab" aria-selected="' +
      (on ? 'true' : 'false') +
      '" data-action="racerTab" data-arg-tab="' +
      key +
      '">' +
      label +
      '</button>'
    );
  }
  return (
    '<div class="racer-tabs" role="tablist" aria-label="選手の表示切替">' +
    tab('fav', '★ お気に入り <span id="racerFavCount">(' + n + ')</span>') +
    tab('today', '本日の出走') +
    tab('search', '🔍 検索') +
    '</div>'
  );
}

function _racerListHtml(now) {
  if (!_racerUi.tab) _racerUi.tab = _favRacers().length ? 'fav' : 'today';
  var body;
  if (_racerUi.tab === 'today') body = _racerTodayTabHtml(now);
  else if (_racerUi.tab === 'search') {
    body =
      '<input type="search" id="racerSearchInput" class="racer-search" placeholder="名前・かな・登録番号" ' +
      'autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-label="選手を検索" value="' +
      escText(_racerUi.q) +
      '"><div id="racerSearchResult">' +
      _racerSearchResultHtml(now) +
      '</div>';
  } else body = _racerFavTabHtml(now);
  return _racerTabsHtml() + '<div id="racerTabBody">' + body + '</div>';
}

// 画面全体を描く。next = {id, from} なら選手詳細、null なら一覧。
//   onlyIfChanged = 中身が同じなら書き換えない（定期更新用）。
function _renderRacerPage(next, now, onlyIfChanged) {
  var view = _racerView();
  if (!view) return;
  _racerBind(view);
  if (next && next.id) {
    // 一覧から開いたときは、戻ったときのために一覧のスクロール位置を覚えておく
    //   （showPage は _onShowRacerPage を呼んだ後で先頭に戻すので、ここではまだ一覧の位置が読める）
    if (_racerUi.view === 'list' && next.from === 'racer' && typeof window !== 'undefined') {
      _racerUi.scroll = window.scrollY || 0;
    }
    _racerUi.view = 'detail';
    _racerUi.id = String(next.id);
    _racerUi.from = next.from || 'top';
  } else if (next !== undefined) {
    _racerUi.view = 'list';
  }
  var html;
  if (_racerUi.view === 'detail') {
    var f = globalThis._racerDetailHtml;
    html = typeof f === 'function' ? f(_racerUi.id, _racerUi.from, now) : '';
  } else {
    html = _racerListHtml(now);
  }
  if (!(onlyIfChanged && html === _racerLastHtml)) view.innerHTML = html;
  _racerLastHtml = html;
  // プロフィール DB が未取得なら取りに行き、届いたら描き直す（かな・支部・コース別成績が増える）
  if (!globalThis._racerProfiles) _loadRacerProfiles(_racerRerender);
  // 追加項目（生年月日・登録期・現在の級 …）も同じ
  if (!globalThis._racerExt && typeof _loadRacerExt === 'function') _loadRacerExt(_racerRerender);
}

// いまの状態のまま描き直す（データが届いた・登録が変わった とき。入力中の検索欄は触らない）
//   中身が変わらないときは DOM を触らない（30 秒ごとの更新で写真がちらつかないように）。
function _racerRerender(now) {
  var view = _racerView();
  var page = typeof document !== 'undefined' ? document.getElementById('pageRacer') : null;
  if (!view || !page || !page.classList || !page.classList.contains('active')) return;
  if (_racerUi.view === 'list' && _racerUi.tab === 'search') {
    var box = document.getElementById('racerSearchResult');
    var res = _racerSearchResultHtml(now);
    if (box && box.innerHTML !== res) box.innerHTML = res;
    return;
  }
  _renderRacerPage(undefined, now, true);
}

var _racerLastHtml = '';

// 検索欄の入力と写真の読込失敗は、選手ページの入れ物で 1 回だけ受ける（CSP のため inline handler は使わない）
var _racerBound = false;
function _racerBind(view) {
  if (_racerBound || typeof view.addEventListener !== 'function') return;
  _racerBound = true;
  view.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.id !== 'racerSearchInput') return;
    _racerUi.q = t.value || '';
    var box = document.getElementById('racerSearchResult');
    if (box) box.innerHTML = _racerSearchResultHtml();
  });
  view.addEventListener(
    'error',
    function (e) {
      var t = e.target;
      if (t && t.tagName === 'IMG' && t.dataset) t.dataset.broken = '1';
    },
    true
  );
}

// 戻る: 選手一覧から開いたなら一覧へ、他のページから開いたならそのページへ
function _racerBack() {
  var from = _racerUi.from;
  if (!from || from === 'racer') {
    _renderRacerPage(null);
    try {
      window.scrollTo(0, _racerUi.scroll || 0);
    } catch (_) {}
    return undefined;
  }
  _racerUi.view = 'list';
  if (typeof showPage === 'function') showPage(from);
  return undefined;
}

// 戻るボタンの文言
function _racerBackLabel(from) {
  var sName =
    typeof currentStadium !== 'undefined' && currentStadium && typeof STADIUMS !== 'undefined'
      ? STADIUMS[parseInt(currentStadium, 10)] || ''
      : '';
  if (from === 'detail' && sName && typeof currentRace !== 'undefined' && currentRace)
    return '← ' + sName + ' ' + currentRace + 'R に戻る';
  if (from === 'races' && sName) return '← ' + sName + ' のレース一覧に戻る';
  if (from === 'top') return '← TOP に戻る';
  if (from === 'racer') return '← 選手一覧に戻る';
  return '← 戻る';
}

if (typeof ACTION_HANDLERS === 'object' && ACTION_HANDLERS) {
  ACTION_HANDLERS.racerTab = function (el) {
    _racerUi.tab = el.dataset.argTab || 'fav';
    _renderRacerPage(null);
    if (_racerUi.tab === 'search') {
      try {
        var inp = document.getElementById('racerSearchInput');
        if (inp && typeof inp.focus === 'function') inp.focus();
      } catch (_) {}
    }
  };
  ACTION_HANDLERS.racerSid = function (el) {
    _racerUi.sid = String(el.dataset.argSid || '');
    _renderRacerPage(null);
  };
  ACTION_HANDLERS.racerBack = function () {
    _racerBack();
  };
}

// 選手ページを開いている間は 30 秒ごとに描き直す（「あと N 分」・結果待ち → 着順。TOP の帯と同じ間隔）。
//   データは 90 秒 poll が更新した programData / resultData を読むだけ。
if (typeof setInterval === 'function' && typeof document !== 'undefined') {
  setInterval(function () {
    try {
      if (!document.hidden) _racerRerender();
    } catch (_) {}
  }, 30000);
}

// お気に入りの登録が変わったら件数だけ直す（一覧の行はそのまま: 押し間違いで行が消えないように）
globalThis._onFavRacerChanged = function () {
  try {
    var c = document.getElementById('racerFavCount');
    if (c) c.textContent = '(' + _favRacers().length + ')';
  } catch (_) {}
};

globalThis._renderRacerPage = _renderRacerPage;
globalThis._racerRerender = _racerRerender;
globalThis._racerInfo = _racerInfo;
globalThis._racerSearch = _racerSearch;
globalThis._racerSearchKey = _racerSearchKey;
globalThis._racerRowHtml = _racerRowHtml;
globalThis._racerTodayLine = _racerTodayLine;
globalThis._racerBackLabel = _racerBackLabel;
globalThis._racerProgramBoat = _racerProgramBoat;
globalThis._racerClsChip = _clsChip;
globalThis._racerUi = _racerUi;
globalThis._racerClassOf = _racerClassOf;
globalThis._racerNextSeries = _racerNextSeries;
globalThis._racerNextLine = _racerNextLine;
globalThis._racerMd = _racerMd;
globalThis._racerIsoDay = _racerIsoDay;
globalThis._racerFillNext = _racerFillNext;

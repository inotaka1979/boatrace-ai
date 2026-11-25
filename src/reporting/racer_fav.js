// 2026-11-25: お気に入り選手（rest bundle）
//
// ユーザー要望「選手情報を充実させたい。お気に入り登録して出走情報が見たい」。
//   - 保存: localStorage boatrace_fav_racers = [{id, name, ts}]（選手番号で一意、最大 FAV_RACER_MAX 人）
//   - 本日の出走の索引: programData から 選手番号 → [{sid, rno, boat, closedMs, ...}]
//   - TOP の場一覧の下に「お気に入り選手の出走」（締切前 → 結果待ち → 確定の順）
//   - 場カード / レース一覧 / まもなく締切 に ★
//   - 選手ページ（lazy chunk app-rest-racer）への入口: openRacer と showPage('racer') の受け口
//
// 既存のレース単位の印（boatrace_watched、レース詳細タイトル横）は「注目レース」。選手の ★ とは別物。
//
// REST_ONLY。critical からは typeof guard 付きで呼ぶ（renderStadiums → _renderFavTop、
//   showPage('racer') → _onShowRacerPage）。data-action のハンドラは読込時に ACTION_HANDLERS へ登録する
//   （critical の予算を使わない）。
//
// Public: _favRacers / _favIdSet / _isFavRacer / _toggleFavRacer / _racerTodayIndex / _racerEntryStatus /
//         _favInRace / _favStripHtml / _renderFavTop / _markFavRaceList / _racerDispName / _racerAiMark(Reset) /
//         openRacer / _onShowRacerPage

/* global programData, resultData, predictRace, escText, boatBadge, safeParse, safeSet, showPage, ACTION_HANDLERS,
   currentStadium, _ensureRacerChunk */
'use strict';

var FAV_RACER_KEY = 'boatrace_fav_racers';
var FAV_RACER_MAX = 100;
var FAV_STRIP_MAX = 12; // TOP に並べる行数の上限（超えた分は選手タブへ）
var FAV_STRIP_MARK_MAX = 6; // AI の印を出す行数の上限（predictRace の回数を抑える）
var FAV_SOON_MIN = 60; // 締切までこの分数以内は「あと N 分」

// ─── 保存 ───────────────────────────────────────────────

// 壊れた値・重複・不正な番号は捨てて返す（保存形式の検証はここで行う）
function _favRacers() {
  var raw = typeof safeParse === 'function' ? safeParse(FAV_RACER_KEY, []) : [];
  if (!Array.isArray(raw)) return [];
  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var e = raw[i];
    var id = e && e.id != null ? String(e.id) : '';
    if (!/^\d{1,6}$/.test(id) || seen[id]) continue;
    seen[id] = 1;
    out.push({ id: id, name: typeof e.name === 'string' ? e.name : '', ts: Number(e.ts) || 0 });
  }
  return out;
}

// 選手番号 → 1 の表（一覧の描画で 1 人ずつ localStorage を読まないため）
function _favIdSet() {
  var set = {};
  _favRacers().forEach(function (e) {
    set[e.id] = 1;
  });
  return set;
}

function _isFavRacer(id) {
  return !!_favIdSet()[String(id)];
}

// 登録 / 解除して、新しい状態（true = 登録済み）を返す。上限を超える登録は行わない。
function _toggleFavRacer(id, name) {
  id = String(id == null ? '' : id);
  if (!/^\d{1,6}$/.test(id)) return false;
  var arr = _favRacers();
  var idx = -1;
  for (var i = 0; i < arr.length; i++) if (arr[i].id === id) idx = i;
  var on;
  if (idx >= 0) {
    arr.splice(idx, 1);
    on = false;
  } else {
    if (arr.length >= FAV_RACER_MAX) {
      try {
        alert('お気に入り選手は ' + FAV_RACER_MAX + ' 人までです。不要な選手を外してから登録してください。');
      } catch (_) {}
      return false;
    }
    arr.push({ id: id, name: _racerDispName(name), ts: Date.now() });
    on = true;
  }
  if (typeof safeSet === 'function') safeSet(FAV_RACER_KEY, arr);
  _syncFavUi(id, on);
  return on;
}

// ─── 表示用の小物 ─────────────────────────────────────────

// ファン手帳の選手名は全角空白で 8 文字に揃えてある（先頭 4 文字 = 姓、後ろ 4 文字 = 名）。
//   「峰　　　　竜　太」→「峰 竜太」。出走表の名前（「峰 竜太」）はそのまま。
function _racerDispName(n) {
  var s = String(n == null ? '' : n);
  if (s.length === 8 && s.indexOf('　') >= 0) {
    var fam = s.slice(0, 4).replace(/[\s　]/g, '');
    var giv = s.slice(4).replace(/[\s　]/g, '');
    return giv ? fam + ' ' + giv : fam;
  }
  return s.replace(/[\s　]+/g, ' ').trim();
}

// race_closed_at は JST 壁時計 "YYYY-MM-DD HH:MM(:SS)" → UTC ms
function _favClosedMs(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]) : null;
}

// ─── 本日の出走 ───────────────────────────────────────────

// 選手番号 → その日の出走（レース番号順）。programData の全場を 1 回なめるだけ（最大 24 場 × 12R × 6 艇）。
function _racerTodayIndex() {
  var idx = {};
  if (typeof programData === 'undefined' || !programData) return idx;
  for (var sid in programData) {
    var st = programData[sid];
    for (var rno in st) {
      var race = st[rno];
      if (!race || !Array.isArray(race.boats)) continue;
      var ms = _favClosedMs(race.race_closed_at);
      var hm = race.race_closed_at ? (String(race.race_closed_at).split(' ')[1] || '').slice(0, 5) : '';
      for (var i = 0; i < race.boats.length; i++) {
        var b = race.boats[i];
        if (!b || !b.racer_number || !b.racer_boat_number) continue;
        var id = String(b.racer_number);
        (idx[id] || (idx[id] = [])).push({
          id: id,
          sid: parseInt(sid, 10),
          rno: parseInt(rno, 10),
          boat: b.racer_boat_number,
          closedMs: ms,
          hm: hm,
          name: b.racer_name || '',
          cls: b.racer_class_number || 0,
        });
      }
    }
  }
  for (var k in idx)
    idx[k].sort(function (a, b) {
      return a.rno - b.rno;
    });
  return idx;
}

// 1 走の状態: open（締切前）/ wait（締切後・結果待ち）/ done（確定）/ cancel（中止）
function _racerEntryStatus(e, now) {
  var t = now || Date.now();
  var res = typeof resultData !== 'undefined' && resultData && resultData[e.sid] ? resultData[e.sid][e.rno] : null;
  if (res && res.isCancelled) return { kind: 'cancel', text: '中止' };
  if (res && res.isFinished) {
    var rr = (res.results || []).filter(function (x) {
      return x && x.racer_boat_number === e.boat;
    })[0];
    var p = rr && rr.place >= 1 && rr.place <= 6 ? rr.place : null;
    // 着順が付かない（失格・欠場・フライングなど）も「確定」
    return { kind: 'done', place: p, text: p ? p + '着' : '着順なし' };
  }
  var rc = globalThis._raceCancelled;
  if (typeof rc === 'function' && rc(e.sid, e.rno)) return { kind: 'cancel', text: '中止' };
  if (e.closedMs == null) return { kind: 'open', mins: null, text: '' };
  var mins = Math.floor((e.closedMs - t) / 60000);
  if (mins < 0) return { kind: 'wait', text: '結果待ち' };
  return { kind: 'open', mins: mins, text: mins <= FAV_SOON_MIN ? 'あと ' + mins + ' 分' : '' };
}

// このレースにお気に入り選手が出るか（まもなく締切の帯が使う）
function _favInRace(sid, rno) {
  var race = typeof programData !== 'undefined' && programData && programData[sid] ? programData[sid][rno] : null;
  if (!race || !Array.isArray(race.boats)) return false;
  var fav = _favIdSet();
  return race.boats.some(function (b) {
    return b && fav[String(b.racer_number)];
  });
}

// AI の印と 1 着確率（締切前のレースだけ）。predictRace は重いので、1 回の描画の中では同じレースを
//   計算し直さない。描画をまたいでは使い回さない（展示・オッズ・選手 DB が届くと予想が変わるため。
//   起動直後の描画は選手 DB の到着前で、その結果を残すと古い印が出続ける）。
var _favMarkMemo = {};
function _racerAiMarkReset() {
  _favMarkMemo = {};
}
function _racerAiMark(sid, rno, boat) {
  var key = sid + '_' + rno;
  var marks = _favMarkMemo[key];
  if (marks === undefined) {
    marks = null;
    try {
      var p = typeof predictRace === 'function' ? predictRace(sid, rno) : null;
      marks = p && Array.isArray(p.marks) ? p.marks : null;
    } catch (_) {
      marks = null;
    }
    _favMarkMemo[key] = marks;
  }
  if (!marks) return null;
  for (var i = 0; i < marks.length; i++) {
    if (marks[i] && marks[i].boat === boat) return { mark: marks[i].mark || '', prob: marks[i].prob };
  }
  return null;
}

// ─── TOP: お気に入り選手の出走 ────────────────────────────────

var _FAV_KIND_ORDER = { open: 0, wait: 1, done: 2, cancel: 2 };

// お気に入り選手の本日の出走を「締切前（近い順）→ 結果待ち → 確定（新しい順）」で返す
function _favEntriesToday(now) {
  var idx = _racerTodayIndex();
  var rows = [];
  var racers = 0;
  _favRacers().forEach(function (f) {
    var es = idx[f.id];
    if (!es) return;
    racers++;
    es.forEach(function (e) {
      rows.push({ e: e, st: _racerEntryStatus(e, now) });
    });
  });
  rows.sort(function (a, b) {
    var ga = _FAV_KIND_ORDER[a.st.kind];
    var gb = _FAV_KIND_ORDER[b.st.kind];
    if (ga !== gb) return ga - gb;
    var d = (a.e.closedMs || 0) - (b.e.closedMs || 0);
    return (ga === 2 ? -d : d) || a.e.sid - b.e.sid || a.e.boat - b.e.boat;
  });
  return { rows: rows, racers: racers };
}

function _favRowHtml(r, withMark) {
  var e = r.e;
  var st = r.st;
  var name = (typeof STADIUMS !== 'undefined' && STADIUMS[e.sid]) || '場' + e.sid;
  var ai = '';
  if (withMark && st.kind === 'open') {
    var mk = _racerAiMark(e.sid, e.rno, e.boat);
    if (mk && mk.mark)
      ai =
        ' <span class="fav-note">' +
        escText(mk.mark) +
        (typeof mk.prob === 'number' ? ' ' + Math.round(mk.prob * 100) + '%' : '') +
        '</span>';
  }
  var cls = 'fav-st';
  if (st.kind === 'done' && st.place && st.place <= 3) cls += ' res-' + st.place;
  else if (st.kind === 'open' && st.mins != null && st.mins <= 5) cls += ' soon-urgent';
  else if (st.kind === 'cancel') cls += ' c-danger';
  return (
    '<div class="fav-row' +
    (st.kind === 'open' ? '' : ' done') +
    '" role="button" tabindex="0" data-action="openRace" data-arg-sid="' +
    e.sid +
    '" data-arg-rn="' +
    e.rno +
    '"><span class="fav-time">' +
    escText(e.hm) +
    '</span><span>' +
    escText(name) +
    ' <b>' +
    e.rno +
    'R</b></span><span class="fav-who">' +
    (typeof boatBadge === 'function' ? boatBadge(e.boat) : e.boat) +
    ' <span class="fav-nm">' +
    escText(_racerDispName(e.name)) +
    '</span>' +
    ai +
    '</span><span class="' +
    cls +
    '">' +
    escText(st.text) +
    '</span></div>'
  );
}

// 帯の HTML（置き場が無い・番組表が未取得なら null = 何も書き換えない）
function _favStripHtml(now) {
  if (typeof programData === 'undefined' || !programData) return null;
  var favs = _favRacers();
  var more = '<span class="fav-more" role="button" tabindex="0" data-action="showPage" data-arg-page="racer">';
  if (!favs.length) {
    return (
      '<div class="fav-strip fav-empty" role="region" aria-label="お気に入り選手の出走">' +
      '<span><span class="fav-mark">★</span> お気に入り選手を登録すると、本日の出走がここに出ます。</span>' +
      more +
      '選手を探す ›</span></div>'
    );
  }
  var t = _favEntriesToday(now);
  _racerAiMarkReset();
  if (!t.rows.length) {
    return (
      '<div class="fav-strip fav-empty" role="region" aria-label="お気に入り選手の出走">' +
      '<span><span class="fav-mark">★</span> お気に入り選手（' +
      favs.length +
      ' 人）の本日の出走はありません。</span>' +
      more +
      '選手一覧 ›</span></div>'
    );
  }
  var html =
    '<div class="fav-strip" role="region" aria-label="お気に入り選手の出走"><div class="fav-title"><span>' +
    '<span class="fav-mark">★</span> お気に入り選手の出走（本日 ' +
    t.racers +
    ' 人・' +
    t.rows.length +
    ' 走）</span>' +
    more +
    '選手一覧 ›</span></div>';
  var shown = t.rows.slice(0, FAV_STRIP_MAX);
  var marks = 0;
  shown.forEach(function (r) {
    var withMark = r.st.kind === 'open' && marks < FAV_STRIP_MARK_MAX;
    if (withMark) marks++;
    html += _favRowHtml(r, withMark);
  });
  if (t.rows.length > shown.length) {
    html +=
      '<div class="fav-row fav-rest" role="button" tabindex="0" data-action="showPage" data-arg-page="racer">' +
      '<span class="fav-note">ほか ' +
      (t.rows.length - shown.length) +
      ' 走を見る ›</span></div>';
  }
  return html + '</div>';
}

// 開催中の場カードに ★（その場にお気に入り選手が出る日）。疑似要素で出すので高さは変わらない。
function _markFavStadiums() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  var idx = _racerTodayIndex();
  var sids = {};
  _favRacers().forEach(function (f) {
    (idx[f.id] || []).forEach(function (e) {
      sids[e.sid] = 1;
    });
  });
  var cards = document.querySelectorAll('#stadiumList .stadium-card');
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var sid = c.getAttribute ? c.getAttribute('data-sid') : null;
    if (c.classList) c.classList.toggle('has-fav', !!(sid && sids[sid]));
  }
}

// TOP の描画（renderStadiums の最後・30 秒ごと・登録の変更時）
function _renderFavTop(now) {
  if (typeof document === 'undefined') return;
  var el = document.getElementById('favStrip');
  if (el) {
    var html = _favStripHtml(now);
    if (html != null) el.innerHTML = html;
  }
  _markFavStadiums();
}

// レース一覧（AI 予想ビュー）の選手名に ★。行は [R, 1〜6 号艇] の順（欠場は '-' の td）なので位置で引く。
function _markFavRaceList(sid) {
  if (typeof document === 'undefined') return;
  var list = document.getElementById('racesList');
  var st = typeof programData !== 'undefined' && programData ? programData[sid] : null;
  if (!list || !st || typeof list.querySelectorAll !== 'function') return;
  var fav = _favIdSet();
  var rows = list.querySelectorAll('tr[data-arg-rn]');
  for (var i = 0; i < rows.length; i++) {
    var race = st[rows[i].getAttribute('data-arg-rn')];
    var tds = rows[i].children || [];
    if (!race || !Array.isArray(race.boats)) continue;
    for (var j = 0; j < race.boats.length; j++) {
      var b = race.boats[j];
      var td = b ? tds[b.racer_boat_number] : null;
      if (td && td.classList && td.classList.contains('racer-cell')) {
        td.classList.toggle('fav-racer', !!fav[String(b.racer_number)]);
      }
    }
  }
}

// 登録の変更を、いま画面に出ているボタン・印・帯に反映する
function _syncFavUi(id, on) {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  try {
    var btns = document.querySelectorAll('[data-fav-id="' + id + '"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.classList) b.classList.toggle('on', on);
      if (b.setAttribute) b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent =
        b.getAttribute && b.getAttribute('data-fav-style') === 'full'
          ? on
            ? '★ 登録済み'
            : '☆ お気に入りに登録'
          : on
            ? '★'
            : '☆';
    }
    var marks = document.querySelectorAll('[data-fav-mark="' + id + '"]');
    for (var k = 0; k < marks.length; k++) marks[k].hidden = !on;
    _renderFavTop();
    if (typeof currentStadium !== 'undefined' && currentStadium) _markFavRaceList(currentStadium);
    var hook = globalThis._onFavRacerChanged;
    if (typeof hook === 'function') hook(id, on);
  } catch (_) {}
}

// お気に入りボタンの HTML（full = 「★ 登録済み / ☆ お気に入りに登録」、既定は ★ / ☆ だけ）
function _favBtnHtml(id, name, full, on) {
  if (on == null) on = _isFavRacer(id);
  return (
    '<button type="button" class="fav-btn' +
    (on ? ' on' : '') +
    (full ? '' : ' fav-btn-s') +
    '" data-action="toggleFavRacer" data-arg-id="' +
    escText(id) +
    '" data-arg-name="' +
    escText(_racerDispName(name)) +
    '" data-fav-id="' +
    escText(id) +
    '"' +
    (full ? ' data-fav-style="full"' : '') +
    ' aria-pressed="' +
    (on ? 'true' : 'false') +
    '" aria-label="お気に入り選手に登録・解除">' +
    (full ? (on ? '★ 登録済み' : '☆ お気に入りに登録') : on ? '★' : '☆') +
    '</button>'
  );
}

// ─── 選手ページへの入口 ─────────────────────────────────────

var _racerNext = null; // showPage('racer') の直後に開く選手（無ければ一覧）

function _activePageKey() {
  try {
    var p = document.querySelector('.page.active');
    var id = p && p.id ? String(p.id) : '';
    return id.indexOf('page') === 0 ? id.charAt(4).toLowerCase() + id.slice(5) : 'top';
  } catch (_) {
    return 'top';
  }
}

// 選手詳細を開く。from を省くと、いま表示中のページへ「戻る」で帰る。
function openRacer(id, from) {
  if (id == null || id === '') return;
  _racerNext = { id: String(id), from: from || _activePageKey() };
  if (typeof showPage === 'function') showPage('racer');
}

// showPage('racer') の受け口（page_router.js）。選手ページの chunk を読み込んでから描く。
function _onShowRacerPage() {
  var next = _racerNext;
  _racerNext = null;
  var render = function () {
    var f = globalThis._renderRacerPage;
    if (typeof f === 'function') f(next);
  };
  if (typeof globalThis._renderRacerPage === 'function') return render();
  var view = typeof document !== 'undefined' ? document.getElementById('racerView') : null;
  if (view && !view.innerHTML) view.innerHTML = '<div class="card">読込中...</div>';
  if (typeof _ensureRacerChunk !== 'function') return undefined;
  return _ensureRacerChunk().then(render, function (err) {
    if (view)
      view.innerHTML =
        '<div class="card">選手ページの読込に失敗しました。通信状況を確認して、下の「選手」をもう一度押してください。</div>';
    try {
      reportError({ type: 'chunk-load', msg: String(err) });
    } catch (_) {}
  });
}

// data-action のハンドラ（critical の ACTION_HANDLERS に後から足す）
if (typeof ACTION_HANDLERS === 'object' && ACTION_HANDLERS) {
  ACTION_HANDLERS.openRacer = function (el) {
    openRacer(el.dataset.argId, el.dataset.argFrom);
  };
  // 「選手を開く」行の中に置いた ★ でも、delegation は内側の data-action だけを実行する（行は開かない）
  ACTION_HANDLERS.toggleFavRacer = function (el) {
    _toggleFavRacer(el.dataset.argId, el.dataset.argName);
  };
}

// TOP 表示中は 30 秒ごとに「あと N 分」を進める（まもなく締切の帯と同じ間隔）
if (typeof setInterval === 'function' && typeof document !== 'undefined') {
  setInterval(function () {
    try {
      var top = document.getElementById('pageTop');
      if (top && top.classList && top.classList.contains('active') && !document.hidden) _renderFavTop();
    } catch (_) {}
  }, 30000);
}

globalThis._favRacers = _favRacers;
globalThis._favIdSet = _favIdSet;
globalThis._isFavRacer = _isFavRacer;
globalThis._toggleFavRacer = _toggleFavRacer;
globalThis._racerTodayIndex = _racerTodayIndex;
globalThis._racerEntryStatus = _racerEntryStatus;
globalThis._favInRace = _favInRace;
globalThis._favEntriesToday = _favEntriesToday;
globalThis._favStripHtml = _favStripHtml;
globalThis._renderFavTop = _renderFavTop;
globalThis._markFavRaceList = _markFavRaceList;
globalThis._racerDispName = _racerDispName;
globalThis._racerAiMark = _racerAiMark;
globalThis._racerAiMarkReset = _racerAiMarkReset;
globalThis._favBtnHtml = _favBtnHtml;
globalThis.openRacer = openRacer;
globalThis._onShowRacerPage = _onShowRacerPage;
// rest bundle はデータ読込後に届くことがある（renderStadiums が先に走ると帯が出ないまま）ため、読込時にも 1 回描く。
//   rest の読込前に下メニュー「選手」が押されていた場合は、ここで選手ページを描く。
try {
  if (typeof programData !== 'undefined' && programData) _renderFavTop();
  var _pr = typeof document !== 'undefined' ? document.getElementById('pageRacer') : null;
  if (_pr && _pr.classList && _pr.classList.contains('active')) _onShowRacerPage();
} catch (_) {}

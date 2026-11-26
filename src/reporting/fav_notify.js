// 2026-11-26（選手機能 第 3 段階 C）: お気に入り選手の締切前通知（アプリを開いている間）。
//   お気に入り選手の出るレースが締切 N 分前になったら、画面の下に知らせる（押すとそのレースを開く）。
//   設定の「許可リクエスト」で端末の通知を許可していれば、端末の通知も出す。
//
//   - アプリを開いている間だけ。閉じている・止められている間（iPhone は裏に回ると数秒で止まる）は通知できない。
//     閉じている間も届く通知（Web Push）は、送る側のサーバが要る別の仕組み。
//   - 1 レースにつき 1 回（その日のうちに知らせたレースは localStorage に覚える。開き直しても重ねて出さない）。
//   - 画面が見えていない間（別のタブ・別のアプリ）は、端末の通知を出せるときだけ知らせる。出せないときは
//     覚えずに待ち、画面に戻った時に（まだ締切前なら）知らせる。見えない画面に出して 1 回を使い切らない。
//   - 設定「お気に入り選手の締切前通知」: 通知しない / 3 / 5 / 10 / 15 分前（既定 5 分前）。
//   - rest bundle。起動時の bundle からは呼ばれない。
//
// Public: _favNotifyMin / _favNotifyDue / _favNotifyTick / _syncFavNotifyUi / _hideFavToast / _favOnSwMessage /
//         _favOnVisibility (globalThis)

/* global settings, safeParse, safeSet, escText, boatBadge, ACTION_HANDLERS, programData, _favEntriesToday,
   _racerDispName, _pushIsOn, currentStadium, currentRace */
'use strict';

var FAV_NOTIFY_CHOICES = [0, 3, 5, 10, 15];
var FAV_NOTIFY_DEFAULT = 5;
var FAV_NOTIFIED_KEY = 'boatrace_fav_notified'; // { d: 'YYYYMMDD', k: ['8_6', …] }
var FAV_NOTIFY_TICK_MS = 20000;
var FAV_TOAST_MS = 15000;
var FAV_TOAST_ROWS = 3;
var _favToastTimer = null;

// 設定値（分）。0 = 通知しない。未設定・不正な値は既定の 5 分
function _favNotifyMin() {
  var v = typeof settings !== 'undefined' && settings ? settings.favNotifyMin : undefined;
  var n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
  return FAV_NOTIFY_CHOICES.indexOf(n) >= 0 ? n : FAV_NOTIFY_DEFAULT;
}

function _favNotifyYmd(now) {
  var d = new Date((now || Date.now()) + 9 * 3600000);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return String(d.getUTCFullYear()) + (m < 10 ? '0' : '') + m + (day < 10 ? '0' : '') + day;
}

// 今日すでに知らせたレース（'場_R' → true）。日付が変わっていたら空
function _favNotifiedSet(now) {
  var s = typeof safeParse === 'function' ? safeParse(FAV_NOTIFIED_KEY, null) : null;
  var out = {};
  if (s && s.d === _favNotifyYmd(now) && Array.isArray(s.k)) {
    s.k.forEach(function (k) {
      if (typeof k === 'string') out[k] = true;
    });
  }
  return out;
}

// いま知らせるレース: 締切まで 0〜N 分・未確定・まだ知らせていない。締切の近い順。
//   [{ sid, rno, mins, hm, who: [{ name, boat }] }]
function _favNotifyDue(now) {
  var lead = _favNotifyMin();
  if (!lead || typeof _favEntriesToday !== 'function') return [];
  if (typeof programData === 'undefined' || !programData) return [];
  var done = _favNotifiedSet(now);
  var by = {};
  var order = [];
  _favEntriesToday(now).rows.forEach(function (r) {
    var st = r.st;
    var e = r.e;
    if (st.kind !== 'open' || st.mins == null || st.mins < 0 || st.mins > lead) return;
    var key = e.sid + '_' + e.rno;
    if (done[key]) return;
    if (!by[key]) {
      by[key] = { sid: e.sid, rno: e.rno, mins: st.mins, hm: e.hm, closedMs: e.closedMs, who: [] };
      order.push(key);
    }
    by[key].who.push({ name: e.name, boat: e.boat });
  });
  return order
    .map(function (k) {
      return by[k];
    })
    .sort(function (a, b) {
      return (a.closedMs || 0) - (b.closedMs || 0) || a.sid - b.sid || a.rno - b.rno;
    });
}

function _favNotifyMark(list, now) {
  if (typeof safeSet !== 'function') return;
  var done = _favNotifiedSet(now);
  list.forEach(function (x) {
    done[x.sid + '_' + x.rno] = true;
  });
  safeSet(FAV_NOTIFIED_KEY, { d: _favNotifyYmd(now), k: Object.keys(done) });
}

function _favStadiumName(sid) {
  return (typeof STADIUMS !== 'undefined' && STADIUMS[sid]) || '場' + sid;
}

// ─── 画面の中の通知 ────────────────────────────────────────
function _favToastHtml(list) {
  var rows = '';
  list.slice(0, FAV_TOAST_ROWS).forEach(function (x) {
    rows +=
      '<div class="fav-toast-row" role="button" tabindex="0" data-action="favToastOpen" data-arg-sid="' +
      x.sid +
      '" data-arg-rn="' +
      x.rno +
      '"><span class="fav-toast-when">あと ' +
      x.mins +
      ' 分</span><span><b>' +
      escText(_favStadiumName(x.sid)) +
      ' ' +
      x.rno +
      'R</b></span><span class="fav-toast-who">' +
      x.who
        .map(function (w) {
          return (
            (typeof boatBadge === 'function' ? boatBadge(w.boat) : w.boat) +
            ' ' +
            escText(typeof _racerDispName === 'function' ? _racerDispName(w.name) : w.name)
          );
        })
        .join(' ') +
      '</span></div>';
  });
  if (list.length > FAV_TOAST_ROWS) {
    rows +=
      '<div class="fav-toast-more">ほか ' + (list.length - FAV_TOAST_ROWS) + ' レース（TOP のお気に入り欄）</div>';
  }
  return (
    '<div class="fav-toast-h"><span>★ お気に入り選手 まもなく締切</span>' +
    '<button type="button" class="fav-toast-x" data-action="favToastClose" aria-label="閉じる">×</button></div>' +
    rows
  );
}

function _hideFavToast() {
  if (_favToastTimer) {
    clearTimeout(_favToastTimer);
    _favToastTimer = null;
  }
  if (typeof document === 'undefined') return;
  var el = document.getElementById('favToast');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function _showFavToast(list) {
  if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return false;
  _hideFavToast();
  var el = document.createElement('div');
  el.id = 'favToast';
  el.className = 'fav-toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = _favToastHtml(list);
  document.body.appendChild(el);
  if (typeof setTimeout === 'function') _favToastTimer = setTimeout(_hideFavToast, FAV_TOAST_MS);
  return true;
}

// ─── 端末の通知（許可済みのときだけ）─────────────────────────────
//   iOS / Android は service worker 経由でないと出せないので、まず registration.showNotification を使う。
function _favCanSystemNotify() {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch (_) {
    return false;
  }
}

function _favSystemNotify(list) {
  try {
    if (!_favCanSystemNotify()) return false;
    var x = list[0];
    var title = 'まもなく締切 ' + _favStadiumName(x.sid) + ' ' + x.rno + 'R（あと ' + x.mins + ' 分）';
    var body =
      x.who
        .map(function (w) {
          return w.boat + '号艇 ' + (typeof _racerDispName === 'function' ? _racerDispName(w.name) : w.name);
        })
        .join('、') + (list.length > 1 ? ' ほか ' + (list.length - 1) + ' レース' : '');
    var opt = {
      body: body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'boatrace-fav-' + x.sid + '-' + x.rno,
      data: { sid: x.sid, rno: x.rno },
    };
    var sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
    if (sw && sw.ready && typeof sw.ready.then === 'function') {
      sw.ready
        .then(function (reg) {
          return reg.showNotification(title, opt);
        })
        .catch(function () {});
    } else {
      new Notification(title, opt);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function _favPageHidden() {
  return typeof document !== 'undefined' && !!document && document.visibilityState === 'hidden';
}

// 20 秒ごと（と読込直後・画面に戻った時）に呼ぶ。知らせたレース数を返す
function _favNotifyTick(now) {
  // 画面が見えていなくて端末の通知も出せないなら、覚えずに待つ（戻った時に知らせる）
  if (_favPageHidden() && !_favCanSystemNotify()) return 0;
  var due;
  try {
    due = _favNotifyDue(now);
  } catch (_) {
    return 0;
  }
  if (!due.length) return 0;
  _favNotifyMark(due, now); // 先に覚える（表示で失敗しても、20 秒ごとに出し直さない）
  // 画面の通知と端末の通知は別々に試す（片方の失敗でもう片方を止めない）
  try {
    _showFavToast(due);
  } catch (_) {}
  // 「閉じている間も通知」(Web Push) が有効なら、端末の通知は Worker から届く（ここでも出すと 2 通になる）
  if (!(typeof _pushIsOn === 'function' && _pushIsOn())) _favSystemNotify(due);
  return due.length;
}

// 設定画面の選択を保存値に合わせる（loadSettings から）
function _syncFavNotifyUi() {
  if (typeof document === 'undefined') return;
  var el = document.getElementById('setFavNotify');
  if (el) el.value = String(_favNotifyMin());
}

if (typeof ACTION_HANDLERS === 'object' && ACTION_HANDLERS) {
  ACTION_HANDLERS.favToastClose = function () {
    _hideFavToast();
  };
  // 行を押す → 通知を閉じてそのレースを開く
  ACTION_HANDLERS.favToastOpen = function (el) {
    _hideFavToast();
    if (typeof ACTION_HANDLERS.openRace === 'function') ACTION_HANDLERS.openRace(el);
  };
}

if (typeof setInterval === 'function' && typeof document !== 'undefined') {
  setInterval(function () {
    _favNotifyTick();
  }, FAV_NOTIFY_TICK_MS);
  // 読込直後にも 1 回（番組表が届いていれば、開いた時点で締切が近いレースを知らせる）
  if (typeof setTimeout === 'function') {
    setTimeout(function () {
      _favNotifyTick();
    }, 3000);
  }
}
// 画面の表示が切り替わった時: すぐに 1 回確かめる（裏にいた間は時計が止まる。戻った時に、待たせていた分を知らせる）
function _favOnVisibility() {
  return _favNotifyTick();
}
try {
  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', _favOnVisibility);
  }
} catch (_) {}

// 端末の通知を押した時: service worker が開いているアプリに知らせてくる（sw.js の notificationclick）
function _favOnSwMessage(ev) {
  var d = ev && ev.data;
  if (!d || d.type !== 'OPEN_RACE') return false;
  var sid = Number(d.sid);
  var rno = Number(d.rno);
  if (!Number.isInteger(sid) || !Number.isInteger(rno) || sid < 1 || sid > 24 || rno < 1 || rno > 12) return false;
  _hideFavToast();
  if (typeof ACTION_HANDLERS !== 'object' || !ACTION_HANDLERS || typeof ACTION_HANDLERS.openRace !== 'function') {
    return false;
  }
  ACTION_HANDLERS.openRace({ dataset: { argSid: String(sid), argRn: String(rno) } });
  return true;
}
try {
  if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener('message', _favOnSwMessage);
  }
} catch (_) {}

// ─── 通知から開いた時（アプリが閉じていた場合）────────────────────────
//   sw.js は、開いているアプリが無ければ ./?race=<場>-<R> で開く。起動後にそのレースを表示する。
function _favRaceFromSearch(search) {
  var m = /[?&]race=(\d{1,2})-(\d{1,2})(?:&|$)/.exec(String(search || ''));
  if (!m) return null;
  var sid = parseInt(m[1], 10);
  var rno = parseInt(m[2], 10);
  return sid >= 1 && sid <= 24 && rno >= 1 && rno <= 12 ? { sid: sid, rno: rno } : null;
}

function _favRaceShown(t) {
  try {
    var pg = document.querySelector('.page.active');
    return (
      !!pg &&
      pg.id === 'pageDetail' &&
      typeof currentStadium !== 'undefined' &&
      typeof currentRace !== 'undefined' &&
      Number(currentStadium) === t.sid &&
      Number(currentRace) === t.rno
    );
  } catch (_) {
    return false;
  }
}

function _favOpenFromUrl() {
  var t = null;
  try {
    t = _favRaceFromSearch(location.search);
  } catch (_) {
    t = null;
  }
  if (!t) return null;
  // 起動時のページ復元 (_restoreNavState) が、このレースを開くようにしておく
  try {
    sessionStorage.setItem('boatrace_nav', JSON.stringify({ page: 'detail', sid: t.sid, rn: t.rno, ts: Date.now() }));
  } catch (_) {}
  // 読み直しで同じレースを開き直さないよう、URL から外す
  try {
    history.replaceState(null, '', location.pathname + location.hash);
  } catch (_) {}
  // 復元が先に済んでいた場合（rest の読込が遅かった）の備え: 番組表が届いたら自分で開く
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var ready = typeof programData !== 'undefined' && programData && programData[t.sid] && programData[t.sid][t.rno];
    if (!ready && tries < 60) return;
    clearInterval(timer);
    if (!ready) return;
    setTimeout(function () {
      if (_favRaceShown(t)) return;
      _favOnSwMessage({ data: { type: 'OPEN_RACE', sid: t.sid, rno: t.rno } });
    }, 700);
  }, 500);
  return t;
}
try {
  if (typeof location !== 'undefined' && typeof document !== 'undefined' && typeof setInterval === 'function')
    _favOpenFromUrl();
} catch (_) {}

globalThis._favRaceFromSearch = _favRaceFromSearch;
globalThis._favOpenFromUrl = _favOpenFromUrl;
globalThis._favNotifyMin = _favNotifyMin;
globalThis._favNotifyDue = _favNotifyDue;
globalThis._favNotifyTick = _favNotifyTick;
globalThis._syncFavNotifyUi = _syncFavNotifyUi;
globalThis._showFavToast = _showFavToast;
globalThis._hideFavToast = _hideFavToast;
globalThis._favSystemNotify = _favSystemNotify;
globalThis._favOnSwMessage = _favOnSwMessage;
globalThis._favOnVisibility = _favOnVisibility;
globalThis._favToastHtml = _favToastHtml;

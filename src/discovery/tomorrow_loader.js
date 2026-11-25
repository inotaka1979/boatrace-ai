// 2026-11-26（選手機能 第 3 段階 B）: 翌日の出走（data/schedule/tomorrow.json）の取得。
//   Discovery 層（network IO はここだけ）。TOP の「お気に入り選手の出走」と選手ページが使うので rest bundle に置く。
//
//   scripts/scrape_tomorrow.py が、公式の場別レース一覧（1 場 1 ページ）から前日の 15 時以降に作る:
//     {"date": "20261127", "pending": [場番号…], "stadiums": {"8": {"label": "4日目",
//        "races": [{"r": 1, "t": "10:27", "b": [[枠, 登録番号, "名前", 級], …]}, …]}}}
//   翌日分の公開は前日の午後〜夜。それまでは pending（未公開の場）に入っている。
//
//   - 15 時 (JST) より前は取りに行かない（まだ作られていない）。
//   - 10 分は取り直さない。失敗は 3 分。取り直しの失敗で前の内容を捨てない。
//   - 日付が「明日」でない内容は使わない（日付が変わった後の古いファイル）。
//
// Public: _loadTomorrow / _tomorrowYmd / _tomorrowEntriesOf / _tomorrowInfo (globalThis)

'use strict';

var TOMORROW_FROM_HOUR = 15;
var TOMORROW_TTL_MS = 10 * 60000;
var TOMORROW_RETRY_MS = 3 * 60000;
var TOMORROW_TIMEOUT_MS = 10000;
var _tomorrow = { at: 0, data: null, loading: false, failed: false, idx: null, idxOf: null };

function _tmJst(now, addDays) {
  return new Date((now || Date.now()) + 9 * 3600000 + (addDays || 0) * 86400000);
}
// 明日 (JST) の日付 'YYYYMMDD'
function _tomorrowYmd(now) {
  var d = _tmJst(now, 1);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return String(d.getUTCFullYear()) + (m < 10 ? '0' : '') + m + (day < 10 ? '0' : '') + day;
}
function _tmInt(v, lo, hi) {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

// 取れていて、日付が「明日」のものだけ
function _tomorrowData(now) {
  var d = _tomorrow.data;
  return d && d.date === _tomorrowYmd(now) ? d : null;
}

// 登録番号 → [{sid, rno, hm, boat, name, cls, label}]（締切の早い順）。形の合わない行は入れない
function _tomorrowIndex(now) {
  var d = _tomorrowData(now);
  if (!d) return null;
  if (_tomorrow.idxOf === d) return _tomorrow.idx;
  var idx = {};
  var st = d.stadiums && typeof d.stadiums === 'object' && !Array.isArray(d.stadiums) ? d.stadiums : {};
  Object.keys(st).forEach(function (k) {
    var sid = Number(k);
    var s = st[k];
    if (!_tmInt(sid, 1, 24) || !s || !Array.isArray(s.races)) return;
    var label = typeof s.label === 'string' ? s.label.slice(0, 8) : '';
    s.races.forEach(function (r) {
      if (!r || !_tmInt(r.r, 1, 12) || !Array.isArray(r.b)) return;
      var hm = typeof r.t === 'string' && /^\d{2}:\d{2}$/.test(r.t) ? r.t : '';
      r.b.forEach(function (b) {
        if (!Array.isArray(b) || !_tmInt(b[0], 1, 6) || !_tmInt(b[1], 1000, 99999)) return;
        var key = String(b[1]);
        if (!Object.prototype.hasOwnProperty.call(idx, key)) idx[key] = [];
        idx[key].push({
          sid: sid,
          rno: r.r,
          hm: hm,
          boat: b[0],
          name: typeof b[2] === 'string' ? b[2].slice(0, 20) : '',
          cls: _tmInt(b[3], 1, 4) ? b[3] : 0,
          label: label,
        });
      });
    });
  });
  Object.keys(idx).forEach(function (k) {
    idx[k].sort(function (a, b) {
      return (a.hm || '99:99').localeCompare(b.hm || '99:99') || a.sid - b.sid || a.rno - b.rno;
    });
  });
  _tomorrow.idx = idx;
  _tomorrow.idxOf = d;
  return idx;
}

// その選手の明日の出走。null = まだ分からない（未取得・15 時前・日付違い）、[] = 出走なし（公開済みの場の中では）
function _tomorrowEntriesOf(id, now) {
  var idx = _tomorrowIndex(now);
  if (!idx) return null;
  var key = String(id);
  return Object.prototype.hasOwnProperty.call(idx, key) ? idx[key] : [];
}

// 明日のデータの概要。null = まだ無い。pending = 出走表が未公開の場の数
function _tomorrowInfo(now) {
  var d = _tomorrowData(now);
  if (!d) return null;
  var st = d.stadiums && typeof d.stadiums === 'object' && !Array.isArray(d.stadiums) ? d.stadiums : {};
  return { date: d.date, stadiums: Object.keys(st).length, pending: Array.isArray(d.pending) ? d.pending.length : 0 };
}

// 取りに行った（true）/ 行く必要が無い・行けない（false）。終わったら onLoaded()。
function _loadTomorrow(onLoaded, now) {
  var t = now || Date.now();
  if (typeof fetch !== 'function' || _tomorrow.loading) return false;
  if (_tmJst(t, 0).getUTCHours() < TOMORROW_FROM_HOUR) return false;
  if (_tomorrow.at) {
    var age = t - _tomorrow.at;
    if (age >= 0 && age < (_tomorrow.failed ? TOMORROW_RETRY_MS : TOMORROW_TTL_MS)) return false;
  }
  _tomorrow.loading = true;
  _tomorrow.at = t;
  var opt = { cache: 'no-cache' };
  try {
    if (typeof capabilities !== 'undefined' && capabilities && typeof capabilities.makeTimeoutSignal === 'function') {
      opt.signal = capabilities.makeTimeoutSignal(TOMORROW_TIMEOUT_MS);
    }
  } catch (_) {}
  var done = function (j) {
    var ok = !!(j && typeof j === 'object' && typeof j.date === 'string' && /^\d{8}$/.test(j.date));
    _tomorrow.loading = false;
    _tomorrow.failed = !ok;
    _tomorrow.at = Date.now();
    if (ok) _tomorrow.data = j; // 失敗時は前の内容を残す
    if (typeof onLoaded === 'function') onLoaded();
  };
  fetch('data/schedule/tomorrow.json', opt)
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(done, function () {
      done(null);
    });
  return true;
}

globalThis._loadTomorrow = _loadTomorrow;
globalThis._tomorrowYmd = _tomorrowYmd;
globalThis._tomorrowEntriesOf = _tomorrowEntriesOf;
globalThis._tomorrowInfo = _tomorrowInfo;
globalThis._tomorrow = _tomorrow;

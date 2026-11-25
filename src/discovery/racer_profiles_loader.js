// 2026-11-25: 選手プロフィール（data/db/racerDB.json の元の形: 名前・かな・支部・級・コース別成績 …）の取得。
//   Discovery 層（network IO はここだけ）。選手ページの lazy chunk (app-rest-racer) に同梱。
//
//   予測用の racerDB（app.js）は起動時に同じファイルを読むが、予測に使う項目しか残さない
//   （かな・支部・年齢・体重・期別勝率・コース別の着順分布は捨てる）。loadDeferredData がそのとき
//   元の形を globalThis._racerProfiles に残すので、通常ここからは取りに行かない。
//   起動時の取得がまだ終わっていなければそれを待ち、失敗していたときだけ 1 回取りに行く
//   （約 800KB を二重に落とさない）。
//
// 2026-11-25（第 2 段階）: 追加項目 racer_ext.json と、公式の選手ページ（Worker /racer-proxy）の取得もここに置く。
//
// 2026-11-26（第 3 段階）: 選手ごとの出走ログ（data/db/racer_log/NN.json）の取得。
//
// Public: _loadRacerProfiles / _racerProfiles / _racerProfilesAt / _loadRacerExt / _racerExt /
//         _loadRacerOfficial / _loadRacerOfficialMany / _racerOfficialOf / _racerOfficialPaused /
//         _loadRacerLog / _racerLogOf (globalThis)

/* global WORKER_BASE */
'use strict';

var _racerProfilesLoading = false;

// 届いたら onLoaded() を呼ぶ（開いている選手ページの描き直し用）。既に在れば何もしない。
function _loadRacerProfiles(onLoaded) {
  if (globalThis._racerProfiles || _racerProfilesLoading) return;
  _racerProfilesLoading = true;
  var startup = globalThis._racerProfilesReady; // loadDeferredData の取得（reject しない）
  var wait = startup && typeof startup.then === 'function' ? startup : Promise.resolve();
  wait
    .then(function () {
      if (globalThis._racerProfiles || typeof fetch !== 'function') return null;
      return fetch('data/db/racerDB.json', { cache: 'no-cache' }).then(function (r) {
        return r.ok ? r.json() : null;
      });
    })
    .then(function (j) {
      if (j && j.racers && !globalThis._racerProfiles) {
        globalThis._racerProfiles = j.racers;
        globalThis._racerProfilesAt = j.updated_at || '';
      }
      if (globalThis._racerProfiles && typeof onLoaded === 'function') onLoaded();
    })
    .catch(function () {})
    .then(function () {
      _racerProfilesLoading = false;
    });
}

globalThis._loadRacerProfiles = _loadRacerProfiles;

// ─── 追加項目（ファン手帳: 生年月日・身長・血液型・登録期・優出 / 優勝・能力指数 …） ──────────────
//   scripts/build_db.py が data/db/racer_ext.json に書く（約 230KB。起動時には読まない）。
//   選手ページを開いた時に 1 回だけ取る。
var _racerExtLoading = false;

function _loadRacerExt(onLoaded) {
  if (globalThis._racerExt || _racerExtLoading || typeof fetch !== 'function') return;
  _racerExtLoading = true;
  fetch('data/db/racer_ext.json', { cache: 'no-cache' })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (!j || !j.racers) return;
      globalThis._racerExt = j;
      if (typeof onLoaded === 'function') onLoaded();
    })
    .catch(function () {})
    .then(function () {
      _racerExtLoading = false;
    });
}

// ─── 公式の選手ページ（今後の出場予定 / 過去 3 節）— Worker /racer-proxy ────────────────────
//   選手詳細を開いた時と、お気に入り一覧の「次節」のためにだけ取る。Worker が edge に 3 時間置くので、
//   同じ選手を何度開いても boatrace.jp への取得は増えない。ここでも 30 分は取り直さない。
//   失敗は 3 分覚えておく（30 秒ごとの描き直しで叩き続けない）。
var RACER_OFFICIAL_TTL_MS = 30 * 60000;
var RACER_OFFICIAL_RETRY_MS = 3 * 60000;
// 待つ上限。公式サイトの応答が遅いと、edge に無い選手の初回取得は 10 秒を超える（本番で 10.9 秒を実測、
//   2 回目以降は 0.1 秒）。Worker は公式への取得を 20 秒で打ち切って 502 を返すので、それより長く待つ。
var RACER_OFFICIAL_TIMEOUT_MS = 25000;
var RACER_OFFICIAL_BATCH_MAX = 20; // 一覧からまとめて取る人数の上限
var RACER_OFFICIAL_BATCH_GAP_MS = 300; // 1 人ずつ、間を空けて取る
// 続けて失敗したら（Worker の停止・公式サイトの拒否・圏外）しばらく誰の分も取りに行かない。
//   お気に入り 20 人を 3 分ごとに取り直し続けるのを防ぐ。1 回でも成功すれば数え直す。
var RACER_OFFICIAL_FAIL_RUN_MAX = 3;
var RACER_OFFICIAL_PAUSE_MS = 10 * 60000;
var _racerOfficialCache = {}; // 登録番号 → { at, data, loading, failed }
var _racerOfficialFailRun = 0;
var _racerOfficialPausedUntil = 0;

// いまの状態: null（未取得）/ { loading, failed, data }。data は取得済みの内容（取り直し中・失敗時も残す）
function _racerOfficialOf(id) {
  return _racerOfficialCache[String(id)] || null;
}

// 続けて失敗して休止中か（時計が戻って残りが不自然に長いときは休止とみなさない）
function _racerOfficialPaused(now) {
  var t = now || Date.now();
  return t < _racerOfficialPausedUntil && _racerOfficialPausedUntil - t <= RACER_OFFICIAL_PAUSE_MS;
}

function _racerOfficialNeeds(id, now) {
  var t = now || Date.now();
  var e = _racerOfficialCache[String(id)];
  if (e && e.loading) return false;
  if (_racerOfficialPaused(t)) return false;
  if (!e) return true;
  var age = t - e.at;
  return age >= (e.failed ? RACER_OFFICIAL_RETRY_MS : RACER_OFFICIAL_TTL_MS) || age < 0;
}

// 取りに行った（true）/ 取りに行く必要が無い・行けない・休止中（false）。終わったら onLoaded(id)。
function _loadRacerOfficial(id, onLoaded, now) {
  id = String(id == null ? '' : id);
  if (!/^\d{4,5}$/.test(id) || !_racerOfficialNeeds(id, now)) return false;
  var base = typeof WORKER_BASE !== 'undefined' && WORKER_BASE ? WORKER_BASE : '';
  if (!base || typeof fetch !== 'function') return false;
  var prev = _racerOfficialCache[id] && _racerOfficialCache[id].data ? _racerOfficialCache[id].data : null;
  _racerOfficialCache[id] = { at: now || Date.now(), data: prev, loading: true, failed: false };
  var opt = {};
  try {
    if (typeof capabilities !== 'undefined' && capabilities && typeof capabilities.makeTimeoutSignal === 'function') {
      opt.signal = capabilities.makeTimeoutSignal(RACER_OFFICIAL_TIMEOUT_MS);
    }
  } catch (_) {}
  var done = function (data) {
    var ok = !!(data && !data.error && Array.isArray(data.schedule));
    _racerOfficialCache[id] = { at: Date.now(), data: ok ? data : prev, loading: false, failed: !ok };
    if (ok) {
      _racerOfficialFailRun = 0;
    } else if (++_racerOfficialFailRun >= RACER_OFFICIAL_FAIL_RUN_MAX) {
      _racerOfficialFailRun = 0;
      _racerOfficialPausedUntil = Date.now() + RACER_OFFICIAL_PAUSE_MS;
    }
    if (typeof onLoaded === 'function') onLoaded(id);
  };
  fetch(base + '/racer-proxy?toban=' + id, opt)
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(done, function () {
      done(null);
    });
  return true;
}

// 一覧用: まだ取っていない選手を、1 人ずつ間を空けて取る（最大 RACER_OFFICIAL_BATCH_MAX 人）
function _loadRacerOfficialMany(ids, onEach) {
  var queue = (ids || [])
    .map(String)
    .filter(function (id) {
      return /^\d{4,5}$/.test(id) && _racerOfficialNeeds(id);
    })
    .slice(0, RACER_OFFICIAL_BATCH_MAX);
  var next = function () {
    var id = queue.shift();
    if (id == null) return;
    var started = _loadRacerOfficial(id, function (rid) {
      if (typeof onEach === 'function') onEach(rid);
      setTimeout(next, RACER_OFFICIAL_BATCH_GAP_MS);
    });
    if (!started) next();
  };
  var n = queue.length;
  next();
  return n;
}

// ─── 出走ログ（日付・場・進入・ST・着順・決まり手）— scripts/build_racer_log.py ──────────────────
//   data/db/racer_log/NN.json（NN = 登録番号 % 100、1 ファイル 10〜20KB）。選手詳細を開いた時に、その選手の
//   入った 1 ファイルだけ取る。前日までの分（当日の分は「本日の出走」が実況の結果から出す）。
var RACER_LOG_SHARDS = 100;
var RACER_LOG_TTL_MS = 30 * 60000;
var RACER_LOG_RETRY_MS = 3 * 60000;
var RACER_LOG_TIMEOUT_MS = 10000;
var _racerLogCache = {}; // shard 番号 → { at, racers, loading, failed }

function _racerLogShard(id) {
  return Number(id) % RACER_LOG_SHARDS;
}

// null（まだ取っていない）/ { loading, failed, rows }。
//   rows: 取れていれば配列（その選手の行が無ければ []）、まだ 1 度も取れていなければ null。
function _racerLogOf(id) {
  if (!/^\d{4,5}$/.test(String(id))) return null;
  var e = _racerLogCache[_racerLogShard(id)];
  if (!e) return null;
  var rows = e.racers ? e.racers[String(id)] : null;
  return { loading: !!e.loading, failed: !!e.failed, rows: e.racers ? (Array.isArray(rows) ? rows : []) : null };
}

// 取りに行った（true）/ 行く必要が無い・行けない（false）。終わったら onLoaded(id)。
function _loadRacerLog(id, onLoaded, now) {
  id = String(id == null ? '' : id);
  if (!/^\d{4,5}$/.test(id) || typeof fetch !== 'function') return false;
  var n = _racerLogShard(id);
  var t = now || Date.now();
  var e = _racerLogCache[n];
  if (e) {
    if (e.loading) return false;
    var age = t - e.at;
    if (age >= 0 && age < (e.failed ? RACER_LOG_RETRY_MS : RACER_LOG_TTL_MS)) return false;
  }
  var prev = e && e.racers ? e.racers : null; // 取り直しに失敗しても、前に取れた内容は残す
  _racerLogCache[n] = { at: t, racers: prev, loading: true, failed: false };
  var opt = { cache: 'no-cache' };
  try {
    if (typeof capabilities !== 'undefined' && capabilities && typeof capabilities.makeTimeoutSignal === 'function') {
      opt.signal = capabilities.makeTimeoutSignal(RACER_LOG_TIMEOUT_MS);
    }
  } catch (_) {}
  var done = function (j) {
    var ok = !!(j && j.racers && typeof j.racers === 'object' && !Array.isArray(j.racers));
    _racerLogCache[n] = { at: Date.now(), racers: ok ? j.racers : prev, loading: false, failed: !ok };
    if (typeof onLoaded === 'function') onLoaded(id);
  };
  fetch('data/db/racer_log/' + (n < 10 ? '0' : '') + n + '.json', opt)
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(done, function () {
      done(null);
    });
  return true;
}

globalThis._loadRacerExt = _loadRacerExt;
globalThis._loadRacerLog = _loadRacerLog;
globalThis._racerLogOf = _racerLogOf;
globalThis._racerLogCache = _racerLogCache;
globalThis._racerOfficialOf = _racerOfficialOf;
globalThis._racerOfficialPaused = _racerOfficialPaused;
globalThis._loadRacerOfficial = _loadRacerOfficial;
globalThis._loadRacerOfficialMany = _loadRacerOfficialMany;
globalThis._racerOfficialCache = _racerOfficialCache;

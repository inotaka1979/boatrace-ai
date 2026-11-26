// 2026-11-27: 閉じている間も届く締切前通知（Web Push）の、アプリ側。
//
//   設定の「閉じている間も通知」を有効にすると、
//     1. 端末に通知の許可を求める
//     2. ブラウザに「通知の宛先」(push subscription) を作ってもらう
//     3. その宛先と、お気に入り選手・何分前かを Cloudflare Worker に預ける（/push/subscribe）
//   以後、Worker が締切の N 分前に通知を送る（アプリを閉じていても届く）。受け取るのは sw.js。
//
//   - お気に入りや分数を変えたら、預けた内容も合わせる（_pushSyncSoon）。同じ内容なら送らない。
//     1 日に 1 回は、変わっていなくても確かめる（Worker 側の記録が消えていたら入れ直す）。
//   - ブラウザ側で宛先が無くなっていたら（通知を拒否した・入れ直した）、無効に戻して画面に出す。
//   - iPhone は、ホーム画面に追加したアプリ（iOS 16.4 以降）でだけ使える。
//   - 通信は discovery 層（src/discovery/push_client.js）。ここでは fetch しない。
//   - rest bundle。起動時の bundle からは呼ばれない。
//
// Public: _pushIsOn / _pushSyncSoon / _pushSync / _syncFavPushUi / _pushEnable / _pushDisable / _pushTest (globalThis)

/* global safeParse, safeSet, ACTION_HANDLERS, _favRacers, _favNotifyMin, _racerDispName, _pushFetchKey, _pushPost */
'use strict';

var PUSH_STATE_KEY = 'boatrace_push'; // { on, key, ep, sig, at, keyAt, lost }
var PUSH_RESYNC_MS = 24 * 3600000;
var PUSH_SYNC_DEBOUNCE_MS = 2500;
var PUSH_TEST_DELAY_SEC = 10;
var PUSH_SW_WAIT_MS = 6000;
var PUSH_KEY_CACHE_MS = 10 * 60000;
var _pushBusy = false;
var _pushMsg = ''; // 操作の結果として画面に出す文（次の操作まで）
var _pushSyncTimer = null;
var _pushKeyCache = null; // { key, at, pending }。設定画面を開いた時に先に取っておく

function _pushState() {
  var s = typeof safeParse === 'function' ? safeParse(PUSH_STATE_KEY, null) : null;
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

function _pushSave(st) {
  if (typeof safeSet === 'function') safeSet(PUSH_STATE_KEY, st);
}

function _pushIsOn() {
  return _pushState().on === true;
}

function _pushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator &&
    !!navigator.serviceWorker &&
    typeof PushManager !== 'undefined' &&
    typeof Notification !== 'undefined'
  );
}

// iPhone / iPad で、ホーム画面に追加していない（Safari のタブで開いている）
function _pushIosNeedsInstall() {
  try {
    var ua = String((navigator && navigator.userAgent) || '');
    var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (!ios) return false;
    var standalone =
      navigator.standalone === true ||
      (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
    return !standalone;
  } catch (_) {
    return false;
  }
}

function _pushB64uToBytes(s) {
  var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var bin = atob(b64);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function _pushBytesToB64u(buf) {
  var bytes = new Uint8Array(buf);
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 預ける内容: お気に入り選手 [[登録番号, 名前]]（登録番号順）と、何分前か
function _pushPayload() {
  var favs = [];
  (typeof _favRacers === 'function' ? _favRacers() : []).forEach(function (f) {
    var id = parseInt(f.id, 10);
    if (id > 0) favs.push([id, typeof _racerDispName === 'function' ? _racerDispName(f.name) : String(f.name || '')]);
  });
  favs.sort(function (a, b) {
    return a[0] - b[0];
  });
  return { favs: favs, lead: typeof _favNotifyMin === 'function' ? _favNotifyMin() : 5 };
}

// 預けた内容が変わったかを見るための短い印
function _pushSigOf(endpoint, payload) {
  var s = endpoint + '|' + payload.lead + '|' + JSON.stringify(payload.favs);
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '.' + s.length;
}

// service worker の登録。しばらく待っても用意できなければ null
function _pushReg() {
  return new Promise(function (resolve) {
    var done = false;
    var finish = function (v) {
      if (done) return;
      done = true;
      resolve(v || null);
    };
    try {
      setTimeout(function () {
        finish(null);
      }, PUSH_SW_WAIT_MS);
      navigator.serviceWorker.ready.then(finish, function () {
        finish(null);
      });
    } catch (_) {
      finish(null);
    }
  });
}

// 送信元の鍵。設定画面を開いた時に先に取っておき、「有効にする」を押してから購読を作るまでに通信を挟まない
//   （iPhone は、ユーザーの操作から時間がたつと購読の作成を断ることがある）。
function _pushKeyNow() {
  var c = _pushKeyCache;
  var now = Date.now();
  if (c && c.key && now - c.at >= 0 && now - c.at < PUSH_KEY_CACHE_MS) return Promise.resolve(c.key);
  if (c && c.pending) return c.pending;
  var pending = _pushFetchKey().then(function (k) {
    _pushKeyCache = k ? { key: k, at: Date.now(), pending: null } : null;
    return k;
  });
  _pushKeyCache = { key: null, at: 0, pending: pending };
  return pending;
}

function _pushCurrentSub(reg) {
  if (!reg || !reg.pushManager) return Promise.resolve(null);
  return reg.pushManager.getSubscription().then(
    function (s) {
      return s || null;
    },
    function () {
      return null;
    }
  );
}

function _pushAskPermission() {
  return new Promise(function (resolve) {
    try {
      if (Notification.permission === 'granted' || Notification.permission === 'denied') {
        resolve(Notification.permission);
        return;
      }
      // 古い Safari は callback で返す
      var r = Notification.requestPermission(function (p) {
        resolve(p);
      });
      if (r && typeof r.then === 'function') {
        r.then(resolve, function () {
          resolve('denied');
        });
      }
    } catch (_) {
      resolve('denied');
    }
  });
}

// 残っている購読が、いまの送信元の鍵で作られたものか（分からなければ、覚えている鍵で判断する）
function _pushSubUsesKey(sub, key) {
  try {
    var k = sub && sub.options && sub.options.applicationServerKey;
    if (k) return _pushBytesToB64u(k) === key;
  } catch (_) {}
  return _pushState().key === key;
}

function _pushSubJson(sub) {
  var j = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
  return { endpoint: j.endpoint, keys: { p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth } };
}

function _pushFail(code) {
  var e = new Error(code);
  e.pushCode = code;
  return e;
}

var PUSH_MESSAGES = {
  denied: '通知が許可されていません。端末の設定でこのアプリの通知を許可してから、もう一度お試しください。',
  no_sw: 'アプリの準備ができていません。少し待ってから、もう一度お試しください。',
  server: 'サーバに接続できませんでした。時間をおいて、もう一度お試しください。',
  full: 'サーバに登録できる数の上限に達しています。',
  busy: '混み合っています。少し待ってから、もう一度お試しください。',
  subscribe: 'この端末では通知の宛先を作れませんでした。',
  rejected: 'サーバに登録できませんでした。',
};

// 預ける（登録・更新）。成功したら状態を保存して true
function _pushUpload(sub, key) {
  var json = _pushSubJson(sub);
  var payload = _pushPayload();
  return _pushPost('/push/subscribe', { sub: json, favs: payload.favs, lead: payload.lead }).then(function (res) {
    if (res.status === 200 && res.data && res.data.ok) {
      var st = _pushState();
      _pushSave({
        on: true,
        key: key || st.key || '',
        ep: json.endpoint,
        sig: _pushSigOf(json.endpoint, payload),
        at: Date.now(),
        keyAt: key ? Date.now() : st.keyAt || 0,
      });
      return true;
    }
    if (res.status === 0) throw _pushFail('server');
    if (res.status === 507) throw _pushFail('full');
    if (res.status === 429) throw _pushFail('busy');
    throw _pushFail('rejected');
  });
}

// 有効にする（ボタンを押した時だけ。通知の許可はユーザーの操作の中でしか求められない）
function _pushEnable() {
  if (_pushBusy) return Promise.resolve(false);
  if (!_pushSupported()) {
    _syncFavPushUi();
    return Promise.resolve(false);
  }
  _pushBusy = true;
  _pushMsg = '設定しています…';
  _syncFavPushUi();
  var reg = null;
  var key = null;
  return _pushAskPermission()
    .then(function (perm) {
      if (perm !== 'granted') throw _pushFail('denied');
      return _pushReg();
    })
    .then(function (r) {
      if (!r || !r.pushManager) throw _pushFail('no_sw');
      reg = r;
      return _pushKeyNow();
    })
    .then(function (k) {
      if (!k) throw _pushFail('server');
      key = k;
      return _pushCurrentSub(reg);
    })
    .then(function (old) {
      // 別の鍵で作った購読が残っていたら作り直す（その鍵では Worker から送れない）
      if (old && !_pushSubUsesKey(old, key)) {
        return old.unsubscribe().then(
          function () {
            return null;
          },
          function () {
            return null;
          }
        );
      }
      return old;
    })
    .then(function (old) {
      if (old) return old;
      return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _pushB64uToBytes(key) }).then(
        function (s) {
          return s;
        },
        function () {
          throw _pushFail('subscribe');
        }
      );
    })
    .then(function (sub) {
      return _pushUpload(sub, key);
    })
    .then(
      function () {
        _pushMsg = '有効にしました。「テスト通知」で、届くかどうかを確かめられます。';
        return true;
      },
      function (e) {
        _pushMsg = PUSH_MESSAGES[(e && e.pushCode) || ''] || PUSH_MESSAGES.rejected;
        return false;
      }
    )
    .then(function (ok) {
      _pushBusy = false;
      _syncFavPushUi();
      return ok;
    });
}

// 無効にする: Worker の記録を消し、ブラウザの購読もやめる
function _pushDisable() {
  if (_pushBusy) return Promise.resolve(false);
  _pushBusy = true;
  _pushMsg = '';
  _syncFavPushUi();
  var st = _pushState();
  return _pushReg()
    .then(_pushCurrentSub)
    .then(function (sub) {
      var ep = (sub && sub.endpoint) || st.ep;
      var gone = ep ? _pushPost('/push/unsubscribe', { endpoint: ep }) : Promise.resolve(null);
      return gone.then(function () {
        if (!sub) return null;
        return sub.unsubscribe().then(
          function () {
            return null;
          },
          function () {
            return null;
          }
        );
      });
    })
    .then(
      function () {},
      function () {}
    )
    .then(function () {
      _pushSave({ on: false });
      _pushMsg = '無効にしました。';
      _pushBusy = false;
      _syncFavPushUi();
      return true;
    });
}

// 預けた内容を、いまのお気に入り・分数に合わせる。送ったら true
function _pushSync(force) {
  var st = _pushState();
  if (st.on !== true || _pushBusy || !_pushSupported()) return Promise.resolve(false);
  var reg = null;
  return _pushReg()
    .then(function (r) {
      reg = r;
      return _pushCurrentSub(r);
    })
    .then(function (sub) {
      if (!reg) return false; // service worker がまだ（次の機会に）
      var granted = false;
      try {
        granted = Notification.permission === 'granted';
      } catch (_) {}
      if (!sub || !granted) {
        // ブラウザ側で宛先が無くなった（通知を拒否した・アプリを入れ直した）
        _pushSave({ on: false, lost: true });
        _pushMsg = ''; // 前の操作の文（「有効にしました」など）を残さない
        _syncFavPushUi();
        return false;
      }
      var payload = _pushPayload();
      var now = Date.now();
      var fresh = st.at && now - st.at >= 0 && now - st.at < PUSH_RESYNC_MS;
      if (!force && fresh && st.sig === _pushSigOf(sub.endpoint, payload)) return false;
      // 1 日に 1 回は鍵も確かめる（Worker の鍵が変わっていたら、その宛先にはもう送れない）
      var keyFresh = st.keyAt && now - st.keyAt >= 0 && now - st.keyAt < PUSH_RESYNC_MS;
      var keyCheck = keyFresh && !force ? Promise.resolve(st.key) : _pushFetchKey();
      return keyCheck.then(function (key) {
        if (key && st.key && key !== st.key) {
          _pushSave({ on: false, lost: true });
          _pushMsg = '';
          _syncFavPushUi();
          return false;
        }
        return _pushUpload(sub, key && !keyFresh ? key : null).then(
          function () {
            _syncFavPushUi();
            return true;
          },
          function () {
            return false; // 次の機会にもう一度（状態は変えない）
          }
        );
      });
    })
    .then(
      function (v) {
        return v;
      },
      function () {
        return false;
      }
    );
}

// お気に入り・分数を変えた直後に呼ぶ（続けて変えても 1 回にまとめる）
function _pushSyncSoon() {
  if (!_pushIsOn()) return false;
  if (_pushSyncTimer) clearTimeout(_pushSyncTimer);
  _pushSyncTimer = setTimeout(function () {
    _pushSyncTimer = null;
    _pushSync(false);
  }, PUSH_SYNC_DEBOUNCE_MS);
  return true;
}

// テスト通知: 10 秒後に Worker から送ってもらう（その間にアプリを閉じて、届くかを確かめる）
function _pushTest() {
  var st = _pushState();
  if (st.on !== true || _pushBusy) return Promise.resolve(false);
  _pushBusy = true;
  _pushMsg = PUSH_TEST_DELAY_SEC + ' 秒後にテスト通知を送ります。アプリを閉じて（ホーム画面に戻って）お待ちください。';
  _syncFavPushUi();
  return _pushReg()
    .then(_pushCurrentSub)
    .then(function (sub) {
      var ep = (sub && sub.endpoint) || st.ep;
      return _pushPost('/push/test', { endpoint: ep, delay: PUSH_TEST_DELAY_SEC }, 45000);
    })
    .then(function (res) {
      var d = res.data || {};
      if (res.status === 200 && d.ok) {
        _pushMsg =
          'テスト通知を送りました。届かないときは、端末の設定でこのアプリの通知が許可されているかをご確認ください。';
        return true;
      }
      if (res.status === 404) {
        // Worker 側に記録が無い → 入れ直す
        _pushBusy = false;
        return _pushSync(true).then(function (ok) {
          _pushMsg = ok ? '登録し直しました。もう一度「テスト通知」をお試しください。' : PUSH_MESSAGES.server;
          return false;
        });
      }
      if (res.status === 429) _pushMsg = PUSH_MESSAGES.busy;
      else if (res.status === 200) {
        _pushMsg =
          '通知を送れませんでした（通知サービスの応答 ' +
          (Number(d.status) || 0) +
          '）。「無効にする」→「有効にする」で登録し直してください。';
      } else _pushMsg = PUSH_MESSAGES.server;
      return false;
    })
    .then(
      function (ok) {
        return ok;
      },
      function () {
        _pushMsg = PUSH_MESSAGES.server;
        return false;
      }
    )
    .then(function (ok) {
      _pushBusy = false;
      _syncFavPushUi();
      return ok;
    });
}

// 設定画面の説明文（操作の結果の文が無いとき）
function _pushDefaultNote(st) {
  if (!_pushSupported()) {
    return _pushIosNeedsInstall()
      ? 'iPhone では、共有メニューの「ホーム画面に追加」で入れたアプリから有効にできます（iOS 16.4 以降）。'
      : 'この端末・ブラウザは、閉じている間の通知（プッシュ通知）に対応していません。';
  }
  if (st.on === true) {
    var p = _pushPayload();
    if (!p.lead) return '有効ですが、上の「お気に入り選手の締切前通知」が「通知しない」のため、通知は届きません。';
    if (!p.favs.length)
      return (
        '有効です。お気に入り選手（★）を登録すると、その選手の出るレースの締切 ' + p.lead + ' 分前に通知が届きます。'
      );
    return (
      '有効です。アプリを閉じていても、お気に入り選手（' +
      p.favs.length +
      ' 人）の出るレースの締切 ' +
      p.lead +
      ' 分前に通知が届きます。'
    );
  }
  if (st.lost) return '通知の登録が無効になっています。もう一度「有効にする」を押してください。';
  return '有効にすると、アプリを閉じていても締切前に通知が届きます。お気に入り選手の一覧と通知の宛先を、このアプリのサーバ（Cloudflare）に保存します。';
}

// opened = 設定画面を開いた時（loadSettings から）。まだ有効でなければ、鍵を先に取っておく
function _syncFavPushUi(opened) {
  if (typeof document === 'undefined') return;
  if (opened === true && _pushSupported() && !_pushIsOn() && !_pushBusy) _pushKeyNow();
  var btn = document.getElementById('btnFavPush');
  var tst = document.getElementById('btnFavPushTest');
  var note = document.getElementById('favPushNote');
  var st = _pushState();
  var on = st.on === true;
  if (btn) {
    btn.textContent = on ? '無効にする' : '有効にする';
    btn.disabled = _pushBusy || (!on && !_pushSupported());
  }
  if (tst) {
    tst.style.display = on ? '' : 'none';
    tst.disabled = _pushBusy;
  }
  if (note) note.textContent = _pushMsg || _pushDefaultNote(st);
}

if (typeof ACTION_HANDLERS === 'object' && ACTION_HANDLERS) {
  ACTION_HANDLERS.favPushToggle = function () {
    return _pushIsOn() ? _pushDisable() : _pushEnable();
  };
  ACTION_HANDLERS.favPushTest = function () {
    return _pushTest();
  };
}

try {
  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    // 「何分前か」を変えたら、預けた内容も合わせる（保存は data-action="saveSetting" が行う）
    document.addEventListener('change', function (ev) {
      var el = ev && ev.target;
      if (el && el.id === 'setFavNotify') {
        _pushMsg = '';
        _pushSyncSoon();
        setTimeout(_syncFavPushUi, 0);
      }
    });
  }
  // 起動のたびに 1 回（1 日たっていなければ、内容が同じなら通信しない）
  if (typeof setTimeout === 'function' && typeof document !== 'undefined') {
    setTimeout(function () {
      _pushSync(false);
    }, 5000);
  }
} catch (_) {}

globalThis._pushIsOn = _pushIsOn;
globalThis._pushSupported = _pushSupported;
globalThis._pushSync = _pushSync;
globalThis._pushSyncSoon = _pushSyncSoon;
globalThis._pushEnable = _pushEnable;
globalThis._pushDisable = _pushDisable;
globalThis._pushTest = _pushTest;
globalThis._syncFavPushUi = _syncFavPushUi;
globalThis._pushPayload = _pushPayload;
globalThis._pushState = _pushState;

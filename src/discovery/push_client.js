// 2026-11-27: Web Push の登録口（Cloudflare Worker の /push/*）との通信。
//   Discovery 層（network IO はここだけ）。設定画面と起動時の同期が使うので rest bundle に置く。
//
//   GET  /push/key          送信元の公開鍵（ブラウザの購読を作るのに要る）
//   POST /push/subscribe    { sub: { endpoint, keys }, favs: [[登録番号, 名前]], lead: 分 }
//   POST /push/unsubscribe  { endpoint }
//   POST /push/test         { endpoint, delay: 秒 }
//
//   POST の本文は text/plain の JSON にする（application/json だとブラウザが事前確認 (preflight) を
//   送る。Worker 側は text/plain でも JSON として読む）。
//
// Public: _pushFetchKey / _pushPost (globalThis)

/* global WORKER_BASE */
'use strict';

var PUSH_API_TIMEOUT_MS = 12000;

function _pushApiBase() {
  return typeof WORKER_BASE !== 'undefined' && WORKER_BASE ? WORKER_BASE : '';
}

function _pushApiOpt(opt, timeoutMs) {
  try {
    if (typeof capabilities !== 'undefined' && capabilities && typeof capabilities.makeTimeoutSignal === 'function') {
      opt.signal = capabilities.makeTimeoutSignal(timeoutMs || PUSH_API_TIMEOUT_MS);
    }
  } catch (_) {}
  return opt;
}

// 送信元の公開鍵（base64url、65 バイト）。取れなければ null
function _pushFetchKey() {
  var base = _pushApiBase();
  if (!base || typeof fetch !== 'function') return Promise.resolve(null);
  return fetch(base + '/push/key', _pushApiOpt({ cache: 'no-store' }))
    .then(function (r) {
      return r && r.ok ? r.json() : null;
    })
    .then(
      function (j) {
        return j && typeof j.key === 'string' && /^[A-Za-z0-9_-]{87}$/.test(j.key) ? j.key : null;
      },
      function () {
        return null;
      }
    );
}

// POST して { status, data } を返す。通信できなければ status 0。reject しない。
function _pushPost(path, body, timeoutMs) {
  var base = _pushApiBase();
  if (!base || typeof fetch !== 'function') return Promise.resolve({ status: 0, data: null });
  var opt = _pushApiOpt(
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  return fetch(base + path, opt)
    .then(function (r) {
      return r.json().then(
        function (j) {
          return { status: r.status, data: j && typeof j === 'object' ? j : null };
        },
        function () {
          return { status: r.status, data: null };
        }
      );
    })
    .then(
      function (x) {
        return x;
      },
      function () {
        return { status: 0, data: null };
      }
    );
}

globalThis._pushFetchKey = _pushFetchKey;
globalThis._pushPost = _pushPost;
